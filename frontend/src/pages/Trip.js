import { useEffect, useState, useCallback, useMemo } from "react";
import { api, apiError } from "../lib/api";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { Play, Square, MapPin, Gauge, Route as RouteIcon, Clock } from "lucide-react";
import { toast } from "sonner";

const DUTY = [
  { id: "off_duty", label: "Off Duty" },
  { id: "sleeper", label: "Sleeper" },
  { id: "driving", label: "Driving" },
  { id: "on_duty", label: "On Duty" },
];
const STATES = ["AL","AR","AZ","CA","CO","CT","FL","GA","IA","ID","IL","IN","KS","KY","LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WV","WY"];

export default function Trip() {
  const [trip, setTrip] = useState(null);
  const [history, setHistory] = useState([]);
  const [rigs, setRigs] = useState([]);
  const [startForm, setStartForm] = useState({ rig_id: "", start_odometer: "", origin: "" });
  const [smForm, setSmForm] = useState({ state: "TX", miles: "" });
  const [endOdo, setEndOdo] = useState("");

  const load = useCallback(() => {
    api.get("/trips/active").then((r) => setTrip(r.data?.id ? r.data : null)).catch(() => {});
    api.get("/trips").then((r) => setHistory(r.data)).catch(() => {});
    Promise.all([api.get("/rigs"), api.get("/auth/me")]).then(([rr, me]) => {
      setRigs(rr.data);
      const pref = me.data.active_rig_id || me.data.assigned_rig_id;
      const found = rr.data.find((x) => x.id === pref);
      setStartForm((s) => ({ ...s, rig_id: found ? found.id : (rr.data[0]?.id || "") }));
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const completedTrips = useMemo(() => history.filter((t) => t.status === "completed"), [history]);

  const start = async () => {
    try {
      await api.post("/trips/start", {
        rig_id: startForm.rig_id || null,
        start_odometer: startForm.start_odometer ? Number(startForm.start_odometer) : null,
        origin: startForm.origin || null,
      });
      toast.success("Trip started. Drive safe.");
      load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const setDuty = async (status) => {
    const { data } = await api.post(`/trips/${trip.id}/duty`, { duty_status: status });
    setTrip(data);
  };

  const addMiles = async () => {
    if (!smForm.miles) return toast.error("Enter miles.");
    const { data } = await api.post(`/trips/${trip.id}/state-miles`, { state: smForm.state, miles: Number(smForm.miles) });
    setTrip(data); setSmForm({ ...smForm, miles: "" });
    toast.success("Mileage logged.");
  };

  const stop = async () => {
    try {
      await api.post(`/trips/${trip.id}/stop`, { end_odometer: endOdo ? Number(endOdo) : null });
      toast.success("Trip completed.");
      setEndOdo(""); load();
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="space-y-4" data-testid="trip-page">
      <h1 className="font-display font-black text-3xl tracking-wide">TRIP</h1>

      {!trip ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3" data-testid="trip-start-card">
          <div className="font-display font-bold text-xl">Start a new trip</div>
          <div>
            <label className="text-xs font-mono-num uppercase tracking-widest text-slate-400">Rig</label>
            <Select value={startForm.rig_id} onValueChange={(v) => setStartForm({ ...startForm, rig_id: v })}>
              <SelectTrigger data-testid="trip-rig-select" className="mt-1 h-12 bg-slate-800/60 border-slate-700 text-slate-100"><SelectValue placeholder="Select rig" /></SelectTrigger>
              <SelectContent className="bg-[#161920] border-slate-700 text-slate-100">
                {rigs.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <TripField label="Start Odometer" testId="trip-start-odo" type="number" value={startForm.start_odometer} onChange={(e) => setStartForm({ ...startForm, start_odometer: e.target.value })} placeholder="152300" />
          <TripField label="Origin (optional)" value={startForm.origin} onChange={(e) => setStartForm({ ...startForm, origin: e.target.value })} placeholder="Houston, TX" />
          <button data-testid="trip-start-button" onClick={start}
            className="w-full min-h-[52px] rounded-xl bg-amber-500 text-[#0A0C0E] font-bold text-lg flex items-center justify-center gap-2 active:scale-95 transition-transform">
            <Play className="w-5 h-5" /> Start Trip
          </button>
        </div>
      ) : (
        <div className="space-y-4" data-testid="trip-active-card">
          <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono-num uppercase tracking-widest">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Trip in progress
            </div>
            <div className="font-display font-bold text-2xl mt-1">{trip.rig_name || "Trip"}</div>
            {trip.origin && <div className="text-slate-400 text-sm flex items-center gap-1"><MapPin className="w-4 h-4" /> from {trip.origin}</div>}
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1"><Clock className="w-3 h-3" /> Started {fmtTime(trip.start_time)}</div>
          </div>

          <div>
            <div className="text-xs font-mono-num uppercase tracking-widest text-slate-400 mb-2">Duty Status</div>
            <div className="grid grid-cols-2 gap-2">
              {DUTY.map((dd) => (
                <button key={dd.id} data-testid={`trip-duty-${dd.id}`} onClick={() => setDuty(dd.id)}
                  className={`h-12 rounded-lg font-semibold text-sm transition-colors ${trip.duty_status === dd.id ? "bg-amber-500 text-[#0A0C0E]" : "bg-slate-800/60 text-slate-300"}`}>
                  {dd.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-xs font-mono-num uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><RouteIcon className="w-4 h-4" /> Mileage by State</div>
            <div className="flex gap-2">
              <Select value={smForm.state} onValueChange={(v) => setSmForm({ ...smForm, state: v })}>
                <SelectTrigger data-testid="trip-state-select" className="w-24 h-12 bg-slate-800/60 border-slate-700 text-slate-100"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#161920] border-slate-700 text-slate-100 max-h-60">
                  {STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <input data-testid="trip-miles-input" type="number" inputMode="decimal" value={smForm.miles} onChange={(e) => setSmForm({ ...smForm, miles: e.target.value })} placeholder="miles"
                className="flex-1 h-12 rounded-lg bg-slate-800/60 border border-slate-700 px-3 text-slate-100 outline-none focus:border-amber-500" />
              <button data-testid="trip-add-miles" onClick={addMiles} className="px-4 h-12 rounded-lg bg-slate-700 text-slate-100 font-semibold">Add</button>
            </div>
            {trip.state_miles?.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {trip.state_miles.map((e) => (
                  <span key={e.state} className="px-2.5 py-1 rounded-md bg-slate-800 text-sm font-mono-num">{e.state}: {e.miles}</span>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
            <TripField label="End Odometer" testId="trip-end-odo" type="number" value={endOdo} onChange={(e) => setEndOdo(e.target.value)} placeholder="152750" icon={Gauge} />
            <button data-testid="trip-stop-button" onClick={stop}
              className="w-full min-h-[52px] rounded-xl bg-red-600 text-white font-bold text-lg flex items-center justify-center gap-2 active:scale-95 transition-transform">
              <Square className="w-5 h-5" /> End Trip
            </button>
          </div>
        </div>
      )}

      <div className="pt-2">
        <div className="text-xs font-mono-num uppercase tracking-widest text-slate-400 mb-2">Recent Trips</div>
        {completedTrips.length === 0 && (
          <div className="text-slate-500 text-sm">No completed trips yet.</div>
        )}
        <div className="space-y-2">
          {completedTrips.map((t, i) => (
            <div key={t.id} data-testid={`trip-history-${i}`} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 flex justify-between items-center">
              <div>
                <div className="font-semibold">{t.rig_name || "Trip"}{t.origin ? ` · ${t.origin}` : ""}</div>
                <div className="text-xs text-slate-500">{fmtDate(t.start_time)}</div>
              </div>
              <div className="text-right">
                <div className="font-mono-num font-bold">{t.total_miles != null ? `${Number(t.total_miles).toLocaleString()} mi` : "—"}</div>
                {t.user_name && <div className="text-xs text-slate-500">{t.user_name}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TripField({ label, testId, icon: Icon, ...props }) {
  return (
    <div>
      <label className="text-xs font-mono-num uppercase tracking-widest text-slate-400">{label}</label>
      <div className="relative mt-1">
        {Icon && <Icon className="w-5 h-5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />}
        <input data-testid={testId} {...props}
          className={`w-full h-12 rounded-lg bg-slate-800/60 border border-slate-700 ${Icon ? "pl-10" : "px-3"} pr-3 text-slate-100 outline-none focus:border-amber-500 transition-colors`} />
      </div>
    </div>
  );
}

const fmtTime = (s) => (s ? new Date(s).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—");
