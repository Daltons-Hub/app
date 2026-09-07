import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { FileSignature, Wrench, Receipt, ArrowRight, AlertTriangle } from "lucide-react";

export default function Office() {
  const nav = useNavigate();
  const [s, setS] = useState(null);

  useEffect(() => { api.get("/office/summary").then((r) => setS(r.data)).catch(() => {}); }, []);

  return (
    <div className="space-y-4" data-testid="office-page">
      <div>
        <h1 className="font-display font-black text-3xl tracking-wide">BACK OFFICE</h1>
        <p className="text-slate-400 text-sm">Deliveries, maintenance and money — all in one place.</p>
      </div>

      <Card testId="office-deliveries" icon={FileSignature} title="Deliveries & Invoices"
        sub={s ? `${s.deliveries_count} delivered · ${s.unpaid_count} unpaid ($${(s.unpaid_total || 0).toLocaleString()})` : ""}
        onClick={() => nav("/deliveries")} />

      <Card testId="office-maintenance" icon={Wrench} title="Maintenance Tracker"
        sub={s ? (s.maintenance_due > 0 ? `${s.maintenance_due} service item(s) due` : "All trucks up to date") : ""}
        warn={s?.maintenance_due > 0}
        onClick={() => nav("/maintenance")} />

      <Card testId="office-expenses" icon={Receipt} title="Expenses & IFTA"
        sub={s ? `$${(s.expense_total || 0).toLocaleString()} logged` : ""}
        onClick={() => nav("/expenses")} />
    </div>
  );
}

function Card({ icon: Icon, title, sub, onClick, testId, warn }) {
  return (
    <button data-testid={testId} onClick={onClick}
      className="w-full rounded-xl border border-slate-800 bg-slate-900/40 p-5 flex items-center gap-4 active:bg-slate-800/60 transition-colors">
      <div className="w-12 h-12 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
        <Icon className="w-6 h-6 text-amber-500" />
      </div>
      <div className="text-left flex-1 min-w-0">
        <div className="font-display font-bold text-xl">{title}</div>
        <div className={`text-sm flex items-center gap-1 ${warn ? "text-amber-400 font-semibold" : "text-slate-400"}`}>
          {warn && <AlertTriangle className="w-4 h-4" />}{sub}
        </div>
      </div>
      <ArrowRight className="w-5 h-5 text-slate-400 shrink-0" />
    </button>
  );
}
