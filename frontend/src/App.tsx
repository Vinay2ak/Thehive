import React, { useMemo, useRef, useState } from "react";
import { Volume2, VolumeX, Download, Copy, Check } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL as string;
const API = `${BACKEND_URL}/api`;

interface PatchedItem {
  weakness: string;
  fix: string;
}

interface AuditResponse {
  id: string;
  architect_diagram: string;
  attack_diagram: string;
  final_diagram: string;
  architect_summary: string;
  attack_summary: string;
  final_summary: string;
  patched: PatchedItem[];
  timestamp: string;
}

type StageStatus = "idle" | "loading" | "loaded" | "error";

interface StageState {
  status: StageStatus;
  diagram: string;
  summary: string;
  fallback: boolean;
  patched: PatchedItem[];
  elapsedMs?: number;
}

const EMPTY_STAGE: StageState = {
  status: "idle",
  diagram: "",
  summary: "",
  fallback: false,
  patched: [],
};

const DEFAULT_REQUIREMENTS =
  "Design a URL shortener that handles 50k redirects/sec,\n" +
  "with custom aliases, analytics, and 99.99% uptime.";

const COLUMNS: Record<string, { accent: string; verdict: string }> = {
  architect: { accent: "#5B8DEF", verdict: "STRUCTURALLY SOUND" },
  chaos: { accent: "#E8543E", verdict: "FRACTURE DETECTED" },
  hardened: { accent: "#3ECF8E", verdict: "HARDENED — PASS" },
};

const CHAOS = "#E8543E";
const MINT = "#3ECF8E";

function formatElapsed(ms?: number): string | null {
  if (ms == null) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function StageColumn(props: {
  columnKey: string;
  title: string;
  accent: string;
  verdict: string;
  state: StageState;
  testid: string;
}) {
  const { title, accent, verdict, state, testid } = props;
  const accentVars = { "--accent": accent } as React.CSSProperties;
  const [copied, setCopied] = useState(false);

  const copyDiagram = async () => {
    const text = state.diagram || "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div
      className="relative flex min-h-[300px] min-w-0 flex-col border-b border-[#1E3A5F]/50 last:border-b-0 md:h-full md:min-h-0 md:flex-1 md:border-b-0 md:border-r"
      data-testid={testid}
      style={accentVars}
    >
      {/* Top accent bar (role color) */}
      <div
        className="h-[3px] w-full shrink-0"
        style={{ background: accent, boxShadow: `0 0 12px ${accent}66` }}
      />

      {/* Header row */}
      <div className="relative z-10 flex shrink-0 flex-col gap-2 border-b border-[#1E3A5F]/50 bg-[#0E1524]/70 px-3 py-2.5 backdrop-blur-sm">
        <div className="flex min-w-0 items-start gap-2">
          <span
            className="mt-[3px] h-2 w-2 shrink-0"
            style={{ background: accent }}
            aria-hidden="true"
          />
          <span className="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-[#F2F0E9]">
            {title}
          </span>
        </div>
        {state.status === "loaded" && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={copyDiagram}
              data-testid={`${testid}-copy`}
              aria-label="Copy ASCII diagram"
              title={copied ? "Copied" : "Copy diagram"}
              className="flex h-6 items-center gap-1 border px-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F2F0E9]"
              style={{ borderColor: `${accent}66`, color: accent }}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              <span className="hidden sm:inline">
                {copied ? "Copied" : "Copy"}
              </span>
            </button>
            {formatElapsed(state.elapsedMs) && (
              <span
                className="border px-1.5 py-0.5 font-mono text-[10px] tracking-widest"
                style={{
                  borderColor: `${accent}66`,
                  color: accent,
                  background: `${accent}0D`,
                }}
                data-testid={`${testid}-latency`}
                title="Stage response time"
              >
                {formatElapsed(state.elapsedMs)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="relative min-h-0 flex-1 overflow-auto">
        {/* Blueprint grid texture, tinted in the panel's role color */}
        <div
          aria-hidden="true"
          className="blueprint-grid pointer-events-none absolute inset-0 opacity-[0.09]"
          style={{ "--tint": accent } as React.CSSProperties}
        />

        <div className="relative z-10 h-full p-4">
          {state.status === "idle" && (
            <div
              className="relative flex h-full items-center justify-center overflow-hidden"
              data-testid={`${testid}-idle`}
            >
              <div className="scanline" />
              <span className="font-mono text-xs tracking-[0.22em] text-[#8FA8B8]/50">
                AWAITING_INPUT<span className="archaudit-blink">_</span>
              </span>
            </div>
          )}

          {state.status === "loading" && (
            <div
              className="relative flex h-full items-center justify-center overflow-hidden"
              data-testid={`${testid}-loading`}
            >
              <div className="scanline scanline--gen" />
              <span
                className="font-mono text-xs tracking-[0.18em]"
                style={{ color: accent }}
              >
                COMPILING_RESPONSE<span className="archaudit-blink">_</span>
              </span>
            </div>
          )}

          {state.status === "error" && (
            <div
              className="flex h-full items-center justify-center px-2 text-center"
              data-testid={`${testid}-error`}
            >
              <span
                className="font-mono text-xs tracking-wide"
                style={{ color: CHAOS }}
              >
                STAGE_FAILED — SHOWING_CACHED_FALLBACK
              </span>
            </div>
          )}

          {state.status === "loaded" && (
            <div
              className="relative flex h-full min-w-0 flex-col"
              data-testid={`${testid}-loaded`}
            >
              {/* Verdict stamp */}
              <div className="verdict-stamp" data-testid={`${testid}-verdict`}>
                {verdict}
              </div>

              <div className="reveal flex min-w-0 flex-col gap-3">
                {state.fallback && (
                  <div
                    className="border px-2 py-1"
                    style={{ borderColor: `${CHAOS}66`, background: `${CHAOS}0D` }}
                    data-testid={`${testid}-fallback-banner`}
                  >
                    <span
                      className="font-mono text-[10px] uppercase tracking-widest"
                      style={{ color: CHAOS }}
                    >
                      STAGE_FAILED — SHOWING_CACHED_FALLBACK
                    </span>
                  </div>
                )}
                <pre
                  className="max-w-full overflow-x-auto whitespace-pre font-mono text-[9px] leading-[1.5] text-[#C9D6E0] sm:text-[10px] 2xl:text-[11px]"
                  data-testid={`${testid}-diagram`}
                >
                  {state.diagram}
                </pre>
                <p
                  className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-[#8FA8B8]"
                  data-testid={`${testid}-summary`}
                >
                  {state.summary}
                </p>

                {state.patched.length > 0 && (
                  <div
                    className="mt-1 border-t border-[#1E3A5F]/60 pt-3"
                    data-testid={`${testid}-patched`}
                  >
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#8FA8B8]/70">
                      // patched_from_chaos_injection
                    </div>
                    <ul className="flex flex-col gap-2">
                      {state.patched.map((p, i) => (
                        <li
                          key={i}
                          className="font-mono text-[11px] leading-snug"
                          data-testid={`${testid}-patched-item-${i}`}
                        >
                          <div className="flex gap-1.5" style={{ color: CHAOS }}>
                            <span style={{ color: MINT }}>[✓]</span>
                            <span
                              className="line-through"
                              style={{ textDecorationColor: `${CHAOS}80` }}
                            >
                              {p.weakness}
                            </span>
                          </div>
                          {p.fix && (
                            <div className="pl-5" style={{ color: MINT }}>
                              └─ {p.fix}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ArchAuditApp() {
  const [requirements, setRequirements] = useState<string>(DEFAULT_REQUIREMENTS);
  const [running, setRunning] = useState<boolean>(false);
  const [architect, setArchitect] = useState<StageState>(EMPTY_STAGE);
  const [chaos, setChaos] = useState<StageState>(EMPTY_STAGE);
  const [hardened, setHardened] = useState<StageState>(EMPTY_STAGE);
  const [muted, setMuted] = useState<boolean>(false);
  const audioRef = useRef<AudioContext | null>(null);

  const ensureAudio = () => {
    if (!audioRef.current) {
      const Ctx =
        window.AudioContext || (window as any).webkitAudioContext;
      if (Ctx) audioRef.current = new Ctx();
    }
    if (audioRef.current && audioRef.current.state === "suspended") {
      audioRef.current.resume();
    }
    return audioRef.current;
  };

  // Subtle synthesized "stamp thud" — a low body + a short transient click.
  const playThud = () => {
    if (muted) return;
    const ctx = audioRef.current;
    if (!ctx) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);

    const buffer = ctx.createBuffer(
      1,
      Math.floor(ctx.sampleRate * 0.05),
      ctx.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.11, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1200;
    noise.connect(hp).connect(ng).connect(ctx.destination);
    noise.start(t);
    noise.stop(t + 0.05);
  };

  const canExport = hardened.status === "loaded";

  const buildReport = (): string => {
    const block = (title: string, verdict: string, s: StageState) => {
      const meta = [
        s.elapsedMs != null ? formatElapsed(s.elapsedMs) : null,
        s.fallback ? "CACHED_FALLBACK" : null,
      ]
        .filter(Boolean)
        .join(" · ");
      let out = `## ${title} — ${verdict}${meta ? `  (${meta})` : ""}\n\n`;
      out += "```\n" + (s.diagram || "(no output)") + "\n```\n\n";
      if (s.summary) out += s.summary + "\n";
      if (s.patched.length) {
        out += "\n### Patched from Chaos Injection\n";
        for (const p of s.patched) {
          out += `- ${p.weakness}${p.fix ? ` → ${p.fix}` : ""}\n`;
        }
      }
      return out + "\n";
    };
    return (
      "# ARCHAUDIT — Inspection Report\n\n" +
      `Generated: ${new Date().toISOString()}\n` +
      "Model: gemma-4-31b (NVIDIA NIM) · stateless\n\n" +
      `## Requirements\n\n${requirements}\n\n` +
      block("v1.0 ARCHITECT", COLUMNS.architect.verdict, architect) +
      block("v1.1 CHAOS_INJECTION", COLUMNS.chaos.verdict, chaos) +
      block("v2.0 HARDENED", COLUMNS.hardened.verdict, hardened)
    );
  };

  const exportReport = () => {
    if (!canExport) return;
    const blob = new Blob([buildReport()], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `archaudit-report-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const lineNumbers = useMemo(() => {
    const count = Math.max(requirements.split("\n").length, 20);
    return Array.from({ length: count }, (_, i) =>
      String(i + 1).padStart(2, "0"),
    );
  }, [requirements]);

  const applyEvent = (event: string, payload: any) => {
    if (event === "architect_done") {
      setArchitect({
        status: "loaded",
        diagram: payload.architect_diagram,
        summary: payload.architect_summary,
        fallback: Boolean(payload.fallback),
        patched: [],
        elapsedMs: payload.elapsed_ms,
      });
    } else if (event === "attack_done") {
      setChaos({
        status: "loaded",
        diagram: payload.attack_diagram,
        summary: payload.attack_summary,
        fallback: Boolean(payload.fallback),
        patched: [],
        elapsedMs: payload.elapsed_ms,
      });
    } else if (event === "final_done") {
      const res = payload as AuditResponse & { fallback?: boolean; elapsed_ms?: number };
      setHardened({
        status: "loaded",
        diagram: res.final_diagram,
        summary: res.final_summary,
        fallback: Boolean(res.fallback),
        patched: Array.isArray(res.patched) ? res.patched : [],
        elapsedMs: res.elapsed_ms,
      });
    }
    playThud();
  };

  const executeAudit = async () => {
    if (running || !requirements.trim()) return;
    setRunning(true);
    ensureAudio();
    const loading: StageState = { ...EMPTY_STAGE, status: "loading" };
    setArchitect(loading);
    setChaos(loading);
    setHardened(loading);

    try {
      const resp = await fetch(`${API}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements }),
      });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          let event = "";
          let data = "";
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!event || !data) continue;
          try {
            applyEvent(event, JSON.parse(data));
          } catch (e) {
            // ignore malformed frame
          }
        }
      }

      // Stream ended: if any stage never delivered, surface it as an error
      // (e.g. the connection was truncated by a proxy) instead of hanging.
      setArchitect((s) => (s.status === "loading" ? { ...s, status: "error" } : s));
      setChaos((s) => (s.status === "loading" ? { ...s, status: "error" } : s));
      setHardened((s) => (s.status === "loading" ? { ...s, status: "error" } : s));
    } catch (e) {
      // Connection-level failure: mark any still-pending column as errored.
      setArchitect((s) => (s.status === "loading" ? { ...s, status: "error" } : s));
      setChaos((s) => (s.status === "loading" ? { ...s, status: "error" } : s));
      setHardened((s) => (s.status === "loading" ? { ...s, status: "error" } : s));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0B0F1A] text-[#F2F0E9]">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-[#1E3A5F]/60 bg-[#0B0F1A] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span
            className="h-3.5 w-3.5 shrink-0"
            style={{ background: "#5B8DEF", boxShadow: "0 0 10px #5B8DEF88" }}
            aria-hidden="true"
          />
          <span
            className="font-sans text-sm font-bold uppercase tracking-[0.32em] text-[#F2F0E9]"
            data-testid="archaudit-logo"
          >
            ARCHAUDIT
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-[#8FA8B8]/70 sm:inline">
            // adversarial architecture review
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMuted((m) => !m)}
            data-testid="sound-toggle"
            aria-label={muted ? "Unmute stamp sound" : "Mute stamp sound"}
            title={muted ? "Sound off" : "Sound on"}
            className="flex h-6 w-6 items-center justify-center border border-[#1E3A5F] text-[#8FA8B8] transition-colors hover:text-[#F2F0E9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B8DEF]"
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#8FA8B8]">
            gemma-4-31b
          </span>
          <span className="border border-[#1E3A5F] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-[#8FA8B8]/80">
            stateless
          </span>
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        {/* Left sidebar — Command Terminal (30%) */}
        <aside className="flex w-full shrink-0 flex-col border-b border-[#1E3A5F]/60 md:w-[30%] md:border-b-0 md:border-r">
          <div className="flex shrink-0 items-center gap-2 border-b border-[#1E3A5F]/50 bg-[#0E1524]/70 px-3 py-2.5">
            <span
              className="h-2 w-2 shrink-0"
              style={{ background: "#5B8DEF" }}
              aria-hidden="true"
            />
            <span className="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-[#F2F0E9]">
              Command Terminal
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-3">
            <label className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#8FA8B8]/70">
              // requirements.spec
            </label>

            <div className="relative flex min-h-[200px] flex-1 border border-[#1E3A5F]/70 bg-[#070B14] focus-within:ring-1 focus-within:ring-[#5B8DEF]">
              <div
                aria-hidden="true"
                className="blueprint-grid pointer-events-none absolute inset-0 opacity-[0.06]"
                style={{ "--tint": "#5B8DEF" } as React.CSSProperties}
              />
              <div
                className="relative z-10 select-none overflow-hidden border-r border-[#1E3A5F]/60 bg-[#0E1524]/60 px-2 py-2 text-right font-mono text-[11px] leading-relaxed text-[#8FA8B8]/40"
                aria-hidden="true"
              >
                {lineNumbers.map((n) => (
                  <div key={n}>{n}</div>
                ))}
              </div>
              <textarea
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                spellCheck={false}
                data-testid="requirements-input"
                className="relative z-10 min-h-0 flex-1 resize-none bg-transparent px-3 py-2 font-mono text-[13px] leading-relaxed text-[#CFE0EB] caret-[#5B8DEF] outline-none placeholder:text-[#8FA8B8]/40 focus-visible:outline-none"
                placeholder="Describe the system to audit..."
              />
            </div>

            <button
              onClick={executeAudit}
              disabled={running || !requirements.trim()}
              data-testid="execute-audit-button"
              className="mt-3 shrink-0 rounded-none border border-transparent bg-[#F2F0E9] px-4 py-3 font-sans text-xs font-bold uppercase tracking-[0.18em] text-[#0B0F1A] transition-colors duration-150 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B8DEF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F1A] disabled:cursor-not-allowed disabled:bg-[#1E3A5F]/50 disabled:text-[#8FA8B8]/50"
            >
              {running ? "AUDIT_RUNNING..." : "EXECUTE AUDIT"}
            </button>

            <button
              onClick={exportReport}
              disabled={!canExport}
              data-testid="export-report-button"
              className="mt-2 flex shrink-0 items-center justify-center gap-2 rounded-none border border-[#1E3A5F] bg-transparent px-4 py-2.5 font-sans text-xs font-semibold uppercase tracking-[0.18em] text-[#8FA8B8] transition-colors duration-150 hover:border-[#5B8DEF] hover:text-[#F2F0E9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B8DEF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F1A] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#1E3A5F] disabled:hover:text-[#8FA8B8]"
            >
              <Download size={13} />
              Export Report
            </button>
          </div>
        </aside>

        {/* Main canvas — three columns (70%) */}
        <main className="min-w-0 flex-1 md:overflow-hidden">
          <div className="flex min-h-0 flex-col md:h-full md:flex-row">
            <StageColumn
              columnKey="architect"
              title="v1.0 ARCHITECT"
              accent={COLUMNS.architect.accent}
              verdict={COLUMNS.architect.verdict}
              state={architect}
              testid="column-architect"
            />
            <StageColumn
              columnKey="chaos"
              title="v1.1 CHAOS_INJECTION"
              accent={COLUMNS.chaos.accent}
              verdict={COLUMNS.chaos.verdict}
              state={chaos}
              testid="column-chaos"
            />
            <StageColumn
              columnKey="hardened"
              title="v2.0 HARDENED"
              accent={COLUMNS.hardened.accent}
              verdict={COLUMNS.hardened.verdict}
              state={hardened}
              testid="column-hardened"
            />
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="flex shrink-0 items-center justify-between border-t border-[#1E3A5F]/60 bg-[#0B0F1A] px-4 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#8FA8B8]/70">
          ARCHAUDIT
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: running ? MINT : "#8FA8B8" }}
        >
          {running ? "STREAM_OPEN" : "READY"}
        </span>
      </footer>
    </div>
  );
}
