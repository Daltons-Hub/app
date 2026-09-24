import { useEffect, useState, useRef, useCallback } from "react";
import { api, apiError, fileUrl } from "../lib/api";
import { SignaturePad } from "../components/SignaturePad";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { Plus, Camera, FileText, Trash2, Check, Clock } from "lucide-react";
import { toast } from "sonner";

const EMPTY = { customer_name: "", rig_id: "", destination: "", load_description: "", delivery_date: "", weight: "", rate_amount: "", notes: "" };

export default function Deliveries() {
  const [items, setItems] = useState([]);
  const [rigs, setRigs] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [photoId, setPhotoId] = useState(null);
  const [photoName, setPhotoName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const sigRef = useRef(null);

  const load = useCallback(() => {
    api.get("/deliveries").then((r) => setItems(r.data)).catch(() => {});
    api.get("/rigs").then((r) => setRigs(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setForm({ ...EMPTY, delivery_date: new Date().toISOString().slice(0, 10) });
    setPhotoId(null); setPhotoName(""); setOpen(true);
  };

  const uploadPhoto = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setPhotoId(data.file_id); setPhotoName(file.name);
      toast.success("Photo attached.");
    } catch (err) { toast.error(apiError(err)); }
    finally { setUploading(false); }
  };

  const save = async () => {
    if (!form.customer_name.trim()) return toast.error("Enter the customer name.");
    setUploading(true);
    try {
      let sigId = null;
      if (sigRef.current && !sigRef.current.isEmpty()) {
        const blob = await sigRef.current.toBlob();
        const fd = new FormData(); fd.append("file", new File([blob], "signature.png", { type: "image/png" }));
        const { data } = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
        sigId = data.file_id;
      }
      await api.post("/deliveries", {
        ...form,
        rig_id: form.rig_id || null,
        weight: form.weight ? Number(form.weight) : null,
        rate_amount: form.rate_amount ? Number(form.rate_amount) : null,
        photo_file_id: photoId, signature_file_id: sigId,
      });
      toast.success("Delivery saved & invoice created.");
      setOpen(false); load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setUploading(false); }
  };

  const togglePaid = async (d) => {
    const next = d.invoice_status === "paid" ? "unpaid" : "paid";
    const { data } = await api.put(`/deliveries/${d.id}/invoice`, { invoice_status: next });
    setInvoice(data); load();
  };

  const del = async (id) => {
    if (!window.confirm("Delete this delivery & invoice?")) return;
    await api.delete(`/deliveries/${id}`); setInvoice(null); toast.success("Deleted."); load();
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-4" data-testid="deliveries-page">
      <div className="flex items-center justify-between">
        <h1 className="font-display font-black text-3xl tracking-wide">DELIVERIES</h1>
        <button data-testid="add-delivery-button" onClick={openNew}
          className="flex items-center gap-1 h-11 px-4 rounded-xl bg-amber-500 text-[#0A0C0E] font-bold active:scale-95 transition-transform">
          <Plus className="w-5 h-5" /> New
        </button>
      </div>

      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
          No deliveries yet. Capture a POD to auto-create an invoice.
        </div>
      )}

      {items.map((d, i) => (
        <button key={d.id} data-testid={`delivery-card-${i}`} onClick={() => setInvoice(d)}
          className="w-full text-left rounded-xl border border-slate-800 bg-slate-900/40 p-4 active:bg-slate-800/60 transition-colors">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="font-mono-num text-xs text-amber-500">{d.invoice_number}</div>
              <div className="font-semibold truncate">{d.customer_name}</div>
              <div className="text-sm text-slate-400 truncate">{d.load_description || d.destination || "—"}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono-num font-bold text-lg">{d.rate_amount != null ? `$${Number(d.rate_amount).toLocaleString()}` : "—"}</div>
              <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded ${d.invoice_status === "paid" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
                {d.invoice_status === "paid" ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3" />}{d.invoice_status.toUpperCase()}
              </span>
            </div>
          </div>
        </button>
      ))}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md bg-[#161920] border-slate-800 text-slate-100 max-h-[88vh] overflow-y-auto no-scrollbar">
          <DialogHeader><DialogTitle className="font-display text-2xl">New Delivery / POD</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Customer" testId="delivery-customer-input" value={form.customer_name} onChange={set("customer_name")} placeholder="Acme Oilfield" />
            <div>
              <label className="text-xs font-mono-num uppercase tracking-widest text-slate-400">Rig</label>
              <Select value={form.rig_id} onValueChange={(v) => setForm({ ...form, rig_id: v })}>
                <SelectTrigger data-testid="delivery-rig-select" className="mt-1 h-12 bg-slate-800/60 border-slate-700 text-slate-100"><SelectValue placeholder="Select rig" /></SelectTrigger>
                <SelectContent className="bg-[#161920] border-slate-700 text-slate-100">
                  {rigs.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Field label="Load Description" value={form.load_description} onChange={set("load_description")} placeholder="Drill pipe, 12k lb" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Destination" value={form.destination} onChange={set("destination")} placeholder="Midland, TX" />
              <Field label="Delivery Date" type="date" value={form.delivery_date} onChange={set("delivery_date")} />
              <Field label="Weight (lb)" type="number" value={form.weight} onChange={set("weight")} />
              <Field label="Rate ($)" testId="delivery-rate-input" type="number" value={form.rate_amount} onChange={set("rate_amount")} placeholder="1350" />
            </div>
            <div>
              <label className="text-xs font-mono-num uppercase tracking-widest text-slate-400">Proof of Delivery Photo</label>
              <label className="mt-1 flex items-center gap-2 h-12 px-3 rounded-lg bg-slate-800/60 border border-slate-700 cursor-pointer text-slate-300">
                <Camera className="w-5 h-5 text-amber-500" />
                <span className="truncate text-sm">{uploading ? "Uploading…" : photoName || "Take / choose photo"}</span>
                <input data-testid="delivery-photo-input" type="file" accept="image/*" capture="environment" className="hidden" onChange={uploadPhoto} />
              </label>
            </div>
            <div>
              <label className="text-xs font-mono-num uppercase tracking-widest text-slate-400">Recipient Signature</label>
              <div className="mt-1"><SignaturePad ref={sigRef} testId="delivery-signature-pad" /></div>
            </div>
          </div>
          <DialogFooter>
            <button data-testid="save-delivery-button" onClick={save} disabled={uploading}
              className="w-full min-h-[52px] rounded-xl bg-amber-500 text-[#0A0C0E] font-bold text-lg active:scale-95 transition-transform disabled:opacity-50">
              Save & Create Invoice
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice dialog */}
      <Dialog open={!!invoice} onOpenChange={(v) => !v && setInvoice(null)}>
        <DialogContent className="max-w-md bg-[#161920] border-slate-800 text-slate-100 max-h-[88vh] overflow-y-auto no-scrollbar" data-testid="invoice-view">
          {invoice && (
            <>
              <DialogHeader><DialogTitle className="font-display text-2xl flex items-center gap-2"><FileText className="w-6 h-6 text-amber-500" /> Invoice</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="font-mono-num text-amber-500">{invoice.invoice_number}</span>
                  <span className={`text-xs font-bold px-2 py-1 rounded ${invoice.invoice_status === "paid" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>{invoice.invoice_status.toUpperCase()}</span>
                </div>
                <Row label="Customer" value={invoice.customer_name} />
                <Row label="Load" value={invoice.load_description || "—"} />
                <Row label="Destination" value={invoice.destination || "—"} />
                <Row label="Date" value={invoice.delivery_date || "—"} />
                <Row label="Rig" value={invoice.rig_name || "—"} />
                <div className="rounded-xl bg-slate-800/60 p-4 flex justify-between items-center">
                  <span className="text-slate-400">Amount Due</span>
                  <span className="font-mono-num font-black text-3xl text-amber-500">{invoice.rate_amount != null ? `$${Number(invoice.rate_amount).toLocaleString()}` : "—"}</span>
                </div>
                {invoice.photo_file_id && (
                  <div><div className="text-xs font-mono-num uppercase tracking-widest text-slate-400 mb-1">POD Photo</div>
                    <img data-testid="invoice-photo" src={fileUrl(invoice.photo_file_id)} alt="POD" className="w-full rounded-lg border border-slate-700" /></div>
                )}
                {invoice.signature_file_id && (
                  <div><div className="text-xs font-mono-num uppercase tracking-widest text-slate-400 mb-1">Signature</div>
                    <img data-testid="invoice-signature" src={fileUrl(invoice.signature_file_id)} alt="Signature" className="w-full rounded-lg bg-white" /></div>
                )}
                <div className="flex gap-2 pt-1">
                  <button data-testid="invoice-toggle-paid" onClick={() => togglePaid(invoice)}
                    className={`flex-1 min-h-[48px] rounded-xl font-bold ${invoice.invoice_status === "paid" ? "bg-slate-700 text-slate-100" : "bg-emerald-500 text-emerald-950"}`}>
                    {invoice.invoice_status === "paid" ? "Mark Unpaid" : "Mark Paid"}
                  </button>
                  <button data-testid="invoice-delete" onClick={() => del(invoice.id)} className="w-12 rounded-xl bg-red-600/20 text-red-400 flex items-center justify-center"><Trash2 className="w-5 h-5" /></button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }) {
  return <div className="flex justify-between text-sm"><span className="text-slate-400">{label}</span><span className="text-slate-100 font-medium text-right">{value}</span></div>;
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
