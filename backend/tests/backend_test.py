"""Backend tests for ARCHAUDIT.

Covers:
  - /api/health
  - /api/audit (SSE) for gpt-4o-mini and gemini
  - /api/audit/stage for architect / chaos / hardened
  - unknown stage error handling
"""
import json
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://archaudit-dev.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
REQ = "Design a URL shortener that handles 50k redirects per second with analytics."


# --------- helpers ---------
def parse_sse(text):
    """Return list of (event_name, dict_data) parsed from an SSE payload."""
    events = []
    for block in text.split("\n\n"):
        event = None
        data = ""
        for line in block.split("\n"):
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data += line[5:].strip()
        if event and data:
            try:
                events.append((event, json.loads(data)))
            except json.JSONDecodeError:
                pass
    return events


# --------- health ---------
class TestHealth:
    def test_health_ok(self):
        r = requests.get(f"{API}/health", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "ok"
        assert d["llm_key_configured"] is True
        assert "gpt-4o-mini" in d["models"]
        assert "gemini" in d["models"]


# --------- audit SSE ---------
class TestAuditSSE:
    @pytest.mark.parametrize("model", ["gpt-4o-mini", "gemini"])
    def test_audit_streams_three_events_in_order(self, model):
        with requests.post(
            f"{API}/audit",
            json={"requirements": REQ, "model": model},
            stream=True,
            timeout=90,
        ) as r:
            assert r.status_code == 200
            body = r.text  # sync read (small)
        evts = parse_sse(body)
        names = [e for e, _ in evts]
        # Ordering check
        assert names.index("architect_done") < names.index("attack_done") < names.index("final_done"), names

        for name, data in evts:
            assert "fallback" in data, f"{name} missing fallback"
            assert "error_reason" in data, f"{name} missing error_reason"
            if data["fallback"] is False:
                assert data["error_reason"] is None

        final = dict(evts)["final_done"]
        assert "patched" in final and isinstance(final["patched"], list)
        assert "final_diagram" in final and final["final_diagram"]

    def test_audit_gpt_returns_real_results(self):
        with requests.post(
            f"{API}/audit",
            json={"requirements": REQ, "model": "gpt-4o-mini"},
            stream=True,
            timeout=90,
        ) as r:
            evts = parse_sse(r.text)
        d = dict(evts)
        # Real (non-fallback) results expected since key configured
        assert d["architect_done"]["fallback"] is False, d["architect_done"]
        assert d["attack_done"]["fallback"] is False, d["attack_done"]
        assert d["final_done"]["fallback"] is False, d["final_done"]


# --------- stage endpoint ---------
class TestAuditStage:
    def test_stage_architect(self):
        r = requests.post(f"{API}/audit/stage",
                          json={"requirements": REQ, "stage": "architect", "model": "gpt-4o-mini"},
                          timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert set(["diagram", "summary", "fallback", "error_reason", "elapsed_ms"]).issubset(d.keys())
        assert d["diagram"]
        assert isinstance(d["elapsed_ms"], int)

    def test_stage_chaos(self):
        r = requests.post(f"{API}/audit/stage",
                          json={"requirements": REQ, "stage": "chaos", "model": "gpt-4o-mini"},
                          timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["diagram"]
        assert "fallback" in d and "error_reason" in d

    def test_stage_hardened(self):
        # First get architect & chaos content
        arch = requests.post(f"{API}/audit/stage",
                             json={"requirements": REQ, "stage": "architect", "model": "gpt-4o-mini"},
                             timeout=60).json()
        chaos = requests.post(f"{API}/audit/stage",
                              json={"requirements": REQ, "stage": "chaos", "model": "gpt-4o-mini"},
                              timeout=60).json()
        r = requests.post(f"{API}/audit/stage", json={
            "requirements": REQ,
            "stage": "hardened",
            "model": "gpt-4o-mini",
            "architect_diagram": arch["diagram"],
            "architect_summary": arch["summary"],
            "attack_diagram": chaos["diagram"],
            "attack_summary": chaos["summary"],
        }, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["diagram"]
        assert isinstance(d["patched"], list) and len(d["patched"]) >= 1
        for p in d["patched"]:
            assert "weakness" in p and "fix" in p

    def test_stage_unknown_returns_json_error_not_500(self):
        r = requests.post(f"{API}/audit/stage",
                          json={"requirements": REQ, "stage": "bogus"},
                          timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "error" in d
        assert d.get("fallback") is True
