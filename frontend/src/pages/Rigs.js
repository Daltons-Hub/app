import { useEffect, useState } from "react";
import { api, apiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "../components/ui/dialog";
import { Plus, Truck, Pencil, Trash2, Weight, Ruler, Gauge } from "lucide-react";
import { toast } from "sonner";

const EMPTY = {
  name: "", truck_make_model: "", engine: "", empty_weight: "", front_axle_weight: "",
  rear_axle_weight: "", gvwr: "", gcwr: "", trailer_type: "", trailer_length: "", trailer_capacity: "",
};

const NUM_FIELDS = ["empty_weight", "front_axle_weight", "rear_axle_weight", "gvwr", "gcwr", "trailer_length", "trailer_capacity"];

export default function Rigs() {
  const { isOwner } = useAuth();
  const [rigs, setRigs] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);

  const [activeRigId, setActiveRigId] = useState(null);
  const load = () => {
    api.get("/rigs").then((r) => setRigs(r.data)).catch(() => {});
    if (isOwner) api.get("/auth/me").then((r) => setActiveRigId(r.data.active_rig_id)).catch(() => {});
  };
  const setActive = async (id) => {
    await api.put("/settings/active-rig", { rig_id: id });
    setActiveRigId(id);
    toast.success("Set as active rig for Weigh Station.");
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY); setEditId(null); setOpen(true); };
  const openEdit = (r) => {
    const f = { ...EMPTY, ...r };
    NUM_FIELDS.forEach((k) => (f[k] = r[k] ?? ""));
    setForm(f); setEditId(r.id); setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.truck_make_model.trim()) return toast.error("Give the rig a name and truck.");
    const payload = { ...form };
    NUM_FIELDS.forEach((k) => (payload[k] = payload[k] === "" ? null : Number(payload[k])));
    try {
      if (editId) await api.put(`/rigs/${editId}`, payload);
      else await api.post("/rigs", payload);
      toast.success("Rig saved.");
      setOpen(false);
      load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this rig?")) return;
    await api.delete(`/rigs/${id}`);
    toast.success("Rig deleted.");
    load();
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-4" data-testid="rigs-page">
      <div className="flex items-center justify-between">
        <h1 className="font-display font-black text-3xl tracking-wide">{isOwner ? "RIGS" : "MY RIG"}</h1>
        {isOwner && (
          <button data-testid="add-rig-button" onClick={openNew}
            className="flex items-center gap-1 h-11 px-4 rounded-xl bg-amber-500 text-[#0A0C0E] font-bold active:scale-95 transition-transform">
            <Plus className="w-5 h-5" /> Add
          </button>
        )}
      </div>

      {rigs.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
          <Truck className="w-10 h-10 mx-auto mb-3 text-slate-600" />
          {isOwner ? "No rigs yet. Tap Add to save your truck + trailer." : "No rig assigned to you yet."}
        </div>
      )}

      {rigs.map((r, i) => (
        <div key={r.id} data-testid={`rig-profile-card-${i}`} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-display font-bold text-xl">{r.name}</div>
              <div className="text-slate-300 text-sm">{r.truck_make_model}</div>
              <div className="text-slate-500 text-xs font-mono-num mt-0.5">{r.engine}</div>
            </div>
            {isOwner && (
              <div className="flex gap-1">
                <button data-testid={`edit-rig-${i}`} onClick={() => openEdit(r)} className="p-2 rounded-md text-slate-400 hover:bg-slate-800"><Pencil className="w-4 h-4" /></button>
                <button data-testid={`delete-rig-${i}`} onClick={() => del(r.id)} className="p-2 rounded-md text-red-400 hover:bg-slate-800"><Trash2 className="w-4 h-4" /></button>
              </div>
            )}
          </div>
          {r.trailer_type && (
            <div className="mt-2 text-sm text-amber-500 font-semibold">
              🚚 {r.trailer_type}{r.trailer_length ? ` · ${r.trailer_length}ft` : ""}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Spec icon={Weight} label="Empty Wt" value={fmt(r.empty_weight)} />
            <Spec icon={Gauge} label="GVWR" value={fmt(r.gvwr)} />
            <Spec icon={Gauge} label="GCWR" value={fmt(r.gcwr)} />
            <Spec icon={Weight} label="Trailer Cap" value={fmt(r.trailer_capacity)} />
            <Spec icon={Weight} label="Front Axle" value={fmt(r.front_axle_weight)} />
            <Spec icon={Weight} label="Rear Axle" value={fmt(r.rear_axle_weight)} />
          </div>
          {isOwner && (
            <button data-testid={`set-active-rig-${i}`} onClick={() => setActive(r.id)}
              className={`mt-3 w-full h-11 rounded-lg font-semibold text-sm transition-colors ${
                activeRigId === r.id ? "bg-amber-500 text-[#0A0C0E]" : "bg-slate-800/60 text-slate-300"
              }`}>
              {activeRigId === r.id ? "★ Active for Weigh Station" : "Set as active rig"}
            </button>
          )}
        </div>
      ))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md bg-[#161920] border-slate-800 text-slate-100 max-h-[85vh] overflow-y-auto no-scrollbar">
          <DialogHeader><DialogTitle className="font-display text-2xl">{editId ? "Edit Rig" : "New Rig"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Rig Name" testId="rig-name-input" value={form.name} onChange={set("name")} placeholder="Big Blue" />
            <Field label="Truck (make/model)" testId="rig-truck-input" value={form.truck_make_model} onChange={set("truck_make_model")} placeholder="Ram 3500 Dually" />
            <Field label="Engine" testId="rig-engine-input" value={form.engine} onChange={set("engine")} placeholder="6.7L Cummins" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Empty Weight (lb)" type="number" value={form.empty_weight} onChange={set("empty_weight")} />
              <Field label="GVWR (lb)" type="number" value={form.gvwr} onChange={set("gvwr")} />
              <Field label="GCWR (lb)" type="number" value={form.gcwr} onChange={set("gcwr")} />
              <Field label="Front Axle (lb)" type="number" value={form.front_axle_weight} onChange={set("front_axle_weight")} />
              <Field label="Rear Axle (lb)" type="number" value={form.rear_axle_weight} onChange={set("rear_axle_weight")} />
              <Field label="Trailer Length (ft)" type="number" value={form.trailer_length} onChange={set("trailer_length")} />
            </div>
            <Field label="Trailer Type" value={form.trailer_type} onChange={set("trailer_type")} placeholder="40ft Gooseneck Flatbed" />
            <Field label="Trailer Capacity (lb)" type="number" value={form.trailer_capacity} onChange={set("trailer_capacity")} />
          </div>
          <DialogFooter>
            <button data-testid="save-rig-button" onClick={save}
              className="w-full h-13 min-h-[52px] rounded-xl bg-amber-500 text-[#0A0C0E] font-bold text-lg active:scale-95 transition-transform">
              Save Rig
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const fmt = (v) => (v || v === 0 ? Number(v).toLocaleString() : "—");

function Spec({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg bg-slate-800/40 px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-slate-500"><Icon className="w-3 h-3" />{label}</div>
      <div className="font-mono-num font-bold text-slate-100">{value}</div>
    </div>
  );
}

function Field({ label, testId, ...props }) {
  return (
    <div>
      <label className="text-xs font-mono-num uppercase tracking-widest text-slate-400">{label}</label>
      <input data-testid={testId} {...props}
        className="mt-1 w-full h-12 rounded-lg bg-slate-800/60 border border-slate-700 px-3 text-slate-100 outline-none focus:border-amber-500 transition-colors" />
    </div>
  );
}
