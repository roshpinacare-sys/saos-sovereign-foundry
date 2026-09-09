"use client";

import { clsx } from "clsx";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  MinusCircle,
  RefreshCw,
  ShieldAlert,
  XCircle
} from "lucide-react";
import { type ReactNode } from "react";

// ─── utils ───────────────────────────────────────────────────────────────────

export function cn(...parts: Array<string | false | null | undefined>): string {
  return clsx(...parts);
}

export function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("he-IL");
}

// ─── Card ────────────────────────────────────────────────────────────────────

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={clsx(
        "glass glass-hover overflow-hidden",
        className
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={clsx(
        "flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-gradient-to-l from-white/[0.03] to-transparent px-4 pb-3 pt-4 sm:px-5",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({ className, children, icon }: { className?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <h3 className={clsx("flex items-center gap-2.5 text-sm font-bold tracking-wide text-zinc-100", className)}>
      {icon && (
        <span className="grid size-7 shrink-0 place-items-center rounded-[10px] border border-emerald-400/25 bg-gradient-to-br from-emerald-400/15 to-amber-400/10 text-emerald-300 shadow-[0_0_14px_-4px_rgba(52,211,153,0.5)]">
          {icon}
        </span>
      )}
      {children}
    </h3>
  );
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5", className)}>{children}</div>;
}

// ─── Badge ───────────────────────────────────────────────────────────────────

export type Tone = "ok" | "warn" | "danger" | "info" | "neutral" | "gold";

const toneClasses: Record<Tone, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  danger: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  info: "border-teal-500/40 bg-teal-500/10 text-teal-300",
  neutral: "border-zinc-600/60 bg-zinc-800/60 text-zinc-400",
  gold: "border-amber-400/40 bg-amber-400/10 text-amber-300"
};

export function Badge({
  tone = "neutral",
  className,
  children,
  title
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-5 backdrop-blur-sm",
        toneClasses[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

// ─── Button ──────────────────────────────────────────────────────────────────

export function Btn({
  variant = "primary",
  size = "md",
  className,
  disabled,
  loading,
  onClick,
  children,
  type = "button",
  ariaLabel,
  title
}: {
  variant?: "primary" | "ghost" | "outline" | "danger" | "info";
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  children: ReactNode;
  type?: "button" | "submit";
  ariaLabel?: string;
  title?: string;
}) {
  const variants = {
    primary:
      "bg-gradient-to-l from-amber-400 via-amber-300 to-amber-400 bg-[length:200%_100%] text-zinc-950 font-bold shadow-lg shadow-amber-500/25 hover:bg-[position:100%_0] hover:shadow-amber-400/40 hover:brightness-105",
    ghost: "bg-transparent text-zinc-300 hover:bg-white/[0.06] hover:text-white",
    outline:
      "border border-zinc-700/80 bg-white/[0.02] text-zinc-300 hover:border-emerald-400/50 hover:text-emerald-300 hover:shadow-[0_0_18px_-6px_rgba(52,211,153,0.45)]",
    danger: "border border-rose-500/50 text-rose-300 hover:bg-rose-500/10",
    info: "border border-teal-500/50 text-teal-300 hover:bg-teal-500/10"
  };
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl px-3.5 transition-all duration-200",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400",
        "active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "min-h-[32px] rounded-lg px-2.5 text-xs",
        variants[variant],
        className
      )}
    >
      {loading ? <RefreshCw className="size-3.5 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

// ─── Mono (hashes / numbers) ─────────────────────────────────────────────────

export function Mono({ className, children, title }: { className?: string; children: ReactNode; title?: string }) {
  return (
    <span dir="ltr" title={title} className={cn("font-mono text-[0.8em] tracking-tight", className)}>
      {children}
    </span>
  );
}

// ─── Stat ────────────────────────────────────────────────────────────────────

export function Stat({
  label,
  value,
  tone = "default",
  hint,
  mono
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "gold" | "ok" | "danger" | "warn" | "info";
  hint?: string;
  mono?: boolean;
}) {
  const tones = {
    default: "text-zinc-100",
    gold: "text-amber-300",
    ok: "text-emerald-300",
    danger: "text-rose-300",
    warn: "text-amber-300",
    info: "text-teal-300"
  };
  const bars = {
    default: "from-white/25 to-transparent",
    gold: "from-amber-400 to-transparent",
    ok: "from-emerald-400 to-transparent",
    danger: "from-rose-400 to-transparent",
    warn: "from-amber-400 to-transparent",
    info: "from-teal-400 to-transparent"
  };
  return (
    <div className="glass relative overflow-hidden rounded-xl px-3 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_34px_-16px_rgba(0,0,0,0.8)]">
      <span aria-hidden className={cn("absolute inset-y-0 right-0 w-0.5 bg-gradient-to-b", bars[tone])} />
      <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div
        dir={mono ? "ltr" : undefined}
        className={cn("font-display text-lg font-bold tabular-nums", mono && "font-mono text-base", tones[tone])}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[10px] leading-tight text-zinc-500">{hint}</div>}
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer rounded-lg", className)} aria-hidden />;
}

export function LoadingPanel({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={`טוען: ${label}`} className="space-y-2.5 p-1">
      <span className="sr-only">טוען: {label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

// ─── Empty / Error states ────────────────────────────────────────────────────

export function EmptyState({
  title,
  explanation,
  nextAction
}: {
  title: string;
  explanation: string;
  nextAction?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-zinc-700 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-zinc-300">
        <MinusCircle className="size-4 text-zinc-500" aria-hidden />
        {title}
      </div>
      <p className="text-xs leading-relaxed text-zinc-500">{explanation}</p>
      {nextAction && (
        <p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-teal-300">
          <HelpCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {nextAction}
        </p>
      )}
    </div>
  );
}

export type ErrorKind = "network" | "auth" | "auth-unconfigured" | "rate" | "api" | "parse" | "server";

export function errorExplain(kind: ErrorKind): { headline: string; hint: string } {
  switch (kind) {
    case "network":
      return { headline: "שגיאת רשת — לא ניתן להגיע לשרת", hint: "בדוק חיבור ואז רענן. הפאנל מציג את המצב האחרון שנטען, אם קיים." };
    case "auth":
      return { headline: "נדרשת התחברות", hint: "פעולה זו רגישה — התחבר במסך אבטחה ומאגר (מפתח אופרטור), ואז רענן." };
    case "auth-unconfigured":
      return { headline: "שכבת-ההרשאות לא מוגדרת על השרת", hint: "המערכת fail-closed: כל פעולה רגישה נדחית. הגדר SAOS_ADMIN_KEY_HASH (docs/deployment.md)." };
    case "rate":
      return { headline: "הגבלת-קצב — יותר מדי בקשות", hint: "המתן מספר שניות ורענן. ההגבלה מגינה על המערכת (429)." };
    case "api":
      return { headline: "השרת דיווח על כישלון", hint: "שגיאה היא נתון — פרטי הכישלון מוצגים למטה. אם זו חסימה, הפעולה הנדרשת תופיע בה." };
    case "parse":
      return { headline: "תשובה לא תקינה מהשרת", hint: "התשובה שהתקבלה אינה JSON תקף — רענן או בדוק את לוג השרת (dev.log)." };
    case "server":
      return { headline: "שגיאת שרת", hint: "בדוק את dev.log. ה-API מחויב לעולם לא להחזיר 500 — אם קרה, זה פגם שדורש תיקון." };
  }
}

export function ErrorState({
  kind,
  detail,
  onRetry,
  retrying
}: {
  kind: ErrorKind;
  detail?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const { headline, hint } = errorExplain(kind);
  return (
    <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-rose-300">
        <XCircle className="size-4" aria-hidden />
        {headline}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">{hint}</p>
      {detail && (
        <p className="mt-1.5 break-words font-mono text-[11px] text-rose-300/80" dir="ltr">
          {detail}
        </p>
      )}
      {onRetry && (
        <Btn variant="outline" size="sm" className="mt-3" onClick={onRetry} loading={retrying} ariaLabel="רענן את הפאנל">
          רענן
        </Btn>
      )}
    </div>
  );
}

// ─── Panel (data-source aware card) ──────────────────────────────────────────

export function Panel({
  title,
  icon,
  source,
  sourceKind = "live",
  lastChecked,
  onRefresh,
  refreshing,
  children,
  className,
  actions
}: {
  title: string;
  icon?: ReactNode;
  /** data origin shown to the operator — endpoint or document */
  source: string;
  sourceKind?: "live" | "docs" | "derived";
  lastChecked?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  const sourceLabel =
    sourceKind === "live" ? "נתון חי" : sourceKind === "docs" ? "מקור תיעודי" : "נגזר";
  const sourceTone: Tone = sourceKind === "live" ? "info" : sourceKind === "docs" ? "neutral" : "info";
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle icon={icon}>{title}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={sourceTone} title={`מקור הנתון: ${source}`}>
            {sourceLabel}
            <span className="hidden font-mono text-[10px] font-normal text-zinc-500 sm:inline">{source}</span>
          </Badge>
          {lastChecked && (
            <span className="text-[11px] tabular-nums text-zinc-500" aria-label="זמן בדיקה אחרון">
              עודכן {fmtTime(lastChecked)}
            </span>
          )}
          {actions}
          {onRefresh && (
            <Btn
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              loading={refreshing}
              ariaLabel={`רענן: ${title}`}
              title={`רענן: ${title}`}
              className="px-2"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              <span className="sr-only">רענן {title}</span>
            </Btn>
          )}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ─── Checks (pass / warn / fail rows) ────────────────────────────────────────

export type CheckRowStatus = "pass" | "warn" | "fail";

export function CheckIcon({ status }: { status: CheckRowStatus }) {
  if (status === "pass") return <CheckCircle2 className="size-4 shrink-0 text-emerald-300" aria-hidden />;
  if (status === "warn") return <AlertTriangle className="size-4 shrink-0 text-amber-300" aria-hidden />;
  return <ShieldAlert className="size-4 shrink-0 text-rose-300" aria-hidden />;
}

const checkLabel: Record<CheckRowStatus, string> = { pass: "תקין", warn: "אזהרה", fail: "חסום" };
const checkEdge: Record<CheckRowStatus, string> = {
  pass: "border-s-emerald-500/50",
  warn: "border-s-amber-500/50",
  fail: "border-s-rose-500/60"
};

export function CheckRow({ status, title, detail }: { status: CheckRowStatus; title: string; detail?: string }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border border-white/[0.06] border-s-2 bg-white/[0.02] p-3", checkEdge[status])}>
      <CheckIcon status={status} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-zinc-200">{title}</span>
          <Badge tone={status === "pass" ? "ok" : status === "warn" ? "warn" : "danger"}>{checkLabel[status]}</Badge>
        </div>
        {detail && <p className="mt-1 text-xs leading-relaxed text-zinc-400">{detail}</p>}
      </div>
    </div>
  );
}

// ─── Key-value meta rows ─────────────────────────────────────────────────────

export function MetaRows({ rows }: { rows: { label: string; value: ReactNode; mono?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-0 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-3 border-b border-white/[0.05] py-1.5">
          <dt className="shrink-0 text-[11px] font-medium text-zinc-500">{r.label}</dt>
          <dd className={cn("min-w-0 truncate text-right text-xs font-semibold text-zinc-200", r.mono && "font-mono")} dir={r.mono ? "ltr" : undefined}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
