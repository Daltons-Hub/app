import { useEffect, useState } from "react";
import { api, apiError } from "../lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { Plus, User, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";

export default function Drivers() {
  const [drivers, setDrivers] = useState([]);
  const [rigs, setRigs] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", username: "", pin: "", assigned_rig_id: "" });

  const load = () => {
    api.get("/drivers").then((r) => setDrivers(r.data)).catch(() => {});
    api.get("/rigs").then((r) => setRigs(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim() || !form.username.trim()) return toast.error("Enter a name and username.");
    if (!/^\d{4}$/.test(form.pin)) return toast.error("PIN must be 4 digits.");
    try {
      await api.post("/drivers", { ...form, assigned_rig_id: form.assigned_rig_id || null });
      toast.success("Driver added.");
      setOpen(false); setForm({ name: "", username: "", pin: "", assigned_rig_id: "" }); load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const assign = async (id, rigId) => {
    await api.put(`/drivers/${id}/assign`, { assigned_rig_id: rigId === "none" ? null : rigId });
    toast.success("Rig assigned.");
    load();
  };

  const del = async (id) => {
    if (!window.confirm("Remove this driver?")) return;
    await api.delete(`/drivers/${id}`);
    toast.success("Driver removed."); load();
  };

  const rigName = (id) => rigs.find((r) => r.id === id)?.name;

  return (
    <div className="space-y-4" data-testid="drivers-page">
      <div className="flex items-center justify-between">
        <h1 className="font-display font-black text-3xl tracking-wide">DRIVERS</h1>
        <button data-testid="add-driver-button" onClick={() => setOpen(true)}
          className="flex items-center gap-1 h-11 px-4 rounded-xl bg-amber-500 text-[#0A0C0E] font-bold active:scale-95 transition-transform">
          <Plus className="w-5 h-5" /> Add
        </button>
      </div>

      {drivers.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
          No drivers yet. Tap Add to create a driver login.
        </div>
      )}

      {drivers.map((d, i) => (
        <div key={d.id} data-testid={`driver-card-${i}`} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center"><User className="w-5 h-5 text-amber-500" /></div>
              <div>
                <div className="font-semibold">{d.name}</div>
                <div className="text-xs font-mono-num text-slate-400">@{d.username}</div>
              </div>
            </div>
            <button data-testid={`delete-driver-${i}`} onClick={() => del(d.id)} className="p-2 rounded-md text-red-400 hover:bg-slate-800"><Trash2 className="w-4 h-4" /></button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Truck className="w-4 h-4 text-slate-500" />
            <Select value={d.assigned_rig_id || "none"} onValueChange={(v) => assign(d.id, v)}>
              <SelectTrigger data-testid={`assign-rig-${i}`} className="h-11 bg-slate-800/60 border-slate-700 text-slate-100">
                <SelectValue placeholder="Assign a rig" />
              </SelectTrigger>
              <SelectContent className="bg-[#161920] border-slate-700 text-slate-100">
                <SelectItem value="none">No rig assigned</SelectItem>
                {rigs.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      ))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md bg-[#161920] border-slate-800 text-slate-100">
          <DialogHeader><DialogTitle className="font-display text-2xl">New Driver</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Full Name" testId="driver-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mike Rowe" />
            <Field label="Username" testId="driver-username-input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="mike" autoCapitalize="none" />
            <Field label="4-Digit PIN" testId="driver-pin-input" value={form.pin} maxLength={4} inputMode="numeric"
              onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })} placeholder="0000" />
          </div>
          <DialogFooter>
            <button data-testid="save-driver-button" onClick={save}
              className="w-full min-h-[52px] rounded-xl bg-amber-500 text-[#0A0C0E] font-bold text-lg active:scale-95 transition-transform">
              Create Driver
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
