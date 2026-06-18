"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  askStream, clearMemories, clearToken, deleteDoc, getMemories,
  getToken, getUserId, login, saveToken, signup, uploadDoc,
  type ChatMode, type Citation,
} from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type Msg = {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  mode?: ChatMode;
  streaming?: boolean;
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
  const buckets = [{ label: "Today", items: [] as Session[] }, { label: "Yesterday", items: [] as Session[] }, { label: "Last 7 days", items: [] as Session[] }, { label: "Older", items: [] as Session[] }];
  for (const s of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const d = (now - s.updatedAt) / 86_400_000;
    if (d < 1) buckets[0].items.push(s);
    else if (d < 2) buckets[1].items.push(s);
    else if (d < 7) buckets[2].items.push(s);
    else buckets[3].items.push(s);
  }
  return buckets.filter(b => b.items.length > 0);
}

// ─── Global Styles ────────────────────────────────────────────────────────────

const GLOBAL_STYLES = `
@keyframes fadeInUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
@keyframes fadeInLeft { from { opacity:0; transform:translateX(-14px); } to { opacity:1; transform:translateX(0); } }
@keyframes fadeInRight { from { opacity:0; transform:translateX(14px); } to { opacity:1; transform:translateX(0); } }
@keyframes slideInDrawer { from { transform:translateX(100%); } to { transform:translateX(0); } }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
@keyframes typingDot { 0%,60%,100%{opacity:.25;transform:scale(.8)} 30%{opacity:1;transform:scale(1.15)} }
@keyframes spinIn { from{opacity:0;transform:rotate(-90deg) scale(.5)} to{opacity:1;transform:rotate(0) scale(1)} }
@keyframes pulseGlow { 0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.4)} 50%{box-shadow:0 0 0 6px rgba(34,197,94,0)} }

.msg-user { animation: fadeInRight 240ms cubic-bezier(.22,1,.36,1) both; }
.msg-bot  { animation: fadeInLeft  240ms cubic-bezier(.22,1,.36,1) both; }
.session-item { transition: background 160ms, border-color 160ms, transform 160ms; }
.session-item:hover { transform: translateX(2px); }
.send-btn { transition: background 160ms, transform 120ms, box-shadow 160ms; }
.send-btn:not(:disabled):hover { transform: scale(1.05); box-shadow: 0 0 12px rgba(34,197,94,.45); }
.send-btn:not(:disabled):active { transform: scale(.95); }
.mode-btn { transition: background 200ms, color 200ms, transform 150ms; }
.mode-btn:hover:not(.mode-active) { transform: translateY(-1px); }
.doc-item { transition: background 150ms, border-color 150ms, transform 150ms; }
.doc-item:hover { transform: translateX(2px); }
`;

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [authed, setAuthed] = useState(typeof window !== "undefined" && !!getToken());
  return (
    <>
      <style>{GLOBAL_STYLES}</style>
      {authed ? <AppLayout onLogout={() => setAuthed(false)} /> : <AuthPage onAuthed={() => setAuthed(true)} />}
    </>
  );
}

// ─── Auth Page ────────────────────────────────────────────────────────────────

function AuthPage({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try { const t = await (mode === "login" ? login : signup)(email, password); saveToken(t.access_token); onAuthed(); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <main style={{ background: "var(--bg)" }} className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md" style={{ animation: "fadeInUp 320ms cubic-bezier(.22,1,.36,1) both" }}>
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-3" style={{ fontFamily: "JetBrains Mono, monospace" }}>
            <span className="w-9 h-9 rounded-xl flex items-center justify-center text-black font-bold text-sm" style={{ background: "var(--accent)", boxShadow: "0 0 20px rgba(34,197,94,.4)" }}>R</span>
            <span className="text-xl font-semibold" style={{ color: "var(--text)" }}>RAG<span style={{ color: "var(--accent)" }}>.</span>chat</span>
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Upload documents. Ask anything. Get grounded answers.</p>
        </div>
        <form onSubmit={submit} className="rounded-2xl p-8 space-y-4" style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,.3)" }}>
          <h2 className="text-lg font-semibold mb-1" style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--text)" }}>{mode === "login" ? "Sign in" : "Create account"}</h2>
          {[{ type: "email", placeholder: "Email", value: email, onChange: setEmail }, { type: "password", placeholder: "Password (min 8 chars)", value: password, onChange: setPassword }].map((f, i) => (
            <input key={i} className="w-full rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", transition: "border-color 180ms" }}
              onFocus={e => (e.target.style.borderColor = "var(--accent)")} onBlur={e => (e.target.style.borderColor = "var(--border)")}
              type={f.type} placeholder={f.placeholder} value={f.value} onChange={e => f.onChange(e.target.value)} required />
          ))}
          {error && <p className="text-sm rounded-lg px-3 py-2" style={{ color: "#F87171", background: "rgba(248,113,113,.1)" }}>{error}</p>}
          <button disabled={busy} className="w-full rounded-lg py-2.5 text-sm font-semibold cursor-pointer send-btn"
            style={{ background: busy ? "var(--surface-2)" : "var(--accent)", color: busy ? "var(--text-muted)" : "#000" }}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Sign up"}
          </button>
          <button type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="w-full text-sm cursor-pointer" style={{ color: "var(--text-muted)", transition: "color 160ms" }}
            onMouseOver={e => ((e.target as HTMLElement).style.color = "var(--text)")}
            onMouseOut={e => ((e.target as HTMLElement).style.color = "var(--text-muted)")}>
            {mode === "login" ? "No account? Sign up" : "Have an account? Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

// ─── App Layout ───────────────────────────────────────────────────────────────

function AppLayout({ onLogout }: { onLogout: () => void }) {
  const uid = getUserId() ?? "anon";

  const [sessions, setSessions] = useState<Session[]>(() => {
    if (typeof window === "undefined") return [newSession("doc")];
    const s = loadSessions(uid); return s.length > 0 ? s : [newSession("doc")];
  });
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const s = loadSessions(uid); return s.length > 0 ? s.sort((a, b) => b.updatedAt - a.updatedAt)[0].id : "";
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
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); createNewSession(activeSession?.mode ?? "doc"); }
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
      setTimeout(() => setUploadStatus(null), 3000);
    } catch (err: any) { setUploadStatus(`Upload failed: ${err.message}`); }
  }

  async function handleRemoveDoc(docId: string) {
    setDocs(d => d.filter(x => x.doc_id !== docId));
    setSelectedDocIds(s => { const n = new Set(s); n.delete(docId); return n; });
    try { await deleteDoc(docId); } catch {}
  }

  async function openMemory() {
    setMemoryOpen(true);
    // If we have cached memories, show them instantly — refresh silently in background.
    // If empty cache, show spinner (first open).
    if (memories.length === 0) setMemBusy(true);
    else setMemRefreshing(true);
    try { const r = await getMemories(); setMemories(r.items); }
    catch { /* keep stale data on error */ }
    finally { setMemBusy(false); setMemRefreshing(false); }
  }

  const docFilter = selectedDocIds.size > 0 ? [...selectedDocIds] : null;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Sidebar */}
      <aside className="flex flex-col w-64 shrink-0 h-full" style={{ background: "var(--surface)", borderRight: "1px solid var(--border)", boxShadow: "2px 0 12px rgba(0,0,0,.15)" }}>
        {/* Logo + New Chat */}
        <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2" style={{ fontFamily: "JetBrains Mono, monospace" }}>
            <span className="w-7 h-7 rounded-md flex items-center justify-center text-black font-bold text-xs" style={{ background: "var(--accent)", boxShadow: "0 0 10px rgba(34,197,94,.3)" }}>R</span>
            <span className="font-semibold text-sm">RAG<span style={{ color: "var(--accent)" }}>.</span>chat</span>
          </div>
          <button onClick={() => createNewSession(activeSession?.mode ?? "doc")} title="New Chat (Ctrl+Shift+O)"
            className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer send-btn"
            style={{ color: "var(--text-muted)", background: "transparent", border: "1px solid var(--border)" }}
            onMouseOver={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLElement).style.color = "var(--accent)"; }}
            onMouseOut={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>

        {/* Sessions */}
        <div className="flex-1 overflow-y-auto py-2">
          {groupByDate(sessions).map(group => (
            <div key={group.label} className="mb-1">
              <p className="px-4 py-1 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--surface-2)", fontSize: "10px" }}>{group.label}</p>
              {group.items.map(s => (
                <SessionItem key={s.id} session={s} active={s.id === activeId} onClick={() => setActiveId(s.id)} onDelete={() => deleteSession(s.id)} />
              ))}
            </div>
          ))}
        </div>

        {/* Documents */}
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={() => setDocsExpanded(!docsExpanded)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-widest cursor-pointer"
            style={{ color: "var(--text-muted)", fontSize: "10px", transition: "background 150ms" }}
            onMouseOver={e => ((e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.03)")}
            onMouseOut={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}>
            <span>Documents {docs.length > 0 ? `(${docs.length})` : ""}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ transform: docsExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms" }}>
              <polyline points="6,9 12,15 18,9" />
            </svg>
          </button>
          {docsExpanded && (
            <div className="px-3 pb-3">
              <DropZone onFile={handleFile} dragging={dragging} setDragging={setDragging} />
              {uploadStatus && (
                <p className="mt-1.5 text-xs rounded-md px-2 py-1" style={{ color: uploadStatus.startsWith("✓") ? "var(--accent)" : uploadStatus.startsWith("Upload failed") ? "#F87171" : "var(--text-muted)", background: "var(--bg)" }}>
                  {uploadStatus}
                </p>
              )}
              {docs.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {selectedDocIds.size > 0 && (
                    <div className="flex items-center justify-between mb-1 px-1">
                      <span className="text-xs" style={{ color: "var(--accent)" }}>{selectedDocIds.size} filtered</span>
                      <button onClick={() => setSelectedDocIds(new Set())} className="text-xs cursor-pointer" style={{ color: "var(--text-muted)" }}>clear</button>
                    </div>
                  )}
                  {docs.map(d => <DocItem key={d.doc_id} doc={d} selected={selectedDocIds.has(d.doc_id)} onRemove={handleRemoveDoc}
                    onToggle={id => setSelectedDocIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })} />)}
                  {docs.length > 1 && <p className="text-xs px-1 mt-1" style={{ color: "var(--surface-2)" }}>Check docs to filter chat</p>}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-3 space-y-0.5" style={{ borderTop: "1px solid var(--border)" }}>
          {[
            { icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" /><path d="M12 6v6l4 2" /></svg>, label: "Memory", action: openMemory },
            { icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16,17 21,12 16,7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>, label: "Logout", action: () => { clearToken(); onLogout(); } },
          ].map(item => (
            <button key={item.label} onClick={item.action}
              className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs cursor-pointer"
              style={{ color: "var(--text-muted)", transition: "background 150ms, color 150ms" }}
              onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
              onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}>
              {item.icon}{item.label}
            </button>
          ))}
        </div>
      </aside>

      {activeSession && (
        <ChatArea key={activeSession.id} session={activeSession} onSessionUpdate={handleSessionUpdate}
          docFilter={docFilter} onNewSession={createNewSession} />
      )}

      {memoryOpen && (
        <MemoryDrawer memories={memories} busy={memBusy} refreshing={memRefreshing} onClose={() => setMemoryOpen(false)}
          onClear={async () => { try { await clearMemories(); setMemories([]); } catch {} }} />
      )}
    </div>
  );
}

// ─── Session Item ─────────────────────────────────────────────────────────────

function SessionItem({ session, active, onClick, onDelete }: { session: Session; active: boolean; onClick: () => void; onDelete: () => void; }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div className="session-item flex items-center gap-2 mx-2 rounded-lg px-2 py-2 cursor-pointer"
      style={{ background: active ? "rgba(34,197,94,.12)" : hovered ? "rgba(255,255,255,.04)" : "transparent", border: `1px solid ${active ? "rgba(34,197,94,.25)" : "transparent"}` }}
      onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <span className="shrink-0" style={{ color: active ? "var(--accent)" : "var(--surface-2)" }}>
        {session.mode === "doc"
          ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /></svg>
          : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>}
      </span>
      <span className="flex-1 text-xs truncate" style={{ color: active ? "var(--text)" : "var(--text-muted)" }}>{session.title}</span>
      {(hovered || active) && (
        <button onClick={e => { e.stopPropagation(); onDelete(); }} className="shrink-0 w-5 h-5 rounded flex items-center justify-center cursor-pointer"
          style={{ color: "var(--text-muted)", transition: "color 120ms" }}
          onMouseOver={e => ((e.currentTarget as HTMLElement).style.color = "#F87171")}
          onMouseOut={e => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      )}
    </div>
  );
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────

function DropZone({ onFile, dragging, setDragging }: { onFile: (f: File) => void; dragging: boolean; setDragging: (v: boolean) => void }) {
  return (
    <label onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className="flex flex-col items-center justify-center gap-1 w-full rounded-xl py-4 text-xs cursor-pointer"
      style={{ border: `1.5px dashed ${dragging ? "var(--accent)" : "var(--border)"}`, background: dragging ? "rgba(34,197,94,.05)" : "var(--bg)", color: "var(--text-muted)", transition: "all 200ms" }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={dragging ? "var(--accent)" : "currentColor"} strokeWidth="1.5" style={{ transition: "stroke 200ms" }}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17,8 12,3 7,8" /><line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <span style={{ color: dragging ? "var(--accent)" : "var(--text-muted)", transition: "color 200ms" }}>Drop PDF or TXT</span>
      <input type="file" accept=".pdf,.txt,.md" className="hidden" onChange={e => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ""; }} />
    </label>
  );
}

// ─── Doc Item ─────────────────────────────────────────────────────────────────

function DocItem({ doc, selected, onRemove, onToggle }: { doc: DocFile; selected: boolean; onRemove: (id: string) => void; onToggle: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <li className="doc-item flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs"
      style={{ background: selected ? "rgba(34,197,94,.08)" : hovered ? "rgba(255,255,255,.04)" : "var(--bg)", border: `1px solid ${selected ? "rgba(34,197,94,.3)" : "var(--border)"}` }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <input type="checkbox" checked={selected} onChange={() => onToggle(doc.doc_id)} className="cursor-pointer shrink-0" style={{ accentColor: "var(--accent)", width: "11px", height: "11px" }} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" style={{ color: "var(--text)" }}>{doc.filename}</p>
        <p style={{ color: "var(--text-muted)" }}>{doc.chunk_count} chunks</p>
      </div>
      <button onClick={() => onRemove(doc.doc_id)} className="shrink-0 rounded w-4 h-4 flex items-center justify-center cursor-pointer"
        style={{ opacity: hovered ? 1 : 0, color: "#F87171", transition: "opacity 150ms", pointerEvents: hovered ? "auto" : "none" }}
        onMouseOver={e => ((e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,.15)")}
        onMouseOut={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </li>
  );
}

// ─── Chat Area ────────────────────────────────────────────────────────────────

function ChatArea({ session, onSessionUpdate, docFilter, onNewSession }: {
  session: Session; onSessionUpdate: (s: Session) => void;
  docFilter: string[] | null; onNewSession: (mode: ChatMode) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>(session.messages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(session.id);

  useEffect(() => {
    if (session.id !== sessionIdRef.current) { setMessages(session.messages); sessionIdRef.current = session.id; }
  }, [session.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function handleModeSwitch(mode: ChatMode) {
    if (mode === session.mode) return;
    // Mode switch always opens a fresh session — never changes an existing session's mode
    onNewSession(mode);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setInput(""); setBusy(true);

    const isFirst = messages.length === 0;
    const autoTitle = isFirst ? q.slice(0, 45) + (q.length > 45 ? "…" : "") : session.title;
    const userMsg: Msg = { role: "user", text: q, mode: session.mode };
    const baseMessages = [...messages, userMsg];

    setMessages(m => [...m, userMsg, { role: "assistant", text: "", citations: [], mode: session.mode, streaming: true }]);

    let accText = ""; let accCitations: Citation[] = [];

    try {
      await askStream(q, session.mode, docFilter,
        citations => { accCitations = citations; setMessages(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], citations }; return c; }); },
        token => {
          accText += token;
          flushSync(() => { setMessages(m => { const c = [...m]; const last = c[c.length - 1]; c[c.length - 1] = { ...last, text: last.text + token }; return c; }); });
        },
        errMsg => {
          const errMsgs = [...baseMessages, { role: "assistant" as const, text: `Error: ${errMsg}`, mode: session.mode }];
          setMessages(errMsgs); onSessionUpdate({ ...session, title: autoTitle, messages: errMsgs, updatedAt: Date.now() }); setBusy(false);
        },
        () => {
          const finalMsgs = [...baseMessages, { role: "assistant" as const, text: accText, citations: accCitations, mode: session.mode, streaming: false }];
          setMessages(finalMsgs); onSessionUpdate({ ...session, title: autoTitle, messages: finalMsgs, updatedAt: Date.now() }); setBusy(false);
        },
      );
    } catch (err: any) {
      const errMsgs = [...baseMessages, { role: "assistant" as const, text: `Error: ${err.message}`, mode: session.mode }];
      setMessages(errMsgs); onSessionUpdate({ ...session, title: autoTitle, messages: errMsgs, updatedAt: Date.now() }); setBusy(false);
    }
  }

  const subtitle = session.mode === "personal" ? "Free conversation with memory"
    : docFilter ? `Filtered to ${docFilter.length} doc${docFilter.length > 1 ? "s" : ""}` : "Grounded on your documents";

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--border)", background: "rgba(0,0,0,.15)", backdropFilter: "blur(8px)" }}>
        <div>
          <h1 className="text-base font-semibold" style={{ fontFamily: "JetBrains Mono, monospace" }}>
            {session.title === "New Chat" ? "Chat" : session.title}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: docFilter ? "var(--accent)" : "var(--text-muted)" }}>{subtitle}</p>
        </div>
        {/* Mode toggle — switching mode creates a NEW session */}
        <div className="flex rounded-xl p-1 gap-1" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          {(["doc", "personal"] as ChatMode[]).map(m => (
            <button key={m} onClick={() => handleModeSwitch(m)}
              className={`mode-btn px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${session.mode === m ? "mode-active" : ""}`}
              style={{ background: session.mode === m ? "var(--accent)" : "transparent", color: session.mode === m ? "#000" : "var(--text-muted)", fontFamily: session.mode === m ? "JetBrains Mono, monospace" : undefined }}>
              {m === "doc" ? "Doc Chat" : "Personal"}
            </button>
          ))}
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-20" style={{ animation: "fadeInUp 300ms cubic-bezier(.22,1,.36,1) both" }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5" style={{ background: "var(--surface)", border: "1px solid var(--border)", animation: "spinIn 400ms cubic-bezier(.22,1,.36,1) both 100ms", boxShadow: "0 0 30px rgba(34,197,94,.15)" }}>
              {session.mode === "doc"
                ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /></svg>
                : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>}
            </div>
            <p className="font-semibold text-lg mb-2" style={{ fontFamily: "JetBrains Mono, monospace" }}>
              {session.mode === "doc" ? "Ask about your documents" : "Chat freely with memory"}
            </p>
            <p className="text-sm max-w-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {session.mode === "doc" ? "Upload a PDF or text file, then ask anything about it." : "I remember our past conversations. Tell me anything."}
            </p>
            <p className="text-xs mt-5 px-3 py-1.5 rounded-full" style={{ color: "var(--surface-2)", background: "var(--surface)", border: "1px solid var(--border)" }}>
              Ctrl+Shift+O · new chat
            </p>
          </div>
        )}
        {messages.map((m, i) => <MessageBubble key={i} msg={m} onCitationClick={setActiveCitation} />)}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={send} className="px-6 py-4 shrink-0" style={{ borderTop: "1px solid var(--border)", background: "rgba(0,0,0,.1)" }}>
        <div className="flex items-end gap-3 rounded-2xl px-4 py-3" style={{ background: "var(--surface)", border: "1px solid var(--border)", transition: "border-color 200ms, box-shadow 200ms" }}
          onFocus={() => {}} onClick={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(34,197,94,.4)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 3px rgba(34,197,94,.08)"; }}
          onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}>
          <textarea className="flex-1 resize-none bg-transparent outline-none text-sm leading-relaxed"
            style={{ color: "var(--text)", minHeight: "24px", maxHeight: "120px" }}
            placeholder={session.mode === "doc" ? "Ask about your documents…" : "Chat freely…"}
            value={input} rows={1}
            onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e as any); } }} />
          <button type="submit" disabled={busy || !input.trim()} className="shrink-0 rounded-xl w-9 h-9 flex items-center justify-center cursor-pointer send-btn"
            style={{ background: busy || !input.trim() ? "var(--surface-2)" : "var(--accent)", color: busy || !input.trim() ? "var(--text-muted)" : "#000" }}>
            {busy
              ? <div className="flex gap-0.5">{[0, 1, 2].map(i => <span key={i} style={{ width: "4px", height: "4px", borderRadius: "50%", background: "currentColor", animation: `typingDot 1.2s ${i * 0.15}s infinite` }} />)}</div>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22,2 15,22 11,13 2,9" /></svg>}
          </button>
        </div>
        <p className="text-xs mt-2 text-center" style={{ color: "var(--surface-2)" }}>Enter to send · Shift+Enter for new line</p>
      </form>

      {activeCitation && <CitationDrawer citation={activeCitation} onClose={() => setActiveCitation(null)} />}
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, onCitationClick }: { msg: Msg; onCitationClick: (c: Citation) => void }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end msg-user">
        <div className="max-w-[70%] rounded-2xl rounded-br-sm px-4 py-3 text-sm" style={{ background: "var(--surface-2)", color: "var(--text)", boxShadow: "0 2px 8px rgba(0,0,0,.2)" }}>
          <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start gap-3 msg-bot">
      <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-black text-xs font-bold mt-0.5"
        style={{ background: "var(--accent)", fontFamily: "JetBrains Mono, monospace", boxShadow: "0 0 12px rgba(34,197,94,.3)" }}>R</div>
      <div className="max-w-[78%] space-y-2">
        <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", boxShadow: "0 2px 8px rgba(0,0,0,.15)" }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
            p: ({ children }) => <p style={{ marginBottom: "8px" }} className="last:mb-0 leading-relaxed">{children}</p>,
            ul: ({ children }) => <ul style={{ paddingLeft: "20px", marginBottom: "8px" }}>{children}</ul>,
            ol: ({ children }) => <ol style={{ paddingLeft: "20px", marginBottom: "8px" }}>{children}</ol>,
            li: ({ children }) => <li style={{ marginBottom: "3px" }}>{children}</li>,
            strong: ({ children }) => <strong style={{ fontWeight: 600, color: "var(--text)" }}>{children}</strong>,
            a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>{children}</a>,
            blockquote: ({ children }) => <blockquote style={{ borderLeft: "3px solid var(--accent)", paddingLeft: "12px", color: "var(--text-muted)", margin: "8px 0" }}>{children}</blockquote>,
            code: ({ children, className }) => {
              const isBlock = Boolean(className?.startsWith("language-"));
              return isBlock ? (
                <pre style={{ background: "var(--bg)", padding: "12px", borderRadius: "10px", overflow: "auto", fontSize: "12px", margin: "8px 0", border: "1px solid var(--border)" }}>
                  <code style={{ fontFamily: "JetBrains Mono, monospace" }}>{children}</code>
                </pre>
              ) : <code style={{ background: "var(--bg)", padding: "2px 6px", borderRadius: "5px", fontSize: "12px", fontFamily: "JetBrains Mono, monospace", border: "1px solid var(--border)" }}>{children}</code>;
            },
            h1: ({ children }) => <h1 style={{ fontSize: "17px", fontWeight: 700, marginBottom: "8px", fontFamily: "JetBrains Mono, monospace" }}>{children}</h1>,
            h2: ({ children }) => <h2 style={{ fontSize: "15px", fontWeight: 600, marginBottom: "6px" }}>{children}</h2>,
            h3: ({ children }) => <h3 style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>{children}</h3>,
          }}>
            {msg.text || ""}
          </ReactMarkdown>
          {msg.streaming && (
            <span className="inline-flex items-center gap-0.5 ml-1 align-middle">
              {[0, 1, 2].map(i => <span key={i} style={{ width: "4px", height: "4px", borderRadius: "50%", background: "var(--accent)", display: "inline-block", animation: `typingDot 1.2s ${i * 0.18}s infinite` }} />)}
            </span>
          )}
        </div>
        {msg.citations && msg.citations.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {msg.citations.map((c, j) => (
              <button key={j} onClick={() => onCitationClick(c)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs cursor-pointer"
                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", transition: "all 160ms" }}
                onMouseOver={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLElement).style.color = "var(--accent)"; (e.currentTarget as HTMLElement).style.background = "rgba(34,197,94,.06)"; }}
                onMouseOut={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLElement).style.background = "var(--surface)"; }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /></svg>
                {c.source}{c.page_number ? ` · p.${c.page_number}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Citation Drawer ──────────────────────────────────────────────────────────

function CitationDrawer({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,.5)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <aside className="fixed right-0 top-0 h-full z-50 flex flex-col w-96" style={{ background: "var(--surface)", borderLeft: "1px solid var(--border)", animation: "slideInDrawer 220ms cubic-bezier(.22,1,.36,1)", boxShadow: "-8px 0 32px rgba(0,0,0,.3)" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <h3 className="text-sm font-semibold" style={{ fontFamily: "JetBrains Mono, monospace" }}>Source Passage</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{citation.source}{citation.page_number ? ` · Page ${citation.page_number}` : ""} · chunk #{citation.chunk_index}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer send-btn" style={{ color: "var(--text-muted)", border: "1px solid var(--border)", background: "transparent" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="rounded-xl p-4 text-sm leading-relaxed" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", whiteSpace: "pre-wrap" }}>
            {citation.chunk_text || "No passage text available."}
          </div>
        </div>
        <div className="px-5 py-4" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2" style={{ background: "var(--bg)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            Relevance score: {citation.score.toFixed(3)}
          </div>
        </div>
      </aside>
    </>
  );
}

// ─── Memory Drawer ────────────────────────────────────────────────────────────

function MemoryDrawer({ memories, busy, refreshing, onClose, onClear }: { memories: { id: string; memory: string }[]; busy: boolean; refreshing: boolean; onClose: () => void; onClear: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,.5)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <aside className="fixed right-0 top-0 h-full z-50 flex flex-col w-96" style={{ background: "var(--surface)", borderLeft: "1px solid var(--border)", animation: "slideInDrawer 220ms cubic-bezier(.22,1,.36,1)", boxShadow: "-8px 0 32px rgba(0,0,0,.3)" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold" style={{ fontFamily: "JetBrains Mono, monospace" }}>Long-term Memory</h3>
              {refreshing && <div className="w-3 h-3 rounded-full border-2 animate-spin" style={{ borderColor: "var(--surface-2)", borderTopColor: "var(--accent)" }} />}
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{memories.length} facts stored</p>
          </div>
          <div className="flex items-center gap-2">
            {memories.length > 0 && (
              <button onClick={onClear} className="text-xs px-2.5 py-1 rounded-md cursor-pointer send-btn"
                style={{ color: "#F87171", border: "1px solid rgba(248,113,113,.3)", background: "transparent" }}>Clear all</button>
            )}
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer send-btn" style={{ color: "var(--text-muted)", border: "1px solid var(--border)", background: "transparent" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {busy ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: "var(--surface-2)", borderTopColor: "var(--accent)" }} />
            </div>
          ) : memories.length === 0 ? (
            <p className="text-center py-12 text-sm" style={{ color: "var(--text-muted)" }}>No memories yet. Chat a few turns in Personal mode to build memory.</p>
          ) : (
            <ul className="space-y-2">
              {memories.map((m, i) => (
                <li key={m.id} className="rounded-xl px-4 py-3 text-sm" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", animation: `fadeInUp 200ms ${i * 40}ms both` }}>
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
