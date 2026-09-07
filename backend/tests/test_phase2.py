"""HotShot Ops Phase 2 backend tests: compliance, rate, securement, trips, active-rig."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://weigh-go-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "pin": "1910"}, timeout=30)
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="module")
def driver_token():
    r = requests.post(f"{API}/auth/login", json={"username": "driver", "pin": "1234"}, timeout=30)
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="module")
def big_blue(owner_token):
    r = requests.get(f"{API}/rigs", headers=h(owner_token), timeout=30)
    assert r.status_code == 200
    rigs = r.json()
    bb = next((x for x in rigs if x.get("name") == "Big Blue"), None)
    assert bb, "Sample rig 'Big Blue' not seeded"
    return bb


# ---------- Compliance ----------
class TestCompliance:
    def test_big_blue_12000_lb_class_a_rating_gotcha(self, owner_token, big_blue):
        r = requests.post(f"{API}/compliance",
                          json={"rig_id": big_blue["id"], "cargo_weight": 12000},
                          headers=h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["cdl_required"] is True
        assert d["cdl_class"] == "A"
        assert d["consortium_required"] is True
        assert d["rating_gotcha"] is True
        assert d["is_cmv"] is True
        # Requirements array shape
        keys = {req["key"] for req in d["requirements"]}
        assert {"usdot", "medical", "hos_eld", "cdl", "consortium"} <= keys

    def test_overweight_warning(self, owner_token, big_blue):
        r = requests.post(f"{API}/compliance",
                          json={"rig_id": big_blue["id"], "cargo_weight": 22000},
                          headers=h(owner_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        # trailer_capacity 21000 -> should warn
        assert any("trailer" in w.lower() or "capacity" in w.lower() for w in d["warnings"])

    def test_driver_can_run_compliance(self, driver_token, big_blue):
        r = requests.post(f"{API}/compliance",
                          json={"rig_id": big_blue["id"], "cargo_weight": 5000},
                          headers=h(driver_token), timeout=30)
        assert r.status_code == 200


# ---------- Rate ----------
class TestRate:
    def test_owner_rate_math(self, owner_token):
        r = requests.post(f"{API}/rate",
                          json={"distance_miles": 450, "fuel_price": 4.00, "mpg": 10,
                                "quoted_rate": 1350},
                          headers=h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert abs(d["total_cost"] - 265.73) < 1.0
        assert abs(d["cost_per_mile"] - 0.59) < 0.05
        assert abs(d["profit"] - 1084.0) < 2.0
        assert abs(d["margin_pct"] - 80.0) < 1.0

    def test_driver_rate_forbidden(self, driver_token):
        r = requests.post(f"{API}/rate",
                          json={"distance_miles": 100, "fuel_price": 4.00},
                          headers=h(driver_token), timeout=30)
        assert r.status_code == 403


# ---------- Securement ----------
class TestSecurement:
    def test_steel_chains_recommendation(self, driver_token):
        r = requests.post(f"{API}/securement",
                          json={"cargo_weight": 9000, "cargo_type": "Steel / Metal",
                                "length_ft": 20},
                          headers=h(driver_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "chain" in d["device"].lower()
        assert d["device_wll"] == 6600
        assert d["count"] == 3
        assert d["aggregate_wll"] == 19800
        assert isinstance(d["checklist"], list) and len(d["checklist"]) >= 6


# ---------- Trips ----------
class TestTrips:
    def test_full_trip_flow(self, driver_token):
        # Cleanup existing active trip if any
        act = requests.get(f"{API}/trips/active", headers=h(driver_token), timeout=30).json()
        if act and act.get("id"):
            requests.post(f"{API}/trips/{act['id']}/stop", json={"end_odometer": 0},
                          headers=h(driver_token), timeout=30)

        r = requests.post(f"{API}/trips/start",
                          json={"start_odometer": 100000, "origin": "TEST_Origin"},
                          headers=h(driver_token), timeout=30)
        assert r.status_code == 200, r.text
        trip = r.json()
        assert trip["status"] == "active"
        assert trip["rig_name"] == "Big Blue"  # auto-filled from assigned rig
        tid = trip["id"]

        # active
        a = requests.get(f"{API}/trips/active", headers=h(driver_token), timeout=30).json()
        assert a["id"] == tid

        # duty
        r2 = requests.post(f"{API}/trips/{tid}/duty", json={"duty_status": "on_duty"},
                           headers=h(driver_token), timeout=30)
        assert r2.status_code == 200
        assert r2.json()["duty_status"] == "on_duty"

        # state miles
        r3 = requests.post(f"{API}/trips/{tid}/state-miles", json={"state": "TX", "miles": 120},
                           headers=h(driver_token), timeout=30)
        assert r3.status_code == 200
        sm = r3.json()["state_miles"]
        assert any(e["state"] == "TX" and e["miles"] == 120 for e in sm)

        # stop
        r4 = requests.post(f"{API}/trips/{tid}/stop", json={"end_odometer": 100150},
                           headers=h(driver_token), timeout=30)
        assert r4.status_code == 200
        assert r4.json()["status"] == "completed"
        assert r4.json()["total_miles"] == 150

        # list contains this trip
        lst = requests.get(f"{API}/trips", headers=h(driver_token), timeout=30).json()
        assert any(t["id"] == tid for t in lst)


# ---------- Active rig picker ----------
class TestActiveRig:
    def test_owner_set_active_rig(self, owner_token, big_blue):
        r = requests.put(f"{API}/settings/active-rig", json={"rig_id": big_blue["id"]},
                         headers=h(owner_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["active_rig_id"] == big_blue["id"]

        # weigh station now shows Big Blue
        ws = requests.get(f"{API}/weigh-station", headers=h(owner_token), timeout=30).json()
        assert ws["rig"]["id"] == big_blue["id"]

    def test_driver_cannot_set_active_rig(self, driver_token, big_blue):
        r = requests.put(f"{API}/settings/active-rig", json={"rig_id": big_blue["id"]},
                         headers=h(driver_token), timeout=30)
        assert r.status_code == 403


# ---------- Sample data ----------
class TestSampleData:
    def test_sample_docs_present(self, owner_token):
        docs = requests.get(f"{API}/documents", headers=h(owner_token), timeout=30).json()
        cats = {d["category"] for d in docs}
        assert {"DOT", "MC", "Insurance", "IFTA", "Medical"} <= cats

    def test_driver_assigned_to_big_blue(self, driver_token, big_blue):
        rigs = requests.get(f"{API}/rigs", headers=h(driver_token), timeout=30).json()
        assert len(rigs) >= 1
        assert any(r["id"] == big_blue["id"] for r in rigs)
