import { useEffect, useState } from "react";
import {
  ArrowLeft, ArrowRight, Bot, Gauge, GitPullRequestDraft, KanbanSquare, Keyboard, LayoutGrid, Mic, Pin, Settings, Smartphone, Sparkles,
} from "lucide-react";
import { useApp, type View } from "../store";
import { Button, Kbd, cx } from "./ui";

/** Bump when the tour gains steps worth showing again after an update. */
export const TOUR_VERSION = 1;

interface Step {
  icon: typeof Gauge;
  title: string;
  body: React.ReactNode;
  view?: View;
  cta?: string;
}

const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: "Willkommen im Robs AI Cockpit",
    body: (
      <>
        <p>Claude, Codex und andere KI-CLIs nebeneinander — mit Aufgaben, Automatik und Überblick über Tokens und Limits.</p>
        <p className="mt-2 text-muted">Diese Tour zeigt in 2 Minuten, was wo ist. Jeder Schritt hat „Zeig mir“; mit <Kbd>←</Kbd> <Kbd>→</Kbd> blätterst du, <Kbd>Esc</Kbd> schließt. Später wieder aufrufbar über <Kbd>F1</Kbd>.</p>
      </>
    ),
  },
  {
    icon: LayoutGrid,
    title: "Workspace: bis zu 8 Fenster",
    view: "workspace",
    body: (
      <ul className="list-disc space-y-1 pl-4">
        <li>Oben rechts <b>− / +</b> oder den Layout-Wähler für 1–8 Fenster. Gespeicherte Arbeitsplätze findest du im selben Menü.</li>
        <li>Unten die <b>Session-Leiste</b>: Session auf ein Fenster ziehen; Fensterkopf (⠿) auf ein anderes Fenster ziehen = tauschen.</li>
        <li>Sind alle Fenster voll, fragt das Cockpit, <b>welches Platz machen soll</b> — nichts wird mehr rausgeworfen.</li>
        <li><b>Doppelklick</b> auf den Fensterkopf oder <Kbd>Strg Umschalt F</Kbd>: nur dieses Fenster groß. <Kbd>Strg</Kbd>+Mausrad: Schriftgröße pro Fenster.</li>
        <li>Dateien oder Screenshots aus dem Explorer <b>auf ein Fenster ziehen</b> → der Pfad wird eingetippt.</li>
      </ul>
    ),
  },
  {
    icon: Gauge,
    title: "Overview: Tokens, Limits, Resets",
    view: "overview",
    body: (
      <ul className="list-disc space-y-1 pl-4">
        <li>Kachel <b>Tokens</b>: heute, 7 Tage, 30 Tage, gesamt — Klick öffnet Details mit Zeitraum, Accounts, Modellen und API-Gegenwert.</li>
        <li>Pro Account: Auslastung, <b>Reset-Countdown</b>, Tempo und Warnung „Limit vor dem Reset erreicht“. Ist ein Account im Limit, wird die Karte rot mit Reset-Zeit.</li>
        <li>An jeder Agenten-Karte: antworten (<Kbd>↑</Kbd> holt frühere Befehle), ★ Favoriten, 🔊 vorlesen, 📌 anpinnen, Antwort an einen anderen Agenten weitergeben.</li>
      </ul>
    ),
  },
  {
    icon: KanbanSquare,
    title: "Tasks: Arbeit verteilen",
    view: "tasks",
    body: (
      <ul className="list-disc space-y-1 pl-4">
        <li>Aufgabe anlegen, auf einen Agenten rechts ziehen oder „Give to…“ — die Antwort kommt automatisch in <b>Review</b> zurück.</li>
        <li>⚡ an einem Agenten + <b>Auto-dispatch</b>: freie Agenten holen sich die nächste Aufgabe selbst (Reihenfolge mit ↑/↓).</li>
        <li><b>Night shift</b>: die ⚡-Agenten arbeiten bis zur Uhrzeit alles ab, warten Limits aus, morgens Bericht + Push.</li>
        <li>„Give to… → New agent in its own worktree“: eigener Git-Branch pro Aufgabe, danach <b>Merge & done</b>.</li>
      </ul>
    ),
  },
  {
    icon: GitPullRequestDraft,
    title: "Review & Pins",
    view: "review",
    body: (
      <ul className="list-disc space-y-1 pl-4">
        <li><b>Review & commit</b>: alle Änderungen eines Repos als Diff — mit welchem Agenten sie zuletzt bearbeitet wurden. Selbst committen oder den Agenten committen lassen.</li>
        <li><b>Pins</b> (<Pin size={11} className="inline" />): wichtige Antworten mit Notizen sammeln, als Markdown exportieren.</li>
        <li><b>History</b>: Volltextsuche über alle Unterhaltungen. <b>Usage → Report</b>: Wochen-/Monatsbericht.</li>
      </ul>
    ),
  },
  {
    icon: Mic,
    title: "Sprache",
    view: "settings",
    cta: "Voice-Einstellungen",
    body: (
      <ul className="list-disc space-y-1 pl-4">
        <li>Hauptkürzel diktiert ins aktive Fenster; <Kbd>Alt Umschalt 1…8</Kbd> direkt in Fenster 1–8.</li>
        <li>Während der Aufnahme: <Kbd>1</Kbd>–<Kbd>8</Kbd> oder <Kbd>←</Kbd> <Kbd>→</Kbd> wechselt das Ziel, <Kbd>Enter</Kbd> sendet, <Kbd>Esc</Kbd> bricht ab.</li>
        <li>Sprachbefehle: „Fenster 3 stopp“, „Fenster 2 groß“, „alle weiter“, „zeig Aufgaben“. Mit Namen ansprechen: „Claude B, …“.</li>
      </ul>
    ),
  },
  {
    icon: Bot,
    title: "Weitere KI-Tools",
    view: "accounts",
    body: (
      <p>
        Unter <b>Accounts → Other CLIs</b> kannst du Gemini CLI, Qwen Code, Aider, OpenCode oder ein lokales Modell (Ollama) als Agenten hinzufügen. Sie laufen wie Claude und
        Codex in Fenstern und nehmen Aufgaben an — nur ohne Token- und Limitdaten.
      </p>
    ),
  },
  {
    icon: Smartphone,
    title: "Automatik & Handy",
    view: "settings",
    cta: "Einstellungen öffnen",
    body: (
      <ul className="list-disc space-y-1 pl-4">
        <li><b>Tests nach jeder Antwort</b> (Befehl je Projekt) mit grün/rot an Karte und Aufgabe.</li>
        <li>Warnungen: voller Kontext (/compact), hängender Agent, zwei Agenten an derselben Datei, <b>Token-Budget</b> pro Projekt.</li>
        <li><b>Push aufs Handy</b> (ntfy) und <b>Handy-Fernbedienung</b> im Heimnetz: Status sehen und antworten.</li>
        <li>Helles Design, Vorlesen, <b>Update from source</b> (neu bauen & neu starten per Klick).</li>
      </ul>
    ),
  },
  {
    icon: Keyboard,
    title: "Das Wichtigste auf einen Blick",
    body: (
      <>
        <p><Kbd>F1</Kbd> zeigt alle Tasten- und Sprachkürzel, <Kbd>Strg P</Kbd> die Befehlspalette (auch „Tour“), <Kbd>Strg 0</Kbd> wechselt zur Overview.</p>
        <p className="mt-2 text-muted">Viel Spaß beim Testen!</p>
      </>
    ),
  },
];

/** First-start tour (and "what's new" after updates that bump TOUR_VERSION). */
export function Tour() {
  const open = useApp((s) => s.tourOpen);
  const [i, setI] = useState(0);
  const close = () => {
    useApp.getState().setTourOpen(false);
    void useApp.getState().setSetting("tourSeen", TOUR_VERSION);
    setI(0);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Typing in a terminal (xterm uses a textarea) or a field keeps its keys.
      const t = document.activeElement?.tagName;
      if (t === "TEXTAREA" || t === "INPUT" || t === "SELECT") return;
      if (e.key === "ArrowRight") setI((x) => Math.min(STEPS.length - 1, x + 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
      else if (e.key === "Escape") close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const step = STEPS[i];
  const Icon = step.icon;
  const last = i === STEPS.length - 1;
  return (
    // Bottom-right card, not a blocking modal: "Zeig mir" shows the real view behind it.
    <div className="fixed right-4 bottom-10 z-[75] w-[440px] rounded-lg border border-accent/50 bg-panel shadow-2xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent"><Icon size={15} /></span>
        <b className="flex-1 text-[14px]">{step.title}</b>
        <span className="text-[11px] text-faint tabular">{i + 1}/{STEPS.length}</span>
      </div>
      <div className="px-4 py-3 text-[12.5px] leading-relaxed">{step.body}</div>
      <div className="flex items-center gap-1.5 border-t border-line px-4 py-2.5">
        <div className="mr-auto flex gap-1">
          {STEPS.map((_, k) => (
            <button key={k} onClick={() => setI(k)} className={cx("h-1.5 w-1.5 rounded-full", k === i ? "bg-accent" : "bg-line-strong hover:bg-muted")} title={STEPS[k].title} />
          ))}
        </div>
        {step.view && (
          <Button size="sm" onClick={() => useApp.getState().setView(step.view!)}>
            {step.view === "settings" ? <Settings size={11} /> : null} {step.cta ?? "Zeig mir"}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => setI(i - 1)}><ArrowLeft size={11} /></Button>
        {last ? (
          <Button size="sm" variant="primary" onClick={close}>Los geht's</Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => setI(i + 1)}>Weiter <ArrowRight size={11} /></Button>
        )}
        {!last && <Button size="sm" variant="ghost" onClick={close} title="Später über F1 wieder aufrufbar">Überspringen</Button>}
      </div>
    </div>
  );
}
