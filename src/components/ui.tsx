import { clsx } from "clsx";
import { X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import type { Provider, SessionStatus } from "../lib/api";

export const cx = clsx;

type Variant = "default" | "primary" | "ghost" | "danger";

export function Button({
  variant = "default",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center gap-1.5 rounded border font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" ? "h-6 px-2 text-[11.5px]" : "h-7 px-2.5 text-[12.5px]",
        variant === "default" && "border-line-strong bg-raised hover:bg-hover text-fg",
        variant === "primary" && "border-accent/60 bg-accent/15 text-accent hover:bg-accent/25",
        variant === "ghost" && "border-transparent text-muted hover:text-fg hover:bg-hover",
        variant === "danger" && "border-err/50 bg-err/10 text-err hover:bg-err/20",
        className,
      )}
    />
  );
}

export function IconButton({ className, title, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return (
    <button
      {...rest}
      title={title}
      aria-label={title}
      className={cx(
        "inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:text-fg hover:bg-hover disabled:opacity-30 disabled:pointer-events-none",
        className,
      )}
    />
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        "h-7 rounded border border-line-strong bg-bg px-2 text-[12.5px] placeholder:text-faint focus:border-accent focus:outline-none",
        className,
      )}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cx("h-7 rounded border border-line-strong bg-bg px-1.5 text-[12.5px] focus:border-accent focus:outline-none", className)}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-raised px-1 font-mono text-[10.5px] text-muted">{children}</kbd>;
}

export function ProviderMark({ provider, className }: { provider: Provider; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-1 font-mono text-[9.5px] font-bold uppercase",
        provider === "claude" ? "bg-claude/15 text-claude" : provider === "codex" ? "bg-codex/15 text-codex" : "bg-accent/15 text-accent",
        className,
      )}
      title={provider === "claude" ? "Claude Code" : provider === "codex" ? "Codex CLI" : "Custom CLI"}
    >
      {provider === "claude" ? "CC" : provider === "codex" ? "CX" : "AI"}
    </span>
  );
}

const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  idle: { dot: "bg-faint", label: "idle" },
  starting: { dot: "bg-accent animate-pulse", label: "starting" },
  working: { dot: "bg-accent animate-pulse", label: "working" },
  "waiting-for-input": { dot: "bg-ok", label: "waiting for input" },
  "rate-limited": { dot: "bg-warn", label: "rate limited" },
  stopped: { dot: "bg-line-strong", label: "stopped" },
  failed: { dot: "bg-err", label: "failed" },
};

export function StatusDot({ status, withLabel = false }: { status: SessionStatus | string; withLabel?: boolean }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.idle;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5" title={s.label}>
      <span className={cx("h-2 w-2 shrink-0 rounded-full", s.dot)} />
      {withLabel && <span className="text-[11.5px] whitespace-nowrap text-muted">{s.label}</span>}
    </span>
  );
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "err" | "accent"; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-[18px] items-center rounded px-1.5 text-[10.5px] font-medium whitespace-nowrap",
        tone === "neutral" && "bg-hover text-muted",
        tone === "ok" && "bg-ok/12 text-ok",
        tone === "warn" && "bg-warn/12 text-warn",
        tone === "err" && "bg-err/12 text-err",
        tone === "accent" && "bg-accent/12 text-accent",
      )}
    >
      {children}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]" onMouseDown={onClose}>
      <div
        className="flex max-h-[76vh] flex-col rounded-md border border-line-strong bg-panel shadow-2xl"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-9 items-center justify-between border-b border-line px-3">
          <span className="text-[13px] font-semibold">{title}</span>
          <IconButton title="Close" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
        <div className="overflow-auto p-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-3 py-2">{footer}</div>}
      </div>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-[11px] font-semibold tracking-wider text-muted uppercase">{children}</h2>
      {right}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-md border border-line bg-panel", className)}>{children}</div>;
}

export function Meter({ value, tone }: { value: number; tone?: "ok" | "warn" | "err" | "accent" }) {
  const v = Math.max(0, Math.min(100, value));
  const t = tone ?? (v >= 90 ? "err" : v >= 70 ? "warn" : "accent");
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-hover">
      <div
        className={cx("h-full rounded-full", t === "ok" && "bg-ok", t === "warn" && "bg-warn", t === "err" && "bg-err", t === "accent" && "bg-accent")}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6 text-center text-[12.5px] text-faint">{children}</div>;
}
