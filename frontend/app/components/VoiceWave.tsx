"use client";

/**
 * VoiceWave — animated audio bars shown while mic-mode is recording.
 *
 * Two modes:
 *  - `level` provided (0–1, from a Web Audio analyser): bars scale to live
 *    amplitude so the wave reacts to the user's voice.
 *  - `level` omitted: bars fall back to a looping CSS shimmer so the control
 *    still feels alive before audio is wired up.
 */

const BAR_COUNT = 28;

export default function VoiceWave({
  active,
  level,
  color = "#22C55E",
  height = 48,
}: {
  active: boolean;
  level?: number; // 0–1 live amplitude
  color?: string;
  height?: number;
}) {
  const bars = Array.from({ length: BAR_COUNT });
  const driven = typeof level === "number";

  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        height,
        opacity: active ? 1 : 0.35,
        transition: "opacity 240ms ease",
      }}
    >
      <style>{`
        @keyframes voiceWaveIdle {
          0%, 100% { transform: scaleY(0.18); }
          50%      { transform: scaleY(1); }
        }
      `}</style>
      {bars.map((_, i) => {
        // Bell-shaped envelope: centre bars taller than the edges.
        const dist = Math.abs(i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
        const envelope = 0.35 + 0.65 * (1 - dist * dist);
        const scale = driven
          ? Math.max(0.12, Math.min(1, (level as number) * 1.6 * envelope))
          : undefined;
        return (
          <span
            key={i}
            style={{
              width: 3,
              height: "100%",
              borderRadius: 4,
              background: color,
              transformOrigin: "center",
              transform: driven ? `scaleY(${scale})` : undefined,
              transition: driven ? "transform 80ms linear" : undefined,
              animation:
                active && !driven
                  ? `voiceWaveIdle ${0.9 + (i % 5) * 0.12}s ease-in-out ${
                      i * 0.04
                    }s infinite`
                  : undefined,
              boxShadow: active ? `0 0 8px ${color}66` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
