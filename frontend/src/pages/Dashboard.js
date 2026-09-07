import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Truck, FolderLock, ScanLine, ArrowRight, CheckCircle2, AlertTriangle, XCircle, Info, Route, Scale, DollarSign, ClipboardCheck, Users, Sparkles } from "lucide-react";

const LEVELS = {
  good: { cls: "border-emerald-500/50 bg-emerald-500/10", Icon: CheckCircle2, color: "text-emerald-400" },
  expiring: { cls: "border-amber-500/50 bg-amber-500/10", Icon: AlertTriangle, color: "text-amber-400" },
  expired: { cls: "border-red-500/50 bg-red-500/10", Icon: XCircle, color: "text-red-400" },
  info: { cls: "border-sky-500/50 bg-sky-500/10", Icon: Info, color: "text-sky-400" },
};

export default function Dashboard() {
  const nav = useNavigate();
  const { user, isOwner } = useAuth();
  const [data, setData] = useState(null);
  const [trip, setTrip] = useState(null);

  useEffect(() => {
    api.get("/dashboard").then((r) => setData(r.data)).catch(() => {});
    api.get("/trips/active").then((r) => setTrip(r.data?.id ? r.data : null)).catch(() => {});
  }, []);

  if (!data) return <div className="text-slate-500 py-20 text-center">Loading…</div>;

  const step = data.next_step;
  const lv = LEVELS[step.level] || LEVELS.info;
  const StepIcon = lv.Icon;
  const routes = { documents: "/documents", rigs: "/rigs", weigh: "/weigh-station" };

  return (
    <div className="space-y-5" data-testid="dashboard">
      <div>
        <h1 className="font-display font-black text-3xl tracking-wide">
          {hour()}, {user?.name?.split(" ")[0]}
        </h1>
        <p className="text-slate-400 text-sm">Here's your next step.</p>
      </div>

      {/* Next step card */}
      <button
        data-testid="next-step-card"
        onClick={() => nav(routes[step.action] || "/")}
        className={`w-full text-left rounded-xl border p-5 ${lv.cls} active:scale-[0.99] transition-transform`}
      >
        <div className="flex items-start gap-3">
          <StepIcon className={`w-7 h-7 shrink-0 ${lv.color}`} />
          <div className="flex-1">
            <div className="font-display font-bold text-xl leading-tight">{step.title}</div>
            <div className="text-slate-300 text-sm mt-1">{step.detail}</div>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-400 mt-1" />
        </div>
      </button>

      {/* Big weigh station */}
      <button
        data-testid="dashboard-weigh-station"
        onClick={() => nav("/weigh-station")}
        className="w-full rounded-xl bg-amber-500 text-[#0A0C0E] p-5 flex items-center gap-4 active:scale-[0.99] transition-transform"
      >
        <ScanLine className="w-10 h-10" />
        <div className="text-left">
          <div className="font-display font-black text-2xl tracking-wide">WEIGH STATION MODE</div>
          <div className="text-sm font-semibold opacity-80">One tap to show all your paperwork</div>
        </div>
      </button>

      {trip && (
        <button data-testid="dashboard-active-trip" onClick={() => nav("/trip")}
          className="w-full rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 flex items-center gap-3 active:scale-[0.99] transition-transform">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <div className="text-left flex-1">
            <div className="font-display font-bold text-lg leading-tight">Trip in progress</div>
            <div className="text-slate-300 text-sm">{trip.rig_name || "Active trip"} · tap to manage</div>
          </div>
          <Route className="w-5 h-5 text-emerald-400" />
        </button>
      )}

      {/* Tools quick actions */}
      <button data-testid="dashboard-assistant" onClick={() => nav("/assistant")}
        className="w-full rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 flex items-center gap-3 active:scale-[0.99] transition-transform">
        <Sparkles className="w-6 h-6 text-amber-500" />
        <div className="text-left flex-1">
          <div className="font-display font-bold text-lg leading-tight">Ask the Assistant</div>
          <div className="text-slate-400 text-sm">Questions about your rig, paperwork or loads</div>
        </div>
        <ArrowRight className="w-5 h-5 text-slate-400" />
      </button>

      <div>
        <div className="text-xs font-mono-num uppercase tracking-widest text-slate-400 mb-2">Quick tools</div>
        <div className="grid grid-cols-3 gap-3">
          <QuickTool icon={Scale} label="Compliance" onClick={() => nav("/tools?tab=compliance")} testId="quick-compliance" />
          {isOwner
            ? <QuickTool icon={DollarSign} label="Rate" onClick={() => nav("/tools?tab=rate")} testId="quick-rate" />
            : <QuickTool icon={Route} label="Trip" onClick={() => nav("/trip")} testId="quick-trip" />}
          <QuickTool icon={ClipboardCheck} label="Securement" onClick={() => nav("/tools?tab=securement")} testId="quick-securement" />
        </div>
      </div>

      {isOwner && (
        <button data-testid="manage-drivers-card" onClick={() => nav("/drivers")}
          className="w-full rounded-xl border border-slate-800 bg-slate-900/40 p-4 flex items-center gap-3 active:bg-slate-800/60 transition-colors">
          <Users className="w-6 h-6 text-amber-500" />
          <div className="text-left flex-1">
            <div className="font-semibold">Manage Drivers</div>
            <div className="text-slate-400 text-sm">{data.driver_count} driver(s) · assign rigs</div>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-400" />
        </button>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3">
        <Stat icon={Truck} label={isOwner ? "Rigs" : "My Rig"} value={data.rig_count} onClick={() => nav("/rigs")} testId="stat-rigs" />
        <Stat icon={FolderLock} label="Documents" value={data.doc_count} onClick={() => nav("/documents")} testId="stat-documents" />
      </div>

      {(data.expired_count > 0 || data.expiring_count > 0) && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-2" data-testid="alerts-summary">
          <div className="text-xs font-mono-num uppercase tracking-widest text-slate-400">Paperwork alerts</div>
          {data.expired_count > 0 && (
            <div className="flex items-center gap-2 text-red-400 text-sm font-semibold">
              <XCircle className="w-4 h-4" /> {data.expired_count} expired
            </div>
          )}
          {data.expiring_count > 0 && (
            <div className="flex items-center gap-2 text-amber-400 text-sm font-semibold">
              <AlertTriangle className="w-4 h-4" /> {data.expiring_count} expiring within 30 days
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, onClick, testId }) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-left active:bg-slate-800/60 transition-colors"
    >
      <Icon className="w-5 h-5 text-amber-500 mb-2" />
      <div className="font-display font-black text-3xl leading-none">{value}</div>
      <div className="text-xs text-slate-400 mt-1 uppercase tracking-wide">{label}</div>
    </button>
  );
}

function QuickTool({ icon: Icon, label, onClick, testId }) {
  return (
    <button data-testid={testId} onClick={onClick}
      className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 flex flex-col items-center gap-1.5 active:bg-slate-800/60 transition-colors">
      <Icon className="w-6 h-6 text-amber-500" />
      <span className="text-xs font-semibold text-slate-200">{label}</span>
    </button>
  );
}

function hour() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
