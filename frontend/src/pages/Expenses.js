import { useEffect, useState } from "react";
import { api, apiError } from "../lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { Plus, Fuel, CircleDollarSign, Wrench, Trash2, Droplet, MoreHorizontal, MapPinned } from "lucide-react";
import { toast } from "sonner";

const CATS = [
  { id: "Fuel", Icon: Fuel },
  { id: "Toll", Icon: CircleDollarSign },
  { id: "Repair", Icon: Wrench },
  { id: "DEF", Icon: Droplet },
  { id: "Other", Icon: MoreHorizontal },
];
const CAT_ICON = Object.fromEntries(CATS.map((c) => [c.id, c.Icon]));
const STATES = ["AL","AR","AZ","CA","CO","CT","FL","GA","IA","ID","IL","IN","KS","KY","LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WV","WY"];

export default function Expenses() {
  const [tab, setTab] = useState("expenses");
  const [items, setItems] = useState([]);
  const [ifta, setIfta] = useState(null);
  const [rigs, setRigs] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: "Fuel", amount: "", gallons: "", state: "TX", rig_id: "", vendor: "", date: "", notes: "" });

  const load = () => {
    api.get("/expenses").then((r) => setItems(r.data)).catch(() => {});
    api.get("/ifta-report").then((r) => setIfta(r.data)).catch(() => {});
    api.get("/rigs").then((r) => setRigs(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setForm({ category: "Fuel", amount: "", gallons: "", state: "TX", rig_id: rigs[0]?.id || "", vendor: "", date: new Date().toISOString().slice(0, 10), notes: "" });
    setOpen(true);
  };

  const save = async () => {
    if (!form.amount) return toast.error("Enter an amount.");
    try {
      await api.post("/expenses", {
        category: form.category, amount: Number(form.amount),
        gallons: form.category === "Fuel" && form.gallons ? Number(form.gallons) : null,
        state: form.category === "Fuel" ? form.state : null,
        rig_id: form.rig_id || null, vendor: form.vendor || null, date: form.date || null, notes: form.notes || null,
      });
      toast.success("Expense logged.");
      setOpen(false); load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const del = async (id) => { await api.delete(`/expenses/${id}`); load(); };

  const total = items.reduce((s, x) => s + (x.amount || 0), 0);
  const byCat = {};
  items.forEach((x) => { byCat[x.category] = (byCat[x.category] || 0) + (x.amount || 0); });

  return (
    <div className="space-y-4" data-testid="expenses-page">
      <div className="flex items-center justify-between">
        <h1 className="font-display font-black text-3xl tracking-wide">EXPENSES</h1>
        {tab === "expenses" && (
          <button data-testid="add-expense-button" onClick={openNew}
            className="flex items-center gap-1 h-11 px-4 rounded-xl bg-amber-500 text-[#0A0C0E] font-bold active:scale-95 transition-transform">
            <Plus className="w-5 h-5" /> Add
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button data-testid="tab-expenses" onClick={() => setTab("expenses")} className={`h-11 rounded-xl font-semibold text-sm ${tab === "expenses" ? "bg-amber-500 text-[#0A0C0E]" : "bg-slate-800/60 text-slate-300"}`}>Expenses</button>
        <button data-testid="tab-ifta" onClick={() => setTab("ifta")} className={`h-11 rounded-xl font-semibold text-sm ${tab === "ifta" ? "bg-amber-500 text-[#0A0C0E]" : "bg-slate-800/60 text-slate-300"}`}>IFTA Report</button>
      </div>

      {tab === "expenses" && (
        <>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex justify-between items-center"><span className="text-slate-400 text-sm">Total logged</span><span className="font-mono-num font-black text-2xl text-amber-500">${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
            <div className="flex flex-wrap gap-2 mt-3">
              {Object.entries(byCat).map(([c, v]) => (
                <span key={c} className="text-xs font-mono-num px-2 py-1 rounded bg-slate-800">{c}: ${v.toLocaleString()}</span>
              ))}
            </div>
          </div>

          {items.length === 0 && <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400">No expenses yet.</div>}

          {items.map((x, i) => {
            const Icon = CAT_ICON[x.category] || MoreHorizontal;
            return (
              <div key={x.id} data-testid={`expense-card-${i}`} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center"><Icon className="w-5 h-5 text-amber-500" /></div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{x.category}{x.vendor ? ` · ${x.vendor}` : ""}</div>
                  <div className="text-xs text-slate-500">{x.date}{x.state ? ` · ${x.state}` : ""}{x.gallons ? ` · ${x.gallons} gal` : ""}</div>
                </div>
                <div className="font-mono-num font-bold">${Number(x.amount).toLocaleString()}</div>
                <button data-testid={`expense-delete-${i}`} onClick={() => del(x.id)} className="p-2 text-red-400"><Trash2 className="w-4 h-4" /></button>
              </div>
            );
          })}
        </>
      )}

      {tab === "ifta" && ifta && (
        <div className="space-y-3" data-testid="ifta-report">
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Total Miles" value={Number(ifta.total_miles).toLocaleString()} />
            <Metric label="Gallons" value={Number(ifta.total_gallons).toLocaleString()} />
            <Metric label="Fleet MPG" value={ifta.avg_mpg ?? "—"} />
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
            <div className="grid grid-cols-4 px-3 py-2 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
              <span>State</span><span className="text-right">Miles</span><span className="text-right">Gallons</span><span className="text-right">Fuel $</span>
            </div>
            {ifta.rows.length === 0 && <div className="p-4 text-center text-slate-500 text-sm">Log trips (mileage by state) and fuel purchases to build your IFTA report.</div>}
            {ifta.rows.map((r) => (
              <div key={r.state} data-testid={`ifta-row-${r.state}`} className="grid grid-cols-4 px-3 py-2.5 text-sm border-b border-slate-800/60 last:border-0">
                <span className="font-mono-num font-bold text-amber-500 flex items-center gap-1"><MapPinned className="w-3.5 h-3.5" />{r.state}</span>
                <span className="text-right font-mono-num">{r.miles.toLocaleString()}</span>
                <span className="text-right font-mono-num">{r.gallons.toLocaleString()}</span>
                <span className="text-right font-mono-num text-slate-400">${r.fuel_cost.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">Miles come from your completed trips; gallons from fuel expenses tagged by state.</p>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md bg-[#161920] border-slate-800 text-slate-100">
          <DialogHeader><DialogTitle className="font-display text-2xl">Log Expense</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-mono-num uppercase tracking-widest text-slate-400">Category</label>
              <div className="grid grid-cols-5 gap-2 mt-1">
                {CATS.map((c) => (
                  <button key={c.id} data-testid={`expense-cat-${c.id}`} onClick={() => setForm({ ...form, category: c.id })}
                    className={`h-14 rounded-lg flex flex-col items-center justify-center gap-1 text-[10px] font-semibold ${form.category === c.id ? "bg-amber-500 text-[#0A0C0E]" : "bg-slate-800/60 text-slate-300"}`}>
                    <c.Icon className="w-4 h-4" />{c.id}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount ($)" testId="expense-amount-input" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="285.40" />
              <Field label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            {form.category === "Fuel" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Gallons" testId="expense-gallons-input" type="number" value={form.gallons} onChange={(e) => setForm({ ...form, gallons: e.target.value })} placeholder="62" />
                <div>
                  <label className="text-xs font-mono-num uppercase tracking-widest text-slate-400">State (IFTA)</label>
                  <Select value={form.state} onValueChange={(v) => setForm({ ...form, state: v })}>
                    <SelectTrigger data-testid="expense-state-select" className="mt-1 h-12 bg-slate-800/60 border-slate-700 text-slate-100"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#161920] border-slate-700 text-slate-100 max-h-60">
                      {STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <Field label="Vendor (optional)" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="Love's Travel Stop" />
          </div>
          <DialogFooter>
            <button data-testid="save-expense-button" onClick={save} className="w-full min-h-[52px] rounded-xl bg-amber-500 text-[#0A0C0E] font-bold text-lg active:scale-95 transition-transform">Save Expense</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-center">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="font-mono-num font-bold text-lg">{value}</div>
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
