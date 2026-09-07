import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Sparkles, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";

const COMMON = ["Am I clear for the weigh station?", "When's my next oil change due?", "How far was my last trip?"];
const OWNER = ["What do I have unpaid right now?", "What's my cost to run a 450-mile load at $4/gal and 10 mpg?"];

export default function Assistant() {
  const nav = useNavigate();
  const { isOwner, user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  const suggestions = [...COMMON, ...(isOwner ? OWNER : [])];

  useEffect(() => { api.get("/assistant/history").then((r) => setMessages(r.data.map((m, i) => ({ ...m, key: i })))).catch(() => {}); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q, key: Math.random() }]);
    setBusy(true);
    try {
      const { data } = await api.post("/assistant/chat", { message: q });
      setMessages((m) => [...m, { role: "assistant", text: data.answer, key: Math.random() }]);
    } catch (e) {
      toast.error(apiError(e));
      setMessages((m) => [...m, { role: "assistant", text: "Sorry, I couldn't answer that right now. Please try again.", key: Math.random() }]);
    } finally { setBusy(false); }
  };

  const clear = async () => { await api.delete("/assistant/history"); setMessages([]); };

  return (
    <div className="fixed inset-0 z-50 bg-[#0F1115] flex justify-center" data-testid="assistant-page">
      <div className="w-full max-w-md flex flex-col h-full border-x border-slate-800/60">
        <header className="sticky top-0 flex items-center justify-between px-4 h-14 bg-[#0F1115]/95 backdrop-blur border-b border-slate-800/60">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-amber-500 flex items-center justify-center"><Sparkles className="w-5 h-5 text-[#0A0C0E]" /></div>
            <span className="font-display font-black text-xl tracking-wide">ASSISTANT</span>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && <button data-testid="assistant-clear" onClick={clear} className="p-2 text-slate-400 hover:text-slate-100"><Trash2 className="w-5 h-5" /></button>}
            <button data-testid="assistant-close" onClick={() => nav(-1)} className="p-2 text-slate-400 hover:text-slate-100"><X className="w-6 h-6" /></button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-slate-300 text-sm">
              Hey {user?.name?.split(" ")[0] || "there"}! Ask me anything about your rig, paperwork or trips{isOwner ? ", loads or money" : ""}. I answer straight from your HotShot Ops data — no menu-digging.
            </div>
          )}
          {messages.map((m) => (
            <div key={m.key} data-testid={`assistant-msg-${m.role}`} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-amber-500 text-[#0A0C0E] rounded-br-sm" : "bg-slate-800 text-slate-100 rounded-bl-sm"}`}>{m.text}</div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start"><div className="bg-slate-800 rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1">
              <Dot d={0} /><Dot d={150} /><Dot d={300} />
            </div></div>
          )}
          <div ref={endRef} />
        </div>

        <div className="px-4 pt-2 pb-4 border-t border-slate-800/60 bg-[#0F1115]">
          {messages.length === 0 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar mb-2">
              {suggestions.map((s, i) => (
                <button key={i} data-testid={`assistant-suggest-${i}`} onClick={() => send(s)}
                  className="shrink-0 px-3 h-9 rounded-full bg-slate-800/80 border border-slate-700 text-slate-200 text-xs">{s}</button>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end bg-[#161920] border border-slate-700 rounded-2xl p-2">
            <input data-testid="assistant-input" value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask anything…"
              className="flex-1 bg-transparent px-2 h-11 text-slate-100 outline-none" />
            <button data-testid="assistant-send" onClick={() => send()} disabled={busy}
              className="w-11 h-11 rounded-xl bg-amber-500 text-[#0A0C0E] flex items-center justify-center disabled:opacity-50 active:scale-95 transition-transform">
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dot({ d }) {
  return <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />;
}
