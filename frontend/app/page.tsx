"use client";

import { useState } from "react";
import {
  ask,
  clearToken,
  getToken,
  login,
  saveToken,
  signup,
  uploadDoc,
  type Citation,
} from "@/lib/api";

type Msg = { role: "user" | "assistant"; text: string; citations?: Citation[] };

export default function Home() {
  const [authed, setAuthed] = useState<boolean>(
    typeof window !== "undefined" && !!getToken()
  );
  return authed ? (
    <Chat onLogout={() => setAuthed(false)} />
  ) : (
    <Auth onAuthed={() => setAuthed(true)} />
  );
}

function Auth({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const fn = mode === "login" ? login : signup;
      const t = await fn(email, password);
      saveToken(t.access_token);
      onAuthed();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-8"
      >
        <h1 className="text-2xl font-semibold">Personal RAG Chatbot</h1>
        <p className="text-sm text-neutral-400">
          {mode === "login" ? "Sign in to continue." : "Create an account."}
        </p>
        <input
          className="w-full rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          type="password"
          placeholder="Password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-indigo-600 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "..." : mode === "login" ? "Sign in" : "Sign up"}
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="w-full text-sm text-neutral-400 hover:text-neutral-200"
        >
          {mode === "login"
            ? "No account? Sign up"
            : "Have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}

function Chat({ onLogout }: { onLogout: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus(`Uploading ${file.name}...`);
    try {
      const r = await uploadDoc(file);
      setStatus(`Indexed ${r.filename}: ${r.chunk_count} chunks.`);
    } catch (err: any) {
      setStatus(`Upload failed: ${err.message}`);
    }
    e.target.value = "";
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      const r = await ask(q);
      setMessages((m) => [
        ...m,
        { role: "assistant", text: r.answer, citations: r.citations },
      ]);
    } catch (err: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Error: ${err.message}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    clearToken();
    onLogout();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col p-4">
      <header className="flex items-center justify-between border-b border-neutral-800 pb-3">
        <h1 className="text-lg font-semibold">Your Documents</h1>
        <div className="flex items-center gap-3">
          <label className="cursor-pointer rounded-lg bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700">
            Upload
            <input
              type="file"
              accept=".pdf,.txt,.md"
              className="hidden"
              onChange={onUpload}
            />
          </label>
          <button
            onClick={logout}
            className="text-sm text-neutral-400 hover:text-neutral-200"
          >
            Logout
          </button>
        </div>
      </header>

      {status && <p className="py-2 text-sm text-indigo-400">{status}</p>}

      <div className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages.length === 0 && (
          <p className="text-neutral-500">
            Upload a PDF or text file, then ask a question about it.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === "user" ? "text-right" : "text-left"}
          >
            <div
              className={
                "inline-block max-w-[85%] rounded-2xl px-4 py-2 " +
                (m.role === "user"
                  ? "bg-indigo-600"
                  : "bg-neutral-800 text-neutral-100")
              }
            >
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.citations && m.citations.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-neutral-400">
                  {m.citations.map((c, j) => (
                    <li key={j}>
                      [{c.source} #{c.chunk_index}] · {c.score.toFixed(3)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={send} className="flex gap-2 border-t border-neutral-800 pt-3">
        <input
          className="flex-1 rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Ask about your documents..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          disabled={busy}
          className="rounded-lg bg-indigo-600 px-4 font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "..." : "Send"}
        </button>
      </form>
    </main>
  );
}
