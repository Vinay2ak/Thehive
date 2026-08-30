import React, { useLayoutEffect, useMemo, useRef, useState } from "react";

type Mode = "architect" | "chaos" | "hardened";

interface DNode {
  id: string;
  text: string;
  level: number;
  idx: number;
  count: number;
  flagged: boolean;
}
interface DEdge {
  from: string;
  to: string;
}

// Box-drawing glyphs + connector chars stripped when extracting node labels.
const BOX_RE = /[\u2500-\u257F|+^]/g;

const FLAG_RE: Record<Mode, RegExp> = {
  architect: /a^/,
  chaos: /(spof|single point|bottleneck|fail|overload|down|hotspot|hot spot|contention|no repl|no fail|risk|weak|choke)/i,
  hardened: /(replica|cache|queue|cluster|failover|redundan|balanc|shard|backup|pool|auto.?scal)/i,
};

function parseDiagram(
  ascii: string,
  mode: Mode,
): { nodes: DNode[]; edges: DEdge[]; levels: number } {
  const lines = (ascii || "").split("\n");
  const levelTokens: { text: string; col: number }[][] = [];

  for (const line of lines) {
    let cleaned = line.replace(BOX_RE, " ");
    cleaned = cleaned.replace(/-{2,}>?/g, " ").replace(/>/g, " ");
    const parts = cleaned.split(/\s{2,}/);
    const tokens: { text: string; col: number }[] = [];
    let from = 0;
    for (const p of parts) {
      const t = p.trim().replace(/\s+/g, " ");
      const alnum = t.replace(/[^A-Za-z0-9]/g, "");
      if (t && alnum.length >= 2) {
        let col = cleaned.indexOf(p, from);
        if (col < 0) col = 0;
        from = col + p.length;
        tokens.push({ text: t, col });
      }
    }
    if (tokens.length) levelTokens.push(tokens);
  }

  const nodes: DNode[] = [];
  levelTokens.forEach((lvl, li) => {
    const sorted = [...lvl].sort((a, b) => a.col - b.col).slice(0, 4);
    sorted.forEach((tk, k) => {
      nodes.push({
        id: `${li}-${k}`,
        text: tk.text.slice(0, 48),
        level: li,
        idx: k,
        count: sorted.length,
        flagged: mode !== "architect" && FLAG_RE[mode].test(tk.text),
      });
    });
  });

  const edges: DEdge[] = [];
  const maxLevel = levelTokens.length;
  for (let li = 1; li < maxLevel; li++) {
    const prev = nodes.filter((n) => n.level === li - 1);
    const cur = nodes.filter((n) => n.level === li);
    cur.forEach((c) => {
      const cx = (c.idx + 0.5) / c.count;
      let best: DNode | null = null;
      let bd = Infinity;
      prev.forEach((p) => {
        const px = (p.idx + 0.5) / p.count;
        const d = Math.abs(px - cx);
        if (d < bd) {
          bd = d;
          best = p;
        }
      });
      if (best) edges.push({ from: (best as DNode).id, to: c.id });
    });
  }

  return { nodes, edges, levels: maxLevel };
}

const BAND = 78;

export const DiagramCanvas: React.FC<{
  diagram: string;
  mode: Mode;
  accent: string;
  testid?: string;
}> = ({ diagram, mode, accent, testid }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(e.contentRect.width);
    });
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const { nodes, edges, levels } = useMemo(
    () => parseDiagram(diagram, mode),
    [diagram, mode],
  );

  const height = Math.max(levels, 1) * BAND;
  const nodeById = (id: string) => nodes.find((n) => n.id === id);
  const xOf = (n: DNode) => ((n.idx + 0.5) / n.count) * w;
  const yOf = (n: DNode) => n.level * BAND + BAND / 2;

  if (!nodes.length) {
    return (
      <div
        className="font-mono text-[11px] text-[rgb(var(--muted))]"
        data-testid={testid}
      >
        No diagram available.
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="relative w-full"
      style={{ height }}
      data-testid={testid}
    >
      <svg
        className="absolute inset-0"
        width={w || 1}
        height={height}
        style={{ pointerEvents: "none", color: "rgb(var(--edge))" }}
        aria-hidden="true"
      >
        <defs>
          <marker
            id={`arw-${mode}`}
            markerWidth="8"
            markerHeight="8"
            refX="5.5"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
          </marker>
        </defs>
        {w > 0 &&
          edges.map((e) => {
            const a = nodeById(e.from);
            const b = nodeById(e.to);
            if (!a || !b) return null;
            const x1 = xOf(a);
            const y1 = yOf(a) + 20;
            const x2 = xOf(b);
            const y2 = yOf(b) - 20;
            const ym = (y1 + y2) / 2;
            const d = `M ${x1} ${y1} L ${x1} ${ym} L ${x2} ${ym} L ${x2} ${y2}`;
            return (
              <path
                key={`${e.from}-${e.to}`}
                d={d}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.25}
                markerEnd={`url(#arw-${mode})`}
              />
            );
          })}
      </svg>

      {w > 0 &&
        nodes.map((n) => {
          const slotW = w / n.count;
          const maxW = Math.max(64, Math.min(slotW - 12, 220));
          return (
            <div
              key={n.id}
              className="dg-node absolute rounded-md border bg-[rgb(var(--panel-2))] px-2.5 py-1.5 text-center font-mono text-[11px] leading-tight text-[rgb(var(--text))]"
              style={
                {
                  left: xOf(n),
                  top: yOf(n),
                  maxWidth: maxW,
                  transform: "translate(-50%, -50%)",
                  borderColor: n.flagged ? accent : "rgb(var(--border-2))",
                  borderWidth: n.flagged ? 1.5 : 1,
                  boxShadow: n.flagged ? `0 0 0 1px ${accent}44` : "none",
                  animationDelay: `${n.level * 90}ms`,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  wordBreak: "break-word",
                } as React.CSSProperties
              }
            >
              {n.text}
            </div>
          );
        })}
    </div>
  );
};
