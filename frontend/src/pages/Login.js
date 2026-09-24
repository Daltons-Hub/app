import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiError } from "../lib/api";
import { Truck, Delete } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (finalPin) => {
    if (!username.trim()) return toast.error("Enter your username first.");
    setBusy(true);
    try {
      await login(username.trim(), finalPin);
      nav("/");
    } catch (e) {
      toast.error(apiError(e));
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const press = (n) => {
    if (pin.length >= 4 || busy) return;
    const next = pin + n;
    setPin(next);
    if (next.length === 4) submit(next);
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

  return (
    <div className="min-h-screen bg-[#0A0C0E] flex justify-center">
      <div className="w-full max-w-md min-h-screen bg-[#0F1115] flex flex-col px-6 py-10">
        <div className="flex flex-col items-center mt-6 mb-8">
          <div className="w-16 h-16 rounded-2xl bg-amber-500 flex items-center justify-center mb-4">
            <Truck className="w-9 h-9 text-[#0A0C0E]" />
          </div>
          <h1 className="font-display font-black text-4xl tracking-wide text-slate-50">HOTSHOT OPS</h1>
          <p className="text-slate-400 text-sm mt-1">Sign in to your rig</p>
        </div>

        <label className="text-xs font-mono-num uppercase tracking-widest text-slate-400 mb-2">Username</label>
        <input
          data-testid="login-username-input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="owner or driver"
          autoCapitalize="none"
          className="h-14 rounded-xl bg-slate-800/60 border border-slate-700 px-4 text-lg text-slate-100 outline-none focus:border-amber-500 transition-colors"
        />

        <div className="mt-6 mb-3 flex items-center justify-between">
          <span className="text-xs font-mono-num uppercase tracking-widest text-slate-400">4-Digit PIN</span>
          <div className="flex gap-2" data-testid="login-pin-input">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border-2 ${
                  pin.length > i ? "bg-amber-500 border-amber-500" : "border-slate-600"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-2">
          {keys.map((k, i) =>
            k === "" ? (
              <div key={`spacer-${i}`} />
            ) : k === "del" ? (
              <button
                key="del"
                data-testid="login-pin-delete"
                onClick={() => setPin(pin.slice(0, -1))}
                className="h-16 rounded-xl bg-slate-800/40 flex items-center justify-center text-slate-300 active:bg-slate-700 transition-colors"
              >
                <Delete className="w-6 h-6" />
              </button>
            ) : (
              <button
                key={k}
                data-testid={`login-key-${k}`}
                onClick={() => press(k)}
                className="h-16 rounded-xl bg-slate-800/60 text-2xl font-display font-bold text-slate-100 active:bg-amber-500 active:text-[#0A0C0E] transition-colors"
              >
                {k}
              </button>
            )
          )}
        </div>

        <p className="text-center text-xs text-slate-500 mt-8 font-mono-num">
          Owner: owner / 1910 &nbsp;·&nbsp; Driver: driver / 1234
        </p>
      </div>
    </div>
  );
}
