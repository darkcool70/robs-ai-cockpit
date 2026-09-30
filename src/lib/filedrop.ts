// Drop files or screenshots from Explorer onto a pane: their paths are typed into that
// session (Claude Code and Codex pick up images and files from pasted paths).
import { api, errMsg } from "./api";
import { useApp } from "../store";

/** Paths as the CLIs expect them: quoted when they contain spaces. */
export function pathsForTerminal(paths: string[]): string {
  return paths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(" ");
}

function paneAt(x: number, y: number): number | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const t = (el as HTMLElement).closest?.("[data-drop]") as HTMLElement | null;
    const n = t ? Number(t.dataset.drop) : NaN;
    if (Number.isInteger(n)) return n;
  }
  return null;
}

let started = false;
export async function initFileDrop() {
  if (started) return;
  started = true;
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  await getCurrentWebview().onDragDropEvent((ev) => {
    const st = useApp.getState();
    const p = ev.payload;
    if (p.type === "leave") {
      st.setDrag(null);
      return;
    }
    const pos = "position" in p ? p.position : null;
    if (!pos) return;
    const x = pos.x / window.devicePixelRatio;
    const y = pos.y / window.devicePixelRatio;
    const pane = st.view === "workspace" ? paneAt(x, y) : null;
    if (p.type === "over" || p.type === "enter") {
      // Reuse the pane highlight of session drags.
      st.setDrag(pane != null ? { id: "__files__", x, y, over: pane } : null);
      return;
    }
    if (p.type !== "drop") return;
    st.setDrag(null);
    const id = pane != null ? st.panes[pane] : st.panes[st.focused];
    const s = id ? st.sessions[id] : undefined;
    if (!s?.runtime?.running) {
      st.toast("Drop files onto a pane with a running session", "warn");
      return;
    }
    const text = pathsForTerminal(p.paths);
    api
      .ptyWrite(s.id, `${text} `)
      .then(() => {
        st.toast(`${p.paths.length} file${p.paths.length === 1 ? "" : "s"} → ${s.name} (typed, not sent)`, "ok");
        st.focusPane(pane ?? st.focused);
      })
      .catch((e) => st.toast(errMsg(e), "error"));
  });
}
