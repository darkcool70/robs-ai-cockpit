import { useEffect, useState } from "react";
import { useApp } from "../store";
import { Button, Field, Modal, ProviderMark, StatusDot, cx } from "./ui";

/** Send the same message to several running agents (typed once each is ready). */
export function BroadcastDialog() {
  const open = useApp((s) => s.broadcastOpen);
  const setOpen = useApp((s) => s.setBroadcastOpen);
  const sessions = useApp((s) => s.sessions);
  const order = useApp((s) => s.order);
  const accounts = useApp((s) => s.accounts);
  const toast = useApp((s) => s.toast);
  const running = order.map((id) => sessions[id]).filter((s) => s && s.kind === "agent" && s.runtime?.running);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPicked(running.map((s) => s.id));
      setText("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const close = () => setOpen(false);
  const send = async () => {
    if (!text.trim() || !picked.length || busy) return;
    setBusy(true);
    let ok = 0;
    for (const id of picked) if (await useApp.getState().queueInput(id, text)) ok++;
    setBusy(false);
    if (ok) {
      toast(`Queued for ${ok} session${ok === 1 ? "" : "s"} — typed as soon as each one is ready`, "ok");
      close();
    }
  };

  return (
    <Modal
      title="Send to several agents"
      onClose={close}
      width={560}
      footer={
        <>
          <span className="mr-auto self-center text-[11px] text-faint">Ctrl+Enter to send</span>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!text.trim() || !picked.length || busy} onClick={send}>Send to {picked.length}</Button>
        </>
      }
    >
      {running.length === 0 ? (
        <p className="text-[12.5px] text-muted">No agent is running right now.</p>
      ) : (
        <div className="grid gap-3">
          <Field label="Message">
            <textarea
              autoFocus
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); void send(); } }}
              placeholder="e.g. Please commit your work and write a short summary."
              className="rounded border border-line-strong bg-bg px-2 py-1.5 text-[12.5px] placeholder:text-faint focus:border-accent focus:outline-none"
            />
          </Field>
          <Field label="Recipients">
            <div className="grid gap-1">
              {running.map((s) => (
                <label key={s.id} className={cx("flex items-center gap-2 rounded px-1.5 py-1 text-[12.5px] hover:bg-hover")}>
                  <input type="checkbox" checked={picked.includes(s.id)} onChange={() => setPicked((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))} />
                  <ProviderMark provider={s.provider} />
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="text-[11px] text-faint">{accounts.find((a) => a.id === s.accountId)?.name}</span>
                  <StatusDot status={s.runtime?.status ?? s.status} withLabel />
                </label>
              ))}
            </div>
          </Field>
        </div>
      )}
    </Modal>
  );
}
