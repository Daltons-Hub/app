"""Cookie-based auth + undefined-variable fix regression tests."""
import os
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://weigh-go-1.preview.emergentagent.com").rstrip("/") + "/api"


def _login(session, username, pin):
    r = session.post(f"{BASE}/auth/login", json={"username": username, "pin": pin})
    assert r.status_code == 200, r.text
    return r


# ---------- SECURITY: httpOnly cookie login ----------
class TestCookieAuth:
    def test_login_sets_httponly_cookie(self):
        s = requests.Session()
        r = _login(s, "owner", "1910")
        # cookie present in session jar
        assert "access_token" in s.cookies, f"cookies={s.cookies.get_dict()}"
        # inspect Set-Cookie header for httpOnly + Secure + SameSite=None
        raw = r.headers.get("set-cookie", "").lower()
        assert "httponly" in raw
        assert "secure" in raw
        assert "samesite=none" in raw
        # token also in body (for legacy Bearer support)
        assert "token" in r.json() and "user" in r.json()

    def test_me_via_cookie_only(self):
        s = requests.Session()
        _login(s, "owner", "1910")
        r = s.get(f"{BASE}/auth/me")  # no Authorization header
        assert r.status_code == 200
        assert r.json()["username"] == "owner"

    def test_me_no_auth_401(self):
        r = requests.get(f"{BASE}/auth/me")
        assert r.status_code == 401

    def test_me_bearer_fallback_still_works(self):
        # Fresh session — no cookies, only Bearer header
        r = requests.post(f"{BASE}/auth/login", json={"username": "owner", "pin": "1910"})
        tok = r.json()["token"]
        r2 = requests.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r2.status_code == 200

    def test_logout_clears_cookie(self):
        s = requests.Session()
        _login(s, "owner", "1910")
        r = s.post(f"{BASE}/auth/logout")
        assert r.status_code == 200
        # Session cookie should be cleared / expired
        # /auth/me should now be 401
        r2 = s.get(f"{BASE}/auth/me")
        assert r2.status_code == 401

    def test_file_download_auth_via_cookie(self):
        s = requests.Session()
        _login(s, "owner", "1910")
        # try to fetch a file id - use an upload flow
        files = {"file": ("t.txt", b"hello", "text/plain")}
        up = s.post(f"{BASE}/upload", files=files)
        assert up.status_code == 200, up.text
        fid = up.json()["file_id"]
        # download via cookie only (no ?auth=, no header)
        dl = requests.get(f"{BASE}/files/{fid}", cookies=s.cookies)
        assert dl.status_code == 200
        assert dl.content == b"hello"
        # download with no auth should 401
        dl2 = requests.get(f"{BASE}/files/{fid}")
        assert dl2.status_code == 401


# ---------- Undefined-variable fixes ----------
class TestNoUndefinedVars:
    @pytest.fixture(scope="class")
    def sess(self):
        s = requests.Session()
        _login(s, "owner", "1910")
        return s

    def test_dashboard_always_has_next_step(self, sess):
        r = sess.get(f"{BASE}/dashboard")
        assert r.status_code == 200
        body = r.json()
        assert "next_step" in body
        assert isinstance(body["next_step"], dict)

    @pytest.mark.parametrize("cargo", [5000, 12000, 25000])
    def test_compliance_returns_tier_and_summary(self, sess, cargo):
        # Need a rig; grab first one
        rigs = sess.get(f"{BASE}/rigs").json()
        assert rigs, "No rigs available for compliance test"
        rig_id = rigs[0]["id"]
        payload = {"rig_id": rig_id, "cargo_weight": cargo}
        r = sess.post(f"{BASE}/compliance", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "tier" in body and isinstance(body["tier"], str)
        assert "summary" in body and isinstance(body["summary"], str)

    def test_assistant_chat_returns_answer(self, sess):
        r = sess.post(f"{BASE}/assistant/chat", json={"message": "hi"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "answer" in body and isinstance(body["answer"], str)


# ---------- Role gating regression ----------
class TestRoleGate:
    def test_driver_403_office(self):
        s = requests.Session()
        _login(s, "driver", "1234")
        r = s.get(f"{BASE}/office/summary")
        assert r.status_code == 403
