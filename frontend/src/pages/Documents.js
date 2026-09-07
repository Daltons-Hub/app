import { useEffect, useState } from "react";
import { api, apiError, fileUrl } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import { Plus, Upload, FileText, Image as ImageIcon, Trash2, Pencil, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = ["DOT", "MC", "Insurance", "IFTA", "Medical", "Permit"];
const HAS_NUMBER = ["DOT", "MC"];
const EMPTY = { category: "DOT", label: "", number: "", issue_date: "", expiration_date: "", file_id: null };

export default function Documents() {
  const { isOwner } = useAuth();
  const [docs, setDocs] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [uploadName, setUploadName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState("All");

  const load = () => api.get("/documents").then((r) => setDocs(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY); setEditId(null); setUploadName(""); setOpen(true); };
  const openEdit = (d) => {
    setForm({ ...EMPTY, ...d, number: d.number || "", issue_date: d.issue_date || "", expiration_date: d.expiration_date || "" });
    setEditId(d.id); setUploadName(d.file_id ? "Attached file" : ""); setOpen(true);
  };

  const doUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((f) => ({ ...f, file_id: data.file_id }));
      setUploadName(file.name);
      toast.success("File attached.");
    } catch (err) { toast.error(apiError(err)); }
    finally { setUploading(false); }
  };

  const save = async () => {
    if (!form.label.trim()) return toast.error("Give the document a name.");
    try {
      if (editId) await api.put(`/documents/${editId}`, form);
      else await api.post("/documents", form);
      toast.success("Document saved.");
      setOpen(false); load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this document?")) return;
    await api.delete(`/documents/${id}`);
    toast.success("Deleted."); load();
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const filtered = tab === "All" ? docs : docs.filter((d) => d.category === tab);

  return (
    <div className="space-y-4" data-testid="documents-page">
      <div className="flex items-center justify-between">
        <h1 className="font-display font-black text-3xl tracking-wide">DOCUMENT VAULT</h1>
        {isOwner && (
          <button data-testid="doc-vault-upload-button" onClick={openNew}
            className="flex items-center gap-1 h-11 px-4 rounded-xl bg-amber-500 text-[#0A0C0E] font-bold active:scale-95 transition-transform">
            <Plus className="w-5 h-5" /> Add
          </button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {["All", ...CATEGORIES].map((c) => (
          <button key={c} data-testid={`doc-tab-${c}`} onClick={() => setTab(c)}
            className={`shrink-0 px-3 h-9 rounded-full text-sm font-semibold transition-colors ${
              tab === c ? "bg-amber-500 text-[#0A0C0E]" : "bg-slate-800/60 text-slate-300"
            }`}>{c}</button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
          No documents here yet.
        </div>
      )}

      {filtered.map((d, i) => (
        <div key={d.id} data-testid={`document-card-${i}`} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                {d.content_type?.includes("pdf") ? <FileText className="w-5 h-5 text-amber-500" /> : <ImageIcon className="w-5 h-5 text-amber-500" />}
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-mono-num uppercase tracking-widest text-amber-500">{d.category}</div>
                <div className="font-semibold truncate">{d.label}</div>
                {d.number && <div className="font-mono-num text-sm text-slate-300">#{d.number}</div>}
                {d.expiration_date && <div className="text-xs text-slate-500 mt-0.5">Expires {d.expiration_date}</div>}
              </div>
            </div>
            <StatusBadge status={d.status} testId={`doc-expiration-badge-${i}`} />
          </div>
          <div className="flex items-center gap-2 mt-3">
            {d.file_id && (
              <a data-testid={`doc-view-file-${i}`} href={fileUrl(d.file_id)} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-sm text-sky-400 font-semibold">
                <ExternalLink className="w-4 h-4" /> View file
              </a>
            )}
            {isOwner && (
              <div className="ml-auto flex gap-1">
                <button data-testid={`doc-edit-${i}`} onClick={() => openEdit(d)} className="p-2 rounded-md text-slate-400 hover:bg-slate-800"><Pencil className="w-4 h-4" /></button>
                <button data-testid={`doc-delete-${i}`} onClick={() => del(d.id)} className="p-2 rounded-md text-red-400 hover:bg-slate-800"><Trash2 className="w-4 h-4" /></button>
              </div>
            )}
          </div>
        </div>
      ))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md bg-[#161920] border-slate-800 text-slate-100">
          <DialogHeader><DialogTitle className="font-display text-2xl">{editId ? "Edit Document" : "Add Document"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-mono-num uppercase tracking-widest text-slate-400">Type</label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {CATEGORIES.map((c) => (
                  <button key={c} data-testid={`doc-cat-${c}`} onClick={() => setForm({ ...form, category: c })}
                    className={`h-10 rounded-lg text-sm font-semibold transition-colors ${
                      form.category === c ? "bg-amber-500 text-[#0A0C0E]" : "bg-slate-800/60 text-slate-300"
                    }`}>{c}</button>
                ))}
              </div>
            </div>
            <Field label="Name" testId="doc-label-input" value={form.label} onChange={set("label")} placeholder="e.g. Progressive Insurance Cert" />
            {HAS_NUMBER.includes(form.category) && (
              <Field label={`${form.category}#`} testId="doc-number-input" value={form.number} onChange={set("number")} placeholder="1234567" />
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Issued" type="date" value={form.issue_date} onChange={set("issue_date")} />
              <Field label="Expires" testId="doc-expiration-input" type="date" value={form.expiration_date} onChange={set("expiration_date")} />
            </div>
            <div>
              <label className="text-xs font-mono-num uppercase tracking-widest text-slate-400">File (photo or PDF)</label>
              <label data-testid="doc-file-input-label"
                className="mt-1 flex items-center gap-2 h-12 px-3 rounded-lg bg-slate-800/60 border border-slate-700 cursor-pointer text-slate-300">
                <Upload className="w-5 h-5 text-amber-500" />
                <span className="truncate text-sm">{uploading ? "Uploading…" : uploadName || "Choose file"}</span>
                <input data-testid="doc-file-input" type="file" accept="image/*,application/pdf" className="hidden" onChange={doUpload} />
              </label>
            </div>
          </div>
          <DialogFooter>
            <button data-testid="save-doc-button" onClick={save} disabled={uploading}
              className="w-full min-h-[52px] rounded-xl bg-amber-500 text-[#0A0C0E] font-bold text-lg active:scale-95 transition-transform disabled:opacity-50">
              Save Document
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
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
