// Account health on an account card: the last turn that failed on the model or the login (calm,
// one line + the fix), "Try again" to clear it, and the cockpit's own model for this account
// (never written into the CLI's config files). See lib/accountHealth.ts.
import { useEffect, useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { saveAccountIssues, useApp } from "../store";
import { api, type Account, type ModelInfo } from "../lib/api";
import { ago } from "../lib/format";
import { accountModel, clearIssue, freshIssue, issueFix, readAccountModels, readIssues, suggestModel } from "../lib/accountHealth";
import { Button, Select, cx } from "../components/ui";

export function AccountHealth({ account: a }: { account: Account }) {
  // raw setting values (stable references) — derived values are computed below, never in a selector
  const rawIssues = useApp((s) => s.settings.accountHealth);
  const rawModels = useApp((s) => s.settings.accountModels);
  const issue = freshIssue(readIssues({ accountHealth: rawIssues }), a.id);
  const own = accountModel({ accountModels: rawModels }, a.id);
  const [catalog, setCatalog] = useState<ModelInfo[] | null>(null);
  const [pick, setPick] = useState("");
  const wantsModel = issue?.kind === "model" && a.provider !== "custom";

  useEffect(() => {
    if (!wantsModel || catalog) return;
    api.modelCatalog(a.id).then(setCatalog).catch(() => setCatalog([]));
  }, [wantsModel, a.id, catalog]);
  const suggestion = catalog ? suggestModel(catalog, issue?.model, own) : null;
  useEffect(() => {
    if (suggestion && !pick) setPick(suggestion);
  }, [suggestion, pick]);

  if (!issue && !own) return null;

  const retry = () => saveAccountIssues(clearIssue(readIssues(useApp.getState().settings), a.id));
  const setOwn = (model: string | null) => {
    const next = { ...readAccountModels(useApp.getState().settings) };
    if (model) next[a.id] = model;
    else delete next[a.id];
    void useApp.getState().setSetting("accountModels", next);
    if (model) {
      retry();
      useApp.getState().toast(`New cockpit sessions on ${a.name} use ${model}. Your CLI config stays as it is.`, "ok");
    }
  };

  return (
    <div className={cx("space-y-1.5 rounded border px-2 py-1.5 text-[11.5px]", issue ? "border-warn/30 bg-warn/5" : "border-line")}>
      {issue && (
        <>
          <p className="flex items-start gap-1.5">
            <AlertTriangle size={12} className="mt-[2px] shrink-0 text-warn" />
            <span className="min-w-0">
              <b className="text-warn">{issue.kind === "model" ? "Model not available" : "Login failed"}</b>
              <span className="text-muted"> — {issue.message}</span>
              <span className="text-faint"> · {ago(issue.at)}</span>
            </span>
          </p>
          <p className="text-muted">{issueFix(issue, a.provider, a.configDir)}</p>
          <p className="text-faint">The operator starts new agents and reviewers on another account for 6 h, as long as one works.</p>
        </>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {wantsModel && catalog && catalog.length > 0 && (
          <>
            <Select value={pick} onChange={(e) => setPick(e.target.value)} title="Model the cockpit passes when it starts sessions on this account">
              {catalog.map((m) => (
                <option key={m.id} value={m.id}>{m.label}{m.id === suggestion ? " (suggested)" : ""}</option>
              ))}
            </Select>
            <Button size="sm" disabled={!pick} onClick={() => setOwn(pick)} title="Only the cockpit's own sessions — your CLI config file is not changed">
              Use for cockpit sessions
            </Button>
          </>
        )}
        {issue && (
          <Button size="sm" variant="ghost" onClick={retry} title="Forget this failure — the next agent may use this account again">
            <RotateCcw size={11} /> Try again
          </Button>
        )}
      </div>
      {own && (
        <p className="text-muted">
          Cockpit sessions here use <b className="text-fg">{own}</b> (unless a session picks its own model).{" "}
          <button className="text-accent hover:underline" onClick={() => setOwn(null)}>Back to the CLI default</button>
        </p>
      )}
    </div>
  );
}
