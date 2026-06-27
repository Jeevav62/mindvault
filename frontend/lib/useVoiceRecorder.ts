"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useVoiceRecorder — record mic audio and expose a live amplitude `level`
 * (0–1) so a visualizer (e.g. <VoiceWave/>) can react to the voice.
 *
 * start() begins capture; stop() resolves with the recorded Blob (webm/opus
 * where supported). The analyser drives `level` via requestAnimationFrame
 * while recording, then everything is torn down on stop/unmount.
 */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const teardown = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Analyser for the live waveform level.
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        // RMS deviation from the 128 midpoint → 0–1 amplitude.
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.sqrt(sum / data.length));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e: any) {
      setError(e?.message || "Microphone access denied");
      teardown();
    }
  }, [teardown]);

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const rec = mediaRef.current;
      if (!rec || rec.state === "inactive") {
        teardown();
        setRecording(false);
        resolve(null);
        return;
      }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        teardown();
        setRecording(false);
        resolve(blob.size > 0 ? blob : null);
      };
      rec.stop();
    });
  }, [teardown]);

  return { recording, level, error, start, stop };
}
