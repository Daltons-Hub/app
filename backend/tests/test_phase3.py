"""HotShot Ops Phase 3 backend tests: deliveries/invoices, maintenance, expenses, IFTA, office summary, role enforcement."""
import os
import io
import uuid
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
    rigs = requests.get(f"{API}/rigs", headers=h(owner_token), timeout=30).json()
    bb = next((x for x in rigs if x.get("name") == "Big Blue"), None)
    assert bb, "'Big Blue' rig missing"
    return bb


TINY_PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?"
            b"\x00\x05\xfe\x02\xfeA\xba\x1a\x1a\x00\x00\x00\x00IEND\xaeB`\x82")


# ---------- Deliveries / Invoices ----------
class TestDeliveries:
    def test_create_delivery_creates_invoice_and_persists(self, owner_token, big_blue):
        # upload photo + signature
        files = {"file": ("pod.png", io.BytesIO(TINY_PNG), "image/png")}
        photo = requests.post(f"{API}/upload", files=files, headers=h(owner_token), timeout=60).json()
        files2 = {"file": ("sig.png", io.BytesIO(TINY_PNG), "image/png")}
        sig = requests.post(f"{API}/upload", files=files2, headers=h(owner_token), timeout=60).json()

        payload = {
            "customer_name": f"TEST_Acme_{uuid.uuid4().hex[:6]}",
            "rig_id": big_blue["id"], "destination": "Midland, TX",
            "load_description": "TEST_Drill pipe", "rate_amount": 1350,
            "weight": 12000, "photo_file_id": photo["file_id"],
            "signature_file_id": sig["file_id"],
        }
        r = requests.post(f"{API}/deliveries", json=payload, headers=h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["invoice_number"].startswith("INV-") and d["invoice_status"] == "unpaid"
        assert d["rate_amount"] == 1350
        assert d["rig_name"] == "Big Blue"
        assert d["photo_file_id"] == photo["file_id"]
        assert d["signature_file_id"] == sig["file_id"]
        did = d["id"]

        # GET verifies persistence
        lst = requests.get(f"{API}/deliveries", headers=h(owner_token), timeout=30).json()
        assert any(x["id"] == did for x in lst)

        # Toggle paid
        r2 = requests.put(f"{API}/deliveries/{did}/invoice",
                          json={"invoice_status": "paid"}, headers=h(owner_token), timeout=30)
        assert r2.status_code == 200 and r2.json()["invoice_status"] == "paid"

        # Toggle back unpaid
        r3 = requests.put(f"{API}/deliveries/{did}/invoice",
                          json={"invoice_status": "unpaid"}, headers=h(owner_token), timeout=30)
        assert r3.json()["invoice_status"] == "unpaid"

        # Delete
        r4 = requests.delete(f"{API}/deliveries/{did}", headers=h(owner_token), timeout=30)
        assert r4.status_code == 200
        assert not any(x["id"] == did for x in requests.get(f"{API}/deliveries", headers=h(owner_token), timeout=30).json())


# ---------- Maintenance ----------
class TestMaintenance:
    def test_odometer_and_status_flow(self, owner_token, big_blue):
        rig_id = big_blue["id"]

        # Set odometer to 100000
        r = requests.put(f"{API}/rigs/{rig_id}/odometer",
                         json={"current_odometer": 100000},
                         headers=h(owner_token), timeout=30)
        assert r.status_code == 200 and r.json()["current_odometer"] == 100000

        # Create overdue item: last_done_miles=90000, interval=5000, next_due=95000 < 100000
        r2 = requests.post(f"{API}/maintenance",
                           json={"rig_id": rig_id, "type": "Oil Change",
                                 "interval_miles": 5000, "last_done_miles": 90000},
                           headers=h(owner_token), timeout=30)
        assert r2.status_code == 200
        overdue_id = r2.json()["id"]

        # Create OK item: last_done=99000, interval=5000, next_due=104000 > 100000+500
        r3 = requests.post(f"{API}/maintenance",
                           json={"rig_id": rig_id, "type": "Tires",
                                 "interval_miles": 5000, "last_done_miles": 99000},
                           headers=h(owner_token), timeout=30)
        ok_id = r3.json()["id"]

        # List — compute_maint runs on GET
        items = requests.get(f"{API}/maintenance", headers=h(owner_token), timeout=30).json()
        by_id = {i["id"]: i for i in items}
        assert by_id[overdue_id]["status"] == "overdue"
        assert by_id[ok_id]["status"] == "ok"
        assert by_id[overdue_id]["current_odometer"] == 100000

        # Mark serviced — resets to current odometer + today
        rs = requests.put(f"{API}/maintenance/{overdue_id}/service",
                          headers=h(owner_token), timeout=30)
        assert rs.status_code == 200
        assert rs.json()["last_done_miles"] == 100000

        # Now that item should be OK
        items2 = requests.get(f"{API}/maintenance", headers=h(owner_token), timeout=30).json()
        assert next(i for i in items2 if i["id"] == overdue_id)["status"] == "ok"

        # Cleanup
        requests.delete(f"{API}/maintenance/{overdue_id}", headers=h(owner_token), timeout=30)
        requests.delete(f"{API}/maintenance/{ok_id}", headers=h(owner_token), timeout=30)

    def test_trip_stop_bumps_rig_odometer(self, owner_token, driver_token, big_blue):
        rig_id = big_blue["id"]
        # Set baseline
        requests.put(f"{API}/rigs/{rig_id}/odometer",
                     json={"current_odometer": 100000},
                     headers=h(owner_token), timeout=30)

        # Stop any active trip
        act = requests.get(f"{API}/trips/active", headers=h(driver_token), timeout=30).json()
        if act and act.get("id"):
            requests.post(f"{API}/trips/{act['id']}/stop",
                          json={"end_odometer": 100000}, headers=h(driver_token), timeout=30)

        # Start & stop with end_odometer=100500
        r = requests.post(f"{API}/trips/start",
                          json={"start_odometer": 100000, "origin": "TEST"},
                          headers=h(driver_token), timeout=30)
        tid = r.json()["id"]
        rs = requests.post(f"{API}/trips/{tid}/stop",
                           json={"end_odometer": 100500},
                           headers=h(driver_token), timeout=30)
        assert rs.status_code == 200

        # rig current_odometer should now be >=100500
        rigs = requests.get(f"{API}/rigs", headers=h(owner_token), timeout=30).json()
        bb = next(x for x in rigs if x["id"] == rig_id)
        assert (bb.get("current_odometer") or 0) >= 100500


# ---------- Expenses & IFTA ----------
class TestExpenses:
    def test_fuel_and_toll_and_ifta_aggregation(self, owner_token):
        # Add fuel TX
        r1 = requests.post(f"{API}/expenses",
                           json={"category": "Fuel", "amount": 250.00,
                                 "gallons": 62, "state": "TX",
                                 "vendor": "TEST_Loves"},
                           headers=h(owner_token), timeout=30)
        assert r1.status_code == 200
        fid = r1.json()["id"]
        assert r1.json()["gallons"] == 62 and r1.json()["state"] == "TX"

        # Add toll
        r2 = requests.post(f"{API}/expenses",
                           json={"category": "Toll", "amount": 12.50,
                                 "vendor": "TEST_TXTag"},
                           headers=h(owner_token), timeout=30)
        tid = r2.json()["id"]

        # List
        lst = requests.get(f"{API}/expenses", headers=h(owner_token), timeout=30).json()
        assert any(x["id"] == fid for x in lst)
        assert any(x["id"] == tid for x in lst)

        # IFTA — TX row should reflect our gallons
        ifta = requests.get(f"{API}/ifta-report", headers=h(owner_token), timeout=30).json()
        tx = next((r for r in ifta["rows"] if r["state"] == "TX"), None)
        assert tx is not None
        assert tx["gallons"] >= 62
        assert ifta["total_gallons"] >= 62

        # Delete
        requests.delete(f"{API}/expenses/{fid}", headers=h(owner_token), timeout=30)
        requests.delete(f"{API}/expenses/{tid}", headers=h(owner_token), timeout=30)
        lst2 = requests.get(f"{API}/expenses", headers=h(owner_token), timeout=30).json()
        assert not any(x["id"] == fid for x in lst2)


# ---------- Office summary ----------
class TestOfficeSummary:
    def test_office_summary_shape(self, owner_token):
        r = requests.get(f"{API}/office/summary", headers=h(owner_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ["deliveries_count", "unpaid_count", "unpaid_total", "maintenance_due", "expense_total"]:
            assert k in d


# ---------- Driver 403 role enforcement ----------
class TestDriverForbidden:
    @pytest.mark.parametrize("method,path,body", [
        ("GET", "/deliveries", None),
        ("POST", "/deliveries", {"customer_name": "x"}),
        ("GET", "/maintenance", None),
        ("POST", "/maintenance", {"rig_id": "x", "type": "Oil Change"}),
        ("GET", "/expenses", None),
        ("POST", "/expenses", {"category": "Fuel", "amount": 1}),
        ("GET", "/ifta-report", None),
        ("GET", "/office/summary", None),
    ])
    def test_driver_403(self, driver_token, method, path, body):
        fn = requests.get if method == "GET" else requests.post
        kwargs = {"headers": h(driver_token), "timeout": 30}
        if body is not None:
            kwargs["json"] = body
        r = fn(f"{API}{path}", **kwargs)
        assert r.status_code == 403, f"{method} {path} -> {r.status_code} {r.text[:120]}"
