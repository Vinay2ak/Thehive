import React, { useMemo, useRef, useState } from "react";
import {
  Volume2,
  VolumeX,
  Download,
  Copy,
  Check,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { DiagramCanvas } from "@/DiagramCanvas";

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
  architect: { accent: "#5B8DEF", verdict: "Baseline" },
  chaos: { accent: "#E8A33D", verdict: "Risks Found" },
  hardened: { accent: "#34D399", verdict: "Verified" },
};

const CHAOS = "#E8A33D";
const MINT = "#34D399";

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

  const VerdictIcon =
    props.columnKey === "chaos"
      ? AlertTriangle
      : props.columnKey === "hardened"
        ? ShieldCheck
        : CheckCircle2;

  return (
    <div
      className="relative flex min-h-[300px] min-w-0 flex-col overflow-hidden rounded-xl border border-[#1F2937] bg-[#10151F]/70 backdrop-blur-md md:h-full md:min-h-0 md:flex-1"
      data-testid={testid}
      style={accentVars}
    >
      {/* Top accent bar */}
      <div className="h-[3px] w-full shrink-0" style={{ background: accent }} />

      {/* Header: title (left) + verdict pill (right, own clear zone) */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#1F2937] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-[1px]"
            style={{ background: accent }}
            aria-hidden="true"
          />
          <span className="truncate font-sans text-xs font-semibold uppercase tracking-[0.14em] text-[#E5E7EB]">
            {title}
          </span>
        </div>
        {state.status === "loaded" && (
          <span
            className="badge-pop inline-flex max-w-[140px] shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-sans text-[10px] font-medium"
            style={{
              borderColor: `${accent}66`,
              color: accent,
              background: `${accent}14`,
            }}
            data-testid={`${testid}-verdict`}
            title={verdict}
          >
            <VerdictIcon size={11} className="shrink-0" />
            <span className="truncate">{verdict}</span>
          </span>
        )}
      </div>

      {/* Fallback banner: full-width row directly under header, own clear zone */}
      {state.status === "loaded" && state.fallback && (
        <div
          className="flex shrink-0 items-center gap-1.5 border-b border-[#1F2937] px-3 py-1.5"
          style={{ background: `${CHAOS}14` }}
          data-testid={`${testid}-fallback-banner`}
        >
          <AlertTriangle size={11} style={{ color: CHAOS }} className="shrink-0" />
          <span
            className="font-sans text-[10px] font-medium tracking-wide"
            style={{ color: CHAOS }}
          >
            STAGE_FAILED — SHOWING CACHED FALLBACK
          </span>
        </div>
      )}

      {/* Toolbar: copy (own row) */}
      {state.status === "loaded" && (
        <div className="flex shrink-0 justify-end border-b border-[#1F2937] px-3 py-1.5">
          <button
            onClick={copyDiagram}
            data-testid={`${testid}-copy`}
            aria-label="Copy diagram source"
            title={copied ? "Copied" : "Copy diagram"}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-[#2A3342] px-2 font-sans text-[10px] font-medium text-[#8B96A5] transition-colors hover:border-[#3A4658] hover:text-[#E5E7EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B8DEF]"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      {/* Body */}
      <div className="relative min-h-0 flex-1 overflow-auto p-4">
        {state.status === "idle" && (
          <div
            className="flex h-full items-center justify-center"
            data-testid={`${testid}-idle`}
          >
            <span className="font-mono text-[11px] tracking-wide text-[#8B96A5]/60">
              awaiting input…
            </span>
          </div>
        )}

        {state.status === "loading" && (
          <div
            className="flex h-full flex-col items-center gap-4 pt-6"
            data-testid={`${testid}-loading`}
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="dg-skel rounded-md border border-[#2A3342] bg-[#161C28]"
                style={{ width: 150 - i * 12, height: 34, animationDelay: `${i * 160}ms` }}
              />
            ))}
            <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8B96A5]">
              compiling
            </span>
          </div>
        )}

        {state.status === "error" && (
          <div
            className="flex h-full items-center justify-center px-2 text-center"
            data-testid={`${testid}-error`}
          >
            <span className="font-sans text-xs" style={{ color: CHAOS }}>
              Stage failed — showing cached fallback
            </span>
          </div>
        )}

        {state.status === "loaded" && (
          <div
            className="flex min-w-0 flex-col gap-4"
            data-testid={`${testid}-loaded`}
          >
            <DiagramCanvas
              diagram={state.diagram}
              mode={props.columnKey as "architect" | "chaos" | "hardened"}
              accent={accent}
              testid={`${testid}-diagram`}
            />
            <p
              className="text-[13px] leading-relaxed text-[#8B96A5]"
              data-testid={`${testid}-summary`}
            >
              {state.summary}
            </p>

            {state.patched.length > 0 && (
              <div
                className="border-t border-[#1F2937] pt-3"
                data-testid={`${testid}-patched`}
              >
                <div className="mb-2 font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8B96A5]">
                  Patched from chaos injection
                </div>
                <ul className="flex flex-col gap-2">
                  {state.patched.map((p, i) => (
                    <li
                      key={i}
                      className="text-[12px] leading-snug"
                      data-testid={`${testid}-patched-item-${i}`}
                    >
                      <div className="flex items-start gap-1.5">
                        <Check
                          size={13}
                          className="mt-[1px] shrink-0"
                          style={{ color: MINT }}
                        />
                        <span
                          className="text-[#8B96A5] line-through"
                          style={{ textDecorationColor: `${CHAOS}66` }}
                        >
                          {p.weakness}
                        </span>
                      </div>
                      {p.fix && (
                        <div className="pl-[18px] text-[12px]" style={{ color: MINT }}>
                          {p.fix}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
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
    <div className="flex h-screen w-screen flex-col bg-[#0B0F17] text-[#E5E7EB]">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-[#1F2937]/60 bg-[#0B0F17] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span
            className="h-3.5 w-3.5 shrink-0"
            style={{ background: "#5B8DEF", boxShadow: "0 0 10px #5B8DEF88" }}
            aria-hidden="true"
          />
          <span
            className="font-sans text-sm font-bold uppercase tracking-[0.32em] text-[#E5E7EB]"
            data-testid="archaudit-logo"
          >
            ARCHAUDIT
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-[#8B96A5]/70 sm:inline">
            // adversarial architecture review
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMuted((m) => !m)}
            data-testid="sound-toggle"
            aria-label={muted ? "Unmute stamp sound" : "Mute stamp sound"}
            title={muted ? "Sound off" : "Sound on"}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-[#1F2937] text-[#8B96A5] transition-colors hover:text-[#E5E7EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B8DEF]"
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#8B96A5]">
            gemma-4-31b
          </span>
          <span className="rounded-md border border-[#1F2937] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-[#8B96A5]/80">
            stateless
          </span>
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        {/* Left sidebar — Command Terminal (30%) */}
        <aside className="flex w-full shrink-0 flex-col border-b border-[#1F2937]/60 md:w-[30%] md:border-b-0 md:border-r">
          <div className="mx-2 mt-2 flex shrink-0 items-center gap-2 rounded-xl border border-[#1F2937] bg-[#10151F]/60 px-3 py-2.5 backdrop-blur-md">
            <span
              className="h-2 w-2 shrink-0"
              style={{ background: "#5B8DEF" }}
              aria-hidden="true"
            />
            <span className="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-[#E5E7EB]">
              Command Terminal
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-3">
            <label className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#8B96A5]/70">
              // requirements.spec
            </label>

            <div className="relative flex min-h-[200px] flex-1 overflow-hidden rounded-xl border border-[#1F2937] bg-[#10151F]/50 backdrop-blur-md focus-within:ring-1 focus-within:ring-[#5B8DEF]">
              <div
                className="relative z-10 select-none overflow-hidden border-r border-[#1F2937] bg-[#10151F]/40 px-2 py-2 text-right font-mono text-[11px] leading-relaxed text-[#8B96A5]/40"
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
                className="relative z-10 min-h-0 flex-1 resize-none bg-transparent px-3 py-2 font-mono text-[13px] leading-relaxed text-[#E5E7EB] caret-[#5B8DEF] outline-none placeholder:text-[#8B96A5]/40 focus-visible:outline-none"
                placeholder="Describe the system to audit..."
              />
            </div>

            <button
              onClick={executeAudit}
              disabled={running || !requirements.trim()}
              data-testid="execute-audit-button"
              className="mt-3 shrink-0 rounded-xl border border-white/20 bg-white/15 px-4 py-3 font-sans text-xs font-bold uppercase tracking-[0.18em] text-white backdrop-blur-md transition-colors duration-150 hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B8DEF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F17] disabled:cursor-not-allowed disabled:bg-[#1F2937]/40 disabled:text-[#8B96A5]/50"
            >
              {running ? "AUDIT_RUNNING..." : "EXECUTE AUDIT"}
            </button>

            <button
              onClick={exportReport}
              disabled={!canExport}
              data-testid="export-report-button"
              className="mt-2 flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[#1F2937] bg-[#10151F]/50 px-4 py-2.5 font-sans text-xs font-semibold uppercase tracking-[0.18em] text-[#8B96A5] backdrop-blur-md transition-colors duration-150 hover:border-[#5B8DEF] hover:text-[#E5E7EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B8DEF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F17] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#1F2937] disabled:hover:text-[#8B96A5]"
            >
              <Download size={13} />
              Export Report
            </button>
          </div>
        </aside>

        {/* Main canvas — three columns (70%) */}
        <main className="min-w-0 flex-1 md:overflow-hidden">
          <div className="flex min-h-0 flex-col gap-2 p-2 md:h-full md:flex-row">
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
      <footer className="flex shrink-0 items-center justify-between border-t border-[#1F2937]/60 bg-[#0B0F17] px-4 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#8B96A5]/70">
          ARCHAUDIT
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: running ? MINT : "#8B96A5" }}
        >
          {running ? "STREAM_OPEN" : "READY"}
        </span>
      </footer>
    </div>
  );
}
