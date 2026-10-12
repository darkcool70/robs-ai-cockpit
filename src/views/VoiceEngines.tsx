// „Stimmen-Engine“ in the Voice tab: Piper (offline, small), Supertonic (offline, natural) and
// Azure (cloud, opt-in with your own key) — each with its own voice list and setup.
import { useState } from "react";
import { CheckCircle2, Cloud, Cpu, Download, KeyRound, Play, Sparkles, Trash2 } from "lucide-react";
import { useApp } from "../store";
import { api, errMsg, type TtsEngineId, type TtsStatus, type TtsVoice } from "../lib/api";
import { DEFAULT_NEURAL, engineOf, refreshNeural, speak } from "../lib/tts";
import { Badge, Button, Field, cx } from "../components/ui";

const SAMPLE = {
  de: "Hallo Rob, ich habe das Dashboard fertig. Drei Agenten arbeiten noch, zwei Änderungen warten auf deine Prüfung. Soll ich weitermachen?",
  en: "Good evening. All systems are online. Agent two has finished and the tests are green. Shall I merge the changes?",
};

const ENGINES: { id: TtsEngineId; label: string; tag: string; icon: typeof Cpu }[] = [
  { id: "supertonic", label: "Supertonic", tag: "offline · natürlich", icon: Sparkles },
  { id: "piper", label: "Piper", tag: "offline · klein", icon: Cpu },
  { id: "azure", label: "Azure", tag: "Cloud · eigener Schlüssel", icon: Cloud },
];

const INPUT = "w-full rounded border border-line-strong bg-bg px-2 py-1 text-[12px] focus:border-accent focus:outline-none";

/** Engine choice + the voices of that engine. `active` is the voice in use. */
export function VoiceEngines({
  tts,
  active,
  busy,
  install,
  reload,
}: {
  tts: TtsStatus | null;
  active: string | null;
  busy: boolean;
  install: (id: string) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const settings = useApp((s) => s.settings);
  const setSetting = useApp((s) => s.setSetting);
  const shown: TtsEngineId = (["piper", "supertonic", "azure"] as const).find((e) => e === settings.ttsVoiceEngine) ?? (active ? engineOf(active) : "supertonic");
  const engine = tts?.engines?.find((e) => e.id === shown);
  const list = (tts?.voices ?? []).filter((v) => (v.engine ?? "piper") === shown);

  const choose = (v: TtsVoice) => {
    const before = active ? engineOf(active) : null;
    void setSetting("ttsNeuralVoice", v.id);
    void setSetting("ttsEngine", "auto");
    // the natural model holds ~0.5 GB: give it back when another engine speaks now
    if (before === "supertonic" && (v.engine ?? "piper") !== "supertonic") void api.ttsRelease("supertonic").catch(() => {});
  };

  return (
    <div className="space-y-2">
      <Field label="Stimmen-Engine">
        <div className="grid grid-cols-3 gap-1">
          {ENGINES.map(({ id, label, tag, icon: Icon }) => {
            const ready = tts?.engines?.find((e) => e.id === id)?.ready;
            return (
              <button
                key={id}
                onClick={() => void setSetting("ttsVoiceEngine", id)}
                className={cx("rounded border px-2 py-1.5 text-left", shown === id ? "border-accent bg-accent/10 text-fg" : "border-line text-muted hover:text-fg")}
              >
                <span className="flex items-center gap-1.5 text-[12px] font-medium">
                  <Icon size={12} /> {label}
                  {ready && <CheckCircle2 size={11} className="text-ok" />}
                  {active && engineOf(active) === id && <Badge tone="accent">aktiv</Badge>}
                </span>
                <span className="block text-[10.5px] text-faint">{tag}</span>
              </button>
            );
          })}
        </div>
      </Field>

      {shown === "piper" && (
        <p className="text-[11.5px] text-faint">
          Kleine neuronale Stimmen, offline, sofort (~0,1 s je Satz) — klingen aber hörbar synthetisch. Einmalig Engine (22 MB, GitHub) und je Stimme 20–114 MB (Hugging Face), per Prüfsumme geprüft. Bleibt immer die
          Ersatzstimme, wenn Supertonic oder Azure einmal nicht können.
        </p>
      )}
      {shown === "supertonic" && (
        <div className="space-y-1.5 rounded border border-line px-2.5 py-2 text-[11.5px]">
          <p className="text-faint">
            Deutlich natürlicheres Deutsch, trotzdem komplett auf diesem PC: <b>Supertonic 3</b> (Supertone) über ONNX Runtime. Zehn Stimmen, fünf Männer, fünf Frauen; Englisch spricht dieselbe Stimme mit.
            Einmalig ~{engine?.sizeMb ?? 415} MB (Hugging Face + Microsoft, per Prüfsumme geprüft), ~0,5 GB Arbeitsspeicher solange aktiv, der erste Satz braucht etwa eine halbe bis eine Sekunde.
          </p>
          <p className="text-[10.5px] text-faint">
            Modell-Lizenz OpenRAIL-M: frei nutzbar, auch geschäftlich — verboten ist u. a., echte Menschen ohne Einwilligung nachzuahmen oder Gesprochenes als echte Aufnahme auszugeben. ONNX Runtime: MIT.
          </p>
          {!engine?.ready && (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() =>
                void install("st-M4").then(async () => {
                  // downloaded on purpose: Max speaks from now on (another one is a click away)
                  const st = await refreshNeural();
                  const max = st?.voices.find((v) => v.id === "st-M4" && v.installed);
                  if (max) choose(max);
                })
              }
            >
              <Download size={12} /> Supertonic-Stimmen laden ({engine?.sizeMb ?? 415} MB)
            </Button>
          )}
          {engine?.ready && (
            // how much care each sentence gets: quicker start or the finest sound
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <span className="text-muted">Klang</span>
              <div className="flex overflow-hidden rounded-md border border-line" role="radiogroup" aria-label="Klang">
                {([["fast", "Schnell", "Erster Satz am schnellsten, minimal rauer"], ["balanced", "Ausgewogen", "Kaum vom besten Klang zu unterscheiden (Standard)"], ["best", "Beste", "Feinster Klang, der erste Satz braucht spürbar länger"]] as const).map(([q, label, hint]) => {
                  const on = (settings.ttsQuality ?? "balanced") === q;
                  return (
                    <button key={q} role="radio" aria-checked={on} title={hint} onClick={() => void setSetting("ttsQuality", q)} className={cx("px-2.5 py-0.5 text-[11.5px]", on ? "bg-accent/15 text-accent" : "text-muted hover:bg-hover hover:text-fg")}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {shown === "azure" && <AzureSetup tts={tts} reload={reload} />}

      <div className="grid gap-1.5">
        {list.map((v) => {
          const chosen = active === v.id;
          return (
            <div key={v.id} className={cx("flex items-center gap-2 rounded border px-2 py-1.5", chosen ? "border-accent bg-accent/5" : "border-line")}>
              <input type="radio" disabled={!v.installed} checked={chosen} onChange={() => choose(v)} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{v.label}</span>
                {(v.id === DEFAULT_NEURAL[v.lang] || v.id === "st-M4" || v.id === "st-F1") && <span className="ml-1.5 text-[10.5px] text-accent">empfohlen</span>}
                <span className="block text-[11px] text-faint">{v.hint}</span>
              </span>
              {v.installed ? (
                <>
                  <Button size="sm" variant="ghost" title="Anhören" onClick={() => speak(SAMPLE[v.lang], { voice: v.id, name: v.label })}><Play size={11} /></Button>
                  <span className="flex items-center gap-1 text-[11px] text-ok"><CheckCircle2 size={12} /></span>
                </>
              ) : shown === "piper" ? (
                <Button size="sm" disabled={busy} onClick={() => void install(v.id)}><Download size={12} /> {v.sizeMb} MB</Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Azure: opt-in with your own key. Text leaves the PC — said plainly before anything is stored. */
function AzureSetup({ tts, reload }: { tts: TtsStatus | null; reload: () => Promise<void> }) {
  const toast = useApp((s) => s.toast);
  const azure = tts?.engines?.find((e) => e.id === "azure");
  const [region, setRegion] = useState(azure?.region ?? "germanywestcentral");
  const [key, setKey] = useState("");
  const [agree, setAgree] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.ttsCloudKey("azure", region, key);
      setKey("");
      toast("Azure-Schlüssel geprüft und verschlüsselt gespeichert", "ok");
      await refreshNeural();
      await reload();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    await api.ttsCloudKey("azure", null, null).catch(() => {});
    const st = useApp.getState();
    if (engineOf(st.settings.ttsNeuralVoice as string) === "azure") void st.setSetting("ttsNeuralVoice", DEFAULT_NEURAL.de);
    toast("Azure-Schlüssel gelöscht", "ok");
    await refreshNeural();
    await reload();
  };

  return (
    <div className="space-y-2 rounded border border-warn/40 bg-warn/5 px-2.5 py-2 text-[11.5px]">
      <p>
        <b>Cloud-Stimmen von Microsoft Azure</b> klingen am natürlichsten (Seraphina, Florian, Katja, Conrad …). Dafür wird <b>jeder gesprochene Satz an Microsoft geschickt</b> — in die Region deines
        Schlüssels (z. B. Deutschland West-Mitte); laut Microsoft wird der Text für die Sprachausgabe nicht gespeichert.
      </p>
      <p className="text-faint">
        Du brauchst eine eigene Azure-Speech-Ressource (portal.azure.com → „Speech“ anlegen → KEY 1 und Region kopieren). Kostenlos bis 0,5 Mio. Zeichen im Monat (Tarif F0), danach rund 15 $ je 1 Mio.
        Zeichen, HD-Stimmen etwa doppelt so viel. Ohne Netz, bei leerem Kontingent oder falschem Schlüssel spricht der Satz automatisch die lokale Stimme.
      </p>
      {azure?.ready ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ok">Schlüssel gespeichert · Region {azure.region ?? "?"}</Badge>
          <span className="text-[10.5px] text-faint">mit Windows verschlüsselt, nur für dein Benutzerkonto lesbar</span>
          <Button size="sm" variant="ghost" onClick={() => void remove()}><Trash2 size={11} /> Schlüssel löschen</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <Field label="Region">
              <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="germanywestcentral" className={INPUT} spellCheck={false} />
            </Field>
            <Field label="Schlüssel (KEY 1)">
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder="wird nicht angezeigt und nie geloggt" className={INPUT} />
            </Field>
          </div>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
            <span>Ja, gesprochene Texte dürfen an Microsoft Azure gehen, wenn ich eine Azure-Stimme wähle.</span>
          </label>
          <Button size="sm" variant="primary" disabled={!agree || !key.trim() || !region.trim() || saving} onClick={() => void save()}>
            <KeyRound size={11} /> {saving ? "Prüfe…" : "Prüfen & speichern"}
          </Button>
        </div>
      )}
    </div>
  );
}
