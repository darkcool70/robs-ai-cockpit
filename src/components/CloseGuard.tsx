import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../store";
import { closeDecision, closeTexts, workingAgentNames } from "../lib/closeGuard";
import { Button, Modal } from "./ui";

/**
 * Holds back closing the main window while agents are mid-turn and asks first.
 * The handler only exists while this component is mounted: if the frontend crashes it goes
 * away with it, and Tauri then closes the window without asking — the user is never trapped.
 */
export function CloseGuard() {
  const [names, setNames] = useState<string[] | null>(null);
  const askedAt = useRef<number | null>(null);
  const en = useApp((s) => s.settings.voiceLanguage === "en");

  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    const win = getCurrentWindow();
    // Never touch the heads-up or presenter windows.
    if (win.label !== "main") return;
    win
      .onCloseRequested(async (event) => {
        try {
          const working = workingAgentNames(useApp.getState().sessions);
          const what = closeDecision(working.length, askedAt.current, Date.now());
          // "close": leave the event alone, Tauri's own handler then destroys the window.
          if (what === "close") return;
          event.preventDefault();
          if (what === "ask") {
            askedAt.current = Date.now();
            setNames(working);
          }
        } catch {
          // Anything unexpected: do not hold the window back.
        }
      })
      .then((fn) => (gone ? fn() : (off = fn)))
      .catch(() => {});
    return () => {
      gone = true;
      off?.();
    };
  }, []);

  if (!names) return null;
  const t = closeTexts(names, en);
  const keep = () => {
    askedAt.current = null;
    setNames(null);
  };
  return (
    <Modal
      title={t.title}
      onClose={keep}
      width={460}
      footer={
        <>
          <Button onClick={keep} autoFocus>{t.keep}</Button>
          <Button variant="danger" onClick={() => void getCurrentWindow().destroy()}>{t.close}</Button>
        </>
      }
    >
      <p className="text-[12.5px]">{t.body}</p>
    </Modal>
  );
}
