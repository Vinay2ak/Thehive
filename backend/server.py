import os
import json
import time
import uuid
import asyncio
import logging
from pathlib import Path
from datetime import datetime, timezone

from fastapi import FastAPI, APIRouter
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from openai import AsyncOpenAI

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("archaudit")

app = FastAPI()
api_router = APIRouter(prefix="/api")

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
MODEL = "google/gemma-4-31b-it"
TIMEOUT_SECONDS = 1.5
HEARTBEAT_SECONDS = 8
DELIM = "===SUMMARY==="
PATCHED_DELIM = "===PATCHED==="
BOX_CHARS = "┌─┐│└┘├┤┬┴┼"


class AuditRequest(BaseModel):
    requirements: str


# ---------------------------------------------------------------------------
# System prompts — short, explicit, fixed easy-to-parse structure.
# ---------------------------------------------------------------------------
ARCHITECT_SYS = (
    "You are a Solution Architect. Given system requirements, design a system "
    "architecture.\n"
    "Output EXACTLY in this structure and nothing else:\n"
    "1) A monospace ASCII box-diagram using ONLY these characters: "
    "\u250c \u2500 \u2510 \u2502 \u2514 \u2518 \u251c \u2524 \u252c \u2534 \u253c "
    "and arrows ->. Keep every line under 54 characters. Max 16 lines.\n"
    f"2) Then a line containing exactly: {DELIM}\n"
    "3) Then a 2-3 sentence plain-English summary of the architecture.\n"
    "No markdown, no code fences, no headers, no extra commentary."
)

CHAOS_SYS = (
    "You are a Chaos Engineer. Given the SAME system requirements, independently "
    "predict the most likely failure points: bottlenecks, single points of "
    "failure, and where the system collapses under load.\n"
    "Output EXACTLY in this structure and nothing else:\n"
    "1) A monospace ASCII box-diagram (a FAILURE MAP) using ONLY these characters: "
    "\u250c \u2500 \u2510 \u2502 \u2514 \u2518 \u251c \u2524 \u252c \u2534 \u253c "
    "and arrows ->. Mark the weak points. Keep every line under 54 characters. "
    "Max 16 lines.\n"
    f"2) Then a line containing exactly: {DELIM}\n"
    "3) Then a 2-3 sentence summary framed as a failure analysis.\n"
    "No markdown, no code fences, no headers, no extra commentary."
)

ARBITER_SYS = (
    "You are the Arbiter. You are given a proposed ARCHITECTURE and a FAILURE MAP "
    "of its weaknesses. Produce a hardened v2.0 design that keeps the good parts "
    "of the architecture while patching every identified vulnerability (add "
    "redundancy, caching, queues, replicas, failover as needed).\n"
    "Output EXACTLY in this structure and nothing else:\n"
    "1) A monospace ASCII box-diagram of the hardened design using ONLY these "
    "characters: \u250c \u2500 \u2510 \u2502 \u2514 \u2518 \u251c \u2524 \u252c "
    "\u2534 \u253c and arrows ->. Keep every line under 54 characters. Max 18 lines.\n"
    f"2) Then a line containing exactly: {DELIM}\n"
    "3) Then a 2-3 sentence summary of what was hardened and why.\n"
    f"4) Then a line containing exactly: {PATCHED_DELIM}\n"
    "5) Then 3 to 6 lines, ONE per vulnerability from the FAILURE MAP that the "
    "v2.0 design fixes. Each line MUST use exactly this format:\n"
    "<weakness from the failure map> :: <how the hardened design patches it>\n"
    "Use ' :: ' (space colon colon space) as the separator. No bullets, no "
    "numbering, no markdown, no code fences, no extra commentary."
)

# ---------------------------------------------------------------------------
# Deterministic mock fallbacks (per stage) — used when key missing / call fails.
# ---------------------------------------------------------------------------
MOCK_ARCHITECT_DIAGRAM = """\
┌─────────────┐      ┌──────────────┐
│   Clients   │ ───> │ Load Balancer│
└─────────────┘      └──────┬───────┘
                            │
                     ┌──────┴───────┐
                     │  API Server  │
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              │                           │
      ┌───────┴──────┐            ┌────────┴──────┐
      │  Primary DB  │            │  Object Store │
      └──────────────┘            └───────────────┘"""
MOCK_ARCHITECT_SUMMARY = (
    "A straightforward request path: clients hit a load balancer that fans out to "
    "a stateless API server, which persists to a primary database and an object "
    "store. It is simple to reason about and quick to ship."
)

MOCK_ATTACK_DIAGRAM = """\
┌─────────────┐
│  Load Spike │
└──────┬──────┘
       │  (all traffic)
       v
┌──────────────┐   X SINGLE POINT
│  API Server  │─────> OF FAILURE
└──────┬───────┘
       │  (every write)
       v
┌──────────────┐   X BOTTLENECK
│  Primary DB  │─────> NO REPLICA
└──────────────┘"""
MOCK_ATTACK_SUMMARY = (
    "The single API server and un-replicated primary database are both single "
    "points of failure. Under load the database write path becomes the bottleneck "
    "and there is no failover, so one instance dying takes the whole system down."
)

MOCK_FINAL_DIAGRAM = """\
┌─────────────┐      ┌──────────────┐
│   Clients   │ ───> │ Load Balancer│
└─────────────┘      └──────┬───────┘
                     ┌──────┴───────┐
                     │  API x N     │  (auto-scaled)
                     └──────┬───────┘
              ┌────────────┼────────────┐
              v            v            v
       ┌──────────┐  ┌──────────┐ ┌──────────┐
       │  Cache   │  │  Queue   │ │Obj Store │
       └──────────┘  └────┬─────┘ └──────────┘
                          v
              ┌──────────────────────┐
              │ DB Primary + Replica │
              └──────────────────────┘"""
MOCK_FINAL_SUMMARY = (
    "The hardened design keeps the load-balanced API tier but auto-scales it to "
    "remove the single point of failure, adds a cache and an async queue to absorb "
    "spikes, and replicates the database with failover. It preserves the original "
    "simplicity while eliminating the identified bottlenecks."
)
MOCK_FINAL_PATCHED = [
    {"weakness": "Single API server (SPOF)",
     "fix": "Auto-scaled API tier behind the LB with N replicas"},
    {"weakness": "Un-replicated primary database",
     "fix": "Primary + read replica with automatic failover"},
    {"weakness": "DB write path bottleneck under load",
     "fix": "Async queue absorbs and levels write spikes"},
    {"weakness": "No caching for hot reads",
     "fix": "Cache tier added in front of the database"},
]


def _extract_diagram(block: str) -> str:
    """Return the longest run of consecutive lines containing box-drawing chars.

    Reasoning-style models may prepend prose that mentions the box characters
    inline; the real diagram is always the longest contiguous block of such
    lines, so we isolate that and drop any surrounding commentary.
    """
    runs = []
    cur = []
    for line in block.splitlines():
        if any(c in line for c in BOX_CHARS):
            cur.append(line)
        else:
            if cur:
                runs.append(cur)
                cur = []
    if cur:
        runs.append(cur)
    if not runs:
        return ""
    best = max(runs, key=len)
    return "\n".join(best).strip("\n")


def _parse_patched(patched_part: str):
    patched = []
    for line in patched_part.strip().splitlines():
        line = line.strip().lstrip("-*\u2022").strip()
        if not line:
            continue
        if "::" in line:
            weakness, fix = line.split("::", 1)
            patched.append({"weakness": weakness.strip(), "fix": fix.strip()})
        else:
            patched.append({"weakness": line, "fix": ""})
    return patched


def split_response(text: str):
    """Split raw LLM text into (diagram, summary). Returns None if unusable."""
    if not text or not text.strip():
        return None
    idx = text.rfind(DELIM)  # last occurrence = the real answer's delimiter
    if idx < 0:
        diagram = _extract_diagram(text)
        return (diagram, "") if diagram else None
    diagram = _extract_diagram(text[:idx])
    summary = text[idx + len(DELIM):].strip()
    if not diagram:
        return None
    return diagram, summary


def split_arbiter(text: str):
    """Split Arbiter output into (diagram, summary, patched_list) or None."""
    if not text or not text.strip():
        return None
    p_idx = text.rfind(PATCHED_DELIM)
    if p_idx >= 0:
        head = text[:p_idx]
        patched_part = text[p_idx + len(PATCHED_DELIM):]
    else:
        head = text
        patched_part = ""
    s_idx = head.rfind(DELIM)
    if s_idx < 0:
        diagram = _extract_diagram(head)
        summary = ""
    else:
        diagram = _extract_diagram(head[:s_idx])
        summary = head[s_idx + len(DELIM):].strip()
    if not diagram:
        return None
    return diagram, summary, _parse_patched(patched_part)


async def call_agent(system_message: str, user_text: str, stage: str):
    """Call NVIDIA NIM (OpenAI-compatible). Returns raw text or None on failure."""
    api_key = os.environ.get("NVIDIA_API_KEY")
    if not api_key:
        logger.warning("[%s] NVIDIA_API_KEY missing — using deterministic mock.", stage)
        return None
    try:
        client = AsyncOpenAI(base_url=NVIDIA_BASE_URL, api_key=api_key)
        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": system_message},
                    {"role": "user", "content": user_text},
                ],
                temperature=0.4,
                max_tokens=1200,
            ),
            timeout=TIMEOUT_SECONDS,
        )
        return resp.choices[0].message.content
    except asyncio.TimeoutError:
        logger.error("[%s] LLM call timed out after %ss — using mock.", stage, TIMEOUT_SECONDS)
        return None
    except Exception as e:  # noqa: BLE001 - keep demo alive, never surface to UI
        logger.error("[%s] LLM call failed: %s — using mock.", stage, e)
        return None


async def resolve_stage(system_message, user_text, stage, mock_diagram, mock_summary):
    """Run an agent and fall back to mock. Returns (diagram, summary, used_fallback)."""
    text = await call_agent(system_message, user_text, stage)
    parsed = split_response(text)
    if parsed is None:
        return mock_diagram, mock_summary, True
    diagram, summary = parsed
    if not summary:
        summary = mock_summary if diagram == mock_diagram else summary
    return diagram, summary, False


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def audit_event_stream(requirements: str):
    queue: asyncio.Queue = asyncio.Queue()
    store: dict = {}

    async def run_architect():
        t0 = time.monotonic()
        diagram, summary, fallback = await resolve_stage(
            ARCHITECT_SYS, requirements, "architect",
            MOCK_ARCHITECT_DIAGRAM, MOCK_ARCHITECT_SUMMARY,
        )
        store["architect"] = (diagram, summary)
        await queue.put(("architect_done", {
            "architect_diagram": diagram,
            "architect_summary": summary,
            "fallback": fallback,
            "elapsed_ms": int((time.monotonic() - t0) * 1000),
        }))

    async def run_attack():
        t0 = time.monotonic()
        diagram, summary, fallback = await resolve_stage(
            CHAOS_SYS, requirements, "attack",
            MOCK_ATTACK_DIAGRAM, MOCK_ATTACK_SUMMARY,
        )
        store["attack"] = (diagram, summary)
        await queue.put(("attack_done", {
            "attack_diagram": diagram,
            "attack_summary": summary,
            "fallback": fallback,
            "elapsed_ms": int((time.monotonic() - t0) * 1000),
        }))

    async def orchestrate():
        try:
            # 1 + 2: two independent calls, truly concurrent, pushed as each finishes.
            await asyncio.gather(run_architect(), run_attack())

            # 3: Arbiter takes BOTH prior outputs.
            arch_diagram, arch_summary = store["architect"]
            att_diagram, att_summary = store["attack"]
            arbiter_input = (
                f"REQUIREMENTS:\n{requirements}\n\n"
                f"PROPOSED ARCHITECTURE:\n{arch_diagram}\n{arch_summary}\n\n"
                f"FAILURE MAP:\n{att_diagram}\n{att_summary}"
            )
            t0 = time.monotonic()
            arbiter_text = await call_agent(ARBITER_SYS, arbiter_input, "final")
            parsed = split_arbiter(arbiter_text)
            if parsed is None:
                final_diagram = MOCK_FINAL_DIAGRAM
                final_summary = MOCK_FINAL_SUMMARY
                patched = MOCK_FINAL_PATCHED
                fallback = True
            else:
                final_diagram, final_summary, patched = parsed
                fallback = False
                if not patched:
                    patched = MOCK_FINAL_PATCHED
            final_elapsed_ms = int((time.monotonic() - t0) * 1000)
            response = {
                "id": str(uuid.uuid4()),
                "architect_diagram": arch_diagram,
                "attack_diagram": att_diagram,
                "final_diagram": final_diagram,
                "architect_summary": arch_summary,
                "attack_summary": att_summary,
                "final_summary": final_summary,
                "patched": patched,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            await queue.put(("final_done", {
                **response,
                "fallback": fallback,
                "elapsed_ms": final_elapsed_ms,
            }))
        except Exception as e:  # noqa: BLE001
            logger.error("Orchestration error: %s", e)
        finally:
            await queue.put(("__end__", {}))

    task = asyncio.create_task(orchestrate())
    try:
        # Emit a heartbeat comment if no event arrives within HEARTBEAT_SECONDS
        # so intermediary proxies never treat the SSE stream as idle.
        yield ": open\n\n"
        while True:
            try:
                event, data = await asyncio.wait_for(
                    queue.get(), timeout=HEARTBEAT_SECONDS
                )
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if event == "__end__":
                break
            yield sse(event, data)
    finally:
        if not task.done():
            task.cancel()


@api_router.get("/")
async def root():
    return {"service": "ARCHAUDIT", "status": "ok"}


@api_router.post("/audit")
async def audit(req: AuditRequest):
    return StreamingResponse(
        audit_event_stream(req.requirements or ""),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
