"""Tests for dispatcher CRUD and rate calc with dispatcher fee."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://weigh-go-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(username, pin):
    r = requests.post(f"{API}/auth/login", json={"username": username, "pin": pin}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def owner_token():
    return _login("owner", "1910")


@pytest.fixture(scope="module")
def driver_token():
    return _login("driver", "1234")


@pytest.fixture(scope="module")
def owner_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


@pytest.fixture(scope="module")
def driver_headers(driver_token):
    return {"Authorization": f"Bearer {driver_token}"}


def test_driver_forbidden_list(driver_headers):
    r = requests.get(f"{API}/dispatchers", headers=driver_headers, timeout=15)
    assert r.status_code == 403


def test_driver_forbidden_create(driver_headers):
    r = requests.post(f"{API}/dispatchers", headers=driver_headers, json={"name": "X", "fee_percent": 5}, timeout=15)
    assert r.status_code == 403


created_ids = []


def test_create_three_dispatchers(owner_headers):
    # Clean out existing TEST_ dispatchers first for idempotency
    existing = requests.get(f"{API}/dispatchers", headers=owner_headers).json()
    for d in existing:
        if d["name"].startswith("TEST_"):
            requests.delete(f"{API}/dispatchers/{d['id']}", headers=owner_headers)
    for name, fee in [("TEST_Alpha", 5), ("TEST_Beta", 10), ("TEST_Gamma", 25)]:
        r = requests.post(f"{API}/dispatchers", headers=owner_headers, json={"name": name, "fee_percent": fee}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == name
        assert d["fee_percent"] == fee
        assert "id" in d
        created_ids.append(d["id"])


def test_list_dispatchers_contains_created(owner_headers):
    r = requests.get(f"{API}/dispatchers", headers=owner_headers, timeout=15)
    assert r.status_code == 200
    names = [d["name"] for d in r.json()]
    for n in ["TEST_Alpha", "TEST_Beta", "TEST_Gamma"]:
        assert n in names


def test_rate_with_dispatcher_10pct(owner_headers):
    payload = {
        "distance_miles": 450,
        "fuel_price": 4.00,
        "mpg": 10,
        "quoted_rate": 1350,
        "dispatcher_fee_percent": 10,
    }
    r = requests.post(f"{API}/rate", headers=owner_headers, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["dispatcher_fee"] == 135.0
    assert d["net_rate"] == 1215.0
    assert d["take_home"] == 949.27
    assert d["take_home_margin_pct"] == 70.3


def test_rate_without_dispatcher(owner_headers):
    payload = {
        "distance_miles": 450,
        "fuel_price": 4.00,
        "mpg": 10,
        "quoted_rate": 1350,
        "dispatcher_fee_percent": 0,
    }
    r = requests.post(f"{API}/rate", headers=owner_headers, json=payload, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["take_home"] == 1084.28
    assert d.get("dispatcher_fee", 0) == 0


def test_delete_dispatchers(owner_headers):
    for did in created_ids:
        r = requests.delete(f"{API}/dispatchers/{did}", headers=owner_headers, timeout=15)
        assert r.status_code == 200
    # Verify gone
    remaining = [d["id"] for d in requests.get(f"{API}/dispatchers", headers=owner_headers).json()]
    for did in created_ids:
        assert did not in remaining
