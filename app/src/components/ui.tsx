import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * The dashboard's primitives (design-review §2: the same card / panel / button / input markup was
 * rebuilt by hand in 27 places, which is how spacing and states drift between tabs).
 *
 * Rules this file exists to enforce:
 *  - one surface style: rounded-lg, 1px white/10, white/[0.02] fill
 *  - one accent ramp: #5e6ad2 base, #4f59b8 hover, #828fff focus ring (globals.css sets the ring)
 *  - every interactive element has hover, active, disabled AND focus-visible states
 *  - body copy never goes below white/60 on the canvas (#08090a) — measured contrast, not taste
 */

/* ------------------------------------------------------------------ surfaces */

export function Card({ className = "", children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={`rounded-lg border border-white/10 bg-white/[0.02] ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** A labelled figure. The label is muted, the value is monospaced so digits align between cards. */
export function Stat({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: ReactNode;
  href?: string;
  hint?: string;
}) {
  const body = <span className="break-all font-mono text-sm">{value}</span>;
  return (
    <Card className="p-4">
      <div className="text-xs text-white/40">{label}</div>
      <div className="mt-1">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-white/20 underline-offset-2 transition-colors hover:decoration-white/60"
          >
            {body}
          </a>
        ) : (
          body
        )}
      </div>
      {hint ? <p className="mt-1.5 text-[11px] leading-snug text-white/40">{hint}</p> : null}
    </Card>
  );
}

export function Panel({
  title,
  tone = "neutral",
  line,
  note,
  action,
}: {
  title: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
  line: string;
  note?: string;
  action?: ReactNode;
}) {
  const toneClass = {
    ok: "text-emerald-300",
    warn: "text-amber-300",
    bad: "text-red-300",
    neutral: "text-white/70",
  }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      <p className={`mt-1 text-xs ${toneClass}`}>{line}</p>
      {note ? <p className="mt-2 text-[11px] leading-relaxed text-white/45">{note}</p> : null}
    </Card>
  );
}

/* --------------------------------------------------------------------- states */

const ALERT_TONES = {
  info: "border-white/12 bg-white/[0.03] text-white/70",
  ok: "border-emerald-500/25 bg-emerald-500/5 text-emerald-200",
  warn: "border-amber-500/25 bg-amber-500/5 text-amber-200",
  error: "border-red-500/30 bg-red-500/10 text-red-200",
} as const;

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: keyof typeof ALERT_TONES;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border p-3 text-xs ${ALERT_TONES[tone]}`}>
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={title ? "mt-1 leading-relaxed" : "leading-relaxed"}>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-white/15 p-6 text-center">
      <p className="text-sm text-white/50">{title}</p>
      {children ? <p className="mt-1 text-xs leading-relaxed text-white/35">{children}</p> : null}
    </div>
  );
}

export function Skeleton({ className = "h-24" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg border border-white/10 bg-white/[0.02] ${className}`} />;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" }) {
  const cls = {
    neutral: "border-white/12 text-white/60",
    ok: "border-emerald-500/30 text-emerald-300",
    warn: "border-amber-500/30 text-amber-300",
  }[tone];
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[11px] ${cls}`}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ controls */

const BUTTON_VARIANTS = {
  primary:
    "bg-[#5e6ad2] text-white hover:bg-[#4f59b8] active:bg-[#4650a8] disabled:bg-white/10 disabled:text-white/40",
  secondary:
    "border border-white/15 text-white/85 hover:border-white/30 hover:bg-white/5 active:bg-white/10 disabled:text-white/35",
  ghost: "text-white/65 hover:bg-white/5 hover:text-white active:bg-white/10 disabled:text-white/35",
} as const;

const BUTTON_SIZES = {
  sm: "px-2.5 py-1 text-[12px]",
  md: "px-3.5 py-2 text-sm",
} as const;

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: ComponentProps<"button"> & { variant?: keyof typeof BUTTON_VARIANTS; size?: keyof typeof BUTTON_SIZES }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...rest}
    />
  );
}

export function LinkButton({
  href,
  variant = "secondary",
  size = "sm",
  className = "",
  children,
  external,
}: {
  href: string;
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  className?: string;
  children: ReactNode;
  external?: boolean;
}) {
  const cls = `inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`;
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export const inputClass =
  "w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white transition-colors outline-none placeholder:text-white/30 hover:border-white/20 focus:border-[#5e6ad2] disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-red-500/50";

export function Field({
  label,
  id,
  hint,
  error,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs text-white/50">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error ? (
        <p className="mt-1 text-[11px] text-red-300">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-white/35">{hint}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- headings */

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {children ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">{children}</p> : null}
    </header>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-medium">{children}</h2>
      {aside ? <span className="font-mono text-[11px] text-white/35">{aside}</span> : null}
    </div>
  );
}
