import { useNavigate, useLocation } from "react-router-dom";
import { Home, Truck, FolderLock, Users, LogOut, ScanLine, Route, Calculator } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export function Layout({ children }) {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, logout, isOwner } = useAuth();

  const items = isOwner
    ? [
        { to: "/", icon: Home, label: "Home", testId: "nav-home" },
        { to: "/rigs", icon: Truck, label: "Rigs", testId: "nav-rigs" },
        { to: "/trip", icon: Route, label: "Trip", testId: "nav-trip" },
        { to: "/tools", icon: Calculator, label: "Tools", testId: "nav-tools" },
        { to: "/documents", icon: FolderLock, label: "Docs", testId: "nav-documents" },
      ]
    : [
        { to: "/", icon: Home, label: "Home", testId: "nav-home" },
        { to: "/trip", icon: Route, label: "Trip", testId: "nav-trip" },
        { to: "/tools", icon: Calculator, label: "Tools", testId: "nav-tools" },
        { to: "/documents", icon: FolderLock, label: "Docs", testId: "nav-documents" },
      ];

  return (
    <div className="min-h-screen bg-[#0A0C0E] flex justify-center">
      <div className="w-full max-w-md min-h-screen bg-[#0F1115] text-slate-100 pb-28 relative border-x border-slate-800/60">
        {/* top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between px-4 h-14 bg-[#0F1115]/95 backdrop-blur border-b border-slate-800/60">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-amber-500 flex items-center justify-center">
              <Truck className="w-5 h-5 text-[#0A0C0E]" />
            </div>
            <div className="leading-none">
              <div className="font-display font-black text-lg tracking-wide">HOTSHOT OPS</div>
              <div className="text-[10px] font-mono-num uppercase tracking-widest text-amber-500">
                {user?.role === "owner" ? "Owner" : "Driver"} · {user?.name}
              </div>
            </div>
          </div>
          <button
            data-testid="logout-button"
            onClick={() => { logout(); nav("/login"); }}
            className="p-2 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
            aria-label="Log out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </header>

        <main className="px-4 pt-4">{children}</main>

        {/* Weigh station quick button */}
        <button
          data-testid="weigh-station-toggle-button"
          onClick={() => nav("/weigh-station")}
          className="fixed bottom-24 right-4 z-40 flex items-center gap-2 pl-4 pr-5 h-14 rounded-full bg-amber-500 text-[#0A0C0E] font-display font-bold text-lg tracking-wide shadow-lg shadow-amber-500/30 active:scale-95 transition-transform max-w-md"
          style={{ right: "max(1rem, calc(50vw - 14rem))" }}
        >
          <ScanLine className="w-6 h-6" />
          WEIGH STATION
        </button>

        {/* bottom nav */}
        <nav className="fixed bottom-0 left-0 right-0 z-30 flex justify-center bg-[#0F1115] border-t border-slate-800/60">
          <div className="w-full max-w-md grid h-20" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}>
            {items.map((it) => {
              const active = loc.pathname === it.to;
              const Icon = it.icon;
              return (
                <button
                  key={it.to}
                  data-testid={it.testId}
                  onClick={() => nav(it.to)}
                  className={`flex flex-col items-center justify-center gap-1 transition-colors ${
                    active ? "text-amber-500" : "text-slate-500"
                  }`}
                >
                  <Icon className="w-6 h-6" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide">{it.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
