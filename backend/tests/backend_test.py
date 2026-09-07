"""HotShot Ops backend API tests"""
import os
import io
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://weigh-go-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "pin": "1910"}, timeout=30)
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def driver_token():
    r = requests.post(f"{API}/auth/login", json={"username": "driver", "pin": "1234"}, timeout=30)
    assert r.status_code == 200, f"driver login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Auth ----------
class TestAuth:
    def test_owner_login(self):
        r = requests.post(f"{API}/auth/login", json={"username": "owner", "pin": "1910"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and data["user"]["role"] == "owner"

    def test_driver_login(self):
        r = requests.post(f"{API}/auth/login", json={"username": "driver", "pin": "1234"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "driver"

    def test_wrong_pin(self):
        r = requests.post(f"{API}/auth/login", json={"username": "owner", "pin": "0000"}, timeout=30)
        assert r.status_code == 401

    def test_me_requires_auth(self):
        r = requests.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 401


# ---------- Rigs ----------
class TestRigs:
    def test_owner_rig_crud(self, owner_token):
        payload = {"name": f"TEST_Rig_{uuid.uuid4().hex[:6]}",
                   "truck_make_model": "Ford F-550", "engine": "6.7L",
                   "empty_weight": 12000, "gvwr": 19500, "gcwr": 37500,
                   "trailer_type": "gooseneck", "trailer_length": 40}
        r = requests.post(f"{API}/rigs", json=payload, headers=h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        rig = r.json()
        assert rig["name"] == payload["name"]
        assert "id" in rig
        rig_id = rig["id"]

        # List
        r2 = requests.get(f"{API}/rigs", headers=h(owner_token), timeout=30)
        assert r2.status_code == 200
        assert any(x["id"] == rig_id for x in r2.json())

        # Update
        payload["engine"] = "6.7L PowerStroke"
        r3 = requests.put(f"{API}/rigs/{rig_id}", json=payload, headers=h(owner_token), timeout=30)
        assert r3.status_code == 200
        assert r3.json()["engine"] == "6.7L PowerStroke"

        # Delete
        r4 = requests.delete(f"{API}/rigs/{rig_id}", headers=h(owner_token), timeout=30)
        assert r4.status_code == 200

        # Verify gone
        r5 = requests.get(f"{API}/rigs", headers=h(owner_token), timeout=30)
        assert not any(x["id"] == rig_id for x in r5.json())

    def test_driver_cannot_create_rig(self, driver_token):
        r = requests.post(f"{API}/rigs",
                          json={"name": "X", "truck_make_model": "Y", "engine": "Z"},
                          headers=h(driver_token), timeout=30)
        assert r.status_code == 403


# ---------- Documents ----------
class TestDocuments:
    def test_document_status_badges(self, owner_token):
        far_future = (date.today() + timedelta(days=365)).isoformat()
        soon = (date.today() + timedelta(days=10)).isoformat()
        past = (date.today() - timedelta(days=5)).isoformat()

        created_ids = []
        for label, exp, expected in [("TEST_Active", far_future, "active"),
                                     ("TEST_Expiring", soon, "expiring"),
                                     ("TEST_Expired", past, "expired")]:
            r = requests.post(f"{API}/documents",
                              json={"category": "DOT", "label": label,
                                    "number": "1234567", "expiration_date": exp},
                              headers=h(owner_token), timeout=30)
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["status"] == expected, f"{label}: got {d['status']}"
            created_ids.append(d["id"])

        # cleanup
        for did in created_ids:
            requests.delete(f"{API}/documents/{did}", headers=h(owner_token), timeout=30)

    def test_driver_cannot_create_document(self, driver_token):
        r = requests.post(f"{API}/documents",
                          json={"category": "DOT", "label": "X"},
                          headers=h(driver_token), timeout=30)
        assert r.status_code == 403


# ---------- Upload / Download ----------
class TestFiles:
    def test_upload_and_download(self, owner_token):
        # Tiny PNG bytes
        png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
               b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?"
               b"\x00\x05\xfe\x02\xfeA\xba\x1a\x1a\x00\x00\x00\x00IEND\xaeB`\x82")
        files = {"file": ("test.png", io.BytesIO(png), "image/png")}
        r = requests.post(f"{API}/upload", files=files, headers=h(owner_token), timeout=60)
        assert r.status_code == 200, r.text
        fid = r.json()["file_id"]

        r2 = requests.get(f"{API}/files/{fid}", headers=h(owner_token), timeout=60)
        assert r2.status_code == 200
        assert r2.headers.get("content-type", "").startswith("image/")

    def test_files_require_auth(self):
        r = requests.get(f"{API}/files/nonexistent", timeout=30)
        assert r.status_code == 401


# ---------- Weigh Station ----------
class TestWeighStation:
    def test_weigh_station_shape(self, owner_token):
        r = requests.get(f"{API}/weigh-station", headers=h(owner_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        for k in ["dot", "mc", "insurance", "ifta", "medical"]:
            assert k in data
            assert "status" in data[k]


# ---------- Drivers ----------
class TestDrivers:
    def test_driver_forbidden_from_drivers_list(self, driver_token):
        r = requests.get(f"{API}/drivers", headers=h(driver_token), timeout=30)
        assert r.status_code == 403

    def test_owner_creates_and_assigns_driver(self, owner_token):
        # create a rig first
        rig_r = requests.post(f"{API}/rigs",
                              json={"name": f"TEST_AssignRig_{uuid.uuid4().hex[:6]}",
                                    "truck_make_model": "T", "engine": "E"},
                              headers=h(owner_token), timeout=30)
        assert rig_r.status_code == 200
        rig_id = rig_r.json()["id"]

        uname = f"test_drv_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/drivers",
                          json={"name": "TEST Driver", "username": uname, "pin": "4321"},
                          headers=h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        drv = r.json()
        assert drv["role"] == "driver" and drv["username"] == uname
        did = drv["id"]

        # assign rig
        r2 = requests.put(f"{API}/drivers/{did}/assign",
                          json={"assigned_rig_id": rig_id},
                          headers=h(owner_token), timeout=30)
        assert r2.status_code == 200
        assert r2.json()["assigned_rig_id"] == rig_id

        # driver login sees only their rig
        login = requests.post(f"{API}/auth/login", json={"username": uname, "pin": "4321"}, timeout=30)
        assert login.status_code == 200
        new_drv_token = login.json()["token"]
        rr = requests.get(f"{API}/rigs", headers=h(new_drv_token), timeout=30)
        assert rr.status_code == 200
        rigs = rr.json()
        assert len(rigs) == 1 and rigs[0]["id"] == rig_id

        # cleanup
        requests.delete(f"{API}/drivers/{did}", headers=h(owner_token), timeout=30)
        requests.delete(f"{API}/rigs/{rig_id}", headers=h(owner_token), timeout=30)


# ---------- Dashboard ----------
class TestDashboard:
    def test_dashboard_returns_next_step(self, owner_token):
        r = requests.get(f"{API}/dashboard", headers=h(owner_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "next_step" in data
        assert "title" in data["next_step"] and "action" in data["next_step"]

    def test_driver_dashboard(self, driver_token):
        r = requests.get(f"{API}/dashboard", headers=h(driver_token), timeout=30)
        assert r.status_code == 200
        assert "next_step" in r.json()


# ---------- Role enforcement (critical) ----------
class TestRoleEnforcement:
    def test_driver_rigs_scope(self, driver_token):
        # driver with no assigned rig gets []; if assigned, only their rig
        r = requests.get(f"{API}/rigs", headers=h(driver_token), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
