// Drag a session (sidebar, dock, pane header) onto a pane. Pointer events instead of HTML5
// drag and drop: the WebView's own file-drop handling swallows HTML5 drag events on Windows.
import type { PointerEvent as ReactPointerEvent } from "react";
import { useApp } from "../store";

const THRESHOLD = 6;

/** Drop target under the pointer: a pane index, "new" (add-pane zone) or null. */
export function dropTargetAt(x: number, y: number): number | "new" | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const t = (el as HTMLElement).closest?.("[data-drop]") as HTMLElement | null;
    if (!t) continue;
    const v = t.dataset.drop ?? "";
    if (v === "new") return "new";
    const n = Number(v);
    if (Number.isInteger(n)) return n;
  }
  return null;
}

/** Spread onto any element that represents a session: click still works, a drag moves it. */
export function sessionDrag(id: string) {
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      const sx = e.clientX;
      const sy = e.clientY;
      let dragging = false;
      const cleanup = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("keydown", esc, true);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };
      const move = (ev: PointerEvent) => {
        if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
        if (!dragging) {
          dragging = true;
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
        }
        useApp.getState().setDrag({ id, x: ev.clientX, y: ev.clientY, over: dropTargetAt(ev.clientX, ev.clientY) });
      };
      const esc = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        dragging = false;
        cleanup();
        useApp.getState().setDrag(null);
      };
      const up = (ev: PointerEvent) => {
        cleanup();
        if (!dragging) return;
        const st = useApp.getState();
        st.setDrag(null);
        // The click that follows a drag must not also "open" the session.
        const swallow = (c: MouseEvent) => {
          c.stopPropagation();
          c.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
        const over = dropTargetAt(ev.clientX, ev.clientY);
        if (over === "new") st.addPane(id);
        else if (typeof over === "number") st.placeSession(id, over);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("keydown", esc, true);
    },
  };
}
