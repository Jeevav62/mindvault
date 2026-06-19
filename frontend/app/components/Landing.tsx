"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";

// 3D hero loads client-only, after paint — never blocks first render.
const HeroCanvas = dynamic(() => import("./HeroCanvas"), { ssr: false });

// ── Scroll-reveal wrapper ──────────────────────────────────────────────────────
function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${seen ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

const mono = { fontFamily: "JetBrains Mono, monospace" } as const;

// ── Icons ───────────────────────────────────────────────────────────────────────
const ic = (p: ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{p}</svg>
);
const Icons = {
  doc: ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></>),
  brain: ic(<><path d="M12 5a3 3 0 1 0-5.997.142 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.142 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /></>),
  mic: ic(<><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M19 10a7 7 0 0 1-14 0" /><line x1="12" y1="19" x2="12" y2="22" /></>),
  globe: ic(<><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>),
  graph: ic(<><circle cx="5" cy="6" r="2.5" /><circle cx="19" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M7 7.5 10.5 16M16.5 7.5 13.5 16M7 6h10" /></>),
  shield: ic(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>),
  layers: ic(<><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>),
  bolt: ic(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />),
  lock: ic(<><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
  key: ic(<><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.5 12.5 8-8M16 4l3 3M14 7l2 2" /></>),
  gauge: ic(<><path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" /><path d="M13.4 12.6 18 8M4 20a8 8 0 1 1 16 0" /></>),
  check: ic(<><path d="M20 6 9 17l-5-5" /></>),
  spark: ic(<><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>),
};

// ── Data ────────────────────────────────────────────────────────────────────────
const features = [
  { icon: Icons.doc, color: "#22C55E", title: "Document RAG", desc: "Upload PDFs and text. Recursive chunking, vector retrieval, and grounded answers that cite the exact source passage — or refuse when it's not in your docs." },
  { icon: Icons.brain, color: "#818CF8", title: "Long-term Memory", desc: "Mem0-style memory persists facts about you across every session. The assistant gets more personal the more you talk to it." },
  { icon: Icons.graph, color: "#F472B6", title: "Knowledge Graph", desc: "Neo4j extracts people, places, topics and their relationships from your conversations — structured recall, not just fuzzy vectors." },
  { icon: Icons.mic, color: "#F59E0B", title: "Realtime Voice", desc: "Speak and listen. Streaming STT over WebSocket (Deepgram) and low-latency streaming TTS (Cartesia) decoded chunk-by-chunk in the browser." },
  { icon: Icons.globe, color: "#38BDF8", title: "Live Web Search", desc: "Fuse real-time web results (Tavily) and crawled URLs with your private context for answers that aren't frozen in a training cutoff." },
  { icon: Icons.shield, color: "#34D399", title: "Encrypted & Private", desc: "Files encrypted at rest with AES-256-GCM, passwords hashed with Argon2id, JWT auth, and an invite-only approval gate." },
];

const pipeline = [
  { n: "01", t: "Ingest", d: "PDF / text / audio is decrypted, parsed, and split into ~600-token overlapping chunks." },
  { n: "02", t: "Embed", d: "Each chunk → 1024-dim vector via Voyage (Gemini fallback), upserted to Qdrant per-user." },
  { n: "03", t: "Retrieve", d: "Your question is embedded and matched against your vectors — top-k, user-filtered." },
  { n: "04", t: "Generate", d: "Chunks + memory + graph are fused into a grounded prompt; the LLM streams a cited answer." },
];

const chains = [
  { kind: "LLM", color: "#22C55E", nodes: ["Groq", "Cerebras"] },
  { kind: "Embeddings", color: "#818CF8", nodes: ["Voyage", "Gemini"] },
  { kind: "Speech-to-Text", color: "#F59E0B", nodes: ["Deepgram", "Groq"] },
  { kind: "Text-to-Speech", color: "#38BDF8", nodes: ["Cartesia", "Sarvam", "Murf"] },
];

const security = [
  { icon: Icons.lock, t: "AES-256-GCM at rest", d: "Every uploaded blob is authenticated-encrypted before it touches disk." },
  { icon: Icons.key, t: "Argon2id passwords", d: "Memory-hard hashing that resists GPU cracking — never plaintext." },
  { icon: Icons.shield, t: "JWT access + refresh", d: "Short-lived signed access tokens, rotating refresh, typed claims." },
  { icon: Icons.gauge, t: "Rate limiting", d: "SlowAPI throttles auth and chat per-IP to blunt brute-force and abuse." },
  { icon: Icons.check, t: "Invite-only approval", d: "New signups stay pending until the admin approves via a one-click email link." },
  { icon: Icons.bolt, t: "Automatic fallback", d: "Every AI call fails over across providers on quota / error — no dead ends." },
];

const stack: { group: string; items: string[] }[] = [
  { group: "Backend", items: ["FastAPI", "Python 3.10", "Uvicorn", "SlowAPI"] },
  { group: "Frontend", items: ["Next.js 15", "React 19", "TypeScript", "Three.js"] },
  { group: "Data", items: ["Qdrant", "Neo4j", "Supabase", "Postgres"] },
  { group: "AI Providers", items: ["Groq", "Cerebras", "Voyage", "Gemini", "Deepgram", "Cartesia"] },
];

const marquee = ["FastAPI", "Next.js", "Qdrant", "Neo4j", "Supabase", "Groq", "Cerebras", "Voyage AI", "Deepgram", "Cartesia", "Three.js", "Argon2", "AES-256-GCM"];

// ── Section heading ──────────────────────────────────────────────────────────────
function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 mb-5 text-xs font-semibold"
      style={{ ...mono, background: "var(--accent-dim)", border: "1px solid var(--accent-border)", color: "var(--accent)" }}>
      <span style={{ display: "inline-flex" }}>{Icons.spark}</span>
      {children}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────────
export default function Landing({ onGetStarted }: { onGetStarted: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main className="relative" style={{ background: "var(--bg-solid)", color: "var(--text)" }}>
      {/* ── Sticky nav ── */}
      <nav className="fixed top-0 inset-x-0 z-50 transition-all duration-300"
        style={{
          background: scrolled ? "rgba(7,7,18,0.72)" : "transparent",
          backdropFilter: scrolled ? "blur(16px) saturate(1.4)" : "none",
          WebkitBackdropFilter: scrolled ? "blur(16px) saturate(1.4)" : "none",
          borderBottom: scrolled ? "1px solid var(--border)" : "1px solid transparent",
        }}>
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between" style={{ height: 64 }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-black font-bold text-sm"
              style={{ background: "linear-gradient(135deg, #22C55E, #4ADE80)", boxShadow: "0 0 16px rgba(34,197,94,0.35)" }}>R</div>
            <span className="font-bold text-base" style={mono}>RAG<span style={{ color: "var(--accent)" }}>.</span>chat</span>
          </div>
          <div className="hidden sm:flex items-center gap-7 text-sm" style={{ color: "var(--text-muted)" }}>
            {[["Features", "features"], ["How it works", "how"], ["Architecture", "arch"], ["Security", "security"]].map(([l, h]) => (
              <a key={h} href={`#${h}`} className="hover:text-[var(--text)] transition-colors" style={mono}>{l}</a>
            ))}
          </div>
          <button onClick={onGetStarted} className="px-5 py-2 rounded-xl text-sm font-semibold cursor-pointer send-btn"
            style={{ ...mono, background: "linear-gradient(135deg, #22C55E, #4ADE80)", color: "#000", boxShadow: "0 0 18px rgba(34,197,94,0.3)" }}>
            Sign in
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-6">
        <div className="absolute inset-0 grid-bg" />
        <div className="absolute inset-0"><HeroCanvas /></div>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 60% 50% at 50% 40%, transparent, var(--bg-solid) 78%)" }} />

        <div className="relative z-10 text-center max-w-3xl anim-fade-up" style={{ paddingTop: 64 }}>
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-8 text-xs font-medium"
            style={{ ...mono, background: "var(--accent-dim)", border: "1px solid var(--accent-border)", color: "var(--accent)" }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "var(--accent)", animation: "pulse 2s ease-in-out infinite" }} />
            Streaming LLM · STT · TTS — all live
          </div>

          <h1 className="text-5xl sm:text-7xl font-extrabold leading-[1.05] mb-6" style={{ ...mono, letterSpacing: "-2px" }}>
            Your AI that<br /><span className="grad-text">remembers you.</span>
          </h1>

          <p className="text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed mb-10" style={{ color: "var(--text-muted)" }}>
            A personal RAG chatbot with long-term memory, a knowledge graph, realtime voice, and live web search —
            wired on multi-provider fallback chains so it never goes dark.
          </p>

          <div className="flex items-center justify-center gap-4 flex-wrap mb-14">
            <button onClick={onGetStarted} className="flex items-center gap-2.5 px-8 py-3.5 rounded-2xl text-sm font-bold cursor-pointer send-btn"
              style={{ ...mono, background: "linear-gradient(135deg, #22C55E, #4ADE80)", color: "#000", boxShadow: "0 0 32px rgba(34,197,94,0.4)" }}>
              Get Started — it&apos;s free
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12,5 19,12 12,19" /></svg>
            </button>
            <a href="#how" className="flex items-center gap-2 px-7 py-3.5 rounded-2xl text-sm font-semibold cursor-pointer lift"
              style={{ ...mono, background: "var(--surface)", border: "1px solid var(--border-strong)", color: "var(--text)" }}>
              See how it works
            </a>
          </div>

          <div className="flex items-center justify-center gap-6 sm:gap-10 flex-wrap">
            {[["4", "modalities"], ["11+", "AI providers"], ["100%", "fallback-covered"], ["<300ms", "first token"]].map(([n, l]) => (
              <div key={l} className="text-center">
                <div className="text-2xl sm:text-3xl font-extrabold grad-text" style={mono}>{n}</div>
                <div className="text-xs mt-1" style={{ color: "var(--text-subtle)" }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2" style={{ animation: "float 2.4s ease-in-out infinite" }}>
          <span className="text-xs" style={{ ...mono, color: "var(--text-subtle)" }}>scroll</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
        </div>
      </section>

      {/* ── Marquee ── */}
      <section className="py-10 border-y" style={{ borderColor: "var(--border)" }}>
        <div className="marquee-mask overflow-hidden">
          <div className="marquee-track flex gap-3 w-max">
            {[...marquee, ...marquee].map((t, i) => (
              <span key={i} className="rounded-full px-4 py-1.5 text-xs font-medium whitespace-nowrap"
                style={{ ...mono, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>{t}</span>
            ))}
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-6">
        {/* ── Intro / dual-context ── */}
        <section className="py-28 text-center">
          <Reveal>
            <Kicker>Not just retrieval</Kicker>
            <h2 className="text-3xl sm:text-5xl font-extrabold mb-6 leading-tight" style={{ ...mono, letterSpacing: "-1px" }}>
              A RAG chatbot that also<br />remembers <span className="grad-text">the person.</span>
            </h2>
            <p className="text-base sm:text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Most RAG apps answer from documents and forget you the moment you close the tab. This one runs three
              context systems at once — document vectors, long-term memory, and a knowledge graph — and fuses them
              into every answer.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-14 text-left">
            {[
              { c: "#22C55E", i: Icons.doc, t: "Document context", d: "Qdrant vector search over your uploaded files — grounded, cited, user-isolated." },
              { c: "#818CF8", i: Icons.brain, t: "Personal memory", d: "Salient facts about you, written each turn and recalled across sessions." },
              { c: "#F472B6", i: Icons.graph, t: "Knowledge graph", d: "Neo4j entities + relationships for structured, explainable recall." },
            ].map((x, i) => (
              <Reveal key={x.t} delay={i * 90}>
                <div className="rounded-2xl p-7 h-full lift" style={{ background: "var(--surface)", border: "1px solid var(--border-strong)" }}>
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4" style={{ background: `${x.c}18`, color: x.c, border: `1px solid ${x.c}30` }}>{x.i}</div>
                  <h3 className="font-bold text-base mb-2" style={mono}>{x.t}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{x.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Features ── */}
        <section id="features" className="py-28 scroll-mt-20">
          <Reveal className="text-center mb-16">
            <Kicker>Capabilities</Kicker>
            <h2 className="text-3xl sm:text-5xl font-extrabold mb-4" style={{ ...mono, letterSpacing: "-1px" }}>Everything in one place</h2>
            <p className="text-base max-w-xl mx-auto" style={{ color: "var(--text-muted)" }}>Six pillars, each backed by real infrastructure — no mockups.</p>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 80}>
                <div className="group rounded-2xl p-7 h-full lift" style={{ background: "var(--surface)", border: "1px solid var(--border-strong)" }}
                  onMouseOver={e => { e.currentTarget.style.borderColor = `${f.color}55`; e.currentTarget.style.boxShadow = `0 16px 48px rgba(0,0,0,0.45), 0 0 0 1px ${f.color}22`; }}
                  onMouseOut={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.boxShadow = "none"; }}>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ background: `${f.color}18`, color: f.color, border: `1px solid ${f.color}30` }}>{f.icon}</div>
                  <h3 className="font-bold text-lg mb-2" style={mono}>{f.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{f.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── How it works ── */}
        <section id="how" className="py-28 scroll-mt-20">
          <Reveal className="text-center mb-16">
            <Kicker>The RAG pipeline</Kicker>
            <h2 className="text-3xl sm:text-5xl font-extrabold mb-4" style={{ ...mono, letterSpacing: "-1px" }}>From file to grounded answer</h2>
            <p className="text-base max-w-xl mx-auto" style={{ color: "var(--text-muted)" }}>Four stages, fully streamed end to end.</p>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5 relative">
            {pipeline.map((s, i) => (
              <Reveal key={s.n} delay={i * 110}>
                <div className="rounded-2xl p-6 h-full relative lift" style={{ background: "var(--surface)", border: "1px solid var(--border-strong)" }}>
                  <div className="text-4xl font-extrabold mb-3 grad-text" style={mono}>{s.n}</div>
                  <h3 className="font-bold text-base mb-2" style={mono}>{s.t}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{s.d}</p>
                  {i < pipeline.length - 1 && (
                    <div className="hidden md:block absolute top-1/2 -right-3 z-10" style={{ color: "var(--accent)" }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12,5 19,12 12,19" /></svg>
                    </div>
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Architecture / fallback chains ── */}
        <section id="arch" className="py-28 scroll-mt-20">
          <Reveal className="text-center mb-16">
            <Kicker>Reliability by design</Kicker>
            <h2 className="text-3xl sm:text-5xl font-extrabold mb-4" style={{ ...mono, letterSpacing: "-1px" }}>Provider fallback chains</h2>
            <p className="text-base max-w-2xl mx-auto" style={{ color: "var(--text-muted)" }}>
              Every modality sits behind one interface and an ordered chain. On quota, timeout, or error, the router
              fails over to the next provider automatically — and logs which one served you.
            </p>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {chains.map((c, i) => (
              <Reveal key={c.kind} delay={(i % 2) * 90}>
                <div className="rounded-2xl p-7 lift" style={{ background: "var(--surface)", border: "1px solid var(--border-strong)" }}>
                  <div className="flex items-center gap-2 mb-5">
                    <span className="w-2 h-2 rounded-full" style={{ background: c.color, boxShadow: `0 0 10px ${c.color}` }} />
                    <h3 className="font-bold text-sm" style={{ ...mono, color: c.color }}>{c.kind}</h3>
                  </div>
                  <div className="flex items-center flex-wrap gap-2">
                    {c.nodes.map((n, j) => (
                      <span key={n} className="flex items-center gap-2">
                        <span className="rounded-lg px-3.5 py-2 text-xs font-semibold" style={{ ...mono, background: j === 0 ? `${c.color}1a` : "var(--surface-2)", border: `1px solid ${j === 0 ? c.color + "44" : "var(--border)"}`, color: j === 0 ? c.color : "var(--text-muted)" }}>
                          {n}{j === 0 && <span style={{ opacity: 0.6 }}> · primary</span>}
                        </span>
                        {j < c.nodes.length - 1 && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12,5 19,12 12,19" /></svg>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Security ── */}
        <section id="security" className="py-28 scroll-mt-20">
          <Reveal className="text-center mb-16">
            <Kicker>Hardened</Kicker>
            <h2 className="text-3xl sm:text-5xl font-extrabold mb-4" style={{ ...mono, letterSpacing: "-1px" }}>Security &amp; reliability</h2>
            <p className="text-base max-w-xl mx-auto" style={{ color: "var(--text-muted)" }}>Auth, crypto, and abuse-prevention built in from day one.</p>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {security.map((s, i) => (
              <Reveal key={s.t} delay={(i % 3) * 80}>
                <div className="rounded-2xl p-6 h-full flex gap-4 lift" style={{ background: "var(--surface)", border: "1px solid var(--border-strong)" }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid var(--accent-border)" }}>{s.icon}</div>
                  <div>
                    <h3 className="font-bold text-sm mb-1.5" style={mono}>{s.t}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{s.d}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Tech stack ── */}
        <section className="py-28">
          <Reveal className="text-center mb-16">
            <Kicker>Under the hood</Kicker>
            <h2 className="text-3xl sm:text-5xl font-extrabold mb-4" style={{ ...mono, letterSpacing: "-1px" }}>Built on a modern stack</h2>
          </Reveal>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
            {stack.map((g, i) => (
              <Reveal key={g.group} delay={i * 80}>
                <div className="rounded-2xl p-6 h-full" style={{ background: "var(--surface)", border: "1px solid var(--border-strong)" }}>
                  <h3 className="text-xs uppercase tracking-widest mb-4 font-semibold" style={{ color: "var(--text-subtle)", letterSpacing: "0.12em" }}>{g.group}</h3>
                  <div className="flex flex-col gap-2">
                    {g.items.map(it => (
                      <span key={it} className="text-sm flex items-center gap-2" style={{ ...mono, color: "var(--text-muted)" }}>
                        <span className="w-1 h-1 rounded-full" style={{ background: "var(--accent)" }} />{it}
                      </span>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="pb-32">
          <Reveal>
            <div className="rounded-3xl p-12 sm:p-16 text-center relative overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(34,197,94,0.10) 0%, rgba(34,197,94,0.03) 100%)", border: "1px solid var(--accent-border)", animation: "glowPulse 5s ease-in-out infinite" }}>
              <div className="absolute inset-0 grid-bg opacity-50" />
              <div className="relative z-10">
                <h2 className="text-3xl sm:text-5xl font-extrabold mb-4" style={{ ...mono, letterSpacing: "-1px" }}>Ready to remember everything?</h2>
                <p className="mb-9 text-base" style={{ color: "var(--text-muted)" }}>Invite-only access. Sign up and the admin approves you in one click.</p>
                <button onClick={onGetStarted} className="inline-flex items-center gap-2.5 px-9 py-4 rounded-2xl text-sm font-bold cursor-pointer send-btn"
                  style={{ ...mono, background: "linear-gradient(135deg, #22C55E, #4ADE80)", color: "#000", boxShadow: "0 0 32px rgba(34,197,94,0.4)" }}>
                  Start chatting
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12,5 19,12 12,19" /></svg>
                </button>
              </div>
            </div>
          </Reveal>
        </section>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t py-10" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-black font-bold text-xs" style={{ background: "linear-gradient(135deg, #22C55E, #4ADE80)" }}>R</div>
            <span className="font-bold text-sm" style={mono}>RAG<span style={{ color: "var(--accent)" }}>.</span>chat</span>
          </div>
          <p className="text-xs" style={{ color: "var(--text-subtle)" }}>Personal multimodal RAG · built with FastAPI &amp; Next.js</p>
        </div>
      </footer>
    </main>
  );
}
