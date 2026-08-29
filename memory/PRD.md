# ARCHAUDIT — PRD

## Original Problem Statement
Single-screen internal hackathon demo tool "ARCHAUDIT". Industrial-Brutalism developer-IDE UI. Enter system requirements → run an adversarial architecture review: an Architect designs a system, a Chaos Engineer (in parallel) predicts failure points, then an Arbiter produces a hardened v2.0 design. Stateless, no DB, no auth. SSE streaming so each column populates independently.

## Architecture
- **Frontend**: React + TypeScript (`App.tsx`), Tailwind (zinc-950 / border-zinc-800 / font-mono / emerald+amber accents). Consumes SSE via fetch-stream. Uses `REACT_APP_BACKEND_URL`.
- **Backend**: FastAPI, fully stateless (no MongoDB, no auth). `POST /api/audit` returns `text/event-stream`.
- **LLM**: OpenAI `gpt-5-mini` via emergentintegrations (`OPENAI_API_KEY` env var; non-emergent key routes directly to OpenAI). Per-stage deterministic mock fallback on missing key / failure / 15s timeout.

## Flow
1. Two parallel calls via `asyncio.gather` (Architect + Chaos Engineer), each pushed as it finishes (`architect_done`, `attack_done`).
2. Arbiter call using both outputs → `final_done` with full `AuditResponse` JSON.

## Implemented (2026-06)
- SSE `/api/audit` with 3 named events, parallel stages, mock fallback (`fallback` flag). ✅
- Brutalist IDE UI: Command Terminal (30%) with line-number gutter textarea + EXECUTE AUDIT; 3 columns (70%) with idle/loading/loaded/error + fallback banner states. ✅
- Project identity locked to "ARCHAUDIT" (title, logo, footer, package name). ✅
- Verified: 100% backend + frontend (testing agent iteration_1).

## Backlog / Not Built (out of locked scope)
- Any auth, DB, persistence, extra routes/pages — intentionally excluded per scope lock.

## Notes
- `OPENAI_API_KEY` currently empty → demo runs on deterministic mocks. Add a real key to `/app/backend/.env` for live LLM output.
