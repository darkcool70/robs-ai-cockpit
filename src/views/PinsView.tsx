import { useEffect, useMemo, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Copy, FileDown, Trash2 } from "lucide-react";
import { useApp } from "../store";
import { api, errMsg, type Pin } from "../lib/api";
import { dateTime } from "../lib/format";
import { Button, Card, Empty, IconButton, Input, Select } from "../components/ui";

/** Markdown export of pins (grouped by project). Pure for testing. */
export function pinsMarkdown(pins: Pin[], projectName: (id: string | null) => string): string {
  const groups = new Map<string, Pin[]>();
  for (const p of pins) {
    const k = projectName(p.projectId);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const out = ["# Pins", ""];
  for (const [project, list] of groups) {
    out.push(`## ${project}`, "");
    for (const p of list) {
      out.push(`### ${p.sessionName ?? "Agent"} · ${new Date(p.createdAt).toLocaleString("de-DE")}`, "");
      if (p.note) out.push(`> ${p.note.replace(/\n/g, "\n> ")}`, "");
      out.push(p.text.trim(), "");
    }
  }
  return out.join("\n");
}

/** Answers worth keeping — pinned from the Overview — with your own notes. */
export function PinsView() {
  const projects = useApp((s) => s.projects);
  const toast = useApp((s) => s.toast);
  const [pins, setPins] = useState<Pin[]>([]);
  const [project, setProject] = useState("");
  const [q, setQ] = useState("");
  const refresh = () => api.pinsList().then(setPins).catch((e) => toast(errMsg(e), "error"));
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const name = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "Ohne Projekt";
  const shown = useMemo(
    () => pins.filter((p) => (!project || p.projectId === project) && (!q.trim() || `${p.text} ${p.note ?? ""} ${p.sessionName ?? ""}`.toLowerCase().includes(q.toLowerCase()))),
    [pins, project, q],
  );
  const exportMd = async () => {
    const path = await saveDialog({ title: "Export pins", defaultPath: `Pins-${new Date().toISOString().slice(0, 10)}.md`, filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (!path) return;
    try {
      await api.saveTextFile(path, pinsMarkdown(shown, name));
      toast(`Exported: ${path}`, "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[980px] space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-[16px] font-semibold">Pins</h1>
            <p className="text-[12px] text-muted">Important answers, pinned with 📌 on an agent card in the Overview.</p>
          </div>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-48" />
          <Select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button disabled={!shown.length} onClick={() => void exportMd()}><FileDown size={12} /> Export .md</Button>
        </div>
        {shown.length === 0 ? (
          <Card className="p-8"><Empty>No pins yet. Pin an answer with 📌 on an agent card in the Overview.</Empty></Card>
        ) : (
          shown.map((p) => <PinCard key={p.id} pin={p} project={name(p.projectId)} onChange={refresh} />)
        )}
      </div>
    </div>
  );
}

function PinCard({ pin, project, onChange }: { pin: Pin; project: string; onChange: () => void }) {
  const toast = useApp((s) => s.toast);
  const [note, setNote] = useState(pin.note ?? "");
  const saveNote = async () => {
    if ((pin.note ?? "") === note) return;
    await api.pinSave({ ...pin, note: note.trim() || null }).catch((e) => toast(errMsg(e), "error"));
    onChange();
  };
  return (
    <Card className="p-3 text-[12.5px]">
      <div className="mb-1 flex items-center gap-2 text-[11.5px] text-faint">
        <b className="text-fg">{pin.sessionName ?? "Agent"}</b> · {project} · {dateTime(pin.createdAt)}
        <span className="ml-auto flex gap-0.5">
          <IconButton title="Copy" onClick={() => void navigator.clipboard.writeText(pin.text).then(() => toast("Copied", "ok"))}><Copy size={12} /></IconButton>
          <IconButton title="Delete" onClick={() => { if (window.confirm("Delete this pin?")) void api.pinDelete(pin.id).then(onChange); }}><Trash2 size={12} /></IconButton>
        </span>
      </div>
      <p className="max-h-80 overflow-auto whitespace-pre-wrap text-fg/90">{pin.text}</p>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => void saveNote()}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder="Your note…"
        className="mt-2 h-7 w-full rounded border border-line-strong bg-bg px-2 text-[12px] placeholder:text-faint focus:border-accent focus:outline-none"
      />
    </Card>
  );
}
