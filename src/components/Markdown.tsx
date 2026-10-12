// Just enough Markdown for agent answers in chat bubbles: code fences, headings, lists,
// **bold**, `code`. Builds React nodes (never innerHTML), so agent text cannot inject markup.
import type { ReactNode } from "react";

/** `[[id]]` references to things outside the text (board cards): their name, and what a click does. */
export interface MdRefs {
  resolve: (id: string) => string | null;
  open: (id: string) => void;
  hover?: (id: string) => void;
}

function inline(text: string, key: string, refs?: MdRefs): ReactNode[] {
  const out: ReactNode[] = [];
  const re = refs ? /(`[^`]+`|\*\*[^*]+\*\*|\[\[[\w-]{1,40}\]\])/g : /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (refs && t.startsWith("[[")) {
      const id = t.slice(2, -2);
      const name = refs.resolve(id);
      out.push(
        // a card that is not there (any more) is left out — a bare id means nothing to a reader
        name ? (
          <button key={`${key}-${i++}`} className="md-ref" title={`Show “${name}” on the board`} onClick={() => refs.open(id)} onMouseEnter={() => refs.hover?.(id)}>{name}</button>
        ) : null,
      );
      last = m.index + t.length;
      continue;
    }
    out.push(
      t.startsWith("`") ? (
        <code key={`${key}-${i++}`} className="rounded bg-hover px-1 py-px font-mono text-[0.9em]">{t.slice(1, -1)}</code>
      ) : (
        <b key={`${key}-${i++}`}>{t.slice(2, -2)}</b>
      ),
    );
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, refs }: { text: string; refs?: MdRefs }) {
  const blocks: ReactNode[] = [];
  const parts = text.split(/```/);
  parts.forEach((part, pi) => {
    if (pi % 2 === 1) {
      const body = part.replace(/^[\w-]*\n/, "").replace(/\n$/, "");
      blocks.push(
        <pre key={`c${pi}`} className="my-1.5 overflow-x-auto rounded-md border border-line bg-bg px-2.5 py-2 font-mono text-[11.5px] leading-snug">{body}</pre>,
      );
      return;
    }
    let list: ReactNode[] = [];
    const flush = (k: string) => {
      if (list.length) blocks.push(<ul key={k} className="my-1 list-disc space-y-0.5 pl-5">{list}</ul>);
      list = [];
    };
    part.split("\n").forEach((line, li) => {
      const k = `${pi}-${li}`;
      const bullet = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      if (bullet) {
        list.push(<li key={k}>{inline(bullet[1], k, refs)}</li>);
        return;
      }
      flush(`l${k}`);
      const h = line.match(/^#{1,4}\s+(.*)$/);
      if (h) blocks.push(<p key={k} className="mt-1.5 font-semibold">{inline(h[1], k, refs)}</p>);
      else if (line.trim()) blocks.push(<p key={k}>{inline(line, k, refs)}</p>);
      else blocks.push(<div key={k} className="h-1.5" />);
    });
    flush(`l${pi}-end`);
  });
  return <div className="text-[13px] leading-relaxed break-words">{blocks}</div>;
}
