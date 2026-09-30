"use client";

import { Bug, CheckCircle2, FileText, ListChecks, ScrollText, XCircle } from "lucide-react";
import { useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";

import {
  Badge,
  Btn,
  EmptyState,
  ErrorState,
  LoadingPanel,
  Mono,
  Panel,
  fmtDateTime
} from "@/components/ui/kit";
import { EP, errText, refreshKey, saosFetch, useSaos } from "./api";
import type { AuditResponse, KernelResponse } from "./types";

/** documented bug registry — source: docs/testing.md + worklog.md (never invented) */
const BUGS = [
  { id: "BUG-001", title: "התנגשות unique על height ב-seal", status: "fixed", detail: "קרנל לא הקדם height → אילוץ unique נפל. תוקן: הקדמת height לכל op + גזירה מונוטונית מ-DB max." },
  { id: "BUG-002", title: "סקריפט lint שבור (next lint הוסר ב-Next 16)", status: "fixed", detail: "הוחלף ל-eslint . ישירות; תועד גם תיקון הדיווח השגוי ב-worklog." },
  { id: "BUG-003", title: "מירוץ פעימות מקבילות", status: "fixed", detail: "8/8 נכשלו → טרנזקציה + write-lock + retry + idempotency; הוכח 8/8 עובר." },
  { id: "BUG-004", title: "שרשרת קבלות לא-ניתנת לאימות (חסר `at`)", status: "fixed", detail: "backfill מוכח-דיג'סט 41/41 — שום נתון לא נכתב מחדש." },
  { id: "BUG-005", title: "פיצול אמיתי בשרשרת (אינדקס 17)", status: "disclosed", detail: "תוקן מבנית (קבלה בתוך טרנזקציית seal) + מדווח לנצח ב-forks[] — לעולם לא נשכתב." },
  { id: "BUG-006", title: "סטיית ארגומנטים ב-applyTx", status: "fixed", detail: "נתפס על-ידי tsc בשער לפני ריצה." },
  { id: "BUG-007", title: "bun run לא העביר .env ל-child process של node", status: "fixed", detail: "רץ הבדיקות עבר ל-bun; api-check הצליח 45/45 לאחר התיקון." },
  { id: "BUG-008", title: "אובדן .env אחרי rebase (מתועד)", status: "recovered", detail: "שוחזר bit-identical מגיבוי המפתח המקומי; הלקחים תועדו ב-worklog." },
  // roast-era bugs (48-63) — documented with live proof in worklog.md:
  { id: "BUG-009", title: "שידור-כפול אפשרי (requestId טרי לכל ניסיון)", status: "fixed", detail: "roast 54/56/61: anchor-pulse ו-fleet-cure טבעו requestId חדש לכל ניסיון — פנקס-האידמפוטנטיות לא ראה ניסיון-חוזר. תוקן: requestId דטרמיניסטי לכוונה + סיווג סירובים + TTL-guard." },
  { id: "BUG-010", title: "דלף פרטי-שרת בהודעות-שגיאה", status: "fixed", detail: "roast 58: ~33 catch-siteים החזירו מסלולי-קבצים/פנים-Prisma. תוקן: coarseError בכל ה-routes — פרטים-פנימיים לוג-בלבד, 200 תמיד." },
  { id: "BUG-011", title: "אי-שינויות קריא-ואז-כתוב (CAS חסר)", status: "fixed", detail: "roast 60: שני PATCH מקבילים עם txid שונים עברו בדיקת null והשני דרס את הראשון. תוקן: updateMany תנאי — הראשון מנצח, הוכח חי." },
  { id: "BUG-012", title: "הדמונים מתים בזמן שהמסך מבטיח מהם", status: "fixed", detail: "roast 61/62: 3/4 שירותים מתים 39 שעות, המפקח-הפנימי מת 13 שעות, והמסך הבטיח 'עוגן מתוזמן' מקובץ קפוא. תוקן: supervisor-truth + isFresh + pendingWeave — כשירות ≠ תזמון." }
] as const;

/** documented open non-bug items — source: docs/next-steps.md (roast 63: עודכן — session revocation נסגר ב-roast 60 עם epoch+secret mixing והוכח חי) */
/** Task 10 (2026-09-30): פריט-RC עודכן — הבריף הקפוא 2026-09-10 הוחלף במודל-חי (hive-rc-live.ts) + פליטה-חיה 09-30 בריאה; לכל פריט תג "עודכן" */
const OPEN_ITEMS_REGISTRY: { source: string; updated: string; items: Array<{ text: string; asOf?: string }> } = {
  source: "docs/next-steps.md",
  updated: "2026-09-11",
  items: [
    { text: "GitHub Actions CI — אין runner; הרצה ידנית בלבד" },
    { text: "bun run build — חסום-סביבה (לא נבדק מחוץ לסנדבוקס)" },
    { text: "SH-3 — קובץ היסטורי לא מסווג בהיסטוריית git (החלטת בעלים)" },
    { text: "RC-HIVE: מודל-חי במקום-בריף-ישן — פליטה-חיה 09-30 בריאה (energy_census 12/12·steem+12/12·hive ≥97%)", asOf: "2026-09-30" }
  ]
};

const SUITE = [
  { name: "lint", cmd: "bun run lint", what: "eslint (flat config, next core-web-vitals)" },
  { name: "typecheck", cmd: "bun run typecheck", what: "tsc --noEmit" },
  { name: "api-check", cmd: "bun run test", what: "טענות חוזה חיות מול ה-API (דורש dev server)" },
  { name: "concurrency", cmd: "bun run verify", what: "8 פעימות מקבילות — אטומיות + רציפות height" },
  { name: "check (הכול)", cmd: "bun run check", what: "lint → typecheck → api-check → concurrency" }
];

export function AuditTab() {
  const auditQ = useSaos<AuditResponse>("audit", () => saosFetch<AuditResponse>(EP.audit()));
  const kernelQ = useSaos<KernelResponse>("kernel", () => saosFetch<KernelResponse>(EP.kernel), false);
  const [openBug, setOpenBug] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-zinc-100">יומן ובדיקות — Audit &amp; Tests</h2>
        <p className="text-xs text-zinc-500">מה קרה לאחרונה (יומן ביקורת חי), מה נבדק ומה עדיין פתוח — כולל רישומי באגים מהתיעוד.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* live audit trail */}
        {auditQ.state === "error" ? (
          <Panel title="יומן ביקורת אבטחה" icon={<ScrollText className="size-4 text-zinc-500" aria-hidden />} source="/api/saos/audit">
            {auditQ.err.kind === "auth" ? (
              <EmptyState
                title="יומן הביקורת דורש התחברות"
                explanation="היומן חושף דפוסי תפעול ולכן הוא עצמו מידע רגיש (401 ללא session)."
                nextAction="התחבר במסך אבטחה ומאגר ואז רענן כאן."
              />
            ) : (
              <ErrorState kind={auditQ.err.kind} detail={errText(auditQ.err)} onRetry={auditQ.refresh} retrying={auditQ.refreshing} />
            )}
          </Panel>
        ) : auditQ.state === "loading" ? (
          <Panel title="יומן ביקורת אבטחה" icon={<ScrollText className="size-4 text-zinc-500" aria-hidden />} source="/api/saos/audit">
            <LoadingPanel rows={4} label="יומן ביקורת" />
          </Panel>
        ) : (
          <Panel
            title="יומן ביקורת אבטחה — 50 אירועים אחרונים"
            icon={<ScrollText className="size-4 text-sky-400" aria-hidden />}
            source="/api/saos/audit"
            lastChecked={auditQ.lastChecked}
            onRefresh={auditQ.refresh}
            refreshing={auditQ.refreshing}
          >
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              <Badge tone="neutral">סה״כ: {auditQ.data.counts.total}</Badge>
              <Badge tone={auditQ.data.counts.denied > 0 ? "warn" : "ok"}>נדחו: {auditQ.data.counts.denied}</Badge>
              {auditQ.data.counts.byKind.slice(0, 6).map((k) => (
                <Badge key={k.kind} tone="info">
                  {k.kind}: {k.count}
                </Badge>
              ))}
            </div>
            {auditQ.data.events.length === 0 ? (
              <EmptyState
                title="אין אירועים עדיין"
                explanation="היומן נטען חי מה-DB. אירוע נרשם לכל ניסיון פעולה רגישה (אושר או נדחה)."
                nextAction="בצע התחברות או פעולה רגישה — האירוע יופיע כאן."
              />
            ) : (
              <ul className="scroll-slim max-h-80 space-y-1.5 overflow-y-auto pl-1">
                {auditQ.data.events.map((e) => (
                  <li key={e.id} className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {e.allowed ? (
                        <CheckCircle2 className="size-3 shrink-0 text-emerald-400" aria-label="אושר" />
                      ) : (
                        <XCircle className="size-3 shrink-0 text-rose-400" aria-label="נדחה" />
                      )}
                      <Badge tone={e.allowed ? "ok" : "danger"}>{e.kind}</Badge>
                      <span className="text-[11px] text-zinc-400">{e.action}</span>
                      <span className="ms-auto text-[10px] tabular-nums text-zinc-500">{fmtDateTime(e.createdAt)}</span>
                    </div>
                    {e.detail && <p className="mt-0.5 break-words text-[10px] leading-relaxed text-zinc-500">{e.detail}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {/* live checks + suite */}
        <div className="space-y-4">
          <Panel
            title="בדיקות חיות מהממשק"
            icon={<ListChecks className="size-4 text-emerald-400" aria-hidden />}
            source="/api/saos/kernel · /api/saos/verify-chain"
            sourceKind="live"
          >
            <div className="space-y-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                {/* FIX(canonical-merge 2026-09-29 + Task 10): הספירה נגזרת-מהנתונים מהקרנל עצמו — אסור מספר-קפוא (הסוויטה גדלה 7→11; fallback "…" בזמן-טעינה) */}
                <div className="text-xs font-bold text-zinc-200">
                  selftest קרנל ({kernelQ.state === "ready" ? kernelQ.data.result.checks.length : "…"} תכונות)
                </div>
                {kernelQ.state === "ready" ? (
                  <div className="mt-1.5">
                    <Badge tone={kernelQ.data.ok ? "ok" : "danger"}>{kernelQ.data.ok ? `${kernelQ.data.result.checks.length}/${kernelQ.data.result.checks.length} עברו` : "נכשל"}</Badge>
                    <p className="mt-1 text-[10px] text-zinc-500">
                      stateRoot <Mono>{kernelQ.data.result.stateRoot.slice(0, 16)}…</Mono> · קבלת ריצה נוספה לשרשרת
                    </p>
                  </div>
                ) : kernelQ.state === "error" ? (
                  <p className="mt-1 text-[11px] text-rose-400">הריצה האחרונה נכשלה: {errText(kernelQ.err)}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-zinc-500">טרם הורץ בסשן זה.</p>
                )}
                <Btn
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  loading={kernelQ.refreshing}
                  onClick={() => {
                    void refreshKey("kernel", () => saosFetch(EP.kernel));
                  }}
                  ariaLabel="הרץ selftest קרנל עכשיו"
                >
                  הרץ selftest
                </Btn>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                <div className="text-xs font-bold text-zinc-200">אימות שרשרת מלא</div>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">ריצת verify-chain מפורטת זמינה במסך שרשרת ואימות (כפתור הרץ אימות).</p>
              </div>
            </div>
          </Panel>

          <Panel
            title="סוויטת הבדיקות — ריצה ידנית"
            icon={<ListChecks className="size-4 text-zinc-500" aria-hidden />}
            source="docs/testing.md"
            sourceKind="docs"
          >
            <ul className="space-y-1.5">
              {SUITE.map((s) => (
                <li key={s.name} className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-zinc-200">{s.name}</span>
                    <Mono className="text-[10px] text-amber-300/80">{s.cmd}</Mono>
                  </div>
                  <p className="mt-0.5 text-[11px] text-zinc-500">{s.what}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
              זו רשימה תיעודית — הממשק אינו מריץ סקריפטים על השרת; התוצאות המלאות של הריצה האחרונה מתועדות ב-docs/testing.md.
            </p>
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="רישומי באגים (מהתיעוד)" icon={<Bug className="size-4 text-rose-400" aria-hidden />} source="docs/testing.md" sourceKind="docs">
          <ul className="space-y-1.5">
            {BUGS.map((b) => (
              <li key={b.id}>
                <Collapsible.Root open={openBug === b.id} onOpenChange={(o) => setOpenBug(o ? b.id : null)}>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Mono className="text-[10px] font-bold text-zinc-300">{b.id}</Mono>
                      <span className="min-w-0 flex-1 text-[11px] font-semibold text-zinc-200">{b.title}</span>
                      <Badge tone={b.status === "fixed" ? "ok" : b.status === "recovered" ? "ok" : "warn"}>
                        {b.status === "fixed" ? "תוקן" : b.status === "recovered" ? "שוחזר" : "מדווח-לנצח"}
                      </Badge>
                    </div>
                    <Collapsible.Content>
                      <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{b.detail}</p>
                    </Collapsible.Content>
                  </div>
                </Collapsible.Root>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="פריטים פתוחים ומסמכים" icon={<FileText className="size-4 text-amber-400" aria-hidden />} source="docs/next-steps.md" sourceKind="docs">
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-amber-400">פתוחים (מתועד)</div>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {OPEN_ITEMS_REGISTRY.items.map((item) => (
                <li key={item.text} className="text-[11px] leading-relaxed text-zinc-300">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <span>{item.text}</span>
                    <Badge tone="neutral" className="shrink-0">עודכן {item.asOf ?? OPEN_ITEMS_REGISTRY.updated}</Badge>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[10px] text-zinc-500">מקור הרישום: {OPEN_ITEMS_REGISTRY.source} · תאריך-עדכון בסיס: {OPEN_ITEMS_REGISTRY.updated}</p>
          </div>
          <div className="mt-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">מסמכי המערכת (docs/)</div>
            <ul dir="ltr" className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-sky-400/90">
              {["docs/ui.md", "docs/architecture.md", "docs/api.md", "docs/testing.md", "docs/security.md", "docs/runbook.md", "docs/secret-hygiene.md", "docs/external-signer.md", "docs/anchor-preflight.md", "docs/deployment.md", "docs/database.md", "docs/decisions.md", "docs/next-steps.md", "worklog.md"].map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
              הקישורים לקבצים בריפו (לא URL-ים חיים) — כל המסמכים נסרקים בסריקת הסודות של כל סבב.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
