import React, { useMemo, useState } from "react";

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

const ACCENTS: Record<string, string> = {
  architect: "border-l-zinc-400",
  chaos: "border-l-amber-500",
  hardened: "border-l-emerald-400",
};

function StageColumn(props: {
  columnKey: string;
  title: string;
  accent: string;
  state: StageState;
  testid: string;
}) {
  const { title, accent, state, testid } = props;

  return (
    <div
      className="flex h-full min-w-0 flex-1 flex-col border-r border-zinc-800 last:border-r-0"
      data-testid={testid}
    >
      <div
        className={`shrink-0 border-b border-zinc-800 border-l-2 ${accent} bg-zinc-900/40 px-3 py-2`}
      >
        <span className="font-mono text-xs uppercase tracking-widest text-zinc-300">
          {title}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {state.status === "idle" && (
          <div
            className="flex h-full items-center justify-center"
            data-testid={`${testid}-idle`}
          >
            <span className="font-mono text-xs text-zinc-600">
              AWAITING_INPUT...
            </span>
          </div>
        )}

        {state.status === "loading" && (
          <div
            className="flex h-full items-center justify-center"
            data-testid={`${testid}-loading`}
          >
            <span className="font-mono text-xs text-zinc-400">
              COMPILING_RESPONSE
              <span className="archaudit-blink">_</span>
            </span>
          </div>
        )}

        {state.status === "error" && (
          <div
            className="flex h-full items-center justify-center px-2 text-center"
            data-testid={`${testid}-error`}
          >
            <span className="font-mono text-xs text-amber-500">
              STAGE_FAILED — SHOWING_CACHED_FALLBACK
            </span>
          </div>
        )}

        {state.status === "loaded" && (
          <div className="flex flex-col gap-3" data-testid={`${testid}-loaded`}>
            {state.fallback && (
              <div
                className="border border-amber-500/40 bg-amber-500/5 px-2 py-1"
                data-testid={`${testid}-fallback-banner`}
              >
                <span className="font-mono text-[10px] uppercase tracking-widest text-amber-500">
                  STAGE_FAILED — SHOWING_CACHED_FALLBACK
                </span>
              </div>
            )}
            <pre
              className="whitespace-pre font-mono text-[11px] leading-tight text-zinc-200"
              data-testid={`${testid}-diagram`}
            >
              {state.diagram}
            </pre>
            <p
              className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-400"
              data-testid={`${testid}-summary`}
            >
              {state.summary}
            </p>

            {state.patched.length > 0 && (
              <div
                className="mt-1 border-t border-zinc-800 pt-3"
                data-testid={`${testid}-patched`}
              >
                <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  // patched_from_chaos_injection
                </div>
                <ul className="flex flex-col gap-2">
                  {state.patched.map((p, i) => (
                    <li
                      key={i}
                      className="font-mono text-[11px] leading-snug"
                      data-testid={`${testid}-patched-item-${i}`}
                    >
                      <div className="flex gap-1.5 text-amber-500">
                        <span className="text-emerald-400">[✓]</span>
                        <span className="line-through decoration-amber-500/50">
                          {p.weakness}
                        </span>
                      </div>
                      {p.fix && (
                        <div className="pl-5 text-emerald-400">
                          └─ {p.fix}
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
      });
    } else if (event === "attack_done") {
      setChaos({
        status: "loaded",
        diagram: payload.attack_diagram,
        summary: payload.attack_summary,
        fallback: Boolean(payload.fallback),
        patched: [],
      });
    } else if (event === "final_done") {
      const res = payload as AuditResponse & { fallback?: boolean };
      setHardened({
        status: "loaded",
        diagram: res.final_diagram,
        summary: res.final_summary,
        fallback: Boolean(res.fallback),
        patched: Array.isArray(res.patched) ? res.patched : [],
      });
    }
  };

  const executeAudit = async () => {
    if (running || !requirements.trim()) return;
    setRunning(true);
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
    <div className="flex h-screen w-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <span
            className="font-mono text-sm font-bold uppercase tracking-[0.3em] text-zinc-100"
            data-testid="archaudit-logo"
          >
            ARCHAUDIT
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            // adversarial architecture review
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          gpt-5-mini / stateless
        </span>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Left sidebar — Command Terminal (30%) */}
        <aside className="flex w-[30%] shrink-0 flex-col border-r border-zinc-800">
          <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/40 px-3 py-2">
            <span className="font-mono text-xs uppercase tracking-widest text-zinc-300">
              Command Terminal
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-3">
            <label className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              // requirements.spec
            </label>

            <div className="flex min-h-0 flex-1 border border-zinc-800 bg-black">
              <div
                className="select-none overflow-hidden border-r border-zinc-800 bg-zinc-900/40 px-2 py-2 text-right font-mono text-[11px] leading-relaxed text-zinc-700"
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
                className="min-h-0 flex-1 resize-none bg-black px-3 py-2 font-mono text-[13px] leading-relaxed text-emerald-400 outline-none placeholder:text-zinc-700"
                placeholder="Describe the system to audit..."
              />
            </div>

            <button
              onClick={executeAudit}
              disabled={running || !requirements.trim()}
              data-testid="execute-audit-button"
              className="mt-3 shrink-0 rounded-none bg-zinc-100 px-4 py-3 font-mono text-xs font-bold uppercase tracking-widest text-zinc-950 transition-colors duration-150 hover:bg-zinc-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
            >
              {running ? "AUDIT_RUNNING..." : "EXECUTE AUDIT"}
            </button>
          </div>
        </aside>

        {/* Main canvas — three columns (70%) */}
        <main className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex h-full min-w-[720px]">
            <StageColumn
              columnKey="architect"
              title="v1.0 ARCHITECT"
              accent={ACCENTS.architect}
              state={architect}
              testid="column-architect"
            />
            <StageColumn
              columnKey="chaos"
              title="v1.1 CHAOS_INJECTION"
              accent={ACCENTS.chaos}
              state={chaos}
              testid="column-chaos"
            />
            <StageColumn
              columnKey="hardened"
              title="v2.0 HARDENED"
              accent={ACCENTS.hardened}
              state={hardened}
              testid="column-hardened"
            />
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="flex shrink-0 items-center justify-between border-t border-zinc-800 px-4 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          ARCHAUDIT
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          {running ? "STREAM_OPEN" : "READY"}
        </span>
      </footer>
    </div>
  );
}
