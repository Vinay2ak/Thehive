import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Copy,
  Check,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  Sun,
  Moon,
  RotateCw,
  X,
  Crown,
  Share2,
  Scale,
} from "lucide-react";
import { DiagramCanvas } from "@/DiagramCanvas";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL as string;
const API = `${BACKEND_URL}/api`;

// Stripe test-mode Payment Link — paste your Payment Link URL here.
// Configure its after-payment redirect (in Stripe) to <app-url>?pro=true
const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/test_28E5kFdwa68k6Ni4Du0Fi00";
const APP_URL =
  typeof window !== "undefined"
    ? window.location.origin + window.location.pathname
    : "";

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
  errorReason?: string;
}

const EMPTY_STAGE: StageState = {
  status: "idle",
  diagram: "",
  summary: "",
  fallback: false,
  patched: [],
};

const COLUMNS: Record<string, { accent: string; verdict: string }> = {
  architect: { accent: "#5B8DEF", verdict: "Baseline" },
  chaos: { accent: "#E8A33D", verdict: "Risks Found" },
  hardened: { accent: "#34D399", verdict: "Verified" },
};

const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "gpt-4o-mini", label: "gpt-4o-mini" },
  { value: "gemini", label: "gemini-2.5-pro" },
  { value: "nvidia", label: "nvidia-nemotron-super" },
];

// Only these models require Pro; gpt-4o-mini and gemini are free.
const PREMIUM_MODELS = ["nvidia"];
const isPremiumModel = (m: string) => PREMIUM_MODELS.includes(m);

const CHAOS = "#E8A33D";
const MINT = "#34D399";

function formatElapsed(ms?: number): string | null {
  if (ms == null) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// Canvas helpers for the Share Card (native APIs only).
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = (text || "").replace(/\n+/g, " ").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function StageColumn(props: {
  columnKey: string;
  title: string;
  accent: string;
  verdict: string;
  state: StageState;
  testid: string;
  onRetry: () => void;
}) {
  const { title, accent, verdict, state, testid, onRetry } = props;
  const accentVars = { "--accent": accent } as React.CSSProperties;
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const copyDiagram = async () => {
    const text = state.diagram || "";
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } else {
      setCopyFailed(true);
      window.setTimeout(() => setCopyFailed(false), 2000);
    }
  };

  const VerdictIcon =
    props.columnKey === "chaos"
      ? AlertTriangle
      : props.columnKey === "hardened"
        ? ShieldCheck
        : CheckCircle2;

  return (
    <div
      className="relative flex min-h-[300px] min-w-0 flex-col overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.7)] backdrop-blur-md md:h-full md:min-h-0 md:flex-1"
      data-testid={testid}
      style={accentVars}
    >
      {/* Top accent bar */}
      <div className="h-[3px] w-full shrink-0" style={{ background: accent }} />

      {/* Header: title (left) + verdict pill (right, own clear zone) */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[rgb(var(--border))] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-[1px]"
            style={{ background: accent }}
            aria-hidden="true"
          />
          <span className="truncate font-sans text-xs font-semibold uppercase tracking-[0.14em] text-[rgb(var(--text))]">
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
          className="flex shrink-0 items-center gap-1.5 border-b border-[rgb(var(--border))] px-3 py-1.5"
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
          <button
            onClick={onRetry}
            data-testid={`${testid}-retry`}
            className="ml-auto inline-flex h-5 items-center gap-1 rounded-md border px-1.5 font-sans text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B8DEF]"
            style={{ borderColor: `${CHAOS}66`, color: CHAOS }}
          >
            <RotateCw size={10} />
            Retry
          </button>
        </div>
      )}

      {/* Toolbar: copy (own row) */}
      {state.status === "loaded" && (
        <div className="flex shrink-0 items-center justify-end gap-2 border-b border-[rgb(var(--border))] px-3 py-1.5">
          {copyFailed && (
            <span
              className="font-sans text-[10px] font-medium"
              style={{ color: CHAOS }}
              data-testid={`${testid}-copy-error`}
            >
              copy not supported here
            </span>
          )}
          <button
            onClick={copyDiagram}
            data-testid={`${testid}-copy`}
            aria-label="Copy diagram source"
            title={copied ? "Copied" : "Copy diagram"}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-[rgb(var(--border-2))] px-2 font-sans text-[10px] font-medium text-[rgb(var(--muted))] transition-colors hover:border-[rgb(var(--border-3))] hover:text-[rgb(var(--text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B8DEF]"
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
            <span className="font-mono text-[11px] tracking-wide text-[rgb(var(--muted)/0.6)]">
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
                className="dg-skel rounded-md border border-[rgb(var(--border-2))] bg-[rgb(var(--panel-2))]"
                style={{ width: 150 - i * 12, height: 34, animationDelay: `${i * 160}ms` }}
              />
            ))}
            <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
              compiling
            </span>
          </div>
        )}

        {state.status === "error" && (
          <div
            className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center"
            data-testid={`${testid}-error`}
          >
            <AlertTriangle size={20} style={{ color: CHAOS }} />
            <span className="font-sans text-xs" style={{ color: CHAOS }}>
              Stage failed to respond
            </span>
            <button
              onClick={onRetry}
              data-testid={`${testid}-retry`}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-sans text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B8DEF]"
              style={{ borderColor: `${CHAOS}66`, color: CHAOS }}
            >
              <RotateCw size={12} />
              Retry
            </button>
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
              className="text-[13px] leading-relaxed text-[rgb(var(--muted))]"
              data-testid={`${testid}-summary`}
            >
              {state.summary}
            </p>

            {state.patched.length > 0 && (
              <div
                className="border-t border-[rgb(var(--border))] pt-3"
                data-testid={`${testid}-patched`}
              >
                <div className="mb-2 font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--muted))]">
                  Patched from chaos injection
                </div>
                <ul className="flex flex-col gap-2">
                  {state.patched.map((p, i) => (
                    <li
                      key={`${p.weakness}-${i}`}
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
                          className="text-[rgb(var(--muted))] line-through"
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
  const [requirements, setRequirements] = useState<string>("");
  const [running, setRunning] = useState<boolean>(false);
  const [validating, setValidating] = useState<boolean>(false);
  const [architect, setArchitect] = useState<StageState>(EMPTY_STAGE);
  const [chaos, setChaos] = useState<StageState>(EMPTY_STAGE);
  const [hardened, setHardened] = useState<StageState>(EMPTY_STAGE);
  const [model, setModel] = useState<string>("gpt-4o-mini");
  const [specError, setSpecError] = useState<string>("");
  const [keyBanner, setKeyBanner] = useState<string | null>(null);
  const [isPro, setIsPro] = useState<boolean>(() => {
    try {
      return localStorage.getItem("archaudit-pro") === "true";
    } catch {
      return false;
    }
  });
  const [shareOpen, setShareOpen] = useState<boolean>(false);
  const [shareDataUrl, setShareDataUrl] = useState<string>("");
  const [captionCopied, setCaptionCopied] = useState<boolean>(false);
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("archaudit-theme") as "dark" | "light") || "dark",
  );
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("theme-light", theme === "light");
    localStorage.setItem("archaudit-theme", theme);
  }, [theme]);

  // Read ?pro=true from the Stripe redirect, persist it, then strip the param.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("pro") === "true") {
        setIsPro(true);
        try {
          localStorage.setItem("archaudit-pro", "true");
        } catch {
          // private browsing — Pro lasts for this session only, still fine.
        }
        params.delete("pro");
        const qs = params.toString();
        window.history.replaceState(
          {},
          "",
          window.location.pathname + (qs ? `?${qs}` : ""),
        );
      }
    } catch {
      // URL/history API unavailable — silently stay on free tier.
    }
  }, []);

  // Free tier is locked to gpt-4o-mini; coerce if Pro is lost.
  useEffect(() => {
    if (!isPro && isPremiumModel(model)) setModel("gpt-4o-mini");
  }, [isPro, model]);

  // Health check on load — never crash the UI if the LLM key is unavailable.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/health`);
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled && d && d.llm_key_configured === false) {
          setKeyBanner(
            "LLM key not configured — audits will show cached fallback results only.",
          );
        }
      } catch {
        // Health probe failed (backend unreachable) — stay silent; audit calls
        // will surface their own per-panel errors with Retry.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bannerForReason = (reason?: string): string | null => {
    if (reason === "key_missing")
      return "LLM key not configured — showing cached fallback results.";
    if (reason === "auth")
      return "LLM key was rejected (auth error) — showing cached fallback results. Check the key in your deployment.";
    if (reason === "rate_limit")
      return "LLM account rate-limited — showing cached fallback results. Try again shortly or top up your balance.";
    return null;
  };

  const ensureAudio = () => {
    try {
      if (!audioRef.current) {
        const Ctx =
          window.AudioContext || (window as any).webkitAudioContext;
        if (Ctx) audioRef.current = new Ctx();
      }
      if (audioRef.current && audioRef.current.state === "suspended") {
        audioRef.current.resume();
      }
    } catch {
      // AudioContext unavailable / blocked — sound is optional, never fatal.
    }
    return audioRef.current;
  };

  // Subtle synthesized "stamp thud" — a low body + a short transient click.
  const playThud = () => {
    try {
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
    } catch {
      // Autoplay policy / audio failure — verdict flow must continue regardless.
    }
  };

  const canExport =
    architect.status === "loaded" ||
    chaos.status === "loaded" ||
    hardened.status === "loaded";

  const buildReport = (): string => {
    const block = (title: string, verdict: string, s: StageState) => {
      if (s.status !== "loaded") {
        return (
          `## ${title} — ${verdict}\n\n` +
          "```\nUNAVAILABLE — this stage did not complete successfully.\n```\n\n"
        );
      }
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
    const modelLabel =
      MODEL_OPTIONS.find((m) => m.value === model)?.label || model;
    return (
      "# CROSS-EXAMINED — Inspection Report\n\n" +
      `Generated: ${new Date().toISOString()}\n` +
      `Model: ${modelLabel} (Emergent Universal Key) · stateless\n\n` +
      `## Requirements\n\n${requirements}\n\n` +
      block("v1.0 ARCHITECT", COLUMNS.architect.verdict, architect) +
      block("v1.1 CHAOS_INJECTION", COLUMNS.chaos.verdict, chaos) +
      block("v2.0 HARDENED", COLUMNS.hardened.verdict, hardened)
    );
  };

  const exportReport = () => {
    if (!canExport) return;
    try {
      const blob = new Blob([buildReport()], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `archaudit-report-${Date.now()}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Blob/download unsupported — surface via the key banner area.
      setKeyBanner("Report export is not supported in this browser.");
    }
  };

  const lineNumbers = useMemo(() => {
    const count = Math.max(requirements.split("\n").length, 20);
    return Array.from({ length: count }, (_, i) =>
      String(i + 1).padStart(2, "0"),
    );
  }, [requirements]);

  const applyEvent = (event: string, payload: any) => {
    const reason = payload.error_reason as string | undefined;
    const banner = bannerForReason(reason);
    if (banner) setKeyBanner(banner);
    if (event === "architect_done") {
      setArchitect({
        status: "loaded",
        diagram: payload.architect_diagram,
        summary: payload.architect_summary,
        fallback: Boolean(payload.fallback),
        patched: [],
        elapsedMs: payload.elapsed_ms,
        errorReason: reason,
      });
    } else if (event === "attack_done") {
      setChaos({
        status: "loaded",
        diagram: payload.attack_diagram,
        summary: payload.attack_summary,
        fallback: Boolean(payload.fallback),
        patched: [],
        elapsedMs: payload.elapsed_ms,
        errorReason: reason,
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
        errorReason: reason,
      });
    }
    playThud();
  };

  // Per-panel retry — re-runs a single stage in isolation via /audit/stage.
  // The other two panels' results are never touched.
  const retryStage = async (stage: "architect" | "chaos" | "hardened") => {
    const setter =
      stage === "architect" ? setArchitect : stage === "chaos" ? setChaos : setHardened;
    if (!requirements.trim()) {
      setSpecError("Enter a spec before retrying.");
      return;
    }
    setter({ ...EMPTY_STAGE, status: "loading" });
    ensureAudio();
    try {
      const body: any = { requirements, stage, model };
      if (stage === "hardened") {
        body.architect_diagram = architect.diagram;
        body.architect_summary = architect.summary;
        body.attack_diagram = chaos.diagram;
        body.attack_summary = chaos.summary;
      }
      const resp = await fetch(`${API}/audit/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const d = await resp.json();
      const reason = d.error_reason as string | undefined;
      const banner = bannerForReason(reason);
      if (banner) setKeyBanner(banner);
      setter({
        status: "loaded",
        diagram: d.diagram || "",
        summary: d.summary || "",
        fallback: Boolean(d.fallback),
        patched: Array.isArray(d.patched) ? d.patched : [],
        elapsedMs: d.elapsed_ms,
        errorReason: reason,
      });
      playThud();
    } catch {
      setter({ ...EMPTY_STAGE, status: "error", errorReason: "error" });
    }
  };

  const executeAudit = async () => {
    if (running || validating) return; // ignore repeat / double clicks
    const spec = requirements.trim();
    if (!spec) {
      setSpecError("Enter a system spec to run an audit.");
      return;
    }
    setSpecError("");

    // Lightweight pre-flight validation (reuses the selected model). Fails OPEN:
    // any error/timeout skips the check so it can never block a real run.
    setValidating(true);
    let valid = true;
    try {
      const vr = await fetch(`${API}/validate-spec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements: spec, model }),
      });
      if (vr.ok) {
        const vd = await vr.json();
        valid = vd.valid !== false;
      }
    } catch {
      valid = true; // network error → fail open
    } finally {
      setValidating(false);
    }
    if (!valid) {
      setSpecError(
        "This doesn't look like a system to audit. Try describing what the system does, its scale, or key requirements — e.g. 'a URL shortener that handles 50k redirects/sec.'",
      );
      return;
    }

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
        body: JSON.stringify({ requirements, model }),
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
            // Malformed/partial SSE frame — safe to skip; next frame recovers.
            if (process.env.NODE_ENV !== "production") {
              console.error("ARCHAUDIT: dropped malformed SSE frame", e);
            }
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

  const goPro = () => {
    if (STRIPE_PAYMENT_LINK) {
      window.open(STRIPE_PAYMENT_LINK, "_blank", "noopener,noreferrer");
    }
  };

  const shareCaption = (): string => {
    const spec = (requirements || "a system").split("\n")[0].slice(0, 90);
    return `I ran "${spec}" through Cross-Examined — adversarial LLM architecture review: Architect → Chaos → Hardened. ${APP_URL}`;
  };

  const shareOnX = () => {
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareCaption())}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const shareOnLinkedIn = () => {
    window.open(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(APP_URL)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const buildShareCard = (): string => {
    const BG = "#0B0F17";
    const PANEL = "#10151F";
    const TEXT = "#E5E7EB";
    const MUTED = "#8B96A5";

    const stages = [
      { title: "V1.0 ARCHITECT", s: architect, color: COLUMNS.architect.accent, verdict: COLUMNS.architect.verdict },
      { title: "V1.1 CHAOS_INJECTION", s: chaos, color: COLUMNS.chaos.accent, verdict: COLUMNS.chaos.verdict },
      { title: "V2.0 HARDENED", s: hardened, color: COLUMNS.hardened.accent, verdict: COLUMNS.hardened.verdict },
    ];

    const W = 1400;
    const PAD = 48;
    const GAP = 24;
    const colW = Math.floor((W - PAD * 2 - GAP * 2) / 3);
    const innerPad = 18;
    const textW = colW - innerPad * 2;
    const diagFont = "11px 'JetBrains Mono', monospace";
    const diagLH = 14;
    const sumFont = "14px Inter, sans-serif";
    const sumLH = 20;
    const headerH = 210;
    const titleBlock = 78;

    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) throw new Error("canvas unsupported");
    measure.font = sumFont;
    const cols = stages.map((st) => {
      const raw =
        st.s.status === "loaded" && st.s.diagram
          ? st.s.diagram
          : st.s.status === "error"
            ? "UNAVAILABLE — stage failed."
            : "(no output)";
      const diagLines = raw.split("\n");
      const sumLines = st.s.summary ? wrapText(measure, st.s.summary, textW) : [];
      return { ...st, diagLines, sumLines };
    });

    const maxBody = Math.max(
      ...cols.map((c) => c.diagLines.length * diagLH + 22 + c.sumLines.length * sumLH),
    );
    const colH = titleBlock + maxBody + innerPad;
    const H = headerH + colH + 70;

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unsupported");

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#5B8DEF";
    ctx.fillRect(0, 0, W, 6);

    // Header
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#5B8DEF";
    ctx.fillRect(PAD, 66, 26, 26);
    ctx.fillStyle = TEXT;
    ctx.font = "700 40px Inter, sans-serif";
    ctx.fillText("CROSS-EXAMINED", PAD + 40, 94);
    ctx.fillStyle = MUTED;
    ctx.font = "500 18px 'JetBrains Mono', monospace";
    ctx.fillText("// adversarial architecture review", PAD + 40, 122);
    ctx.fillStyle = TEXT;
    ctx.font = "600 30px Inter, sans-serif";
    const specLines = wrapText(ctx, (requirements || "Untitled system").trim(), W - PAD * 2);
    ctx.fillText(specLines[0] || "", PAD, 176);

    // Columns
    const colY = headerH;
    cols.forEach((c, i) => {
      const x = PAD + i * (colW + GAP);
      ctx.fillStyle = PANEL;
      roundRect(ctx, x, colY, colW, colH, 14);
      ctx.fill();
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 2;
      roundRect(ctx, x, colY, colW, colH, 14);
      ctx.stroke();
      ctx.fillStyle = c.color;
      roundRect(ctx, x, colY, colW, 6, 3);
      ctx.fill();

      ctx.fillStyle = TEXT;
      ctx.font = "600 15px 'JetBrains Mono', monospace";
      ctx.fillText(c.title, x + innerPad, colY + 42);
      ctx.fillStyle = c.color;
      ctx.font = "700 17px Inter, sans-serif";
      ctx.fillText(c.verdict, x + innerPad, colY + 66);

      // Clip content to the column so long lines never overflow.
      ctx.save();
      roundRect(ctx, x + 4, colY + titleBlock - 14, colW - 8, colH - titleBlock + 8, 8);
      ctx.clip();

      ctx.fillStyle = TEXT;
      ctx.font = diagFont;
      let dy = colY + titleBlock + 4;
      c.diagLines.forEach((ln) => {
        ctx.fillText(ln, x + innerPad, dy);
        dy += diagLH;
      });

      dy += 14;
      ctx.fillStyle = MUTED;
      ctx.font = sumFont;
      c.sumLines.forEach((ln) => {
        ctx.fillText(ln, x + innerPad, dy);
        dy += sumLH;
      });
      ctx.restore();
    });

    ctx.fillStyle = MUTED;
    ctx.font = "500 16px 'JetBrains Mono', monospace";
    ctx.fillText(APP_URL || "archaudit", PAD, H - 28);

    return canvas.toDataURL("image/png");
  };

  const openShare = () => {
    if (!canExport) return;
    try {
      setShareDataUrl(buildShareCard());
    } catch {
      setShareDataUrl("");
    }
    setShareOpen(true);
  };

  const copyCaption = async () => {
    const text = shareCaption();
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCaptionCopied(true);
      window.setTimeout(() => setCaptionCopied(false), 1600);
    }
  };

  const downloadCard = () => {
    if (!shareDataUrl) return;
    try {
      const a = document.createElement("a");
      a.href = shareDataUrl;
      a.download = `archaudit-share-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      // Download unsupported — user can right-click/save the preview image.
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-[rgb(var(--bg))] text-[rgb(var(--text))]">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-[rgb(var(--border)/0.6)] bg-[rgb(var(--bg))] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#5B8DEF]/40"
            style={{
              background:
                "linear-gradient(135deg, rgba(91,141,239,0.28), rgba(52,211,153,0.16))",
              boxShadow: "0 0 12px #5B8DEF55",
            }}
            aria-hidden="true"
          >
            <Scale size={15} strokeWidth={2.2} style={{ color: "#5B8DEF" }} />
          </span>
          <span
            className="font-sans text-sm font-bold uppercase tracking-[0.2em] text-[rgb(var(--text))]"
            data-testid="archaudit-logo"
          >
            Cross-Examined
          </span>
          {isPro && (
            <span
              data-testid="pro-badge"
              className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-sans text-[9px] font-bold uppercase tracking-wider"
              style={{ borderColor: `${CHAOS}66`, color: CHAOS, background: `${CHAOS}14` }}
            >
              <Crown size={9} /> Pro
            </span>
          )}
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--muted)/0.7)] sm:inline">
            // adversarial architecture review
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isPro && (
            <button
              onClick={goPro}
              data-testid="go-pro-button"
              title="Upgrade to Pro (Stripe test mode)"
              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-sans text-[10px] font-bold uppercase tracking-wider transition-colors"
              style={{ borderColor: `${CHAOS}66`, color: CHAOS, background: `${CHAOS}14` }}
            >
              <Crown size={11} /> Go Pro
            </button>
          )}
          <div className="flex items-center gap-2 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.6)] px-2 py-1 backdrop-blur-md">
          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            data-testid="theme-toggle"
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            className="flex h-6 w-6 items-center justify-center rounded-full text-[rgb(var(--muted))] transition-colors hover:bg-[rgb(var(--muted)/0.15)] hover:text-[rgb(var(--text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B8DEF]"
          >
            {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
          </button>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--muted))]">
            <select
              value={model}
              onChange={(e) => {
                const v = e.target.value;
                if (!isPro && isPremiumModel(v)) {
                  // Premium model chosen by a free user → prompt upgrade,
                  // keep the current free model selected.
                  goPro();
                  return;
                }
                setModel(v);
              }}
              data-testid="model-select"
              aria-label="Select model for the next audit"
              title={
                isPro
                  ? "Model used for the next Execute Audit run"
                  : "GPT-4o-mini and Gemini are free — NVIDIA requires Pro"
              }
              className="cursor-pointer appearance-none bg-transparent font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--muted))] outline-none transition-colors hover:text-[rgb(var(--text))] focus-visible:text-[rgb(var(--text))]"
            >
              {MODEL_OPTIONS.map((m) => {
                const locked = !isPro && isPremiumModel(m.value);
                return (
                  <option
                    key={m.value}
                    value={m.value}
                    className="bg-[rgb(var(--panel))] text-[rgb(var(--text))]"
                  >
                    {m.label}
                    {locked ? " · Pro" : ""}
                  </option>
                );
              })}
            </select>
          </span>
          </div>
        </div>
      </header>

      {/* Top-level banner — key/account issues. UI stays fully usable. */}
      {keyBanner && (
        <div
          className="flex shrink-0 items-center gap-2 border-b px-4 py-2"
          style={{ background: `${CHAOS}14`, borderColor: `${CHAOS}44` }}
          data-testid="key-banner"
        >
          <AlertTriangle size={13} style={{ color: CHAOS }} className="shrink-0" />
          <span className="font-sans text-[11px] font-medium" style={{ color: CHAOS }}>
            {keyBanner}
          </span>
          <button
            onClick={() => setKeyBanner(null)}
            data-testid="key-banner-dismiss"
            aria-label="Dismiss notice"
            className="ml-auto text-[rgb(var(--muted))] transition-colors hover:text-[rgb(var(--text))]"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        {/* Left sidebar — Command Terminal (30%) */}
        <aside className="flex w-full shrink-0 flex-col border-b border-[rgb(var(--border)/0.6)] md:w-[30%] md:border-b-0 md:border-r">
          <div className="mx-2 mt-2 flex shrink-0 items-center gap-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.6)] px-3 py-2.5 backdrop-blur-md">
            <span
              className="h-2 w-2 shrink-0"
              style={{ background: "#5B8DEF" }}
              aria-hidden="true"
            />
            <span className="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-[rgb(var(--text))]">
              Command Terminal
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-3">
            <div className="relative flex min-h-[200px] flex-1 overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.5)] backdrop-blur-md focus-within:ring-1 focus-within:ring-[#5B8DEF]">
              <div
                className="relative z-10 select-none overflow-hidden border-r border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.4)] px-2 py-2 text-right font-mono text-[11px] leading-relaxed text-[rgb(var(--muted)/0.4)]"
                aria-hidden="true"
              >
                {lineNumbers.map((n) => (
                  <div key={n}>{n}</div>
                ))}
              </div>
              <textarea
                value={requirements}
                onChange={(e) => {
                  setRequirements(e.target.value);
                  if (specError && e.target.value.trim()) setSpecError("");
                }}
                spellCheck={false}
                data-testid="requirements-input"
                className="relative z-10 min-h-0 flex-1 resize-none overflow-auto bg-transparent px-3 py-2 font-mono text-[13px] leading-relaxed text-[rgb(var(--text))] caret-[#5B8DEF] outline-none placeholder:text-[rgb(var(--muted)/0.4)] focus-visible:outline-none"
                placeholder="Describe the system to audit..."
              />
            </div>

            {specError && (
              <p
                className="mt-2 font-sans text-[11px] font-medium"
                style={{ color: CHAOS }}
                data-testid="spec-error"
              >
                {specError}
              </p>
            )}

            <button
              onClick={executeAudit}
              disabled={running || validating}
              data-testid="execute-audit-button"
              className="mt-3 shrink-0 rounded-xl border border-[rgb(var(--text)/0.2)] bg-[rgb(var(--text)/0.9)] px-4 py-3 font-sans text-xs font-bold uppercase tracking-[0.18em] text-[rgb(var(--bg))] backdrop-blur-md transition-colors duration-150 hover:bg-[rgb(var(--text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B8DEF] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg))] disabled:cursor-not-allowed disabled:bg-[rgb(var(--border)/0.4)] disabled:text-[rgb(var(--muted)/0.5)]"
            >
              {validating
                ? "CHECKING INPUT..."
                : running
                  ? "AUDIT_RUNNING..."
                  : "EXECUTE AUDIT"}
            </button>

            <button
              onClick={openShare}
              disabled={!canExport}
              data-testid="share-result-button"
              className="mt-2 flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.5)] px-4 py-2.5 font-sans text-xs font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))] backdrop-blur-md transition-colors duration-150 hover:border-[#5B8DEF] hover:text-[rgb(var(--text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B8DEF] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg))] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[rgb(var(--border))] disabled:hover:text-[rgb(var(--muted))]"
            >
              <Share2 size={13} />
              Share Result
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
              onRetry={() => retryStage("architect")}
            />
            <StageColumn
              columnKey="chaos"
              title="v1.1 CHAOS_INJECTION"
              accent={COLUMNS.chaos.accent}
              verdict={COLUMNS.chaos.verdict}
              state={chaos}
              testid="column-chaos"
              onRetry={() => retryStage("chaos")}
            />
            <StageColumn
              columnKey="hardened"
              title="v2.0 HARDENED"
              accent={COLUMNS.hardened.accent}
              verdict={COLUMNS.hardened.verdict}
              state={hardened}
              testid="column-hardened"
              onRetry={() => retryStage("hardened")}
            />
          </div>
        </main>
      </div>

      {/* Share Card overlay (Feature 2) */}
      {shareOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          data-testid="share-overlay"
          onClick={() => setShareOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-[rgb(var(--text))]">
                Share Result
              </span>
              <button
                onClick={() => setShareOpen(false)}
                data-testid="share-close"
                aria-label="Close share card"
                className="text-[rgb(var(--muted))] transition-colors hover:text-[rgb(var(--text))]"
              >
                <X size={16} />
              </button>
            </div>
            {shareDataUrl ? (
              <img
                src={shareDataUrl}
                alt="Cross-Examined share card"
                data-testid="share-card-image"
                className="w-full rounded-lg border border-[rgb(var(--border))]"
              />
            ) : (
              <p
                className="py-8 text-center font-sans text-xs"
                style={{ color: CHAOS }}
                data-testid="share-card-error"
              >
                Card image could not be generated in this browser.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={exportReport}
                data-testid="export-report-button"
                className="flex items-center gap-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.5)] px-4 py-2.5 font-sans text-xs font-semibold uppercase tracking-[0.14em] text-[rgb(var(--muted))] transition-colors hover:border-[#5B8DEF] hover:text-[rgb(var(--text))]"
              >
                <Download size={13} />
                Export Report
              </button>
              <button
                onClick={downloadCard}
                disabled={!shareDataUrl}
                data-testid="share-download"
                className="flex items-center gap-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.5)] px-4 py-2.5 font-sans text-xs font-semibold uppercase tracking-[0.14em] text-[rgb(var(--muted))] transition-colors hover:border-[#5B8DEF] hover:text-[rgb(var(--text))] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download size={13} />
                Download PNG
              </button>
              <button
                onClick={copyCaption}
                data-testid="share-copy-caption"
                className="flex items-center gap-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.5)] px-4 py-2.5 font-sans text-xs font-semibold uppercase tracking-[0.14em] text-[rgb(var(--muted))] transition-colors hover:border-[#5B8DEF] hover:text-[rgb(var(--text))]"
              >
                {captionCopied ? <Check size={13} /> : <Copy size={13} />}
                {captionCopied ? "Copied" : "Copy Caption"}
              </button>
              <button
                onClick={shareOnX}
                data-testid="share-x"
                className="flex items-center gap-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.5)] px-4 py-2.5 font-sans text-xs font-semibold uppercase tracking-[0.14em] text-[rgb(var(--muted))] transition-colors hover:border-[#5B8DEF] hover:text-[rgb(var(--text))]"
              >
                <Share2 size={13} />
                Share on X
              </button>
              <button
                onClick={shareOnLinkedIn}
                data-testid="share-linkedin"
                className="flex items-center gap-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.5)] px-4 py-2.5 font-sans text-xs font-semibold uppercase tracking-[0.14em] text-[rgb(var(--muted))] transition-colors hover:border-[#5B8DEF] hover:text-[rgb(var(--text))]"
              >
                <Share2 size={13} />
                Share on LinkedIn
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="flex shrink-0 items-center justify-between border-t border-[rgb(var(--border)/0.6)] bg-[rgb(var(--bg))] px-4 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--muted)/0.7)]">
          Cross-Examined
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: running ? MINT : "rgb(var(--muted))" }}
        >
          {running ? "STREAM_OPEN" : "READY"}
        </span>
      </footer>
    </div>
  );
}
