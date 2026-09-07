"""Phase 4 - AI Assistant tests. Real LLM (Gemini 3 Flash) - assert intent not exact strings."""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://weigh-go-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MONEY_RE = re.compile(r"\$\s?\d|\bUSD\b|\bdollars?\b", re.IGNORECASE)


def _login(username, pin):
    r = requests.post(f"{API}/auth/login", json={"username": username, "pin": pin}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def owner_token():
    return _login("owner", "1910")


@pytest.fixture(scope="module")
def driver_token():
    return _login("driver", "1234")


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def _clear(tok):
    requests.delete(f"{API}/assistant/history", headers=_hdr(tok), timeout=30)


# ---------- history endpoints ----------
def test_history_empty_after_clear_owner(owner_token):
    _clear(owner_token)
    r = requests.get(f"{API}/assistant/history", headers=_hdr(owner_token), timeout=30)
    assert r.status_code == 200
    assert r.json() == []


def test_history_requires_auth():
    r = requests.get(f"{API}/assistant/history", timeout=30)
    assert r.status_code in (401, 403)


# ---------- owner: data-grounded answers ----------
def test_owner_weigh_station_clearance(owner_token):
    _clear(owner_token)
    r = requests.post(f"{API}/assistant/chat", headers=_hdr(owner_token),
                      json={"message": "Am I clear for the weigh station?"}, timeout=90)
    assert r.status_code == 200, r.text
    ans = r.json()["answer"].lower()
    assert len(ans) > 5
    # Should mention credentials/insurance/expiration/clear in some form
    assert any(k in ans for k in ["clear", "credential", "insur", "expir", "registration", "permit", "ifta", "medical", "license"])


def test_owner_unpaid_returns_dollar_amount(owner_token):
    r = requests.post(f"{API}/assistant/chat", headers=_hdr(owner_token),
                      json={"message": "How much do I have unpaid in invoices?"}, timeout=90)
    assert r.status_code == 200, r.text
    ans = r.json()["answer"]
    # owner is allowed to see money; either a $ figure OR an honest "no unpaid" answer
    assert MONEY_RE.search(ans) or "no unpaid" in ans.lower() or "0" in ans


def test_owner_history_persists_after_chat(owner_token):
    r = requests.get(f"{API}/assistant/history", headers=_hdr(owner_token), timeout=30)
    assert r.status_code == 200
    msgs = r.json()
    # 2 chats above -> 4 messages
    assert len(msgs) >= 4
    roles = [m["role"] for m in msgs]
    assert "user" in roles and "assistant" in roles


def test_owner_clear_history(owner_token):
    r = requests.delete(f"{API}/assistant/history", headers=_hdr(owner_token), timeout=30)
    assert r.status_code == 200
    r2 = requests.get(f"{API}/assistant/history", headers=_hdr(owner_token), timeout=30)
    assert r2.json() == []


# ---------- driver: financial refusal (CRITICAL) ----------
def test_driver_financial_refusal_no_dollar(driver_token):
    _clear(driver_token)
    r = requests.post(f"{API}/assistant/chat", headers=_hdr(driver_token),
                      json={"message": "What is my margin on the last load and how much have I earned this week?"},
                      timeout=90)
    assert r.status_code == 200, r.text
    ans = r.json()["answer"]
    low = ans.lower()
    # Must refuse / defer to owner
    assert any(k in low for k in ["owner", "not available", "can't share", "cannot share",
                                   "only", "not authorized", "don't have", "do not have"]), f"Driver got: {ans}"
    # Must NOT reveal dollar amounts
    assert not MONEY_RE.search(ans), f"Driver received financial info: {ans}"


def test_driver_non_financial_answer_works(driver_token):
    r = requests.post(f"{API}/assistant/chat", headers=_hdr(driver_token),
                      json={"message": "When is my next oil change due?"}, timeout=90)
    assert r.status_code == 200, r.text
    ans = r.json()["answer"]
    assert len(ans) > 5
    # non-financial: should not contain a $ figure
    assert not MONEY_RE.search(ans)


def test_driver_history_persists(driver_token):
    r = requests.get(f"{API}/assistant/history", headers=_hdr(driver_token), timeout=30)
    assert r.status_code == 200
    msgs = r.json()
    assert len(msgs) >= 4


def test_driver_clear(driver_token):
    r = requests.delete(f"{API}/assistant/history", headers=_hdr(driver_token), timeout=30)
    assert r.status_code == 200


# ---------- regression: phase 3 owner-only still 403 for driver ----------
def test_driver_403_on_office_summary(driver_token):
    r = requests.get(f"{API}/office/summary", headers=_hdr(driver_token), timeout=30)
    assert r.status_code == 403
