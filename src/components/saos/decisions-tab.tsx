"use client";

import { BookOpen, ChevronDown, History, KeyRound, ShieldAlert } from "lucide-react";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Collapsible from "@radix-ui/react-collapsible";
import { toast } from "sonner";

import {
  Badge,
  Btn,
  EmptyState,
  ErrorState,
  LoadingPanel,
  MetaRows,
  Mono,
  Panel,
  cn,
  fmtDateTime
} from "@/components/ui/kit";
import { EP, errText, refreshKey, saosFetch, useSaos } from "./api";
import { DECISION_PHASE_LABEL, DECISION_PHASE_ORDER, DECISION_RECORDED } from "./labels";
import type { DecisionRecordedStatus, DecisionRow, DecisionsResponse } from "./types";

export function DecisionsTab() {
  const decQ = useSaos<DecisionsResponse>("decisions", () => saosFetch<DecisionsResponse>(EP.decisions));
  const [update, setUpdate] = useState<{ key: string; preset: DecisionRecordedStatus } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (decQ.state === "error") {
    return <ErrorState kind={decQ.err.kind} detail={errText(decQ.err)} onRetry={decQ.refresh} retrying={decQ.refreshing} />;
  }
  if (decQ.state === "loading") {
    return <LoadingPanel rows={6} label="החלטות בעלים" />;
  }

  const data = decQ.data;
  const updateRow = data.decisions.find((d) => d.key === update?.key) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-zinc-100">החלטות בעלים — Owner Decisions</h2>
        <p className="text-xs text-zinc-500">{data.sourceNote}</p>
      </div>

      <Panel
        title="מדדי ההחלטות"
        icon={<KeyRound className="size-4 text-amber-400" aria-hidden />}
        source="/api/saos/decisions"
        lastChecked={decQ.lastChecked}
        onRefresh={decQ.refresh}
        refreshing={decQ.refreshing}
      >
        <div className="flex flex-wrap gap-2">
          <Badge tone="warn">{data.counts.open} פתוחות</Badge>
          <Badge tone="danger">{data.counts.openCritical} פתוחות קריטיות</Badge>
          <Badge tone="info">{data.counts.needsResource} דורשות משאב</Badge>
          <Badge tone="ok">{data.counts.decided} הוכרעו</Badge>
          <Badge tone="neutral">{data.counts.total} ברישום</Badge>
        </div>
      </Panel>

      {data.decisions.length === 0 ? (
        <EmptyState title="אין החלטות ברישום" explanation="הרישום נערך מהתיעוד; אם הוא ריק — יש בעיה במקור." nextAction="בדוק את /api/saos/decisions." />
      ) : (
        DECISION_PHASE_ORDER.map((phase) => {
          const group = data.decisions.filter((d) => d.phase === phase);
          if (group.length === 0) return null;
          return (
            <section key={phase} className="space-y-2" aria-label={DECISION_PHASE_LABEL[phase]}>
              <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                <ShieldAlert className={cn("size-4", phase === "now" ? "text-rose-400" : phase === "before-anchor" ? "text-amber-400" : "text-sky-400")} aria-hidden />
                {DECISION_PHASE_LABEL[phase]}
                <Badge tone="neutral">{group.length}</Badge>
              </h3>
              {group.map((d) => {
                const recorded = DECISION_RECORDED[d.recordedStatus] ?? DECISION_RECORDED.open;
                const isOpen = expanded === d.key;
                return (
                  <div
                    key={d.key}
                    className={cn(
                      "rounded-xl border bg-zinc-900/60",
                      d.critical && d.recordedStatus === "open" ? "border-rose-500/40" : "border-zinc-800"
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 p-3.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-zinc-100">{d.name}</span>
                          {d.critical && <Badge tone="danger">קריטית</Badge>}
                          <Badge tone={recorded.tone}>{recorded.label}</Badge>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{d.description}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500">
                          <span className="flex items-center gap-1">
                            <BookOpen className="size-3" aria-hidden />
                            מקור: <span dir="ltr" className="font-mono">{d.sourceRef}</span>
                          </span>
                          <span>אחריות: {d.ownerRole}</span>
                          {d.decidedAt && <span>עודכן: {fmtDateTime(d.decidedAt)}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        <Btn size="sm" variant="outline" onClick={() => setUpdate({ key: d.key, preset: "decided-default" })} ariaLabel={`סגור החלטה: ${d.name}`}>
                          סגור החלטה
                        </Btn>
                        <Btn size="sm" variant="info" onClick={() => setUpdate({ key: d.key, preset: "needs-resource" })} ariaLabel={`סמן כדורשת משאב: ${d.name}`}>
                          דרוש משאב
                        </Btn>
                        <Btn size="sm" variant="ghost" onClick={() => setUpdate({ key: d.key, preset: "rejected" })} ariaLabel={`דחה: ${d.name}`}>
                          דחה
                        </Btn>
                        <Collapsible.Root open={isOpen} onOpenChange={(o) => setExpanded(o ? d.key : null)}>
                          <Collapsible.Trigger
                            aria-label={`הצג פרטי החלטה: ${d.name}`}
                            className="rounded-md border border-zinc-700 p-1.5 text-zinc-400 hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-amber-400"
                          >
                            <ChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} aria-hidden />
                          </Collapsible.Trigger>
                        </Collapsible.Root>
                      </div>
                    </div>
                    <Collapsible.Root open={isOpen} onOpenChange={(o) => setExpanded(o ? d.key : null)}>
                      <Collapsible.Content className="px-3.5 pb-3.5">
                        <div className="space-y-2">
                          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-wide text-sky-400">אפשרויות</div>
                            <ul className="mt-1 list-inside list-disc space-y-0.5">
                              {d.options.map((o) => (
                                <li key={o} className="text-[11px] leading-relaxed text-zinc-300">
                                  {o}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <MetaRows
                            rows={[
                              { label: "ברירת מחדל בטוחה", value: d.safeDefault },
                              { label: "סיכון", value: d.risk },
                              { label: "עלות", value: d.cost },
                              { label: "זמן", value: d.time },
                              { label: "פעולה נדרשת", value: d.requiredAction }
                            ]}
                          />
                          {d.note && (
                            <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px] leading-relaxed text-zinc-300">
                              הערת בעלים: {d.note}
                            </p>
                          )}
                          {d.auditTrail.length > 0 && (
                            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-sky-400">
                                <History className="size-3" aria-hidden />
                                היסטוריית החלטה ({d.auditTrail.length} אירועים מיומן הביקורת)
                              </div>
                              <ul className="mt-1.5 space-y-1" aria-label={`היסטוריית ההחלטה ${d.name}`}>
                                {d.auditTrail.map((ev, i) => (
                                  <li key={`${ev.at}-${i}`} className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                                    <span className="tabular-nums">{fmtDateTime(ev.at)}</span>
                                    <Mono className="text-zinc-400">{ev.actor}</Mono>
                                    <span dir="ltr" className="min-w-0 flex-1 truncate font-mono text-zinc-500" title={ev.detail}>
                                      {ev.detail}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </Collapsible.Content>
                    </Collapsible.Root>
                  </div>
                );
              })}
            </section>
          );
        })
      )}

      {updateRow && update && (
        <UpdateDialog
          row={updateRow}
          preset={update.preset}
          onClose={() => setUpdate(null)}
          onDone={() => void refreshKey("decisions", () => saosFetch(EP.decisions))}
        />
      )}
    </div>
  );
}

function UpdateDialog({
  row,
  preset,
  onClose,
  onDone
}: {
  row: DecisionRow;
  preset: DecisionRecordedStatus;
  onClose: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<DecisionRecordedStatus>(preset);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(EP.decisions, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: row.key, status, note: note || undefined })
      });
      if (res.status === 401 || res.status === 403) {
        toast.error("נדרשת התחברות — התחבר במסך אבטחה ומאגר ואז עדכן שוב", { duration: 6000 });
        return;
      }
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (body.ok) {
        toast.success("ההחלטה עודכנה ונרשמה ביומן הביקורת");
        onClose();
        onDone();
      } else {
        toast.error(`עדכון נדחה: ${body.error ?? "שגיאה"}`);
      }
    } catch {
      toast.error("שגיאת רשת — העדכון לא נשמר");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl focus-visible:outline-2 focus-visible:outline-amber-400">
          <Dialog.Title className="text-sm font-bold text-zinc-100">עדכן החלטה — {row.name}</Dialog.Title>
          <Dialog.Description className="mt-2 text-xs leading-relaxed text-zinc-400">
            הרישום קובע את הסטטוס בלבד ונרשם ביומן הביקורת. הוא לא משנה מצב ריצה, לא מבצע פעולה חיצונית, לא מזיז משאבים ולא מבצע עוגן.
          </Dialog.Description>
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-zinc-300">סטטוס</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as DecisionRecordedStatus)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-amber-400"
              >
                {Object.entries(DECISION_RECORDED).map(([id, info]) => (
                  <option key={id} value={id}>
                    {info.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-300">הערה ציבורית (אופציונלי)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                rows={3}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-amber-400"
                placeholder="הקשר או אסמכתא להחלטה (אין להזין סודות)"
              />
            </label>
          </div>
          <div className="mt-4 flex justify-start gap-2">
            <Btn onClick={submit} loading={busy} ariaLabel="שמור את עדכון ההחלטה">
              שמור עדכון
            </Btn>
            <Dialog.Close asChild>
              <Btn variant="ghost" disabled={busy} ariaLabel="סגור בלי שמירה">
                בטל
              </Btn>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
