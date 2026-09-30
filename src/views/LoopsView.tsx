import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, BookText, Pause, Pencil, Play, Plus, Repeat, RotateCcw, Send, Square, Trash2, X } from "lucide-react";
import { useApp } from "../store";
import { api, errMsg, type Automation, type Template } from "../lib/api";
import { ago } from "../lib/format";
import { Badge, Button, Card, cx, Empty, Field, IconButton, Input, Meter, Modal, ProviderMark, SectionTitle, Select } from "../components/ui";

/** "…antworte nur mit ALLE PUNKTE ERLEDIGT" / "reply only with DONE" → the upper-case phrase. */
export function suggestStopPhrase(prompt: string): string | null {
  const m = prompt.match(/(?:antworte|antwort|reply|respond|answer)[^.\n]{0,20}?\b(?:mit|with)\s+["'„“]?([A-ZÄÖÜ][A-ZÄÖÜ0-9 _-]{2,40}[A-ZÄÖÜ0-9])/);
  return m ? m[1].trim() : null;
}

const STATE_TONE ={ running: "accent", paused: "neutral", done: "ok", stopped: "neutral" } as const;

/** Loops & prompt queues plus the prompt template library. */
export function LoopsView() {
  const loopsVersion = useApp((s) => s.loopsVersion);
  const sessions = useApp((s) => s.sessions);
  const toast = useApp((s) => s.toast);
  const [loops, setLoops] = useState<Automation[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Partial<Automation> | null>(null);
  const [editTpl, setEditTpl] = useState<Partial<Template> | null>(null);

  const refresh = () => {
    api.automationList().then(setLoops).catch(() => {});
    api.templatesList().then(setTemplates).catch(() => {});
  };
  useEffect(refresh, [loopsVersion]);

  const control = async (id: string, action: "start" | "pause" | "stop" | "reset") => {
    try {
      await api.automationControl(id, action);
      refresh();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const remove = async (a: Automation) => {
    if (!window.confirm(`Delete loop "${a.name}"?`)) return;
    await api.automationDelete(a.id).catch((e) => toast(errMsg(e), "error"));
    refresh();
  };
  const sendTemplate = async (t: Template) => {
    const st = useApp.getState();
    const id = st.panes[st.focused];
    if (!id) return toast("Focus a pane with a running session first", "warn");
    if (await st.queueInput(id, t.text)) toast(`"${t.name}" → ${st.sessions[id]?.name}`, "ok");
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-[16px] font-semibold">Loops &amp; queues</h1>
            <p className="text-[12px] text-muted">
              Prepare prompts that run one after another — each is sent when the agent finished the previous one. Loops repeat until a count or a stop phrase.
            </p>
          </div>
          <Button variant="primary" onClick={() => setEditing({ mode: "queue", prompts: [""], repeat: 1, delaySec: 5 })}><Plus size={13} /> New loop</Button>
        </div>
        {loops.length === 0 ? (
          <Card className="p-8">
            <Empty>
              <span>
                No loops yet. Example: a queue “Implement feature → Write tests → Review diff → Commit”, or a loop
                “Take the next TODO item” that stops when the agent answers “ALLE PUNKTE ERLEDIGT”.
              </span>
            </Empty>
          </Card>
        ) : (
          <div className="space-y-2">
            {loops.map((a) => {
              const s = sessions[a.sessionId];
              const prompts = a.prompts.length;
              const sent = a.iteration * prompts + a.step;
              const total = a.mode === "queue" ? prompts : a.repeat > 0 ? prompts * a.repeat : null;
              return (
                <Card key={a.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Repeat size={14} className="text-muted" />
                    <b className="text-[13px]">{a.name}</b>
                    <Badge tone={STATE_TONE[a.state]}>{a.state}</Badge>
                    <Badge>{a.mode === "queue" ? `queue · ${prompts} prompts` : `loop · ${a.repeat > 0 ? `${a.repeat}×` : "until stopped"}`}</Badge>
                    <span className="flex min-w-0 items-center gap-1 text-[12px] text-muted">
                      {s ? <><ProviderMark provider={s.provider} /> <span className="truncate">{s.name}</span></> : <span className="text-faint">session closed</span>}
                    </span>
                    <div className="ml-auto flex items-center">
                      {a.state === "running" ? (
                        <IconButton title="Pause" onClick={() => void control(a.id, "pause")}><Pause size={13} /></IconButton>
                      ) : (
                        <IconButton title={a.state === "done" || a.state === "stopped" ? "Run again from the start" : "Start / resume"} disabled={!s} onClick={() => void control(a.id, "start")}><Play size={13} /></IconButton>
                      )}
                      <IconButton title="Stop" disabled={a.state === "stopped" || a.state === "done"} onClick={() => void control(a.id, "stop")}><Square size={12} /></IconButton>
                      <IconButton title="Back to the first prompt" onClick={() => void control(a.id, "reset")}><RotateCcw size={12} /></IconButton>
                      <IconButton title="Edit" onClick={() => setEditing(a)}><Pencil size={12} /></IconButton>
                      <IconButton title="Delete" onClick={() => void remove(a)}><Trash2 size={12} /></IconButton>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="w-40">{total ? <Meter value={(sent / total) * 100} tone="accent" /> : <Meter value={100} tone="accent" />}</div>
                    <span className="text-[11.5px] tabular text-muted">{sent}{total ? ` / ${total}` : ""} sent</span>
                    {a.stopPhrase && <span className="text-[11.5px] text-faint">stops on “{a.stopPhrase}”</span>}
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{a.note}{a.lastSentAt ? ` · last sent ${ago(a.lastSentAt)}` : ""}</span>
                  </div>
                  <ol className="mt-2 space-y-0.5">
                    {a.prompts.map((p, i) => (
                      <li key={i} className={cx("truncate text-[11.5px]", i === a.step && a.state === "running" ? "text-accent" : "text-muted")}>
                        {i + 1}. {p}
                      </li>
                    ))}
                  </ol>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      <aside className="flex w-[360px] shrink-0 flex-col overflow-auto border-l border-line bg-panel p-3">
        <SectionTitle right={<Button size="sm" onClick={() => setEditTpl({ name: "", text: "" })}><Plus size={12} /> Template</Button>}>Prompt templates</SectionTitle>
        <p className="mb-2 text-[11.5px] text-faint">Reusable prompts — send to the focused session, use in loops, or pick from the command palette (Ctrl+P).</p>
        <div className="space-y-1.5">
          {templates.map((t) => (
            <Card key={t.id} className="group px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <BookText size={12} className="text-muted" />
                <b className="min-w-0 flex-1 truncate text-[12.5px]">{t.name}</b>
                <span className="hidden group-hover:flex">
                  <IconButton title="Send to the focused session" onClick={() => void sendTemplate(t)}><Send size={12} /></IconButton>
                  <IconButton title="Edit" onClick={() => setEditTpl(t)}><Pencil size={12} /></IconButton>
                  <IconButton title="Delete" onClick={() => void api.templateDelete(t.id).then(refresh)}><Trash2 size={12} /></IconButton>
                </span>
              </div>
              <p className="mt-1 line-clamp-3 text-[11.5px] text-muted">{t.text}</p>
            </Card>
          ))}
        </div>
      </aside>
      {editing && <LoopEditor initial={editing} templates={templates} onClose={() => setEditing(null)} onSaved={refresh} />}
      {editTpl && <TemplateEditor initial={editTpl} onClose={() => setEditTpl(null)} onSaved={refresh} />}
    </div>
  );
}

function LoopEditor({ initial, templates, onClose, onSaved }: { initial: Partial<Automation>; templates: Template[]; onClose: () => void; onSaved: () => void }) {
  const sessions = useApp((s) => s.sessions);
  const order = useApp((s) => s.order);
  const focusedId = useApp((s) => s.panes[s.focused]);
  const toast = useApp((s) => s.toast);
  const agents = order.map((id) => sessions[id]).filter((s) => s && s.kind === "agent");
  const [sessionId, setSessionId] = useState(initial.sessionId ?? (focusedId && sessions[focusedId]?.kind === "agent" ? focusedId : agents[0]?.id) ?? "");
  const [name, setName] = useState(initial.name ?? "");
  const [mode, setMode] = useState<"queue" | "loop">(initial.mode ?? "queue");
  const [prompts, setPrompts] = useState<string[]>(initial.prompts?.length ? initial.prompts : [""]);
  const [repeat, setRepeat] = useState(initial.repeat ?? 1);
  const [delay, setDelay] = useState(initial.delaySec ?? 5);
  const [stop, setStop] = useState(initial.stopPhrase ?? "");
  const [busy, setBusy] = useState(false);

  // "…antworte nur mit ALLE PUNKTE ERLEDIGT" → suggest that as the stop phrase.
  useEffect(() => {
    if (stop.trim()) return;
    for (const p of prompts) {
      const m = suggestStopPhrase(p);
      if (m) {
        setStop(m);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompts]);

  const setAt = (i: number, v: string) => setPrompts((p) => p.map((x, j) => (j === i ? v : x)));
  const move = (i: number, d: number) => setPrompts((p) => {
    const n = [...p];
    const j = i + d;
    if (j < 0 || j >= n.length) return p;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const save = async (start: boolean) => {
    setBusy(true);
    try {
      await api.automationSave({
        id: initial.id,
        sessionId,
        name: name.trim() || (mode === "queue" ? "Queue" : "Loop"),
        mode,
        prompts: prompts.map((p) => p.trim()).filter(Boolean),
        repeat: mode === "queue" ? 1 : repeat,
        delaySec: delay,
        stopPhrase: stop.trim() || null,
        start,
      });
      onSaved();
      onClose();
      if (start) toast("Loop started — the first prompt goes out as soon as the session is ready", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={initial.id ? `Edit loop · ${initial.name}` : "New loop"}
      onClose={onClose}
      width={680}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !sessionId} onClick={() => void save(false)}>Save</Button>
          <Button variant="primary" disabled={busy || !sessionId} onClick={() => void save(true)}><Play size={12} /> Save &amp; start</Button>
        </>
      }
    >
      {agents.length === 0 ? (
        <p className="text-[12.5px] text-muted">Start an agent session first — loops run inside a session.</p>
      ) : (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Session">
              <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                {agents.map((s) => <option key={s.id} value={s.id}>{s.name}{s.runtime?.running ? "" : " (not running)"}</option>)}
              </Select>
            </Field>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Feature pipeline" autoFocus />
            </Field>
          </div>
          <Field label="Type">
            <div className="flex gap-1.5">
              {(["queue", "loop"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cx("flex-1 rounded border px-3 py-1.5 text-left text-[12.5px]", mode === m ? "border-accent bg-accent/10" : "border-line-strong hover:bg-hover")}
                >
                  <b>{m === "queue" ? "Queue" : "Loop"}</b>
                  <span className="block text-[11px] text-faint">{m === "queue" ? "Each prompt once, in order" : "Repeat the prompts — N times or until a stop phrase"}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label={`Prompts (${prompts.filter((p) => p.trim()).length})`}>
            <div className="grid gap-1.5">
              {prompts.map((p, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="w-5 pt-1.5 text-right text-[11px] text-faint">{i + 1}.</span>
                  <textarea
                    value={p}
                    onChange={(e) => setAt(i, e.target.value)}
                    rows={2}
                    placeholder={i === 0 ? "e.g. Implement the next step of the plan in PLAN.md" : "Next prompt…"}
                    className="min-w-0 flex-1 rounded border border-line-strong bg-bg px-2 py-1.5 text-[12.5px] placeholder:text-faint focus:border-accent focus:outline-none"
                  />
                  <div className="flex flex-col">
                    <IconButton title="Up" onClick={() => move(i, -1)}><ArrowUp size={11} /></IconButton>
                    <IconButton title="Down" onClick={() => move(i, 1)}><ArrowDown size={11} /></IconButton>
                  </div>
                  <IconButton title="Remove" disabled={prompts.length === 1} onClick={() => setPrompts((ps) => ps.filter((_, j) => j !== i))}><X size={12} /></IconButton>
                </div>
              ))}
              <div className="flex items-center gap-1.5 pl-6">
                <Button size="sm" onClick={() => setPrompts((p) => [...p, ""])}><Plus size={12} /> Prompt</Button>
                <Select
                  value=""
                  onChange={(e) => {
                    const t = templates.find((x) => x.id === e.target.value);
                    if (t) setPrompts((p) => (p.length === 1 && !p[0].trim() ? [t.text] : [...p, t.text]));
                  }}
                  className="h-6 text-[11.5px]"
                >
                  <option value="">+ from template…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </div>
            </div>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            {mode === "loop" && (
              <Field label="Rounds" hint="0 = until stopped / stop phrase">
                <Input type="number" min={0} max={10000} value={repeat} onChange={(e) => setRepeat(Math.max(0, Number(e.target.value) || 0))} />
              </Field>
            )}
            <Field label="Pause between prompts (s)" hint="After the agent finished">
              <Input type="number" min={0} max={86400} value={delay} onChange={(e) => setDelay(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
            <Field label="Stop phrase (optional)" hint="Ends when the agent's answer contains it">
              <Input value={stop} onChange={(e) => setStop(e.target.value)} placeholder="ALLE PUNKTE ERLEDIGT" />
            </Field>
          </div>
          <p className="text-[11px] text-faint">
            Usage limits pause the loop; with auto-continue it goes on after the reset. The session’s autonomy setting decides whether the agent may act without asking —
            for unattended loops use “Edits auto” or “Auto mode”.
          </p>
        </div>
      )}
    </Modal>
  );
}

function TemplateEditor({ initial, onClose, onSaved }: { initial: Partial<Template>; onClose: () => void; onSaved: () => void }) {
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState(initial.name ?? "");
  const [text, setText] = useState(initial.text ?? "");
  const save = async () => {
    try {
      await api.templateSave({ id: initial.id ?? "", name, text, sort: initial.sort ?? 100 });
      onSaved();
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  return (
    <Modal
      title={initial.id ? "Edit template" : "New template"}
      onClose={onClose}
      width={560}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim() || !text.trim()} onClick={() => void save()}>Save</Button></>}
    >
      <div className="grid gap-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Prompt">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            className="rounded border border-line-strong bg-bg px-2 py-1.5 text-[12.5px] focus:border-accent focus:outline-none"
          />
        </Field>
      </div>
    </Modal>
  );
}
