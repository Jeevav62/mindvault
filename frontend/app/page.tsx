"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ask,
  clearMemories,
  clearToken,
  deleteDoc,
  getMemories,
  getToken,
  login,
  saveToken,
  signup,
  uploadDoc,
  type ChatMode,
  type Citation,
} from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

type Msg = {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  mode?: ChatMode;
};

type DocFile = { filename: string; chunk_count: number; doc_id: string };

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [authed, setAuthed] = useState(
    typeof window !== "undefined" && !!getToken()
  );
  return authed ? (
    <AppLayout onLogout={() => setAuthed(false)} />
  ) : (
    <AuthPage onAuthed={() => setAuthed(true)} />
  );
}

// ─── Auth Page ────────────────────────────────────────────────────────────────

function AuthPage({ onAuthed }: { onAuthed: () => void }) {
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
    <main
      style={{ background: "var(--bg)" }}
      className="min-h-screen flex items-center justify-center p-6"
    >
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div
            className="inline-flex items-center gap-2 mb-3"
            style={{ fontFamily: "JetBrains Mono, monospace" }}
          >
            <span
              className="w-8 h-8 rounded-lg flex items-center justify-center text-black font-bold text-sm"
              style={{ background: "var(--accent)" }}
            >
              R
            </span>
            <span className="text-xl font-semibold" style={{ color: "var(--text)" }}>
              RAG<span style={{ color: "var(--accent)" }}>.</span>chat
            </span>
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
            Upload documents. Ask anything. Get grounded answers.
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={submit}
          className="rounded-2xl p-8 space-y-4"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          <h2
            className="text-lg font-semibold mb-1"
            style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--text)" }}
          >
            {mode === "login" ? "Sign in" : "Create account"}
          </h2>

          <input
            className="w-full rounded-lg px-4 py-2.5 text-sm outline-none transition-all"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
            onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
            onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="w-full rounded-lg px-4 py-2.5 text-sm outline-none transition-all"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
            onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
            onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
            type="password"
            placeholder="Password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && (
            <p className="text-sm rounded-lg px-3 py-2" style={{ color: "#F87171", background: "rgba(248,113,113,0.1)" }}>
              {error}
            </p>
          )}

          <button
            disabled={busy}
            className="w-full rounded-lg py-2.5 text-sm font-semibold transition-all cursor-pointer"
            style={{
              background: busy ? "var(--surface-2)" : "var(--accent)",
              color: busy ? "var(--text-muted)" : "#000",
            }}
          >
            {busy ? "…" : mode === "login" ? "Sign in" : "Sign up"}
          </button>

          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="w-full text-sm transition-colors cursor-pointer"
            style={{ color: "var(--text-muted)" }}
            onMouseOver={(e) => ((e.target as HTMLElement).style.color = "var(--text)")}
            onMouseOut={(e) => ((e.target as HTMLElement).style.color = "var(--text-muted)")}
          >
            {mode === "login" ? "No account? Sign up" : "Have an account? Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

// ─── App Layout ───────────────────────────────────────────────────────────────

function AppLayout({ onLogout }: { onLogout: () => void }) {
  const [docs, setDocs] = useState<DocFile[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memories, setMemories] = useState<{ id: string; memory: string }[]>([]);
  const [memBusy, setMemBusy] = useState(false);

  async function handleFile(file: File) {
    setUploadStatus(`Uploading ${file.name}…`);
    try {
      const r = await uploadDoc(file);
      setDocs((d) => [...d, { filename: r.filename, chunk_count: r.chunk_count, doc_id: r.doc_id }]);
      setUploadStatus(`✓ ${r.filename} — ${r.chunk_count} chunks indexed`);
      setTimeout(() => setUploadStatus(null), 3000);
    } catch (err: any) {
      setUploadStatus(`Upload failed: ${err.message}`);
    }
  }

  async function handleRemoveDoc(docId: string) {
    setDocs((d) => d.filter((x) => x.doc_id !== docId));
    try {
      await deleteDoc(docId);
    } catch {
      // already removed from UI; silently ignore
    }
  }

  async function openMemory() {
    setMemoryOpen(true);
    setMemBusy(true);
    try {
      const r = await getMemories();
      setMemories(r.items);
    } catch {
      setMemories([]);
    } finally {
      setMemBusy(false);
    }
  }

  async function handleClearMemory() {
    try {
      await clearMemories();
      setMemories([]);
    } catch {}
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Sidebar */}
      <aside
        className="flex flex-col w-64 shrink-0 h-full"
        style={{
          background: "var(--surface)",
          borderRight: "1px solid var(--border)",
        }}
      >
        {/* Logo */}
        <div className="px-5 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
          <div
            className="flex items-center gap-2"
            style={{ fontFamily: "JetBrains Mono, monospace" }}
          >
            <span
              className="w-7 h-7 rounded-md flex items-center justify-center text-black font-bold text-xs"
              style={{ background: "var(--accent)" }}
            >
              R
            </span>
            <span className="font-semibold text-sm">
              RAG<span style={{ color: "var(--accent)" }}>.</span>chat
            </span>
          </div>
        </div>

        {/* Upload zone */}
        <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
            Documents
          </p>
          <DropZone onFile={handleFile} dragging={dragging} setDragging={setDragging} />
          {uploadStatus && (
            <p
              className="mt-2 text-xs rounded-md px-2 py-1.5"
              style={{
                color: uploadStatus.startsWith("✓") ? "var(--accent)" : uploadStatus.startsWith("Upload failed") ? "#F87171" : "var(--text-muted)",
                background: "var(--bg)",
              }}
            >
              {uploadStatus}
            </p>
          )}
        </div>

        {/* Doc list */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {docs.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              No documents yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {docs.map((d) => (
                <DocItem key={d.doc_id} doc={d} onRemove={handleRemoveDoc} />
              ))}
            </ul>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-4 py-4 space-y-1" style={{ borderTop: "1px solid var(--border)" }}>
          <button
            onClick={openMemory}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors cursor-pointer"
            style={{ color: "var(--text-muted)" }}
            onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--bg)")}
            onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
              <path d="M12 6v6l4 2" />
            </svg>
            Memory
          </button>
          <button
            onClick={() => { clearToken(); onLogout(); }}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors cursor-pointer"
            style={{ color: "var(--text-muted)" }}
            onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--bg)")}
            onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16,17 21,12 16,7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Chat */}
      <ChatArea />

      {/* Memory drawer */}
      {memoryOpen && (
        <MemoryDrawer
          memories={memories}
          busy={memBusy}
          onClose={() => setMemoryOpen(false)}
          onClear={handleClearMemory}
        />
      )}
    </div>
  );
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────

function DropZone({
  onFile,
  dragging,
  setDragging,
}: {
  onFile: (f: File) => void;
  dragging: boolean;
  setDragging: (v: boolean) => void;
}) {
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className="flex flex-col items-center justify-center gap-1.5 w-full rounded-xl py-5 text-xs transition-all cursor-pointer"
      style={{
        border: `1.5px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
        background: dragging ? "rgba(34,197,94,0.05)" : "var(--bg)",
        color: "var(--text-muted)",
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={dragging ? "var(--accent)" : "currentColor"} strokeWidth="1.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17,8 12,3 7,8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <span style={{ color: dragging ? "var(--accent)" : "var(--text-muted)" }}>
        Drop PDF or TXT
      </span>
      <span style={{ color: "var(--surface-2)" }}>or click to browse</span>
      <input type="file" accept=".pdf,.txt,.md" className="hidden" onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ""; }} />
    </label>
  );
}

// ─── Doc Item ─────────────────────────────────────────────────────────────────

function DocItem({ doc, onRemove }: { doc: DocFile; onRemove: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <li
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs group"
      style={{
        background: hovered ? "var(--surface-2)" : "var(--bg)",
        border: "1px solid var(--border)",
        transition: "background 150ms",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <svg className="shrink-0 mt-0.5" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14,2 14,8 20,8" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" style={{ color: "var(--text)" }}>
          {doc.filename}
        </p>
        <p style={{ color: "var(--text-muted)" }}>{doc.chunk_count} chunks</p>
      </div>
      <button
        onClick={() => onRemove(doc.doc_id)}
        className="shrink-0 rounded-md w-5 h-5 flex items-center justify-center transition-all cursor-pointer"
        style={{
          opacity: hovered ? 1 : 0,
          background: "transparent",
          color: "#F87171",
          pointerEvents: hovered ? "auto" : "none",
        }}
        title="Remove document"
        onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.15)")}
        onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </li>
  );
}

// ─── Chat Area ────────────────────────────────────────────────────────────────

function ChatArea() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ChatMode>("doc");
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q, mode }]);
    setBusy(true);
    try {
      const r = await ask(q, mode);
      setMessages((m) => [
        ...m,
        { role: "assistant", text: r.answer, citations: r.citations, mode },
      ]);
    } catch (err: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Error: ${err.message}`, mode },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Header */}
      <header
        className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div>
          <h1
            className="text-base font-semibold"
            style={{ fontFamily: "JetBrains Mono, monospace" }}
          >
            Chat
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {mode === "doc" ? "Grounded on your uploaded documents" : "Free conversation with memory"}
          </p>
        </div>

        {/* Mode toggle */}
        <div
          className="flex rounded-lg p-1 gap-1"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          {(["doc", "personal"] as ChatMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer"
              style={{
                background: mode === m ? "var(--accent)" : "transparent",
                color: mode === m ? "#000" : "var(--text-muted)",
                fontFamily: mode === m ? "JetBrains Mono, monospace" : undefined,
              }}
            >
              {m === "doc" ? "Doc Chat" : "Personal"}
            </button>
          ))}
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="font-medium mb-1" style={{ fontFamily: "JetBrains Mono, monospace" }}>
              {mode === "doc" ? "Ask about your documents" : "Chat freely"}
            </p>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {mode === "doc"
                ? "Upload a PDF or text file in the sidebar, then ask anything about it."
                : "I remember our past conversations. Tell me anything about yourself."}
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            msg={m}
            onCitationClick={setActiveCitation}
          />
        ))}

        {busy && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={send}
        className="px-6 py-4 shrink-0"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div
          className="flex items-end gap-3 rounded-xl px-4 py-3"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <textarea
            className="flex-1 resize-none bg-transparent outline-none text-sm leading-relaxed"
            style={{ color: "var(--text)", minHeight: "24px", maxHeight: "120px" }}
            placeholder={mode === "doc" ? "Ask about your documents…" : "Chat freely…"}
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(e as any);
              }
            }}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="shrink-0 rounded-lg w-8 h-8 flex items-center justify-center transition-all cursor-pointer"
            style={{
              background: busy || !input.trim() ? "var(--surface-2)" : "var(--accent)",
              color: busy || !input.trim() ? "var(--text-muted)" : "#000",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22,2 15,22 11,13 2,9" />
            </svg>
          </button>
        </div>
        <p className="text-xs mt-2 text-center" style={{ color: "var(--surface-2)" }}>
          Enter to send · Shift+Enter for new line
        </p>
      </form>

      {/* Citation drawer */}
      {activeCitation && (
        <CitationDrawer
          citation={activeCitation}
          onClose={() => setActiveCitation(null)}
        />
      )}
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  onCitationClick,
}: {
  msg: Msg;
  onCitationClick: (c: Citation) => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[70%] rounded-2xl rounded-br-sm px-4 py-3 text-sm"
          style={{ background: "var(--surface-2)", color: "var(--text)" }}
        >
          <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start gap-3">
      <div
        className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center text-black text-xs font-bold mt-0.5"
        style={{ background: "var(--accent)", fontFamily: "JetBrains Mono, monospace" }}
      >
        R
      </div>
      <div className="max-w-[75%] space-y-2">
        <div
          className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
        >
          <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
        </div>
        {msg.citations && msg.citations.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {msg.citations.map((c, j) => (
              <button
                key={j}
                onClick={() => onCitationClick(c)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-all cursor-pointer"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                }}
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
                  (e.currentTarget as HTMLElement).style.color = "var(--accent)";
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                  (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                </svg>
                {c.source}
                {c.page_number ? ` · p.${c.page_number}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <div
        className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center text-black text-xs font-bold"
        style={{ background: "var(--accent)", fontFamily: "JetBrains Mono, monospace" }}
      >
        R
      </div>
      <div
        className="rounded-2xl rounded-tl-sm px-4 py-3"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full animate-bounce"
              style={{
                background: "var(--text-muted)",
                animationDelay: `${i * 150}ms`,
                animationDuration: "800ms",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Citation Drawer ──────────────────────────────────────────────────────────

function CitationDrawer({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.5)" }}
        onClick={onClose}
      />
      <aside
        className="fixed right-0 top-0 h-full z-50 flex flex-col w-96"
        style={{
          background: "var(--surface)",
          borderLeft: "1px solid var(--border)",
          animation: "slideIn 200ms ease-out",
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <h3
              className="text-sm font-semibold"
              style={{ fontFamily: "JetBrains Mono, monospace" }}
            >
              Source Passage
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              {citation.source}
              {citation.page_number ? ` · Page ${citation.page_number}` : ""}
              {" · "}chunk #{citation.chunk_index}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
            style={{ color: "var(--text-muted)" }}
            onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--surface-2)")}
            onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div
            className="rounded-xl p-4 text-sm leading-relaxed"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              fontFamily: "IBM Plex Sans, sans-serif",
              whiteSpace: "pre-wrap",
            }}
          >
            {citation.chunk_text || "No passage text available."}
          </div>
        </div>

        <div className="px-5 py-4" style={{ borderTop: "1px solid var(--border)" }}>
          <div
            className="flex items-center gap-2 text-xs rounded-lg px-3 py-2"
            style={{ background: "var(--bg)", color: "var(--text-muted)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Relevance score: {citation.score.toFixed(3)}
          </div>
        </div>
      </aside>
      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </>
  );
}

// ─── Memory Drawer ────────────────────────────────────────────────────────────

function MemoryDrawer({
  memories,
  busy,
  onClose,
  onClear,
}: {
  memories: { id: string; memory: string }[];
  busy: boolean;
  onClose: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.5)" }}
        onClick={onClose}
      />
      <aside
        className="fixed right-0 top-0 h-full z-50 flex flex-col w-96"
        style={{
          background: "var(--surface)",
          borderLeft: "1px solid var(--border)",
          animation: "slideIn 200ms ease-out",
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <h3
              className="text-sm font-semibold"
              style={{ fontFamily: "JetBrains Mono, monospace" }}
            >
              Long-term Memory
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              {memories.length} facts stored about you
            </p>
          </div>
          <div className="flex items-center gap-2">
            {memories.length > 0 && (
              <button
                onClick={onClear}
                className="text-xs px-2.5 py-1 rounded-md transition-all cursor-pointer"
                style={{ color: "#F87171", border: "1px solid rgba(248,113,113,0.3)" }}
                onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.1)")}
                onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                Clear all
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
              style={{ color: "var(--text-muted)" }}
              onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--surface-2)")}
              onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {busy ? (
            <div className="flex items-center justify-center py-12">
              <div
                className="w-5 h-5 rounded-full border-2 animate-spin"
                style={{ borderColor: "var(--surface-2)", borderTopColor: "var(--accent)" }}
              />
            </div>
          ) : memories.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No memories yet. Chat a few turns to build memory.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {memories.map((m) => (
                <li
                  key={m.id}
                  className="rounded-lg px-4 py-3 text-sm"
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                >
                  {m.memory}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </>
  );
}
