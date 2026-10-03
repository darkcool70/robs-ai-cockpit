// Just enough Markdown for agent answers in chat bubbles: code fences, headings, lists,
// **bold**, `code`. Builds React nodes (never innerHTML), so agent text cannot inject markup.
import type { ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
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

export function Markdown({ text }: { text: string }) {
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
        list.push(<li key={k}>{inline(bullet[1], k)}</li>);
        return;
      }
      flush(`l${k}`);
      const h = line.match(/^#{1,4}\s+(.*)$/);
      if (h) blocks.push(<p key={k} className="mt-1.5 font-semibold">{inline(h[1], k)}</p>);
      else if (line.trim()) blocks.push(<p key={k}>{inline(line, k)}</p>);
      else blocks.push(<div key={k} className="h-1.5" />);
    });
    flush(`l${pi}-end`);
  });
  return <div className="text-[13px] leading-relaxed break-words">{blocks}</div>;
}
