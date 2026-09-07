import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import {
  Scale, DollarSign, ClipboardCheck, CheckCircle2, XCircle, AlertTriangle, ShieldCheck, Truck,
} from "lucide-react";
import { toast } from "sonner";

const CARGO_TYPES = ["General Freight", "Steel / Metal", "Machinery / Equipment", "Lumber", "Vehicles / Autos", "Pipe"];

export default function Tools() {
  const { isOwner } = useAuth();
  const [params, setParams] = useSearchParams();
  const initial = params.get("tab") || "compliance";
  const [tab, setTab] = useState(initial);

  const tabs = [
    { id: "compliance", label: "Compliance", Icon: Scale },
    ...(isOwner ? [{ id: "rate", label: "Rate", Icon: DollarSign }] : []),
    { id: "securement", label: "Securement", Icon: ClipboardCheck },
  ];

  const pick = (id) => { setTab(id); setParams({ tab: id }); };

  return (
    <div className="space-y-4" data-testid="tools-page">
      <h1 className="font-display font-black text-3xl tracking-wide">TOOLS</h1>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0,1fr))` }}>
        {tabs.map((t) => (
          <button key={t.id} data-testid={`tools-tab-${t.id}`} onClick={() => pick(t.id)}
            className={`flex items-center justify-center gap-1.5 h-12 rounded-xl font-semibold text-sm transition-colors ${
              tab === t.id ? "bg-amber-500 text-[#0A0C0E]" : "bg-slate-800/60 text-slate-300"
            }`}>
            <t.Icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === "compliance" && <Compliance />}
      {tab === "rate" && isOwner && <Rate />}
      {tab === "securement" && <Securement />}
    </div>
  );
}

function FieldWrap({ label, children }) {
  return (
    <div>
      <label className="text-xs font-mono-num uppercase tracking-widest text-slate-400">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
function NumInput(props) {
  return <input type="number" inputMode="decimal" {...props}
    className="w-full h-12 rounded-lg bg-slate-800/60 border border-slate-700 px-3 text-slate-100 outline-none focus:border-amber-500 transition-colors" />;
}
function RunBtn({ onClick, children, testId }) {
  return <button data-testid={testId} onClick={onClick}
    className="w-full min-h-[52px] rounded-xl bg-amber-500 text-[#0A0C0E] font-bold text-lg active:scale-95 transition-transform">{children}</button>;
}

/* ---------- Compliance ---------- */
function Compliance() {
  const [rigs, setRigs] = useState([]);
  const [rigId, setRigId] = useState("");
  const [cargo, setCargo] = useState("");
  const [res, setRes] = useState(null);

  useEffect(() => {
    Promise.all([api.get("/rigs"), api.get("/auth/me")]).then(([rr, me]) => {
      setRigs(rr.data);
      const pref = me.data.active_rig_id || me.data.assigned_rig_id;
      const found = rr.data.find((x) => x.id === pref);
      setRigId(found ? found.id : (rr.data[0]?.id || ""));
    }).catch(() => {});
  }, []);

  const run = async () => {
    if (!rigId) return toast.error("Pick a rig first.");
    if (!cargo) return toast.error("Enter the cargo weight.");
    try {
      const { data } = await api.post("/compliance", { rig_id: rigId, cargo_weight: Number(cargo) });
      setRes(data);
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">Enter your load and we'll tell you exactly what licensing and paperwork this haul needs.</p>
      <FieldWrap label="Rig">
        <Select value={rigId} onValueChange={setRigId}>
          <SelectTrigger data-testid="compliance-rig-select" className="h-12 bg-slate-800/60 border-slate-700 text-slate-100"><SelectValue placeholder="Select rig" /></SelectTrigger>
          <SelectContent className="bg-[#161920] border-slate-700 text-slate-100">
            {rigs.map((r) => <SelectItem key={r.id} value={r.id}>{r.name} — {r.truck_make_model}</SelectItem>)}
          </SelectContent>
        </Select>
      </FieldWrap>
      <FieldWrap label="Cargo Weight (lb)"><NumInput data-testid="compliance-cargo-input" value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="12000" /></FieldWrap>
      <RunBtn onClick={run} testId="compliance-run-button">Check Compliance</RunBtn>

      {res && (
        <div className="space-y-3" data-testid="compliance-result">
          <div className={`rounded-xl border p-4 ${res.cdl_required ? "border-amber-500/50 bg-amber-500/10" : res.is_cmv ? "border-sky-500/50 bg-sky-500/10" : "border-emerald-500/50 bg-emerald-500/10"}`}>
            <div className="font-display font-black text-2xl">{res.tier}</div>
            <div className="text-slate-300 text-sm mt-1">{res.summary}</div>
            <div className="text-xs font-mono-num text-slate-400 mt-2">Determining weight: {Number(res.determining_weight).toLocaleString()} lb</div>
          </div>

          {res.warnings.map((w, i) => (
            <div key={i} data-testid={`compliance-warning-${i}`} className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-red-300 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {w}
            </div>
          ))}

          <div className="space-y-2">
            {res.requirements.map((req) => (
              <div key={req.key} data-testid={`compliance-req-${req.key}`} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                {req.required ? <CheckCircle2 className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" /> : <XCircle className="w-5 h-5 text-slate-600 mt-0.5 shrink-0" />}
                <div>
                  <div className={`font-semibold ${req.required ? "text-slate-100" : "text-slate-500"}`}>
                    {req.label} {req.required ? "— REQUIRED" : "— not required"}
                  </div>
                  <div className="text-slate-400 text-xs mt-0.5">{req.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Rate ---------- */
function Rate() {
  const [f, setF] = useState({ distance_miles: "", cargo_weight: "", fuel_price: "4.00", mpg: "10", quoted_rate: "" });
  const [res, setRes] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const run = async () => {
    if (!f.distance_miles || !f.fuel_price) return toast.error("Enter distance and fuel price.");
    try {
      const { data } = await api.post("/rate", {
        distance_miles: Number(f.distance_miles), cargo_weight: f.cargo_weight ? Number(f.cargo_weight) : null,
        fuel_price: Number(f.fuel_price), mpg: Number(f.mpg) || 10,
        quoted_rate: f.quoted_rate ? Number(f.quoted_rate) : null,
      });
      setRes(data);
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">See your real cost to run a load and whether the quoted rate leaves a profit.</p>
      <div className="grid grid-cols-2 gap-3">
        <FieldWrap label="Distance (mi)"><NumInput data-testid="rate-distance-input" value={f.distance_miles} onChange={set("distance_miles")} placeholder="450" /></FieldWrap>
        <FieldWrap label="Cargo (lb)"><NumInput value={f.cargo_weight} onChange={set("cargo_weight")} placeholder="12000" /></FieldWrap>
        <FieldWrap label="Fuel $/gal"><NumInput data-testid="rate-fuel-input" value={f.fuel_price} onChange={set("fuel_price")} /></FieldWrap>
        <FieldWrap label="MPG"><NumInput value={f.mpg} onChange={set("mpg")} /></FieldWrap>
      </div>
      <FieldWrap label="Quoted Rate ($ total, optional)"><NumInput data-testid="rate-quote-input" value={f.quoted_rate} onChange={set("quoted_rate")} placeholder="1350" /></FieldWrap>
      <RunBtn onClick={run} testId="rate-run-button">Calculate</RunBtn>

      {res && (
        <div className="space-y-3" data-testid="rate-result">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Fuel" value={`$${res.fuel_cost}`} sub={`${res.gallons} gal`} />
            <Metric label="DEF" value={`$${res.def_cost}`} />
            <Metric label="Wear & Tear" value={`$${res.wear_cost}`} />
            <Metric label="Cost / Mile" value={`$${res.cost_per_mile}`} />
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex justify-between"><span className="text-slate-400">Total cost to run</span><span className="font-mono-num font-bold text-xl">${res.total_cost}</span></div>
          </div>
          {res.quoted_rate != null && (
            <div className={`rounded-xl border p-4 ${res.profit >= 0 ? "border-emerald-500/50 bg-emerald-500/10" : "border-red-500/50 bg-red-500/10"}`} data-testid="rate-margin">
              <div className="flex justify-between text-sm"><span className="text-slate-300">Quoted</span><span className="font-mono-num">${res.quoted_rate} ( ${res.rate_per_mile}/mi )</span></div>
              <div className="flex justify-between items-center mt-2">
                <span className="font-display font-bold text-lg">{res.profit >= 0 ? "PROFIT" : "LOSS"}</span>
                <span className={`font-mono-num font-black text-2xl ${res.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>${res.profit} · {res.margin_pct}%</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function Metric({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="font-mono-num font-bold text-xl">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

/* ---------- Securement ---------- */
function Securement() {
  const [f, setF] = useState({ cargo_weight: "", cargo_type: "General Freight", length_ft: "" });
  const [res, setRes] = useState(null);
  const [checked, setChecked] = useState({});

  const run = async () => {
    if (!f.cargo_weight) return toast.error("Enter the cargo weight.");
    try {
      const { data } = await api.post("/securement", {
        cargo_weight: Number(f.cargo_weight), cargo_type: f.cargo_type,
        length_ft: f.length_ft ? Number(f.length_ft) : null,
      });
      setRes(data); setChecked({});
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">Auto-build a tie-down plan and pre-trip securement checklist for your load.</p>
      <FieldWrap label="Cargo Weight (lb)"><NumInput data-testid="securement-weight-input" value={f.cargo_weight} onChange={(e) => setF({ ...f, cargo_weight: e.target.value })} placeholder="9000" /></FieldWrap>
      <FieldWrap label="Cargo Type">
        <Select value={f.cargo_type} onValueChange={(v) => setF({ ...f, cargo_type: v })}>
          <SelectTrigger data-testid="securement-type-select" className="h-12 bg-slate-800/60 border-slate-700 text-slate-100"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#161920] border-slate-700 text-slate-100">
            {CARGO_TYPES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </FieldWrap>
      <FieldWrap label="Longest Piece (ft, optional)"><NumInput value={f.length_ft} onChange={(e) => setF({ ...f, length_ft: e.target.value })} placeholder="20" /></FieldWrap>
      <RunBtn onClick={run} testId="securement-run-button">Build Checklist</RunBtn>

      {res && (
        <div className="space-y-3" data-testid="securement-result">
          <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
            <div className="flex items-center gap-2 text-amber-400 font-display font-bold text-xl"><ShieldCheck className="w-6 h-6" /> {res.count} × {res.device}</div>
            <div className="text-slate-300 text-sm mt-2">{res.note}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 divide-y divide-slate-800">
            {res.checklist.map((item, i) => (
              <button key={i} data-testid={`securement-item-${i}`} onClick={() => setChecked({ ...checked, [i]: !checked[i] })}
                className="w-full flex items-start gap-3 p-3 text-left">
                <span className={`mt-0.5 w-6 h-6 rounded-md border flex items-center justify-center shrink-0 ${checked[i] ? "bg-amber-500 border-amber-500" : "border-slate-600"}`}>
                  {checked[i] && <CheckCircle2 className="w-4 h-4 text-[#0A0C0E]" />}
                </span>
                <span className={`text-sm ${checked[i] ? "text-slate-500 line-through" : "text-slate-200"}`}>{item}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
