"""Tests for the new POST /api/validate-spec input-gate endpoint."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend/.env (test runner context)
    from pathlib import Path
    env = Path("/app/frontend/.env").read_text()
    for line in env.splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestValidateSpec:
    def test_empty_is_too_short(self, api):
        r = api.post(f"{BASE_URL}/api/validate-spec", json={"requirements": ""})
        assert r.status_code == 200
        d = r.json()
        assert d["valid"] is False
        assert d["reason"] == "too_short"

    def test_whitespace_is_too_short(self, api):
        r = api.post(f"{BASE_URL}/api/validate-spec", json={"requirements": "     "})
        assert r.status_code == 200
        d = r.json()
        assert d["valid"] is False
        assert d["reason"] == "too_short"

    def test_short_under_10_chars_is_too_short(self, api):
        r = api.post(f"{BASE_URL}/api/validate-spec", json={"requirements": "chat"})
        assert r.status_code == 200
        d = r.json()
        assert d["valid"] is False
        assert d["reason"] == "too_short"

    def test_valid_real_spec(self, api):
        r = api.post(f"{BASE_URL}/api/validate-spec", json={
            "requirements": "Design a URL shortener that handles 50k redirects/sec",
            "model": "gpt-4o-mini",
        })
        assert r.status_code == 200
        d = r.json()
        assert d["valid"] is True

    def test_short_but_valid_chat_app(self, api):
        r = api.post(f"{BASE_URL}/api/validate-spec", json={
            "requirements": "a chat app for teams",
            "model": "gpt-4o-mini",
        })
        assert r.status_code == 200
        d = r.json()
        assert d["valid"] is True

    def test_non_architecture_blocked(self, api):
        r = api.post(f"{BASE_URL}/api/validate-spec", json={
            "requirements": "what is the weather today",
            "model": "gpt-4o-mini",
        })
        assert r.status_code == 200
        d = r.json()
        assert d["valid"] is False
        assert d["reason"] == "classified_no"


class TestHealth:
    def test_health(self, api):
        r = api.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


class TestAuditRegression:
    def test_audit_streams_final(self, api):
        # Verify no regression: full pipeline completes with gpt-4o-mini
        r = api.post(f"{BASE_URL}/api/audit",
                     json={"requirements": "Design a URL shortener that handles 50k redirects/sec",
                           "model": "gpt-4o-mini"},
                     stream=True, timeout=60)
        assert r.status_code == 200
        events = []
        for line in r.iter_lines(decode_unicode=True):
            if line and line.startswith("event:"):
                events.append(line.split(":", 1)[1].strip())
            if "final_done" in events:
                break
        r.close()
        assert "architect_done" in events
        assert "attack_done" in events
        assert "final_done" in events
