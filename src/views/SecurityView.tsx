import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, ShieldCheck, Trash2 } from "lucide-react";
import { useApp } from "../store";
import { api, errMsg, type SecurityOverview } from "../lib/api";
import { Badge, Button, Card, Input, Modal, ProviderMark, SectionTitle } from "../components/ui";

export function SecurityView() {
  const toast = useApp((s) => s.toast);
  const order = useApp((s) => s.order);
  const [o, setO] = useState<SecurityOverview | null>(null);
  const [wipe, setWipe] = useState(false);

  useEffect(() => {
    api.securityOverview().then(setO).catch((e) => toast(errMsg(e), "error"));
  }, [order.length, toast]);

  const exportSettings = async () => {
    const dest = await save({ defaultPath: "ai-cockpit-settings.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!dest) return;
    try {
      await api.exportSettings(dest);
      toast("Settings exported (metadata only, no credentials)", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  if (!o) return null;
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[980px] space-y-4 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-ok" />
          <h1 className="text-[16px] font-semibold">Security &amp; data</h1>
        </div>

        <Card className="grid grid-cols-3 divide-x divide-line">
          <Fact label="Telemetry" value={<Badge tone="ok">OFF</Badge>} note="No analytics SDKs, crash reporters or remote services." />
          <Fact label="Credentials" value={<Badge tone="ok">never stored</Badge>} note="Logins live inside each CLI's own config directory." />
          <Fact label="Network" value={<Badge tone="ok">no backend</Badge>} note="Model traffic only from the official claude / codex processes." />
        </Card>

        <Card className="p-3">
          <SectionTitle>Where things live</SectionTitle>
          <dl className="grid grid-cols-[190px_1fr_auto] items-center gap-y-1.5 text-[12px]">
            <dt className="text-muted">App data (metadata)</dt>
            <dd className="font-mono text-[11.5px]">{o.dbPath}</dd>
            <dd><Button size="sm" onClick={() => void api.openKnownDir("data")}><FolderOpen size={12} /> Open data directory</Button></dd>
            <dt className="text-muted">Managed account profiles</dt>
            <dd className="font-mono text-[11.5px]">{o.profilesRoot}</dd>
            <dd><Button size="sm" onClick={() => void api.openKnownDir("profiles")}><FolderOpen size={12} /> Open</Button></dd>
            <dt className="text-muted">Session event files</dt>
            <dd className="font-mono text-[11.5px]">{o.runRoot}</dd>
            <dd />
          </dl>
          <p className="mt-2 text-[11.5px] text-faint">
            The database holds project paths, account nicknames + config directories, session metadata, numeric token counts and quota
            percentages. It never holds prompts, responses, source code, passwords or OAuth tokens.
          </p>
        </Card>

        <Card className="p-3">
          <SectionTitle>Account config directories (read by the cockpit)</SectionTitle>
          {o.accounts.length === 0 && <p className="text-[12px] text-faint">No accounts configured.</p>}
          <table className="w-full text-[12px]">
            <tbody>
              {o.accounts.map((a) => (
                <tr key={a.configDir} className="border-t border-line first:border-0">
                  <td className="py-1.5 pr-2"><ProviderMark provider={a.provider} /></td>
                  <td className="pr-3">{a.account}</td>
                  <td className="pr-3 font-mono text-[11px]">{a.configDir}</td>
                  <td className="pr-3">{a.managed ? <Badge tone="accent">managed</Badge> : <Badge>external</Badge>}</td>
                  <td className="font-mono text-[10.5px] text-faint">read-only: {a.reads.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-faint">
            Only numeric usage fields, model names, session ids and working directories are extracted. Credential files (e.g.
            <code> .credentials.json</code>, <code>auth.json</code>) are never opened by the cockpit.
          </p>
        </Card>

        <Card className="p-3">
          <SectionTitle>Running processes</SectionTitle>
          {o.processes.length === 0 ? (
            <p className="text-[12px] text-faint">No CLI processes running.</p>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="text-left text-[11px] text-faint"><tr><th className="font-medium">PID</th><th className="font-medium">Provider</th><th className="font-medium">Kind</th><th className="font-medium">Working directory</th></tr></thead>
              <tbody>
                {o.processes.map((p) => (
                  <tr key={p.sessionId} className="border-t border-line">
                    <td className="py-1 font-mono">{p.pid ?? "–"}</td>
                    <td><ProviderMark provider={p.provider} /></td>
                    <td className="text-muted">{p.kind}</td>
                    <td className="font-mono text-[11px]">{p.cwd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-3 text-[12px] text-muted">
          <SectionTitle>Session integration (Claude Code)</SectionTitle>
          <p>
            Each Claude session is launched with <code>--settings &lt;run-dir&gt;/settings.json</code>, which registers documented hooks and a
            statusLine pointing at this executable (<code>ai-cockpit sink …</code>). The sink keeps only event names, session ids, model name and
            rate-limit percentages; prompt text and tool input/output are discarded. It writes only inside the run directory. Your own
            settings files are not modified. Disable it in Settings if you prefer pure output-based status detection.
          </p>
        </Card>

        <Card className="flex flex-wrap items-center gap-2 p-3">
          <Button onClick={exportSettings}><Download size={12} /> Export local settings</Button>
          <Button variant="danger" onClick={() => setWipe(true)}><Trash2 size={12} /> Delete local app data…</Button>
        </Card>
      </div>
      {wipe && <WipeDialog onClose={() => setWipe(false)} />}
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: React.ReactNode; note: string }) {
  return (
    <div className="p-3">
      <div className="text-[11px] tracking-wide text-muted uppercase">{label}</div>
      <div className="my-1">{value}</div>
      <div className="text-[11px] text-faint">{note}</div>
    </div>
  );
}

function WipeDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [profiles, setProfiles] = useState(false);
  const toast = useApp((s) => s.toast);
  return (
    <Modal
      title="Delete local app data"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={text !== "DELETE"}
            onClick={async () => {
              try {
                await api.deleteAppData(text, profiles);
                window.location.reload();
              } catch (e) {
                toast(errMsg(e), "error");
              }
            }}
          >
            Delete
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[12.5px]">
        <p>This stops all sessions and erases the cockpit's database (projects, account entries, history, usage index, settings).</p>
        <p className="text-muted">Your project files, provider transcripts and external config directories (e.g. ~/.claude, ~/.codex) are not touched.</p>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={profiles} onChange={(e) => setProfiles(e.target.checked)} className="mt-0.5" />
          <span>Also delete managed profiles in ~/.ai-cockpit/profiles <span className="text-warn">(logs those profiles out)</span></span>
        </label>
        <div>
          <div className="mb-1 text-[11.5px] text-muted">Type DELETE to confirm</div>
          <Input value={text} onChange={(e) => setText(e.target.value)} className="w-full" />
        </div>
      </div>
    </Modal>
  );
}
