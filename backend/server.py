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

    if user["role"] == "owner":
        rig = await db.rigs.find_one({}, {"_id": 0})
    elif user.get("assigned_rig_id"):
        rig = await db.rigs.find_one({"id": user["assigned_rig_id"]}, {"_id": 0})
    else:
        rig = None

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
        my_rig = await db.rigs.find_one({}, {"_id": 0})
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
