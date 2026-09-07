import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { X, ShieldCheck, ShieldAlert, ShieldX, Truck } from "lucide-react";

const STATUS_STYLE = {
  active: { bg: "bg-emerald-500", text: "text-emerald-950", label: "CLEAR", Icon: ShieldCheck },
  expiring: { bg: "bg-amber-500", text: "text-amber-950", label: "EXPIRING", Icon: ShieldAlert },
  expired: { bg: "bg-red-600", text: "text-red-50", label: "EXPIRED", Icon: ShieldX },
  missing: { bg: "bg-slate-600", text: "text-slate-100", label: "MISSING", Icon: ShieldX },
};

export default function WeighStation() {
  const nav = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => { api.get("/weigh-station").then((r) => setData(r.data)).catch(() => {}); }, []);

  if (!data) return <div className="min-h-screen bg-black flex items-center justify-center text-slate-500">Loading…</div>;

  const allClear = ["dot", "mc", "insurance", "ifta"].every((k) => data[k].status === "active");

  return (
    <div className="fixed inset-0 z-50 bg-black overflow-y-auto no-scrollbar" data-testid="weigh-station-mode">
      <div className="max-w-md mx-auto min-h-screen flex flex-col px-5 py-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-amber-500 flex items-center justify-center"><Truck className="w-5 h-5 text-black" /></div>
            <span className="font-display font-black text-xl tracking-wide text-white">WEIGH STATION</span>
          </div>
          <button data-testid="weigh-station-close" onClick={() => nav(-1)}
            className="w-11 h-11 rounded-full bg-slate-800 flex items-center justify-center text-white active:scale-95 transition-transform">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className={`rounded-2xl p-5 mb-4 text-center ${allClear ? "bg-emerald-500" : "bg-red-600"}`}>
          <div className="font-display font-black text-4xl tracking-wide text-white">{allClear ? "GOOD TO GO" : "CHECK PAPERWORK"}</div>
          <div className="text-white/80 text-sm font-semibold mt-1">{allClear ? "All credentials current" : "One or more items need attention"}</div>
        </div>

        <BigCred label="USDOT #" value={data.dot.number} status={data.dot.status} testId="weigh-station-dot-number" />
        <BigCred label="MC #" value={data.mc.number} status={data.mc.status} testId="weigh-station-mc-number" />
        <BigCred label="Insurance" value={statusWord(data.insurance)} status={data.insurance.status} testId="weigh-station-insurance" />
        <BigCred label="IFTA" value={statusWord(data.ifta)} status={data.ifta.status} testId="weigh-station-ifta" />

        {data.rig && (
          <div className="rounded-2xl bg-slate-900 border border-slate-700 p-4 mt-2" data-testid="weigh-station-rig">
            <div className="text-xs font-mono-num uppercase tracking-widest text-amber-500 mb-1">Rig</div>
            <div className="font-display font-bold text-2xl text-white">{data.rig.truck_make_model}</div>
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              <RigNum label="GVWR" value={data.rig.gvwr} />
              <RigNum label="GCWR" value={data.rig.gcwr} />
              <RigNum label="Rear Axle" value={data.rig.rear_axle_weight} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function statusWord(s) {
  if (!s.present) return "NOT ON FILE";
  return { active: "VALID", expiring: "VALID", expired: "EXPIRED", missing: "NOT ON FILE" }[s.status];
}

function BigCred({ label, value, status, testId }) {
  const st = STATUS_STYLE[status] || STATUS_STYLE.missing;
  const { Icon } = st;
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-700 p-4 mb-3 flex items-center justify-between">
      <div className="min-w-0">
        <div className="text-xs font-mono-num uppercase tracking-widest text-slate-400">{label}</div>
        <div data-testid={testId} className="font-mono-num font-black text-3xl text-white truncate">{value || "—"}</div>
      </div>
      <div className={`flex items-center gap-1.5 px-3 h-10 rounded-xl font-bold ${st.bg} ${st.text}`}>
        <Icon className="w-5 h-5" /> {st.label}
      </div>
    </div>
  );
}

function RigNum({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-800 py-2">
      <div className="text-[10px] uppercase tracking-widest text-slate-400">{label}</div>
      <div className="font-mono-num font-bold text-white">{value ? Number(value).toLocaleString() : "—"}</div>
    </div>
  );
}
