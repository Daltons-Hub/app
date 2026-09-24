import { useEffect, useState, useCallback } from "react";
import { api, apiError } from "../lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { Plus, Wrench, Gauge, Trash2, CheckCircle2, Pencil } from "lucide-react";
import { toast } from "sonner";

const TYPES = ["Oil Change", "DEF Fill", "Tires", "DOT Inspection", "Air Filter", "Brakes", "Other"];
const STATUS = {
  overdue: { label: "OVERDUE", cls: "bg-red-500/15 text-red-400 border-red-500/40" },
  due_soon: { label: "DUE SOON", cls: "bg-amber-500/15 text-amber-400 border-amber-500/40" },
  ok: { label: "OK", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" },
};

export default function Maintenance() {
  const [items, setItems] = useState([]);
  const [rigs, setRigs] = useState([]);
  const [open, setOpen] = useState(false);
  const [odoOpen, setOdoOpen] = useState(false);
  const [odoRig, setOdoRig] = useState(null);
  const [odoVal, setOdoVal] = useState("");
  const [form, setForm] = useState({ rig_id: "", type: "Oil Change", interval_miles: "", interval_days: "", last_done_miles: "", last_done_date: "" });

  const load = useCallback(() => {
    api.get("/maintenance").then((r) => setItems(r.data)).catch(() => {});
    api.get("/rigs").then((r) => setRigs(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setForm({ rig_id: rigs[0]?.id || "", type: "Oil Change", interval_miles: "5000", interval_days: "", last_done_miles: "", last_done_date: new Date().toISOString().slice(0, 10) });
    setOpen(true);
  };

  const save = async () => {
    if (!form.rig_id) return toast.error("Pick a rig.");
    try {
      await api.post("/maintenance", {
        rig_id: form.rig_id, type: form.type,
        interval_miles: form.interval_miles ? Number(form.interval_miles) : null,
        interval_days: form.interval_days ? Number(form.interval_days) : null,
        last_done_miles: form.last_done_miles ? Number(form.last_done_miles) : null,
        last_done_date: form.last_done_date || null,
      });
      toast.success("Service item added.");
      setOpen(false); load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const service = async (id) => {
    await api.put(`/maintenance/${id}/service`); toast.success("Marked serviced."); load();
  };
  const del = async (id) => {
    if (!window.confirm("Delete this item?")) return;
    await api.delete(`/maintenance/${id}`); load();
  };

  const openOdo = (rig) => { setOdoRig(rig); setOdoVal(rig.current_odometer || ""); setOdoOpen(true); };
  const saveOdo = async () => {
    await api.put(`/rigs/${odoRig.id}/odometer`, { current_odometer: Number(odoVal) });
    toast.success("Odometer updated."); setOdoOpen(false); load();
  };

  const odoByRig = {};
  items.forEach((it) => { odoByRig[it.rig_id] = it.current_odometer; });

  return (
    <div className="space-y-4" data-testid="maintenance-page">
      <div className="flex items-center justify-between">
        <h1 className="font-display font-black text-3xl tracking-wide">MAINTENANCE</h1>
        <button data-testid="add-maintenance-button" onClick={openNew}
          className="flex items-center gap-1 h-11 px-4 rounded-xl bg-amber-500 text-[#0A0C0E] font-bold active:scale-95 transition-transform">
          <Plus className="w-5 h-5" /> Add
        </button>
      </div>

      {/* Odometers */}
      <div className="grid gap-2">
        {rigs.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-lg bg-slate-900/40 border border-slate-800 px-3 py-2">
            <div className="flex items-center gap-2"><Gauge className="w-4 h-4 text-amber-500" /><span className="font-semibold text-sm">{r.name}</span></div>
            <button data-testid={`edit-odometer-${r.id}`} onClick={() => openOdo(r)} className="flex items-center gap-1 text-sm font-mono-num text-slate-300">
              {(r.current_odometer || 0).toLocaleString()} mi <Pencil className="w-3.5 h-3.5 text-slate-500" />
            </button>
          </div>
        ))}
      </div>

      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
          No service items yet. Add oil, DEF, tires or DOT inspection schedules.
        </div>
      )}

      {items.map((it, i) => {
        const st = STATUS[it.status] || STATUS.ok;
        return (
          <div key={it.id} data-testid={`maintenance-card-${i}`} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center"><Wrench className="w-5 h-5 text-amber-500" /></div>
                <div>
                  <div className="font-semibold">{it.type}</div>
                  <div className="text-xs text-slate-400">{it.rig_name}</div>
                  <div className="text-xs font-mono-num text-slate-500 mt-1">
                    {it.next_due_miles != null && <>Due at {Number(it.next_due_miles).toLocaleString()} mi{it.miles_remaining != null && ` (${it.miles_remaining <= 0 ? "past due" : Number(it.miles_remaining).toLocaleString() + " mi left"})`}</>}
                    {it.next_due_date && <div>Due {it.next_due_date}{it.days_remaining != null && ` (${it.days_remaining <= 0 ? "past due" : it.days_remaining + " days"})`}</div>}
                  </div>
                </div>
              </div>
              <span data-testid={`maintenance-status-${i}`} className={`shrink-0 px-2 py-1 rounded-md border text-xs font-bold ${st.cls}`}>{st.label}</span>
            </div>
            <div className="flex gap-2 mt-3">
              <button data-testid={`maintenance-service-${i}`} onClick={() => service(it.id)}
                className="flex-1 h-10 rounded-lg bg-slate-800/60 text-slate-100 font-semibold text-sm flex items-center justify-center gap-1"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Mark Serviced</button>
              <button data-testid={`maintenance-delete-${i}`} onClick={() => del(it.id)} className="w-10 rounded-lg bg-red-600/20 text-red-400 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        );
      })}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md bg-[#161920] border-slate-800 text-slate-100">
          <DialogHeader><DialogTitle className="font-display text-2xl">New Service Item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-mono-num uppercase tracking-widest text-slate-400">Rig</label>
              <Select value={form.rig_id} onValueChange={(v) => setForm({ ...form, rig_id: v })}>
                <SelectTrigger data-testid="maintenance-rig-select" className="mt-1 h-12 bg-slate-800/60 border-slate-700 text-slate-100"><SelectValue placeholder="Select rig" /></SelectTrigger>
                <SelectContent className="bg-[#161920] border-slate-700 text-slate-100">
                  {rigs.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-mono-num uppercase tracking-widest text-slate-400">Type</label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger data-testid="maintenance-type-select" className="mt-1 h-12 bg-slate-800/60 border-slate-700 text-slate-100"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#161920] border-slate-700 text-slate-100">
                  {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Every (miles)" testId="maintenance-interval-miles" type="number" value={form.interval_miles} onChange={(e) => setForm({ ...form, interval_miles: e.target.value })} placeholder="5000" />
              <Field label="Or every (days)" type="number" value={form.interval_days} onChange={(e) => setForm({ ...form, interval_days: e.target.value })} placeholder="365" />
              <Field label="Last done at (mi)" type="number" value={form.last_done_miles} onChange={(e) => setForm({ ...form, last_done_miles: e.target.value })} />
              <Field label="Last done date" type="date" value={form.last_done_date} onChange={(e) => setForm({ ...form, last_done_date: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <button data-testid="save-maintenance-button" onClick={save} className="w-full min-h-[52px] rounded-xl bg-amber-500 text-[#0A0C0E] font-bold text-lg active:scale-95 transition-transform">Save</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={odoOpen} onOpenChange={setOdoOpen}>
        <DialogContent className="max-w-xs bg-[#161920] border-slate-800 text-slate-100">
          <DialogHeader><DialogTitle className="font-display text-xl">{odoRig?.name} Odometer</DialogTitle></DialogHeader>
          <Field label="Current miles" testId="odometer-input" type="number" value={odoVal} onChange={(e) => setOdoVal(e.target.value)} />
          <DialogFooter>
            <button data-testid="save-odometer-button" onClick={saveOdo} className="w-full min-h-[52px] rounded-xl bg-amber-500 text-[#0A0C0E] font-bold text-lg">Save</button>
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
