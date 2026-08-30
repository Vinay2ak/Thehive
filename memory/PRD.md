# ARCHAUDIT — PRD

## Problem statement
Single-screen internal hackathon demo (NOT a SaaS): a 3-panel adversarial LLM
architecture reviewer. React + TypeScript + Tailwind frontend (developer-IDE
look), Python FastAPI backend. Strict constraints: **NO database (fully
stateless)**, **NO auth**.

UI: left Command Terminal (spec input + controls) and 3 result columns —
V1.0 ARCHITECT, V1.1 CHAOS_INJECTION, V2.0 HARDENED. Backend runs Architect +
Chaos LLM calls in parallel, then an Arbiter call, streaming stage-completion
results to the frontend via SSE (emitted in fixed order architect→attack→final).

## Architecture
- `/app/frontend/src/App.tsx` — main UI, SSE consumption, controls, theming.
- `/app/frontend/src/DiagramCanvas.tsx` — HTML/SVG diagram renderer.
- `/app/frontend/src/index.css` — Tailwind + theme CSS variables (light/dark).
- `/app/backend/server.py` — FastAPI, parallel LLM orchestration, SSE.
- No DB. `MONGO_URL` exists in env scaffolding but is never used.

## LLM providers (model picker — single dropdown, switches all 3 agents)
- `gpt-4o-mini` — OpenAI via **Emergent Universal Key** (EMERGENT_LLM_KEY).
- `gemini` → `gemini-2.5-flash` — via Emergent Universal Key.
- `nvidia` → `nvidia/nemotron-3-super-120b-a12b` — direct to **NVIDIA NIM**
  (OpenAI-compatible, base `https://integrate.api.nvidia.com/v1`) using the
  user's `NVIDIA_API_KEY` in backend/.env. Reasoning is disabled via
  `extra_body={"chat_template_kwargs": {"thinking": False}}` (otherwise the
  model leaks chain-of-thought into the diagram output).
  NOTE: user's originally requested `nvidia/llama-3.1-nemotron-70b-instruct`
  (and 51b/340b) return 404 "not found for account" (not entitled); many meta
  Llama models are EOL (410). `nemotron-3-super-120b-a12b` is entitled + works.

## Key API endpoints
- `GET /api/health` → {status, llm_key_configured, models:[...]}.
- `POST /api/audit` {requirements, model} → SSE stream (architect_done,
  attack_done, final_done); each event has fallback + error_reason.
- `POST /api/audit/stage` {requirements, stage, model, + arch/attack context for
  hardened} → single-stage JSON result (used by per-panel Retry).

## Implemented (as of 2026-06)
- Core 3-panel SSE audit pipeline, parallel Architect/Chaos + Arbiter.
- HTML/SVG diagram rendering; Export Report (markdown); Copy Diagram.
- Glassmorphism dark theme + rounded surfaces; **light/dark toggle** (CSS var
  RGB-channel system, persisted to localStorage).
- Verdict stamp sound (Web Audio); sound-toggle button REMOVED (sound still
  plays by default). STATELESS badge REMOVED. `// requirements.spec` label and
  header green status dot REMOVED. Spec input starts EMPTY.
- **Model picker** (gpt-4o-mini / gemini / nvidia).
- **Go Pro checkout (Revenue, 2026-06)**: header "Go Pro" button opens the Stripe
  test Payment Link (`STRIPE_PAYMENT_LINK` in App.tsx). Stripe redirect →
  `?pro=true` sets a persisted `isPro` flag (localStorage, try/catch for private
  mode), shows a "PRO" badge by the logo, strips the query param. Free tier is
  gated to gpt-4o-mini (other models visible but disabled + lock icon + "· Pro").
- **Share Card (Virality, 2026-06)**: "Share Result" button (enabled after ≥1
  audit) renders a 1200×630 PNG via native canvas (wordmark, spec headline, 3
  color-coded verdict badges, app URL) in an overlay with Download PNG + Share on
  X + Share on LinkedIn intent links. Fully client-side, no new deps.
- **Production hardening pass**: per-panel independent error + Retry; timeout →
  cached fallback; top-level key/account banner (health check + error_reason);
  empty-spec inline validation; double-click guard; export enabled when any
  panel loaded (+ "UNAVAILABLE" placeholder for failed panels); clipboard
  failure inline message; audio wrapped in try/catch; every async wrapped.
  TIMEOUT_SECONDS=25 so streaming completes within the ~60s ingress cap.

## Backlog / P1-P2
- Per-agent model selection (advanced) — currently one dropdown for all 3.
- Optional: token-streaming of diagrams (currently stage-completion events).

## Known constraints
- NVIDIA nemotron-super is a 120b reasoning model; full 3-stage run ~15-25s.
  If it ever exceeds the timeout, panel shows cached fallback + Retry (retry
  uses the non-streaming /audit/stage with full budget).
