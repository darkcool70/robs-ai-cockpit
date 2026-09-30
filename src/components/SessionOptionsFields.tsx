import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight, FolderPlus, X } from "lucide-react";
import { api, type Account, type Autonomy, type ModelInfo, type Provider, type SessionOptions } from "../lib/api";
import { AUTONOMY } from "../lib/models";
import { Field, IconButton, Input, Select, cx } from "./ui";

/** Models + effort levels offered for an account (cached per account for the app lifetime). */
const catalogCache = new Map<string, ModelInfo[]>();
export function useModelCatalog(account: Account | undefined): ModelInfo[] {
  const [models, setModels] = useState<ModelInfo[]>(() => (account ? catalogCache.get(account.id) ?? [] : []));
  useEffect(() => {
    if (!account) return setModels([]);
    const cached = catalogCache.get(account.id);
    if (cached) return setModels(cached);
    let alive = true;
    api.modelCatalog(account.id).then((m) => {
      catalogCache.set(account.id, m);
      if (alive) setModels(m);
    }).catch(() => alive && setModels([]));
    return () => { alive = false; };
  }, [account?.id]);
  return models;
}

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export function effortsFor(provider: Provider, models: ModelInfo[], model: string): string[] {
  if (provider === "claude") return CLAUDE_EFFORTS;
  const m = models.find((x) => x.id === model);
  if (m?.efforts.length) return m.efforts;
  // Union over the catalog when the model is the config default.
  return [...new Set(models.flatMap((x) => x.efforts))];
}

/** Segmented autonomy picker with a provider-specific explanation. */
export function AutonomyPicker({ value, onChange, provider }: { value: Autonomy; onChange: (a: Autonomy) => void; provider: Provider }) {
  if (provider === "custom") {
    return <span className="text-[11.5px] text-faint">Custom CLIs start exactly as configured in their profile — permissions are handled inside the tool.</span>;
  }
  const current = AUTONOMY.find((a) => a.value === value) ?? AUTONOMY[0];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {AUTONOMY.map((a) => (
          <button
            key={a.value || "default"}
            type="button"
            onClick={() => onChange(a.value)}
            title={a.hint[provider]}
            className={cx(
              "h-6 rounded border px-2 text-[11.5px]",
              value === a.value
                ? a.value === "full" ? "border-err bg-err/15 text-err" : "border-accent bg-accent/15 text-accent"
                : "border-line-strong text-muted hover:bg-hover hover:text-fg",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
      <span className={cx("text-[11px]", value === "full" ? "text-err" : "text-faint")}>{current.hint[provider]}</span>
    </div>
  );
}

export interface OptionsState {
  model: string;
  options: SessionOptions;
  autoContinue: boolean;
}

/** Model / effort / advanced flags for one provider. Autonomy is rendered by the caller. */
export function ModelAndAdvanced({
  provider,
  account,
  state,
  onChange,
  showTask = true,
}: {
  provider: Provider;
  account: Account | undefined;
  state: OptionsState;
  onChange: (patch: Partial<OptionsState> & { options?: SessionOptions }) => void;
  showTask?: boolean;
}) {
  const models = useModelCatalog(account);
  const [advanced, setAdvanced] = useState(false);
  const o = state.options;
  const setOpt = (patch: Partial<SessionOptions>) => onChange({ options: { ...o, ...patch } });
  const efforts = effortsFor(provider, models, state.model);
  const listId = `models-${account?.id ?? provider}`;

  const addDir = async () => {
    const d = await openDialog({ directory: true, title: "Additional directory the agent may use" });
    if (typeof d === "string" && !(o.addDirs ?? []).includes(d)) setOpt({ addDirs: [...(o.addDirs ?? []), d] });
  };

  return (
    <div className="grid gap-3">
      {provider !== "custom" && <div className="grid grid-cols-2 gap-3">
        <Field label="Model" hint={provider === "claude" ? "Alias = newest of that family. Empty = your default." : "Empty = model from your Codex config."}>
          <Input list={listId} value={state.model} onChange={(e) => onChange({ model: e.target.value.trim() })} placeholder="CLI default" />
          <datalist id={listId}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </datalist>
        </Field>
        <Field label={provider === "claude" ? "Effort" : "Reasoning effort"}>
          <Select value={o.effort ?? ""} onChange={(e) => setOpt({ effort: e.target.value || null })}>
            <option value="">CLI default</option>
            {efforts.map((e) => <option key={e} value={e}>{e}</option>)}
          </Select>
        </Field>
      </div>}
      {showTask && (
        <Field label="Task to start with (optional)" hint="Typed into the session as soon as it is ready — then it just runs.">
          <textarea
            value={o.initialPrompt ?? ""}
            onChange={(e) => setOpt({ initialPrompt: e.target.value })}
            rows={3}
            placeholder="e.g. Fix the failing tests in src/, then summarise what you changed."
            className="rounded border border-line-strong bg-bg px-2 py-1.5 text-[12.5px] placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </Field>
      )}
      <label className="flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" checked={state.autoContinue} onChange={(e) => onChange({ autoContinue: e.target.checked })} className="mt-0.5" />
        <span>
          Continue automatically after a usage limit
          <span className="block text-[11px] text-faint">Waits for the reset time the CLI prints (or the quota data), then sends "continue". Optionally switches to another account (Settings).</span>
        </span>
      </label>
      <button type="button" className="flex items-center gap-1 text-left text-[11.5px] font-medium text-muted hover:text-fg" onClick={() => setAdvanced((a) => !a)}>
        {advanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Advanced
      </button>
      {advanced && (
        <div className="grid gap-3 rounded border border-line p-2.5">
          <Field label="Additional directories" hint="The agent may read and edit these too (--add-dir).">
            <div className="flex flex-col gap-1">
              {(o.addDirs ?? []).map((d) => (
                <div key={d} className="flex items-center gap-1 rounded bg-hover px-2 py-0.5 font-mono text-[11px]">
                  <span className="flex-1 truncate" title={d}>{d}</span>
                  <IconButton title="Remove" onClick={() => setOpt({ addDirs: (o.addDirs ?? []).filter((x) => x !== d) })}><X size={11} /></IconButton>
                </div>
              ))}
              <button type="button" onClick={addDir} className="flex h-6 items-center gap-1 self-start rounded border border-line-strong px-2 text-[11.5px] text-muted hover:bg-hover hover:text-fg">
                <FolderPlus size={12} /> Add directory…
              </button>
            </div>
          </Field>
          {provider === "claude" ? (
            <>
              <Field label="Extra system instructions" hint="Appended to Claude's system prompt (--append-system-prompt).">
                <Input value={o.appendSystemPrompt ?? ""} onChange={(e) => setOpt({ appendSystemPrompt: e.target.value })} placeholder="e.g. Answer in German. Run the tests before finishing." />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Fallback model" hint="Used when the main model is overloaded.">
                  <Input list={listId} value={o.fallbackModel ?? ""} onChange={(e) => setOpt({ fallbackModel: e.target.value.trim() })} placeholder="e.g. sonnet" />
                </Field>
                <label className="flex items-center gap-2 pt-4 text-[12.5px]">
                  <input type="checkbox" checked={!!o.chrome} onChange={(e) => setOpt({ chrome: e.target.checked })} />
                  Claude in Chrome (--chrome)
                </label>
              </div>
            </>
          ) : (
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={!!o.webSearch} onChange={(e) => setOpt({ webSearch: e.target.checked })} />
              Live web search (--search)
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** Drop empty values so stored options stay minimal. */
export function cleanOptions(o: SessionOptions): SessionOptions {
  const out: SessionOptions = {};
  if (o.autonomy) out.autonomy = o.autonomy;
  if (o.effort) out.effort = o.effort;
  const dirs = (o.addDirs ?? []).filter((d) => d.trim());
  if (dirs.length) out.addDirs = dirs;
  if (o.appendSystemPrompt?.trim()) out.appendSystemPrompt = o.appendSystemPrompt.trim();
  if (o.fallbackModel?.trim()) out.fallbackModel = o.fallbackModel.trim();
  if (o.webSearch) out.webSearch = true;
  if (o.chrome) out.chrome = true;
  if (o.initialPrompt?.trim()) out.initialPrompt = o.initialPrompt.trim();
  return out;
}

/** Keep only options that make sense for the provider (e.g. after switching account). */
export function optionsForProvider(o: SessionOptions, provider: Provider, efforts: string[]): SessionOptions {
  const out = { ...o };
  if (provider === "claude") delete out.webSearch;
  else {
    delete out.appendSystemPrompt;
    delete out.fallbackModel;
    delete out.chrome;
  }
  if (out.effort && efforts.length && !efforts.includes(out.effort)) delete out.effort;
  return out;
}
