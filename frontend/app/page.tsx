"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  askStream, clearMemories, clearToken, deleteDoc, extractText,
  generateTitle, getMemories, getToken, getUserId, login, saveToken, signup, uploadDoc,
  type AmbientPayload, type ChatMode, type Citation, type HistoryMessage,
} from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type Msg = {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  mode?: ChatMode;
  streaming?: boolean;
  isError?: boolean;
  retryPayload?: { question: string; attachText?: string | null; attachName?: string | null; imageData?: string | null; imageMime?: string; mode?: ChatMode };
};

type Session = {
  id: string;
  title: string;
  mode: ChatMode;
  messages: Msg[];
  createdAt: number;
  updatedAt: number;
};

type DocFile = { filename: string; chunk_count: number; doc_id: string };

function newSession(mode: ChatMode = "doc"): Session {
  return { id: crypto.randomUUID(), title: "New Chat", mode, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
}

function loadSessions(uid: string): Session[] {
  try { const r = localStorage.getItem(`rag.sessions.${uid}`); return r ? JSON.parse(r) : []; } catch { return []; }
}
function saveSessions(uid: string, s: Session[]) { localStorage.setItem(`rag.sessions.${uid}`, JSON.stringify(s)); }

function groupByDate(sessions: Session[]) {
  const now = Date.now();
  const buckets = [
    { label: "Today",       items: [] as Session[] },
    { label: "Yesterday",   items: [] as Session[] },
    { label: "Last 7 days", items: [] as Session[] },
    { label: "Older",       items: [] as Session[] },
  ];
  for (const s of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const d = (now - s.updatedAt) / 86_400_000;
    if (d < 1) buckets[0].items.push(s);
    else if (d < 2) buckets[1].items.push(s);
    else if (d < 7) buckets[2].items.push(s);
    else            buckets[3].items.push(s);
  }
  return buckets.filter(b => b.items.length > 0);
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [authed, setAuthed] = useState(typeof window !== "undefined" && !!getToken());
  return authed
    ? <AppLayout onLogout={() => setAuthed(false)} />
    : <AuthPage onAuthed={() => setAuthed(true)} />;
}

// ─── Auth Page ────────────────────────────────────────────────────────────────

function AuthPage({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const t = await (mode === "login" ? login : signup)(email, password);
      saveToken(t.access_token);
      onAuthed();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{ background: "var(--bg-solid)" }}
    >
      {/* Background orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div style={{
          position: "absolute", width: 500, height: 500, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(34,197,94,0.07) 0%, transparent 70%)",
          top: "-100px", left: "-100px", animation: "orbitA 18s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", width: 400, height: 400, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)",
          bottom: "-80px", right: "5%", animation: "orbitB 22s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", width: 300, height: 300, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(34,197,94,0.04) 0%, transparent 70%)",
          top: "40%", right: "20%", animation: "orbitC 16s ease-in-out infinite",
        }} />
      </div>

      <div className="w-full max-w-sm relative z-10 anim-fade-up">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="inline-flex flex-col items-center gap-3">
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-black font-bold text-xl"
                style={{ background: "linear-gradient(135deg, #22C55E, #4ADE80)", boxShadow: "0 0 32px rgba(34,197,94,0.4), 0 4px 16px rgba(0,0,0,0.4)" }}
                >R</div>
              <div className="absolute inset-0 rounded-2xl"
                style={{ background: "linear-gradient(135deg, #22C55E, #4ADE80)", filter: "blur(12px)", opacity: 0.3, zIndex: -1 }} />
            </div>
            <div>
              <div className="text-2xl font-bold" style={{ fontFamily: "JetBrains Mono, monospace", letterSpacing: "-0.5px" }}>
                RAG<span style={{ color: "var(--accent)" }}>.</span>chat
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                Upload · Ask · Remember
              </p>
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-7 space-y-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border-strong)", boxShadow: "var(--shadow-lg), inset 0 1px 0 rgba(255,255,255,0.04)" }}>
          <div className="flex rounded-xl p-1 gap-1 mb-5" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
            {(["login", "signup"] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className="flex-1 py-2 rounded-lg text-xs font-semibold cursor-pointer mode-btn"
                style={{
                  background: mode === m ? "var(--accent)" : "transparent",
                  color: mode === m ? "#000" : "var(--text-muted)",
                  fontFamily: "JetBrains Mono, monospace",
                }}>
                {m === "login" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>

          {[
            { type: "email",    placeholder: "Email address", value: email,    onChange: setEmail },
            { type: "password", placeholder: "Password",      value: password, onChange: setPassword },
          ].map((f, i) => (
            <div key={i} className="input-wrap rounded-xl" style={{ border: "1px solid var(--border-strong)", transition: "border-color 200ms, box-shadow 200ms" }}>
              <input
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "var(--surface-2)", color: "var(--text)" }}
                type={f.type} placeholder={f.placeholder} value={f.value}
                onChange={e => f.onChange(e.target.value)} required
              />
            </div>
          ))}

          {error && (
            <div className="rounded-xl px-4 py-3 text-sm anim-fade"
              style={{ color: "#F87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
              {error}
            </div>
          )}

          <button
            disabled={busy}
            className="w-full rounded-xl py-3 text-sm font-semibold cursor-pointer send-btn relative overflow-hidden"
            style={{
              background: busy ? "var(--surface-3)" : "linear-gradient(135deg, #22C55E, #4ADE80)",
              color: busy ? "var(--text-muted)" : "#000",
              fontFamily: "JetBrains Mono, monospace",
              boxShadow: busy ? "none" : "0 0 20px rgba(34,197,94,0.3)",
            }}>
            {busy ? <span className="flex items-center justify-center gap-2"><Spinner size={14} /><span>Signing in…</span></span>
              : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </div>
      </div>
    </main>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"
      style={{ animation: "spin 0.7s linear infinite" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}

// ─── App Layout ───────────────────────────────────────────────────────────────

function AppLayout({ onLogout }: { onLogout: () => void }) {
  const uid = getUserId() ?? "anon";
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = localStorage.getItem("rag.theme") as "dark" | "light" | null;
    if (saved) setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("rag.theme", theme);
  }, [theme]);

  const [sessions, setSessions] = useState<Session[]>(() => {
    if (typeof window === "undefined") return [newSession("doc")];
    const s = loadSessions(uid);
    return s.length > 0 ? s : [newSession("doc")];
  });
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const s = loadSessions(uid);
    return s.length > 0 ? s.sort((a, b) => b.updatedAt - a.updatedAt)[0].id : "";
  });
  const [docs, setDocs] = useState<DocFile[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(`rag.docs.${uid}`) || "[]"); } catch { return []; }
  });
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [docsExpanded, setDocsExpanded] = useState(true);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memories, setMemories] = useState<{ id: string; memory: string }[]>([]);
  const [memBusy, setMemBusy] = useState(false);
  const [memRefreshing, setMemRefreshing] = useState(false);
  const [ambientPayload, setAmbientPayload] = useState<AmbientPayload | null>(null);

  useEffect(() => {
    const ts = new Date().toISOString();
    if (!navigator.geolocation) { setAmbientPayload({ timestamp: ts }); return; }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
            { headers: { "User-Agent": "rag-chat-personal/1.0" } }
          );
          const data = await r.json();
          setAmbientPayload({
            lat, lon, timestamp: ts,
            city: data.address?.city || data.address?.town || data.address?.village || undefined,
            country: data.address?.country || undefined,
          });
        } catch {
          setAmbientPayload({ lat, lon, timestamp: ts });
        }
      },
      () => setAmbientPayload({ timestamp: ts }),
      { timeout: 5000 },
    );
  }, []);

  useEffect(() => { saveSessions(uid, sessions); }, [sessions]);
  useEffect(() => { localStorage.setItem(`rag.docs.${uid}`, JSON.stringify(docs)); }, [docs]);

  const activeSession = sessions.find(s => s.id === activeId) ?? sessions[0];

  function createNewSession(mode: ChatMode = "doc") {
    const s = newSession(mode);
    setSessions(prev => [s, ...prev]);
    setActiveId(s.id);
  }

  function handleSessionUpdate(updated: Session) {
    setSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
  }

  function deleteSession(id: string) {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (next.length === 0) { const s = newSession(); setActiveId(s.id); return [s]; }
      if (id === activeId) setActiveId(next.sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
      return next;
    });
  }

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        createNewSession(activeSession?.mode ?? "doc");
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeSession?.mode]);

  async function handleFile(file: File) {
    setUploadStatus(`Uploading ${file.name}…`);
    try {
      const r = await uploadDoc(file);
      setDocs(d => [...d, { filename: r.filename, chunk_count: r.chunk_count, doc_id: r.doc_id }]);
      setUploadStatus(`✓ ${r.filename} — ${r.chunk_count} chunks`);
      setTimeout(() => setUploadStatus(null), 3500);
    } catch (err: any) { setUploadStatus(`Upload failed: ${err.message}`); }
  }

  async function handleRemoveDoc(docId: string) {
    setDocs(d => d.filter(x => x.doc_id !== docId));
    setSelectedDocIds(s => { const n = new Set(s); n.delete(docId); return n; });
    try { await deleteDoc(docId); } catch {}
  }

  async function openMemory() {
    setMemoryOpen(true);
    if (memories.length === 0) setMemBusy(true);
    else setMemRefreshing(true);
    try { const r = await getMemories(); setMemories(r.items); }
    catch {}
    finally { setMemBusy(false); setMemRefreshing(false); }
  }

  const docFilter = selectedDocIds.size > 0 ? [...selectedDocIds] : null;
  const filteredDocNames = selectedDocIds.size > 0
    ? docs.filter(d => selectedDocIds.has(d.doc_id)).map(d => d.filename)
    : null;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg-solid)" }}>
      {/* ── Sidebar ── */}
      <aside className="flex flex-col w-64 shrink-0 h-full" style={{
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        boxShadow: "2px 0 24px rgba(0,0,0,0.3)",
      }}>
        {/* Logo + New Chat */}
        <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-black font-bold text-xs"
              style={{ background: "linear-gradient(135deg, #22C55E, #4ADE80)", boxShadow: "0 0 12px rgba(34,197,94,0.3)" }}>R</div>
            <span className="font-bold text-sm" style={{ fontFamily: "JetBrains Mono, monospace" }}>
              RAG<span style={{ color: "var(--accent)" }}>.</span>chat
            </span>
          </div>
          <button onClick={() => createNewSession(activeSession?.mode ?? "doc")}
            title="New Chat (Ctrl+Shift+O)"
            className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer btn-icon"
            style={{ color: "var(--text-muted)", background: "var(--surface-2)", border: "1px solid var(--border)" }}
            onMouseOver={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-border)"; (e.currentTarget as HTMLElement).style.color = "var(--accent)"; }}
            onMouseOut={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto py-2">
          {groupByDate(sessions).map(group => (
            <div key={group.label} className="mb-2">
              <p className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-widest"
                style={{ color: "var(--text-subtle)", fontSize: "9.5px", letterSpacing: "0.1em" }}>
                {group.label}
              </p>
              {group.items.map(s => (
                <SessionItem key={s.id} session={s} active={s.id === activeId}
                  onClick={() => setActiveId(s.id)} onDelete={() => deleteSession(s.id)} />
              ))}
            </div>
          ))}
        </div>

        {/* Documents section */}
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={() => setDocsExpanded(!docsExpanded)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs cursor-pointer"
            style={{ color: "var(--text-muted)", transition: "background 140ms" }}
            onMouseOver={e => ((e.currentTarget as HTMLElement).style.background = "var(--surface-hover)")}
            onMouseOut={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}>
            <span className="font-semibold uppercase tracking-widest" style={{ fontSize: "9.5px", letterSpacing: "0.1em" }}>
              Documents {docs.length > 0 ? `(${docs.length})` : ""}
            </span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ transform: docsExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms" }}>
              <polyline points="6,9 12,15 18,9" />
            </svg>
          </button>
          {docsExpanded && (
            <div className="px-3 pb-3 space-y-2">
              <DropZone onFile={handleFile} dragging={dragging} setDragging={setDragging} />
              {uploadStatus && (
                <div className="rounded-lg px-3 py-2 text-xs anim-fade"
                  style={{
                    color: uploadStatus.startsWith("✓") ? "var(--accent)" : uploadStatus.startsWith("Upload") ? "#F87171" : "var(--text-muted)",
                    background: uploadStatus.startsWith("✓") ? "var(--accent-dim)" : "var(--surface-2)",
                    border: `1px solid ${uploadStatus.startsWith("✓") ? "var(--accent-border)" : "var(--border)"}`,
                  }}>
                  {uploadStatus}
                </div>
              )}
              {docs.length > 0 && (
                <ul className="space-y-1">
                  {selectedDocIds.size > 0 && (
                    <div className="flex items-center justify-between px-1 mb-1">
                      <span className="text-xs font-medium" style={{ color: "var(--accent)" }}>{selectedDocIds.size} filtered</span>
                      <button onClick={() => setSelectedDocIds(new Set())} className="text-xs cursor-pointer" style={{ color: "var(--text-muted)" }}>clear</button>
                    </div>
                  )}
                  {docs.map(d => (
                    <DocItem key={d.doc_id} doc={d} selected={selectedDocIds.has(d.doc_id)}
                      onRemove={handleRemoveDoc}
                      onToggle={id => setSelectedDocIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-3 py-3 space-y-0.5" style={{ borderTop: "1px solid var(--border)" }}>
          {[
            {
              icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><ellipse cx="12" cy="12" rx="10" ry="5" /><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(120 12 12)"/></svg>,
              label: "Memory",
              action: openMemory,
            },
            {
              icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
              label: "Logout",
              action: () => { clearToken(); onLogout(); },
            },
          ].map(item => (
            <button key={item.label} onClick={item.action}
              className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs cursor-pointer"
              style={{ color: "var(--text-muted)", transition: "background 140ms, color 140ms" }}
              onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
              onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}>
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
          {/* Theme toggle */}
          <button onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
            className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs cursor-pointer"
            style={{ color: "var(--text-muted)", transition: "background 140ms, color 140ms" }}
            onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
            onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}>
            {theme === "dark"
              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}
            <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      {activeSession && (
        <ChatArea key={activeSession.id} session={activeSession}
          onSessionUpdate={handleSessionUpdate} docFilter={docFilter}
          filteredDocNames={filteredDocNames} ambientPayload={ambientPayload}
          onNewSession={createNewSession} />
      )}

      {/* ── Memory drawer ── */}
      {memoryOpen && (
        <MemoryDrawer memories={memories} busy={memBusy} refreshing={memRefreshing}
          onClose={() => setMemoryOpen(false)}
          onClear={async () => { try { await clearMemories(); setMemories([]); } catch {} }} />
      )}
    </div>
  );
}

// ─── Session Item ─────────────────────────────────────────────────────────────

function SessionItem({ session, active, onClick, onDelete }: {
  session: Session; active: boolean; onClick: () => void; onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const preview = session.messages.find(m => m.role === "assistant")?.text?.slice(0, 55) ?? "";

  return (
    <div className="session-item relative mx-2 rounded-xl px-3 py-2.5 cursor-pointer"
      style={{
        background: active
          ? "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(34,197,94,0.06))"
          : hovered ? "var(--surface-hover)" : "transparent",
        border: `1px solid ${active ? "var(--accent-border)" : "transparent"}`,
        boxShadow: active ? "0 0 12px rgba(34,197,94,0.06)" : "none",
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 mt-0.5" style={{ color: active ? "var(--accent)" : "var(--text-subtle)" }}>
          {session.mode === "doc"
            ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
            : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
        </span>
        <div className="flex-1 min-w-0 pr-4">
          <p className="text-xs font-medium truncate" style={{ color: active ? "var(--text)" : "var(--text-muted)" }}>
            {session.title}
          </p>
          {preview && (
            <p className="text-xs truncate mt-0.5" style={{ color: "var(--text-subtle)", fontSize: "10.5px" }}>
              {preview}
            </p>
          )}
        </div>
      </div>
      {(hovered || active) && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md flex items-center justify-center cursor-pointer btn-icon anim-fade"
          style={{ color: "var(--text-muted)", background: "var(--surface-2)" }}
          onMouseOver={e => { (e.currentTarget as HTMLElement).style.color = "#F87171"; (e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.12)"; }}
          onMouseOut={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLElement).style.background = "var(--surface-2)"; }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      )}
    </div>
  );
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────

function DropZone({ onFile, dragging, setDragging }: { onFile: (f: File) => void; dragging: boolean; setDragging: (v: boolean) => void }) {
  return (
    <label
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className="flex flex-col items-center justify-center gap-1.5 w-full rounded-xl py-4 text-xs cursor-pointer"
      style={{
        border: `1.5px dashed ${dragging ? "var(--accent)" : "var(--border-strong)"}`,
        background: dragging ? "var(--accent-dim)" : "var(--surface-2)",
        color: "var(--text-muted)",
        transition: "all 200ms",
        boxShadow: dragging ? "inset 0 0 12px rgba(34,197,94,0.08)" : "none",
      }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke={dragging ? "var(--accent)" : "currentColor"} strokeWidth="1.5" style={{ transition: "stroke 200ms" }}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17,8 12,3 7,8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <span style={{ color: dragging ? "var(--accent)" : "var(--text-muted)", transition: "color 200ms" }}>
        Drop PDF / TXT
      </span>
      <input type="file" accept=".pdf,.txt,.md" className="hidden"
        onChange={e => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ""; }} />
    </label>
  );
}

// ─── Doc Item ─────────────────────────────────────────────────────────────────

function DocItem({ doc, selected, onRemove, onToggle }: {
  doc: DocFile; selected: boolean; onRemove: (id: string) => void; onToggle: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <li className="doc-item flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs"
      style={{
        background: selected ? "var(--accent-dim)" : hovered ? "var(--surface-hover)" : "var(--surface-2)",
        border: `1px solid ${selected ? "var(--accent-border)" : "var(--border)"}`,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      <input type="checkbox" checked={selected} onChange={() => onToggle(doc.doc_id)}
        className="cursor-pointer shrink-0" style={{ accentColor: "var(--accent)", width: 11, height: 11 }} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" style={{ color: "var(--text)" }}>{doc.filename}</p>
        <p style={{ color: "var(--text-muted)", fontSize: "10px" }}>{doc.chunk_count} chunks</p>
      </div>
      <button onClick={() => onRemove(doc.doc_id)}
        className="shrink-0 rounded w-4 h-4 flex items-center justify-center cursor-pointer btn-icon"
        style={{ opacity: hovered ? 1 : 0, color: "#F87171", pointerEvents: hovered ? "auto" : "none", transition: "opacity 140ms" }}
        onMouseOver={e => ((e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.12)")}
        onMouseOut={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </li>
  );
}

// ─── Chat Area ────────────────────────────────────────────────────────────────

function ChatArea({ session, onSessionUpdate, docFilter, filteredDocNames, ambientPayload, onNewSession }: {
  session: Session; onSessionUpdate: (s: Session) => void;
  docFilter: string[] | null; filteredDocNames: string[] | null;
  ambientPayload: AmbientPayload | null;
  onNewSession: (mode: ChatMode) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>(session.messages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [attach, setAttach] = useState<{ text: string; name: string } | null>(null);
  const [attachImage, setAttachImage] = useState<{ data: string; mime: string; name: string } | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef(session.id);

  useEffect(() => {
    if (session.id !== sessionIdRef.current) {
      setMessages(session.messages);
      sessionIdRef.current = session.id;
    }
  }, [session.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function handleModeSwitch(mode: ChatMode) {
    if (mode === session.mode) return;
    onNewSession(mode);
  }

  async function handleAttachFile(file: File) {
    const isImage = file.type.startsWith("image/");
    setAttachBusy(true);
    setAttach(null);
    setAttachImage(null);
    try {
      if (isImage) {
        await new Promise<void>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target!.result as string;
            const base64 = dataUrl.split(",")[1];
            setAttachImage({ data: base64, mime: file.type, name: file.name });
            resolve();
          };
          reader.readAsDataURL(file);
        });
      } else {
        const result = await extractText(file);
        setAttach({ text: result.text, name: result.filename });
      }
    } catch (err: any) {
      console.error("attach failed:", err.message);
    } finally {
      setAttachBusy(false);
    }
  }

  function autoResizeTextarea() {
    const t = textareaRef.current;
    if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; }
  }

  async function doSend(
    q: string,
    pendingAttach: { text: string; name: string } | null,
    pendingImage: { data: string; mime: string; name: string } | null,
    startingMessages: Msg[],
    sendMode?: ChatMode,
  ) {
    const effectiveMode = sendMode ?? session.mode;
    setBusy(true);
    const isFirst = startingMessages.length === 0;
    const retryPayload = { question: q, attachText: pendingAttach?.text, attachName: pendingAttach?.name, imageData: pendingImage?.data, imageMime: pendingImage?.mime, mode: effectiveMode };
    const userLabel = effectiveMode === "web" ? `🔍 ${q}` : pendingImage ? `${q} [📎 ${pendingImage.name}]` : pendingAttach ? `${q} [📎 ${pendingAttach.name}]` : q;
    const userMsg: Msg = { role: "user", text: userLabel, mode: effectiveMode };
    const baseMessages = [...startingMessages, userMsg];

    setMessages([...baseMessages, { role: "assistant", text: "", citations: [], mode: effectiveMode, streaming: true }]);

    const history: HistoryMessage[] = startingMessages.slice(-20).map(m => ({ role: m.role, content: m.text }));
    let accText = "";
    let accCitations: Citation[] = [];

    const mkError = (msg: string): Msg => ({
      role: "assistant", text: `⚠ ${msg}`, mode: session.mode, isError: true, retryPayload,
    });

    try {
      await askStream(
        q, effectiveMode, effectiveMode === "web" ? null : docFilter,
        citations => {
          accCitations = citations;
          setMessages(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], citations }; return c; });
        },
        token => {
          accText += token;
          flushSync(() => {
            setMessages(m => {
              const c = [...m];
              const last = c[c.length - 1];
              c[c.length - 1] = { ...last, text: last.text + token };
              return c;
            });
          });
        },
        errMsg => {
          const errMsgs = [...baseMessages, mkError(errMsg)];
          setMessages(errMsgs);
          const t = isFirst ? q.slice(0, 48) : session.title;
          onSessionUpdate({ ...session, title: t, messages: errMsgs, updatedAt: Date.now() });
          setBusy(false);
        },
        async () => {
          const finalMsgs = [...baseMessages, { role: "assistant" as const, text: accText, citations: accCitations, mode: session.mode, streaming: false }];
          setMessages(finalMsgs);
          let title = session.title;
          if (isFirst) {
            try { title = await generateTitle(q, accText.slice(0, 300)); } catch { title = q.slice(0, 48); }
          }
          onSessionUpdate({ ...session, title, messages: finalMsgs, updatedAt: Date.now() });
          setBusy(false);
        },
        history,
        pendingAttach?.text ?? null,
        pendingAttach?.name ?? null,
        pendingImage?.data ?? null,
        pendingImage?.mime ?? "image/jpeg",
        ambientPayload,
      );
    } catch (err: any) {
      const errMsgs = [...baseMessages, mkError(err.message)];
      setMessages(errMsgs);
      const t = isFirst ? q.slice(0, 48) : session.title;
      onSessionUpdate({ ...session, title: t, messages: errMsgs, updatedAt: Date.now() });
      setBusy(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const raw = input.trim();
    if (!raw || busy) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    const pendingAttach = attach;
    const pendingImage = attachImage;
    setAttach(null);
    setAttachImage(null);

    let q = raw;
    let sendMode: ChatMode | undefined;
    if (raw.toLowerCase().startsWith("/websearch ")) {
      q = raw.slice(11).trim();
      sendMode = "web";
    }
    if (!q) return;
    await doSend(q, pendingAttach, pendingImage, messages, sendMode);
  }

  function retryMsg(payload: NonNullable<Msg["retryPayload"]>) {
    if (busy) return;
    const pendingAttach = payload.attachText && payload.attachName
      ? { text: payload.attachText, name: payload.attachName }
      : null;
    const pendingImage = payload.imageData
      ? { data: payload.imageData, mime: payload.imageMime ?? "image/jpeg", name: "image" }
      : null;
    doSend(payload.question, pendingAttach, pendingImage, messages.slice(0, -2), payload.mode);
  }

  const subtitle = session.mode === "personal"
    ? "Personal mode · memory + knowledge graph"
    : filteredDocNames && filteredDocNames.length > 0
      ? filteredDocNames.length === 1
        ? `Filtered: ${filteredDocNames[0].slice(0, 40)}`
        : `Filtered: ${filteredDocNames.slice(0, 2).map(n => n.split(".")[0]).join(", ")}${filteredDocNames.length > 2 ? ` +${filteredDocNames.length - 2}` : ""}`
      : "Doc mode · grounded answers · /websearch for live web";

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full" style={{ background: "var(--bg-solid)" }}>
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 py-3.5 shrink-0 glass"
        style={{ borderBottom: "1px solid var(--border)" }}>
        <div>
          <h1 className="text-sm font-semibold leading-tight" style={{ fontFamily: "JetBrains Mono, monospace" }}>
            {session.title === "New Chat" ? "New conversation" : session.title}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: docFilter ? "var(--accent)" : "var(--text-muted)" }}>
            {subtitle}
          </p>
        </div>
        {/* Mode toggle */}
        <div className="flex rounded-xl p-1 gap-0.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          {(["doc", "personal"] as ChatMode[]).map(m => (
            <button key={m} onClick={() => handleModeSwitch(m)}
              className={`mode-btn px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${session.mode === m ? "mode-active" : ""}`}
              style={{
                background: session.mode === m ? "var(--accent)" : "transparent",
                color: session.mode === m ? "#000" : "var(--text-muted)",
                fontFamily: "JetBrains Mono, monospace",
                boxShadow: session.mode === m ? "0 0 10px rgba(34,197,94,0.2)" : "none",
              }}>
              {m === "doc" ? "Doc" : "Personal"}
            </button>
          ))}
        </div>
      </header>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-6 py-8 space-y-7"
        style={{ backgroundImage: "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(34,197,94,0.04) 0%, transparent 100%)" }}>
        {messages.length === 0 ? (
          <EmptyState mode={session.mode} />
        ) : (
          messages.map((m, i) => (
            <MessageBubble key={i} msg={m} index={i} onCitationClick={setActiveCitation} onRetry={retryMsg} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <div className="px-6 py-4 shrink-0 glass" style={{ borderTop: "1px solid var(--border)" }}>
        {/* Attachment preview chips */}
        {(attach || attachImage || attachBusy) && (
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {attachBusy && (
              <div className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                <Spinner size={10} color="currentColor" />
                <span>Reading file…</span>
              </div>
            )}
            {attach && !attachBusy && (
              <div className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs anim-fade"
                style={{ background: "var(--accent-dim)", border: "1px solid var(--accent-border)", color: "var(--accent)" }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
                <span className="max-w-[180px] truncate">{attach.name}</span>
                <button onClick={() => setAttach(null)} className="cursor-pointer hover:opacity-70 ml-0.5">&times;</button>
              </div>
            )}
            {attachImage && !attachBusy && (
              <div className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs anim-fade"
                style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.28)", color: "#818CF8" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:${attachImage.mime};base64,${attachImage.data}`}
                  alt="" className="w-4 h-4 rounded object-cover" />
                <span className="max-w-[160px] truncate">{attachImage.name}</span>
                <button onClick={() => setAttachImage(null)} className="cursor-pointer hover:opacity-70 ml-0.5">&times;</button>
              </div>
            )}
          </div>
        )}
        <form onSubmit={send}>
          <div className="input-wrap flex items-end gap-3 rounded-2xl px-4 py-3"
            style={{ background: "var(--surface)", border: "1px solid var(--border-strong)", transition: "border-color 200ms, box-shadow 200ms" }}>
            {/* Attach button */}
            <button type="button"
              disabled={attachBusy || busy}
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 rounded-lg w-7 h-7 flex items-center justify-center cursor-pointer btn-icon"
              title="Attach file or image"
              style={{
                color: (attach || attachImage) ? "var(--accent)" : "var(--text-muted)",
                background: (attach || attachImage) ? "var(--accent-dim)" : "transparent",
                border: "1px solid transparent",
                transition: "all 150ms",
              }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <input ref={fileInputRef} type="file" className="hidden"
              accept="image/*,.pdf,.txt,.md"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleAttachFile(f); e.target.value = ""; }} />
            <textarea
              ref={textareaRef}
              className="flex-1 resize-none bg-transparent outline-none text-sm leading-relaxed"
              style={{ color: "var(--text)", minHeight: "24px", maxHeight: "140px" }}
              placeholder={
                attachImage ? "Ask about this image…" :
                attach ? "Ask about this file…" :
                session.mode === "doc" ? "Ask about your documents…" : "Chat freely…"
              }
              value={input} rows={1}
              onChange={e => { setInput(e.target.value); autoResizeTextarea(); }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e as any); } }}
            />
            <button type="submit" disabled={busy || !input.trim()}
              className="shrink-0 rounded-xl w-9 h-9 flex items-center justify-center cursor-pointer send-btn"
              style={{
                background: (busy || !input.trim()) ? "var(--surface-2)" : "linear-gradient(135deg, #22C55E, #4ADE80)",
                color: (busy || !input.trim()) ? "var(--text-muted)" : "#000",
                boxShadow: (!busy && input.trim()) ? "0 0 14px rgba(34,197,94,0.3)" : "none",
              }}>
              {busy
                ? <Spinner size={14} color="currentColor" />
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9"/></svg>}
            </button>
          </div>
          <p className="text-xs mt-2 text-center" style={{ color: "var(--text-subtle)" }}>
            Enter to send · Shift+Enter for new line · Ctrl+Shift+O new chat
          </p>
        </form>
      </div>

      {activeCitation && <CitationDrawer citation={activeCitation} onClose={() => setActiveCitation(null)} />}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ mode }: { mode: ChatMode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-16">
      {/* Orbs */}
      <div className="relative mb-8">
        <div className="absolute" style={{ width: 180, height: 180, top: -50, left: -50, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,197,94,0.07) 0%, transparent 70%)", animation: "orbitA 12s ease-in-out infinite" }} />
        <div className="absolute" style={{ width: 120, height: 120, top: -20, right: -40, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.05) 0%, transparent 70%)", animation: "orbitB 16s ease-in-out infinite" }} />

        {/* Icon */}
        <div className="relative z-10 w-16 h-16 rounded-2xl flex items-center justify-center anim-scale-in"
          style={{
            background: "linear-gradient(135deg, rgba(34,197,94,0.15), rgba(34,197,94,0.05))",
            border: "1px solid var(--accent-border)",
            boxShadow: "0 0 32px rgba(34,197,94,0.12)",
          }}>
          {mode === "doc"
            ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>
            : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
        </div>
      </div>

      <div className="anim-fade-up" style={{ animationDelay: "80ms" }}>
        <h2 className="text-xl font-bold mb-2" style={{ fontFamily: "JetBrains Mono, monospace" }}>
          {mode === "doc" ? "Ask your documents" : "Chat with memory"}
        </h2>
        <p className="text-sm max-w-xs leading-relaxed mb-6" style={{ color: "var(--text-muted)" }}>
          {mode === "doc"
            ? "Upload a PDF or text file, then ask anything. Answers are grounded with citations."
            : "I remember facts about you across sessions. Just chat naturally."}
        </p>
        <div className="flex items-center gap-1.5 text-xs rounded-full px-4 py-2 mx-auto w-fit"
          style={{ color: "var(--text-subtle)", background: "var(--surface)", border: "1px solid var(--border)" }}>
          <kbd style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px" }}>Ctrl+Shift+O</kbd>
          <span>new chat</span>
        </div>
      </div>
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, index, onCitationClick, onRetry }: {
  msg: Msg; index: number; onCitationClick: (c: Citation) => void;
  onRetry?: (p: NonNullable<Msg["retryPayload"]>) => void;
}) {
  const delay = `${Math.min(index * 30, 120)}ms`;

  if (msg.role === "user") {
    return (
      <div className="flex justify-end anim-slide-r" style={{ animationDelay: delay }}>
        <div className="max-w-[72%] rounded-2xl rounded-br-sm px-4 py-3 text-sm"
          style={{
            background: "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(34,197,94,0.08))",
            border: "1px solid rgba(34,197,94,0.2)",
            color: "var(--text)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
          }}>
          <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start gap-3 anim-slide-l" style={{ animationDelay: delay }}>
      {/* Bot avatar */}
      <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-black text-xs font-bold mt-0.5 bot-avatar"
        style={{
          background: "linear-gradient(135deg, #22C55E, #4ADE80)",
          fontFamily: "JetBrains Mono, monospace",
        }}>
        R
      </div>

      <div className="max-w-[78%] space-y-2">
        {/* Message card */}
        <div className="rounded-2xl rounded-tl-sm px-4 py-3.5 text-sm"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            color: "var(--text)",
            boxShadow: "var(--shadow-sm)",
          }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
            p: ({ children }) => <p style={{ marginBottom: "8px", lineHeight: 1.7 }} className="last:mb-0">{children}</p>,
            ul: ({ children }) => <ul style={{ paddingLeft: "18px", marginBottom: "8px", lineHeight: 1.7 }}>{children}</ul>,
            ol: ({ children }) => <ol style={{ paddingLeft: "18px", marginBottom: "8px", lineHeight: 1.7 }}>{children}</ol>,
            li: ({ children }) => <li style={{ marginBottom: "4px" }}>{children}</li>,
            strong: ({ children }) => <strong style={{ fontWeight: 600, color: "var(--text)" }}>{children}</strong>,
            em: ({ children }) => <em style={{ color: "var(--text-muted)" }}>{children}</em>,
            a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "2px" }}>{children}</a>,
            blockquote: ({ children }) => <blockquote style={{ borderLeft: "3px solid var(--accent)", paddingLeft: "12px", color: "var(--text-muted)", margin: "8px 0", fontStyle: "italic" }}>{children}</blockquote>,
            code: ({ children, className }) => {
              const isBlock = Boolean(className?.startsWith("language-"));
              return isBlock ? (
                <pre style={{ background: "var(--surface-2)", padding: "14px", borderRadius: "10px", overflow: "auto", fontSize: "12.5px", margin: "10px 0", border: "1px solid var(--border)" }}>
                  <code style={{ fontFamily: "JetBrains Mono, monospace" }}>{children}</code>
                </pre>
              ) : (
                <code style={{ background: "var(--surface-2)", padding: "2px 7px", borderRadius: "5px", fontSize: "12px", fontFamily: "JetBrains Mono, monospace", border: "1px solid var(--border)" }}>{children}</code>
              );
            },
            h1: ({ children }) => <h1 style={{ fontSize: "17px", fontWeight: 700, marginBottom: "10px" }}>{children}</h1>,
            h2: ({ children }) => <h2 style={{ fontSize: "15px", fontWeight: 600, marginBottom: "8px" }}>{children}</h2>,
            h3: ({ children }) => <h3 style={{ fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>{children}</h3>,
            hr: () => <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "12px 0" }} />,
          }}>
            {msg.text || ""}
          </ReactMarkdown>
          {msg.streaming && <span className="stream-cursor" />}
        </div>

        {/* Citations */}
        {msg.citations && msg.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {msg.citations.map((c, j) =>
              c.url ? (
                <a key={j} href={c.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs cursor-pointer btn-icon"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", transition: "all 160ms", textDecoration: "none" }}
                  onMouseOver={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "rgba(99,102,241,0.4)"; el.style.color = "#818CF8"; el.style.background = "rgba(99,102,241,0.08)"; }}
                  onMouseOut={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "var(--border)"; el.style.color = "var(--text-muted)"; el.style.background = "var(--surface)"; }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  {c.source.slice(0, 35)}{c.source.length > 35 ? "…" : ""}
                </a>
              ) : (
                <button key={j} onClick={() => onCitationClick(c)}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs cursor-pointer btn-icon"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", transition: "all 160ms" }}
                  onMouseOver={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "var(--accent-border)"; el.style.color = "var(--accent)"; el.style.background = "var(--accent-dim)"; }}
                  onMouseOut={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "var(--border)"; el.style.color = "var(--text-muted)"; el.style.background = "var(--surface)"; }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
                  {c.source}{c.page_number ? ` · p.${c.page_number}` : ""}
                </button>
              )
            )}
          </div>
        )}

        {/* Retry button on errors */}
        {msg.isError && msg.retryPayload && onRetry && (
          <button
            onClick={() => onRetry(msg.retryPayload!)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs cursor-pointer anim-fade btn-icon"
            style={{ color: "#F87171", border: "1px solid rgba(248,113,113,0.3)", background: "rgba(248,113,113,0.07)", transition: "all 150ms" }}
            onMouseOver={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(248,113,113,0.14)"; el.style.borderColor = "rgba(248,113,113,0.5)"; }}
            onMouseOut={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(248,113,113,0.07)"; el.style.borderColor = "rgba(248,113,113,0.3)"; }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 1 0 .49-3.84"/>
            </svg>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Citation Drawer ──────────────────────────────────────────────────────────

function CitationDrawer({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }} onClick={onClose} />
      <aside className="fixed right-0 top-0 h-full z-50 flex flex-col w-96 anim-drawer"
        style={{ background: "var(--surface)", borderLeft: "1px solid var(--border-strong)", boxShadow: "-12px 0 48px rgba(0,0,0,0.4)" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <h3 className="text-sm font-semibold">Source Passage</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              {citation.source}{citation.page_number ? ` · Page ${citation.page_number}` : ""} · chunk #{citation.chunk_index}
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-xl flex items-center justify-center cursor-pointer btn-icon"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)", background: "var(--surface-2)" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="rounded-xl p-4 text-sm leading-relaxed"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", whiteSpace: "pre-wrap", fontFamily: "IBM Plex Sans, system-ui, sans-serif", lineHeight: 1.75 }}>
            {citation.chunk_text || "No passage text available."}
          </div>
        </div>
        <div className="px-5 py-4" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 text-xs rounded-xl px-4 py-2.5"
            style={{ background: "var(--surface-2)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Relevance score: <span style={{ color: "var(--accent)", fontFamily: "JetBrains Mono, monospace" }}>{citation.score.toFixed(3)}</span>
          </div>
        </div>
      </aside>
    </>
  );
}

// ─── Memory Drawer ────────────────────────────────────────────────────────────

function MemoryDrawer({ memories, busy, refreshing, onClose, onClear }: {
  memories: { id: string; memory: string }[];
  busy: boolean; refreshing: boolean;
  onClose: () => void; onClear: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }} onClick={onClose} />
      <aside className="fixed right-0 top-0 h-full z-50 flex flex-col w-96 anim-drawer"
        style={{ background: "var(--surface)", borderLeft: "1px solid var(--border-strong)", boxShadow: "-12px 0 48px rgba(0,0,0,0.4)" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Long-term Memory</h3>
              {refreshing && <Spinner size={12} color="var(--accent)" />}
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              {memories.length} {memories.length === 1 ? "fact" : "facts"} stored
            </p>
          </div>
          <div className="flex items-center gap-2">
            {memories.length > 0 && (
              <button onClick={onClear}
                className="text-xs px-3 py-1.5 rounded-lg cursor-pointer btn-icon"
                style={{ color: "#F87171", border: "1px solid rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.06)" }}>
                Clear all
              </button>
            )}
            <button onClick={onClose} className="w-7 h-7 rounded-xl flex items-center justify-center cursor-pointer btn-icon"
              style={{ color: "var(--text-muted)", border: "1px solid var(--border)", background: "var(--surface-2)" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {busy ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Spinner size={24} color="var(--accent)" />
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Loading memories…</p>
            </div>
          ) : memories.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="1.5"><ellipse cx="12" cy="12" rx="10" ry="5"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(120 12 12)"/></svg>
              </div>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>No memories yet</p>
              <p className="text-xs max-w-[200px]" style={{ color: "var(--text-subtle)" }}>
                Chat a few turns in Personal mode to start building memory.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {memories.map((m, i) => (
                <li key={m.id}
                  className="rounded-xl px-4 py-3 text-sm anim-fade-up"
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    lineHeight: 1.65,
                    animationDelay: `${i * 35}ms`,
                  }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle" style={{ background: "var(--accent)", verticalAlign: "middle" }} />
                  {m.memory}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
