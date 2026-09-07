import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";

const MAP = {
  active: { label: "ACTIVE", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40", Icon: CheckCircle2 },
  expiring: { label: "EXPIRING", cls: "bg-amber-500/15 text-amber-400 border-amber-500/40", Icon: AlertTriangle },
  expired: { label: "EXPIRED", cls: "bg-red-500/15 text-red-400 border-red-500/40", Icon: XCircle },
  missing: { label: "MISSING", cls: "bg-slate-500/15 text-slate-400 border-slate-500/40", Icon: HelpCircle },
};

export const StatusBadge = ({ status, testId }) => {
  const s = MAP[status] || MAP.missing;
  const { Icon } = s;
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-bold font-mono-num tracking-wide ${s.cls}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {s.label}
    </span>
  );
};
