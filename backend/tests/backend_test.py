"""Backend tests for ARCHAUDIT SSE audit endpoint."""
import json
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://archaudit-dev.preview.emergentagent.com").rstrip("/")
AUDIT_URL = f"{BASE_URL}/api/audit"

BOX_CHARS = set("┌─┐│└┘├┤┬┴┼")


def parse_sse_stream(text: str):
    """Return list of (event, data_dict) from an SSE payload."""
    events = []
    for chunk in text.split("\n\n"):
        chunk = chunk.strip("\n")
        if not chunk:
            continue
        event = None
        data_parts = []
        for line in chunk.split("\n"):
            if line.startswith("event:"):
                event = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data_parts.append(line[len("data:"):].strip())
        if event and data_parts:
            try:
                events.append((event, json.loads("".join(data_parts))))
            except json.JSONDecodeError:
                events.append((event, {"_raw": "".join(data_parts)}))
    return events


@pytest.fixture(scope="module")
def audit_response():
    r = requests.post(
        AUDIT_URL,
        json={"requirements": "Design a chat app"},
        stream=True,
        timeout=60,
    )
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    body = r.text
    return r, body, parse_sse_stream(body)


def test_health_root():
    r = requests.get(f"{BASE_URL}/api/", timeout=10)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_content_type_sse(audit_response):
    r, _, _ = audit_response
    ct = r.headers.get("content-type", "")
    assert "text/event-stream" in ct, f"got: {ct}"


def test_three_events_in_order(audit_response):
    _, _, events = audit_response
    names = [e[0] for e in events]
    assert names == ["architect_done", "attack_done", "final_done"], names


def test_architect_done_payload(audit_response):
    _, _, events = audit_response
    payload = dict(events)["architect_done"]
    assert "architect_diagram" in payload and payload["architect_diagram"].strip()
    assert "architect_summary" in payload and payload["architect_summary"].strip()
    assert payload.get("fallback") is True  # OPENAI_API_KEY is empty


def test_attack_done_payload(audit_response):
    _, _, events = audit_response
    payload = dict(events)["attack_done"]
    assert "attack_diagram" in payload and payload["attack_diagram"].strip()
    assert "attack_summary" in payload and payload["attack_summary"].strip()
    assert payload.get("fallback") is True


def test_final_done_full_shape(audit_response):
    _, _, events = audit_response
    payload = dict(events)["final_done"]
    for k in [
        "id", "architect_diagram", "attack_diagram", "final_diagram",
        "architect_summary", "attack_summary", "final_summary", "timestamp",
    ]:
        assert k in payload, f"missing {k}"
    assert payload.get("fallback") is True


def test_ascii_box_chars(audit_response):
    _, _, events = audit_response
    payload = dict(events)["final_done"]
    for key in ("architect_diagram", "attack_diagram", "final_diagram"):
        diag = payload[key]
        assert "\n" in diag, f"{key} not multiline"
        assert any(c in BOX_CHARS for c in diag), f"{key} lacks box-drawing chars"


def test_stream_never_errors_with_empty_key(audit_response):
    r, body, events = audit_response
    assert r.status_code == 200
    assert len(events) == 3
    # No error event surfaced
    assert not any(e[0].lower().startswith("error") for e in events)
