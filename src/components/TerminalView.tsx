import { useEffect, useRef } from "react";
import * as terms from "../lib/terminals";
import { useApp } from "../store";
import { errMsg } from "../lib/api";

/** Hosts the cached xterm instance for `id`. The instance survives unmounts. */
export function TerminalView({ id, onReady }: { id: string; onReady?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    terms.mount(id, el);
    // Ctrl + wheel: font size of this pane only (native listener: React's wheel is passive).
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      terms.zoomTerminal(id, e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    let cancelled = false;
    terms.attach(id).then(() => {
      if (!cancelled) readyRef.current?.();
    }).catch((e) => {
      if (!cancelled) {
        useApp.getState().markStarted(id);
        useApp.getState().toast(`Terminal connection failed: ${errMsg(e)}`, "error");
      }
    });
    return () => {
      cancelled = true;
      el.removeEventListener("wheel", onWheel, { capture: true });
      terms.unmount(id, el);
    };
  }, [id]);

  // Contain xterm's internal z-indices so its viewport cannot cover pane controls.
  return <div ref={host} className="absolute inset-0 z-0" onMouseDown={() => setTimeout(() => terms.focus(id), 0)} />;
}
