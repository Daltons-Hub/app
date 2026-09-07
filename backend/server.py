from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Header, Query, Response
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import logging
from pydantic import BaseModel
from typing import Optional
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
import requests
import math
import json
import re
from pymongo import ReturnDocument
from emergentintegrations.llm.chat import LlmChat, UserMessage

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
APP_NAME = "hotshot-ops"

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
storage_key = None

MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp", "pdf": "application/pdf", "heic": "image/heic",
}

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI()
api_router = APIRouter(prefix="/api")


def init_storage(force: bool = False):
    global storage_key
    if storage_key and not force:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                        headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                            headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_pin(pin: str, hashed: str) -> bool:
    return bcrypt.checkpw(pin.encode("utf-8"), hashed.encode("utf-8"))


def create_token(user_id: str, role: str) -> str:
    payload = {"sub": user_id, "role": role,
               "exp": datetime.now(timezone.utc) + timedelta(days=30), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session. Please log in again.")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "pin_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def require_owner(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can do this.")
    return user


class LoginInput(BaseModel):
    username: str
    pin: str


class RigInput(BaseModel):
    name: str
    truck_make_model: str
    engine: str
    empty_weight: Optional[float] = None
    front_axle_weight: Optional[float] = None
    rear_axle_weight: Optional[float] = None
    gvwr: Optional[float] = None
    gcwr: Optional[float] = None
    trailer_type: Optional[str] = None
    trailer_length: Optional[float] = None
    trailer_capacity: Optional[float] = None


class DocInput(BaseModel):
    category: str
    label: str
    number: Optional[str] = None
    issue_date: Optional[str] = None
    expiration_date: Optional[str] = None
    file_id: Optional[str] = None


class DriverInput(BaseModel):
    name: str
    username: str
    pin: str
    assigned_rig_id: Optional[str] = None


class AssignInput(BaseModel):
    assigned_rig_id: Optional[str] = None


def doc_status(expiration_date: Optional[str]) -> str:
    if not expiration_date:
        return "active"
    try:
        exp = datetime.fromisoformat(expiration_date).date()
    except ValueError:
        return "active"
    today = datetime.now(timezone.utc).date()
    if exp < today:
        return "expired"
    if (exp - today).days <= 30:
        return "expiring"
    return "active"


@api_router.post("/auth/login")
async def login(data: LoginInput):
    user = await db.users.find_one({"username": data.username.lower().strip()})
    if not user or not verify_pin(data.pin, user["pin_hash"]):
        raise HTTPException(status_code=401, detail="Wrong username or PIN.")
    token = create_token(user["id"], user["role"])
    user.pop("_id", None)
    user.pop("pin_hash", None)
    return {"token": token, "user": user}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@api_router.get("/rigs")
async def list_rigs(user: dict = Depends(get_current_user)):
    if user["role"] == "owner":
        return await db.rigs.find({}, {"_id": 0}).to_list(1000)
    rid = user.get("assigned_rig_id")
    return await db.rigs.find({"id": rid}, {"_id": 0}).to_list(10) if rid else []


@api_router.post("/rigs")
async def create_rig(data: RigInput, user: dict = Depends(require_owner)):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.rigs.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/rigs/{rig_id}")
async def update_rig(rig_id: str, data: RigInput, user: dict = Depends(require_owner)):
    res = await db.rigs.update_one({"id": rig_id}, {"$set": data.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Rig not found")
    return await db.rigs.find_one({"id": rig_id}, {"_id": 0})


@api_router.delete("/rigs/{rig_id}")
async def delete_rig(rig_id: str, user: dict = Depends(require_owner)):
    await db.rigs.delete_one({"id": rig_id})
    await db.users.update_many({"assigned_rig_id": rig_id}, {"$set": {"assigned_rig_id": None}})
    return {"ok": True}


@api_router.get("/documents")
async def list_documents(user: dict = Depends(get_current_user)):
    docs = await db.documents.find({}, {"_id": 0}).to_list(1000)
    for d in docs:
        d["status"] = doc_status(d.get("expiration_date"))
    docs.sort(key=lambda d: d.get("expiration_date") or "9999")
    return docs


@api_router.post("/documents")
async def create_document(data: DocInput, user: dict = Depends(require_owner)):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.documents.insert_one(doc)
    doc.pop("_id", None)
    doc["status"] = doc_status(doc.get("expiration_date"))
    return doc


@api_router.put("/documents/{doc_id}")
async def update_document(doc_id: str, data: DocInput, user: dict = Depends(require_owner)):
    res = await db.documents.update_one({"id": doc_id}, {"$set": data.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    d = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    d["status"] = doc_status(d.get("expiration_date"))
    return d


@api_router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, user: dict = Depends(require_owner)):
    await db.documents.delete_one({"id": doc_id})
    return {"ok": True}


@api_router.post("/upload")
async def upload(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ext = file.filename.split(".")[-1].lower() if "." in file.filename else "bin"
    file_id = str(uuid.uuid4())
    path = f"{APP_NAME}/uploads/{user['id']}/{file_id}.{ext}"
    data = await file.read()
    content_type = file.content_type or MIME_TYPES.get(ext, "application/octet-stream")
    result = put_object(path, data, content_type)
    await db.files.insert_one({
        "id": file_id, "storage_path": result["path"], "original_filename": file.filename,
        "content_type": content_type, "size": result.get("size"), "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"file_id": file_id, "original_filename": file.filename, "content_type": content_type}


@api_router.get("/files/{file_id}")
async def download(file_id: str, auth: str = Query(None), authorization: str = Header(None)):
    token = auth or (authorization[7:] if authorization and authorization.startswith("Bearer ") else None)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session")
    rec = await db.files.find_one({"id": file_id, "is_deleted": False})
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
    content, ct = get_object(rec["storage_path"])
    return Response(content=content, media_type=rec.get("content_type", ct))


@api_router.get("/weigh-station")
async def weigh_station(user: dict = Depends(get_current_user)):
    docs = await db.documents.find({}, {"_id": 0}).to_list(1000)

    def summarize(cat):
        matches = [d for d in docs if d.get("category") == cat]
        if not matches:
            return {"present": False, "number": None, "status": "missing", "expiration_date": None, "file_id": None}
        d = matches[0]
        return {"present": True, "number": d.get("number"), "status": doc_status(d.get("expiration_date")),
                "expiration_date": d.get("expiration_date"), "file_id": d.get("file_id")}

    rig = await resolve_user_rig(user)

    return {"dot": summarize("DOT"), "mc": summarize("MC"), "insurance": summarize("Insurance"),
            "ifta": summarize("IFTA"), "medical": summarize("Medical"), "rig": rig}


@api_router.get("/drivers")
async def list_drivers(user: dict = Depends(require_owner)):
    return await db.users.find({"role": "driver"}, {"_id": 0, "pin_hash": 0}).to_list(1000)


@api_router.post("/drivers")
async def create_driver(data: DriverInput, user: dict = Depends(require_owner)):
    username = data.username.lower().strip()
    if await db.users.find_one({"username": username}):
        raise HTTPException(status_code=400, detail="That username is already taken.")
    doc = {"id": str(uuid.uuid4()), "name": data.name, "username": username,
           "pin_hash": hash_pin(data.pin), "role": "driver", "assigned_rig_id": data.assigned_rig_id,
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("pin_hash", None)
    return doc


@api_router.put("/drivers/{driver_id}/assign")
async def assign_driver(driver_id: str, data: AssignInput, user: dict = Depends(require_owner)):
    res = await db.users.update_one({"id": driver_id, "role": "driver"},
                                    {"$set": {"assigned_rig_id": data.assigned_rig_id}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
    return await db.users.find_one({"id": driver_id}, {"_id": 0, "pin_hash": 0})


@api_router.delete("/drivers/{driver_id}")
async def delete_driver(driver_id: str, user: dict = Depends(require_owner)):
    await db.users.delete_one({"id": driver_id, "role": "driver"})
    return {"ok": True}


@api_router.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    docs = await db.documents.find({}, {"_id": 0}).to_list(1000)
    expired, expiring = [], []
    for d in docs:
        s = doc_status(d.get("expiration_date"))
        if s == "expired":
            expired.append(d.get("label"))
        elif s == "expiring":
            expiring.append(d.get("label"))

    if user["role"] == "owner":
        rig_count = await db.rigs.count_documents({})
        driver_count = await db.users.count_documents({"role": "driver"})
        my_rig = await resolve_user_rig(user)
    else:
        rig_count = 1 if user.get("assigned_rig_id") else 0
        driver_count = 0
        my_rig = await db.rigs.find_one({"id": user.get("assigned_rig_id")}, {"_id": 0}) if user.get("assigned_rig_id") else None

    if expired:
        next_step = {"level": "expired", "title": f"{len(expired)} document(s) EXPIRED",
                     "detail": ", ".join(expired) + " — renew before your next haul.", "action": "documents"}
    elif expiring:
        next_step = {"level": "expiring", "title": f"{len(expiring)} document(s) expiring soon",
                     "detail": ", ".join(expiring) + " — renew within 30 days.", "action": "documents"}
    elif rig_count == 0:
        next_step = {"level": "info", "title": "Set up your first rig",
                     "detail": "Add your truck and trailer so we can check your weights.", "action": "rigs"}
    else:
        next_step = {"level": "good", "title": "You're road-ready",
                     "detail": "All documents are current. Tap Weigh Station when you pull in.", "action": "weigh"}

    return {"next_step": next_step, "expired_count": len(expired), "expiring_count": len(expiring),
            "doc_count": len(docs), "rig_count": rig_count, "driver_count": driver_count, "my_rig": my_rig}


# ===================== Phase 2: Trip logic =====================

class ComplianceInput(BaseModel):
    rig_id: str
    cargo_weight: float


class RateInput(BaseModel):
    distance_miles: float
    cargo_weight: Optional[float] = None
    fuel_price: float
    mpg: float = 10.0
    def_price: float = 3.50
    wear_per_mile: float = 0.18
    quoted_rate: Optional[float] = None


class SecurementInput(BaseModel):
    cargo_weight: float
    cargo_type: str
    length_ft: Optional[float] = None


class TripStart(BaseModel):
    rig_id: Optional[str] = None
    start_odometer: Optional[float] = None
    origin: Optional[str] = None


class DutyUpdate(BaseModel):
    duty_status: str


class StateMilesInput(BaseModel):
    state: str
    miles: float


class TripStop(BaseModel):
    end_odometer: Optional[float] = None
    notes: Optional[str] = None


class ActiveRigInput(BaseModel):
    rig_id: Optional[str] = None


async def resolve_user_rig(user):
    if user["role"] == "owner":
        if user.get("active_rig_id"):
            r = await db.rigs.find_one({"id": user["active_rig_id"]}, {"_id": 0})
            if r:
                return r
        return await db.rigs.find_one({}, {"_id": 0})
    if user.get("assigned_rig_id"):
        return await db.rigs.find_one({"id": user["assigned_rig_id"]}, {"_id": 0})
    return None


def compute_compliance(rig, cargo_weight):
    empty = rig.get("empty_weight") or 0
    gcwr = rig.get("gcwr") or 0
    gvwr = rig.get("gvwr") or 0
    trailer_capacity = rig.get("trailer_capacity") or 0

    actual_loaded = empty + cargo_weight  # truck empty + cargo (trailer tare not tracked)
    # FMCSA looks at GVWR/GCWR rating OR actual weight, whichever is greater.
    determining = max(gcwr, actual_loaded)

    is_cmv = determining >= 10001

    # Is the trailer over 10,000 lb? Needed to distinguish Class A from Class B.
    trailer_over_10k = trailer_capacity >= 10001 or (gcwr and gvwr and (gcwr - gvwr) > 10000)

    cdl_required = determining >= 26001
    cdl_class = None
    if cdl_required:
        cdl_class = "A" if trailer_over_10k else "B"

    consortium_required = cdl_required  # DOT random drug & alcohol program is tied to CDL operation
    dot_number_required = is_cmv
    medical_card_required = is_cmv
    eld_required = is_cmv

    rating_gotcha = gcwr >= 26001 and actual_loaded < 26001

    requirements = [
        {"key": "usdot", "label": "USDOT Number", "required": dot_number_required,
         "detail": "Interstate for-hire operation of a 10,001 lb+ vehicle needs an active USDOT number." if dot_number_required
         else "Under 10,001 lb — a USDOT number is generally not federally required."},
        {"key": "medical", "label": "DOT Medical Card", "required": medical_card_required,
         "detail": "Driver must carry a valid DOT medical examiner's certificate." if medical_card_required
         else "No federal DOT physical required at this weight."},
        {"key": "hos_eld", "label": "Hours of Service / ELD", "required": eld_required,
         "detail": "Must track Hours of Service. An ELD is required unless you qualify for the 150 air-mile short-haul exemption (return within 14 hours)." if eld_required
         else "Federal Hours-of-Service / ELD rules do not apply at this weight."},
        {"key": "cdl", "label": f"Commercial Driver's License (Class {cdl_class})" if cdl_class else "Commercial Driver's License", "required": cdl_required,
         "detail": (f"Combined weight is 26,001 lb+ and the trailer is over 10,000 lb → a Class A CDL is required." if cdl_class == "A"
                    else "Combined weight is 26,001 lb+ → at least a Class B CDL is required.") if cdl_required
         else "Under 26,001 lb — no CDL required (unless hauling hazmat or passengers)."},
        {"key": "consortium", "label": "Drug & Alcohol Consortium", "required": consortium_required,
         "detail": "CDL drivers must be enrolled in a DOT random drug & alcohol testing program (consortium)." if consortium_required
         else "Not federally required for non-CDL drivers."},
    ]

    warnings = []
    if gcwr and actual_loaded > gcwr:
        warnings.append(f"Estimated loaded weight ({int(actual_loaded):,} lb) exceeds your GCWR rating ({int(gcwr):,} lb). You may be overweight.")
    if trailer_capacity and cargo_weight > trailer_capacity:
        warnings.append(f"Cargo ({int(cargo_weight):,} lb) is over the trailer's rated capacity ({int(trailer_capacity):,} lb).")

    if not is_cmv:
        tier = "Light / non-CMV"
        summary = "This load is under 10,001 lb — outside most federal FMCSA requirements."
    elif not cdl_required:
        tier = "CMV — no CDL"
        summary = "This load makes you a commercial motor vehicle (USDOT, medical card, and HOS apply), but no CDL is required."
    else:
        tier = f"CDL Class {cdl_class} required"
        summary = f"This combination requires a Class {cdl_class} CDL, plus USDOT, medical card, HOS/ELD, and a drug & alcohol consortium."

    if rating_gotcha:
        summary += f" Note: even though your actual load is under 26,001 lb, your rig's GCWR rating of {int(gcwr):,} lb sets the requirement — FMCSA uses the rating."

    return {
        "cargo_weight": cargo_weight,
        "empty_weight": empty,
        "actual_loaded": actual_loaded,
        "gcwr": gcwr,
        "determining_weight": determining,
        "tier": tier,
        "is_cmv": is_cmv,
        "cdl_required": cdl_required,
        "cdl_class": cdl_class,
        "eld_required": eld_required,
        "consortium_required": consortium_required,
        "rating_gotcha": rating_gotcha,
        "summary": summary,
        "requirements": requirements,
        "warnings": warnings,
    }


CHECKLIST_BASE = [
    "Inspect every strap / chain for cuts, wear, or damage before use",
    "Confirm working load limit (WLL) tags are legible on each device",
    "Block or brace cargo against forward movement (headboard / bulkhead)",
    "Apply tie-downs at proper angles and remove all slack",
    "Re-check tension within the first 50 miles, then periodically",
    "Flag or mark any legal overhang before departure",
]

CHECKLIST_TYPE = {
    "General Freight": ["Fill voids with dunnage so cargo can't shift"],
    "Steel / Metal": ["Use chains with grab hooks", "Add dunnage between stacks to stop side-to-side shift"],
    "Machinery / Equipment": ["Secure at manufacturer tie-down points", "Chock wheels/tracks, engage parking brake & any transport locks"],
    "Lumber": ["Strap each tier separately", "Use corner protectors on all edges"],
    "Vehicles / Autos": ["Use 4 wheel-basket or over-the-tire straps per vehicle", "Chock wheels and set parking brake"],
    "Pipe": ["Block and brace against rolling with stakes/bolsters", "Chain each tier separately"],
}


def compute_securement(cargo_weight, cargo_type, length_ft):
    required_wll = round(cargo_weight * 0.5)
    use_chains = cargo_type in ("Steel / Metal", "Machinery / Equipment", "Pipe")
    device = "3/8\" Grade 70 chain w/ binder" if use_chains else "4\" ratchet strap"
    device_wll = 6600 if use_chains else 5400

    count_by_wll = max(2, math.ceil(required_wll / device_wll)) if device_wll else 2
    min_by_length = 2
    if length_ft:
        if length_ft <= 5 and cargo_weight <= 1100:
            min_by_length = 1
        elif length_ft <= 10:
            min_by_length = 2
        else:
            min_by_length = 2 + math.ceil((length_ft - 10) / 10)
    count = max(count_by_wll, min_by_length)

    items = list(CHECKLIST_BASE)
    if use_chains:
        items.insert(4, "Confirm load binders are locked and secured so they can't release")
    else:
        items.insert(4, "Use edge protectors wherever straps cross sharp corners")
    items += CHECKLIST_TYPE.get(cargo_type, [])

    return {
        "cargo_weight": cargo_weight,
        "cargo_type": cargo_type,
        "required_wll": required_wll,
        "device": device,
        "device_wll": device_wll,
        "count": count,
        "aggregate_wll": count * device_wll,
        "note": f"Federal rule: total tie-down WLL must be at least 50% of cargo weight ({required_wll:,} lb). {count} × {device} ({device_wll:,} lb each) = {count * device_wll:,} lb.",
        "checklist": items,
    }


@api_router.post("/compliance")
async def compliance(data: ComplianceInput, user: dict = Depends(get_current_user)):
    rig = await db.rigs.find_one({"id": data.rig_id}, {"_id": 0})
    if not rig:
        raise HTTPException(status_code=404, detail="Rig not found")
    return compute_compliance(rig, data.cargo_weight)


@api_router.post("/rate")
async def rate(data: RateInput, user: dict = Depends(require_owner)):
    if data.distance_miles <= 0 or data.mpg <= 0:
        raise HTTPException(status_code=400, detail="Distance and MPG must be greater than zero.")
    gallons = data.distance_miles / data.mpg
    fuel_cost = gallons * data.fuel_price
    def_gallons = gallons * 0.03
    def_cost = def_gallons * data.def_price
    wear_cost = data.distance_miles * data.wear_per_mile
    total_cost = fuel_cost + def_cost + wear_cost
    cost_per_mile = total_cost / data.distance_miles

    result = {
        "gallons": round(gallons, 1),
        "fuel_cost": round(fuel_cost, 2),
        "def_cost": round(def_cost, 2),
        "wear_cost": round(wear_cost, 2),
        "total_cost": round(total_cost, 2),
        "cost_per_mile": round(cost_per_mile, 2),
        "quoted_rate": data.quoted_rate,
    }
    if data.quoted_rate is not None:
        profit = data.quoted_rate - total_cost
        result["rate_per_mile"] = round(data.quoted_rate / data.distance_miles, 2)
        result["profit"] = round(profit, 2)
        result["margin_pct"] = round((profit / data.quoted_rate * 100), 1) if data.quoted_rate else 0
    return result


@api_router.post("/securement")
async def securement(data: SecurementInput, user: dict = Depends(get_current_user)):
    return compute_securement(data.cargo_weight, data.cargo_type, data.length_ft)


@api_router.post("/trips/start")
async def start_trip(data: TripStart, user: dict = Depends(get_current_user)):
    if await db.trips.find_one({"user_id": user["id"], "status": "active"}):
        raise HTTPException(status_code=400, detail="You already have an active trip. Stop it first.")
    rig_id = data.rig_id or user.get("assigned_rig_id") or user.get("active_rig_id")
    rig = await db.rigs.find_one({"id": rig_id}, {"_id": 0}) if rig_id else None
    now = datetime.now(timezone.utc).isoformat()
    doc = {"id": str(uuid.uuid4()), "user_id": user["id"], "user_name": user.get("name"),
           "rig_id": rig_id, "rig_name": rig.get("name") if rig else None,
           "status": "active", "start_time": now, "end_time": None,
           "start_odometer": data.start_odometer, "end_odometer": None, "total_miles": None,
           "duty_status": "driving", "duty_log": [{"status": "driving", "time": now}],
           "state_miles": [], "origin": data.origin, "notes": None, "created_at": now}
    await db.trips.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/trips/active")
async def active_trip(user: dict = Depends(get_current_user)):
    return await db.trips.find_one({"user_id": user["id"], "status": "active"}, {"_id": 0}) or {}


async def _get_owned_trip(trip_id, user):
    t = await db.trips.find_one({"id": trip_id})
    if not t:
        raise HTTPException(status_code=404, detail="Trip not found")
    if t["user_id"] != user["id"] and user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Not your trip.")
    return t


@api_router.post("/trips/{trip_id}/duty")
async def trip_duty(trip_id: str, data: DutyUpdate, user: dict = Depends(get_current_user)):
    await _get_owned_trip(trip_id, user)
    now = datetime.now(timezone.utc).isoformat()
    await db.trips.update_one({"id": trip_id},
                              {"$set": {"duty_status": data.duty_status},
                               "$push": {"duty_log": {"status": data.duty_status, "time": now}}})
    return await db.trips.find_one({"id": trip_id}, {"_id": 0})


@api_router.post("/trips/{trip_id}/state-miles")
async def trip_state_miles(trip_id: str, data: StateMilesInput, user: dict = Depends(get_current_user)):
    t = await _get_owned_trip(trip_id, user)
    sm = t.get("state_miles", [])
    for e in sm:
        if e["state"] == data.state:
            e["miles"] = (e.get("miles") or 0) + data.miles
            break
    else:
        sm.append({"state": data.state, "miles": data.miles})
    await db.trips.update_one({"id": trip_id}, {"$set": {"state_miles": sm}})
    return await db.trips.find_one({"id": trip_id}, {"_id": 0})


@api_router.post("/trips/{trip_id}/stop")
async def stop_trip(trip_id: str, data: TripStop, user: dict = Depends(get_current_user)):
    t = await _get_owned_trip(trip_id, user)
    now = datetime.now(timezone.utc).isoformat()
    total = None
    if data.end_odometer is not None and t.get("start_odometer") is not None:
        total = data.end_odometer - t["start_odometer"]
    await db.trips.update_one({"id": trip_id},
                              {"$set": {"status": "completed", "end_time": now, "end_odometer": data.end_odometer,
                                        "total_miles": total, "duty_status": "off_duty", "notes": data.notes}})
    if data.end_odometer is not None and t.get("rig_id"):
        rig = await db.rigs.find_one({"id": t["rig_id"]})
        if rig and (rig.get("current_odometer") or 0) < data.end_odometer:
            await db.rigs.update_one({"id": t["rig_id"]}, {"$set": {"current_odometer": data.end_odometer}})
    return await db.trips.find_one({"id": trip_id}, {"_id": 0})


@api_router.get("/trips")
async def list_trips(user: dict = Depends(get_current_user)):
    q = {} if user["role"] == "owner" else {"user_id": user["id"]}
    trips = await db.trips.find(q, {"_id": 0}).to_list(500)
    trips.sort(key=lambda t: t.get("created_at") or "", reverse=True)
    return trips


@api_router.put("/settings/active-rig")
async def set_active_rig(data: ActiveRigInput, user: dict = Depends(require_owner)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"active_rig_id": data.rig_id}})
    return {"active_rig_id": data.rig_id}


# ===================== Phase 3: Back office =====================

class DeliveryInput(BaseModel):
    customer_name: str
    rig_id: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    load_description: Optional[str] = None
    delivery_date: Optional[str] = None
    weight: Optional[float] = None
    rate_amount: Optional[float] = None
    photo_file_id: Optional[str] = None
    signature_file_id: Optional[str] = None
    notes: Optional[str] = None


class InvoiceUpdate(BaseModel):
    rate_amount: Optional[float] = None
    invoice_status: Optional[str] = None


class MaintenanceInput(BaseModel):
    rig_id: str
    type: str
    interval_miles: Optional[float] = None
    interval_days: Optional[int] = None
    last_done_miles: Optional[float] = None
    last_done_date: Optional[str] = None
    notes: Optional[str] = None


class OdometerInput(BaseModel):
    current_odometer: float


class ExpenseInput(BaseModel):
    rig_id: Optional[str] = None
    category: str
    amount: float
    gallons: Optional[float] = None
    state: Optional[str] = None
    date: Optional[str] = None
    vendor: Optional[str] = None
    notes: Optional[str] = None


def _parse_date(s):
    try:
        return datetime.fromisoformat(s).date()
    except (ValueError, TypeError):
        return None


def compute_maint(item, current_odo):
    today = datetime.now(timezone.utc).date()
    order = {"ok": 0, "due_soon": 1, "overdue": 2}
    status = "ok"
    out = {"next_due_miles": None, "miles_remaining": None, "next_due_date": None, "days_remaining": None}
    if item.get("interval_miles") and item.get("last_done_miles") is not None:
        nd = item["last_done_miles"] + item["interval_miles"]
        rem = nd - (current_odo or 0)
        s = "overdue" if rem <= 0 else ("due_soon" if rem <= 500 else "ok")
        if order[s] > order[status]:
            status = s
        out["next_due_miles"] = nd
        out["miles_remaining"] = rem
    if item.get("interval_days") and item.get("last_done_date"):
        d = _parse_date(item["last_done_date"])
        if d:
            nd = d + timedelta(days=item["interval_days"])
            days_left = (nd - today).days
            s = "overdue" if days_left <= 0 else ("due_soon" if days_left <= 30 else "ok")
            if order[s] > order[status]:
                status = s
            out["next_due_date"] = nd.isoformat()
            out["days_remaining"] = days_left
    out["status"] = status
    return out


# ---------- Deliveries / Invoices ----------
@api_router.post("/deliveries")
async def create_delivery(data: DeliveryInput, user: dict = Depends(require_owner)):
    now = datetime.now(timezone.utc)
    counter = await db.counters.find_one_and_update(
        {"_id": "invoice"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    seq = counter["seq"]
    doc = data.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "invoice_number": f"INV-{now.year}-{seq:04d}",
        "invoice_status": "unpaid",
        "created_at": now.isoformat(),
    })
    rig = await db.rigs.find_one({"id": data.rig_id}, {"_id": 0}) if data.rig_id else None
    doc["rig_name"] = rig.get("name") if rig else None
    await db.deliveries.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/deliveries")
async def list_deliveries(user: dict = Depends(require_owner)):
    items = await db.deliveries.find({}, {"_id": 0}).to_list(1000)
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return items


@api_router.put("/deliveries/{delivery_id}/invoice")
async def update_invoice(delivery_id: str, data: InvoiceUpdate, user: dict = Depends(require_owner)):
    upd = {k: v for k, v in data.model_dump().items() if v is not None}
    res = await db.deliveries.update_one({"id": delivery_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Delivery not found")
    return await db.deliveries.find_one({"id": delivery_id}, {"_id": 0})


@api_router.delete("/deliveries/{delivery_id}")
async def delete_delivery(delivery_id: str, user: dict = Depends(require_owner)):
    await db.deliveries.delete_one({"id": delivery_id})
    return {"ok": True}


# ---------- Maintenance ----------
@api_router.get("/maintenance")
async def list_maintenance(user: dict = Depends(require_owner)):
    rigs = {r["id"]: r for r in await db.rigs.find({}, {"_id": 0}).to_list(1000)}
    items = await db.maintenance.find({}, {"_id": 0}).to_list(1000)
    out = []
    for it in items:
        rig = rigs.get(it.get("rig_id"))
        current_odo = (rig.get("current_odometer") if rig else None) or 0
        it = {**it, **compute_maint(it, current_odo), "rig_name": rig.get("name") if rig else None,
              "current_odometer": current_odo}
        out.append(it)
    order = {"overdue": 0, "due_soon": 1, "ok": 2}
    out.sort(key=lambda x: order.get(x["status"], 3))
    return out


@api_router.post("/maintenance")
async def create_maintenance(data: MaintenanceInput, user: dict = Depends(require_owner)):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.maintenance.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/maintenance/{item_id}/service")
async def service_maintenance(item_id: str, user: dict = Depends(require_owner)):
    it = await db.maintenance.find_one({"id": item_id})
    if not it:
        raise HTTPException(status_code=404, detail="Item not found")
    rig = await db.rigs.find_one({"id": it.get("rig_id")})
    current_odo = (rig.get("current_odometer") if rig else None) or 0
    await db.maintenance.update_one({"id": item_id}, {"$set": {
        "last_done_miles": current_odo,
        "last_done_date": datetime.now(timezone.utc).date().isoformat(),
    }})
    return await db.maintenance.find_one({"id": item_id}, {"_id": 0})


@api_router.delete("/maintenance/{item_id}")
async def delete_maintenance(item_id: str, user: dict = Depends(require_owner)):
    await db.maintenance.delete_one({"id": item_id})
    return {"ok": True}


@api_router.put("/rigs/{rig_id}/odometer")
async def set_odometer(rig_id: str, data: OdometerInput, user: dict = Depends(require_owner)):
    res = await db.rigs.update_one({"id": rig_id}, {"$set": {"current_odometer": data.current_odometer}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Rig not found")
    return {"current_odometer": data.current_odometer}


# ---------- Expenses ----------
@api_router.get("/expenses")
async def list_expenses(user: dict = Depends(require_owner)):
    items = await db.expenses.find({}, {"_id": 0}).to_list(2000)
    items.sort(key=lambda x: x.get("date") or x.get("created_at") or "", reverse=True)
    return items


@api_router.post("/expenses")
async def create_expense(data: ExpenseInput, user: dict = Depends(require_owner)):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    if not doc.get("date"):
        doc["date"] = datetime.now(timezone.utc).date().isoformat()
    await db.expenses.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, user: dict = Depends(require_owner)):
    await db.expenses.delete_one({"id": expense_id})
    return {"ok": True}


@api_router.get("/ifta-report")
async def ifta_report(user: dict = Depends(require_owner)):
    trips = await db.trips.find({"status": "completed"}, {"_id": 0}).to_list(2000)
    miles_by_state = {}
    for t in trips:
        for e in t.get("state_miles", []):
            miles_by_state[e["state"]] = miles_by_state.get(e["state"], 0) + (e.get("miles") or 0)

    expenses = await db.expenses.find({"category": "Fuel"}, {"_id": 0}).to_list(2000)
    gallons_by_state = {}
    fuel_by_state = {}
    for x in expenses:
        st = x.get("state") or "—"
        gallons_by_state[st] = gallons_by_state.get(st, 0) + (x.get("gallons") or 0)
        fuel_by_state[st] = fuel_by_state.get(st, 0) + (x.get("amount") or 0)

    states = sorted(set(list(miles_by_state.keys()) + [s for s in gallons_by_state if s != "—"]))
    rows = [{
        "state": s,
        "miles": round(miles_by_state.get(s, 0), 1),
        "gallons": round(gallons_by_state.get(s, 0), 1),
        "fuel_cost": round(fuel_by_state.get(s, 0), 2),
    } for s in states]

    total_miles = round(sum(miles_by_state.values()), 1)
    total_gallons = round(sum(gallons_by_state.values()), 1)
    return {
        "rows": rows,
        "total_miles": total_miles,
        "total_gallons": total_gallons,
        "avg_mpg": round(total_miles / total_gallons, 2) if total_gallons else None,
        "total_fuel_cost": round(sum(fuel_by_state.values()), 2),
    }


@api_router.get("/office/summary")
async def office_summary(user: dict = Depends(require_owner)):
    deliveries = await db.deliveries.find({}, {"_id": 0}).to_list(2000)
    unpaid = [d for d in deliveries if d.get("invoice_status") != "paid"]
    unpaid_total = sum((d.get("rate_amount") or 0) for d in unpaid)

    rigs = {r["id"]: r for r in await db.rigs.find({}, {"_id": 0}).to_list(1000)}
    maint = await db.maintenance.find({}, {"_id": 0}).to_list(1000)
    due = 0
    for it in maint:
        rig = rigs.get(it.get("rig_id"))
        current_odo = (rig.get("current_odometer") if rig else None) or 0
        if compute_maint(it, current_odo)["status"] in ("overdue", "due_soon"):
            due += 1

    expenses = await db.expenses.find({}, {"_id": 0}).to_list(2000)
    expense_total = sum((x.get("amount") or 0) for x in expenses)

    return {
        "deliveries_count": len(deliveries),
        "unpaid_count": len(unpaid),
        "unpaid_total": round(unpaid_total, 2),
        "maintenance_due": due,
        "expense_total": round(expense_total, 2),
    }


# ===================== Phase 4: AI Assistant =====================

class AssistantInput(BaseModel):
    message: str


async def build_assistant_context(user):
    is_owner = user["role"] == "owner"
    ctx = {
        "role": user["role"],
        "user_name": user.get("name"),
        "today": datetime.now(timezone.utc).date().isoformat(),
    }

    if is_owner:
        rigs = await db.rigs.find({}, {"_id": 0}).to_list(100)
    else:
        rigs = await db.rigs.find({"id": user.get("assigned_rig_id")}, {"_id": 0}).to_list(10) if user.get("assigned_rig_id") else []
    ctx["rigs"] = rigs

    docs = await db.documents.find({}, {"_id": 0}).to_list(1000)
    ctx["credentials"] = [{"category": d.get("category"), "label": d.get("label"), "number": d.get("number"),
                           "expiration_date": d.get("expiration_date"), "status": doc_status(d.get("expiration_date"))}
                          for d in docs]

    tq = {} if is_owner else {"user_id": user["id"]}
    trips = await db.trips.find(tq, {"_id": 0}).to_list(300)
    active = [t for t in trips if t.get("status") == "active"]
    completed = sorted([t for t in trips if t.get("status") == "completed"],
                       key=lambda x: x.get("created_at") or "", reverse=True)[:5]
    ctx["active_trip"] = ({"rig_name": active[0].get("rig_name"), "duty_status": active[0].get("duty_status"),
                           "origin": active[0].get("origin"), "state_miles": active[0].get("state_miles")}
                          if active else None)
    ctx["recent_trips"] = [{"rig_name": t.get("rig_name"), "start_time": t.get("start_time"),
                            "total_miles": t.get("total_miles"), "state_miles": t.get("state_miles")} for t in completed]

    rigmap = {r["id"]: r for r in rigs}
    maint = await db.maintenance.find({"rig_id": {"$in": list(rigmap.keys())}}, {"_id": 0}).to_list(500) if rigmap else []
    ctx["maintenance"] = []
    for it in maint:
        odo = (rigmap.get(it["rig_id"], {}).get("current_odometer")) or 0
        cm = compute_maint(it, odo)
        ctx["maintenance"].append({"type": it.get("type"), "rig": rigmap.get(it["rig_id"], {}).get("name"),
                                   "status": cm["status"], "next_due_miles": cm["next_due_miles"],
                                   "miles_remaining": cm["miles_remaining"], "next_due_date": cm["next_due_date"],
                                   "current_odometer": odo})

    if is_owner:
        deliveries = await db.deliveries.find({}, {"_id": 0}).to_list(500)
        deliveries.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        unpaid = [d for d in deliveries if d.get("invoice_status") != "paid"]
        expenses = await db.expenses.find({}, {"_id": 0}).to_list(1000)
        ctx["financials"] = {
            "unpaid_invoice_count": len(unpaid),
            "unpaid_total": round(sum((d.get("rate_amount") or 0) for d in unpaid), 2),
            "recent_invoices": [{"invoice_number": d.get("invoice_number"), "customer": d.get("customer_name"),
                                 "amount": d.get("rate_amount"), "status": d.get("invoice_status")} for d in deliveries[:8]],
            "expense_total": round(sum((x.get("amount") or 0) for x in expenses), 2),
            "note": "Per-load margin is not stored. To estimate margin, use cost = fuel + DEF (~3% of fuel) + wear (~$0.18/mi); ask the user for distance, fuel price and MPG if needed.",
        }
    return ctx


ASSISTANT_RULES = (
    "You are the HotShot Ops Assistant — a plain-spoken helper for a hotshot trucking operator. "
    "Answer ONLY from the DATA provided below. Keep answers short, friendly and jargon-free (the user may be a non-technical driver). "
    "Use plain numbers (e.g. '2,400 miles left'). If the data doesn't contain the answer, say so honestly and suggest what to add in the app. "
    "For weigh-station / 'am I clear' questions, check the credentials: a credential is a problem if its status is 'expired' or 'missing'; 'expiring' means renew soon but still valid. "
    "IMPORTANT: If the user's role is 'driver', NEVER reveal or discuss any financial information (rates, invoices, margins, expenses, money). If a driver asks about money, say that's only available to the owner. "
    "Never invent numbers that aren't in the data."
)


@api_router.get("/assistant/history")
async def assistant_history(user: dict = Depends(get_current_user)):
    msgs = await db.assistant_messages.find({"user_id": user["id"]}, {"_id": 0}).to_list(300)
    msgs.sort(key=lambda m: m.get("created_at") or "")
    return msgs


@api_router.delete("/assistant/history")
async def clear_assistant_history(user: dict = Depends(get_current_user)):
    await db.assistant_messages.delete_many({"user_id": user["id"]})
    return {"ok": True}


@api_router.post("/assistant/chat")
async def assistant_chat(data: AssistantInput, user: dict = Depends(get_current_user)):
    ctx = await build_assistant_context(user)
    prev = await db.assistant_messages.find({"user_id": user["id"]}, {"_id": 0}).to_list(300)
    prev.sort(key=lambda m: m.get("created_at") or "")
    recent = prev[-8:]
    convo = "\n".join(f"{m['role'].upper()}: {m['text']}" for m in recent)

    system = ASSISTANT_RULES + "\n\nDATA (JSON):\n" + json.dumps(ctx, default=str)
    if convo:
        system += "\n\nRECENT CONVERSATION:\n" + convo

    chat = LlmChat(api_key=EMERGENT_KEY, session_id=f"assistant-{user['id']}",
                   system_message=system).with_model("gemini", "gemini-3-flash-preview")
    try:
        answer = await chat.send_message(UserMessage(text=data.message))
    except Exception as e:
        logger.error(f"Assistant error: {e}")
        raise HTTPException(status_code=502, detail="The assistant is unavailable right now. Please try again.")

    # Belt-and-braces: never let a dollar figure reach a driver
    if user["role"] == "driver" and re.search(r"\$\s?\d", answer or ""):
        answer = "That information is only available to the owner. Check with them for anything about money."

    now = datetime.now(timezone.utc)
    await db.assistant_messages.insert_one({"id": str(uuid.uuid4()), "user_id": user["id"], "role": "user",
                                            "text": data.message, "created_at": now.isoformat()})
    await db.assistant_messages.insert_one({"id": str(uuid.uuid4()), "user_id": user["id"], "role": "assistant",
                                            "text": answer, "created_at": datetime.now(timezone.utc).isoformat()})
    return {"answer": answer}


async def seed():
    await db.users.create_index("username", unique=True)
    owner_username = os.environ.get("ADMIN_USERNAME", "owner").lower()
    owner_pin = os.environ.get("ADMIN_PIN", "1910")
    owner_email = os.environ.get("ADMIN_EMAIL", "")
    if not await db.users.find_one({"username": owner_username}):
        await db.users.insert_one({"id": str(uuid.uuid4()), "name": "Owner", "username": owner_username,
                                   "pin_hash": hash_pin(owner_pin), "role": "owner", "email": owner_email,
                                   "assigned_rig_id": None, "created_at": datetime.now(timezone.utc).isoformat()})
        logger.info("Seeded owner account")
    if not await db.users.find_one({"username": "driver"}):
        await db.users.insert_one({"id": str(uuid.uuid4()), "name": "Demo Driver", "username": "driver",
                                   "pin_hash": hash_pin("1234"), "role": "driver", "email": "",
                                   "assigned_rig_id": None, "created_at": datetime.now(timezone.utc).isoformat()})

    # Sample data so the app is populated on first login (runs once, ever)
    if not await db.app_meta.find_one({"key": "sample_seeded"}):
        today = datetime.now(timezone.utc).date()

        def d(days):
            return (today + timedelta(days=days)).isoformat()

        rig_id = str(uuid.uuid4())
        await db.rigs.insert_one({
            "id": rig_id, "name": "Big Blue", "truck_make_model": "Ram 3500 Dually",
            "engine": "6.7L Cummins", "empty_weight": 8200, "front_axle_weight": 5000,
            "rear_axle_weight": 6000, "gvwr": 14000, "gcwr": 37000,
            "trailer_type": "40ft Gooseneck Flatbed", "trailer_length": 40, "trailer_capacity": 21000,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await db.users.update_one({"username": "driver"}, {"$set": {"assigned_rig_id": rig_id}})
        await db.users.update_one({"username": os.environ.get("ADMIN_USERNAME", "owner").lower()},
                                  {"$set": {"active_rig_id": rig_id}})

        samples = [
            {"category": "DOT", "label": "USDOT Registration", "number": "3948217", "expiration_date": d(500)},
            {"category": "MC", "label": "MC Operating Authority", "number": "1029384", "expiration_date": d(500)},
            {"category": "Insurance", "label": "Progressive Liability Cert", "number": None, "expiration_date": d(18)},
            {"category": "IFTA", "label": "IFTA License", "number": None, "expiration_date": d(320)},
            {"category": "Medical", "label": "DOT Medical Card", "number": None, "expiration_date": d(210)},
        ]
        for s in samples:
            await db.documents.insert_one({"id": str(uuid.uuid4()), "issue_date": None, "file_id": None,
                                           "created_at": datetime.now(timezone.utc).isoformat(), **s})
        await db.app_meta.insert_one({"key": "sample_seeded", "at": datetime.now(timezone.utc).isoformat()})


@app.on_event("startup")
async def startup():
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    await seed()


@app.on_event("shutdown")
async def shutdown():
    client.close()


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
