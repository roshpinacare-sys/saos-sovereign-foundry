"use client";

import { ChevronDown, ListChecks, Play, Stamp } from "lucide-react";
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
import { ANCHOR_STATUS } from "./labels";
import type { SealPostResponse, StatusResponse, VerifyChainResponse } from "./types";

export function ChainTab() {
  const statusQ = useSaos<StatusResponse>("status", () => saosFetch<StatusResponse>(EP.status));
  const verifyQ = useSaos<VerifyChainResponse>("verify-chain:chain", () => saosFetch<VerifyChainResponse>(EP.verifyChain("?scope=chain")), false);
  const [sealOpen, setSealOpen] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [expandedSeal, setExpandedSeal] = useState<string | null>(null);
  const [reverifying, setReverifying] = useState<string | null>(null);

  /** roast 52: promote an honestly-unverified (transit) anchor once the public chain confirms it */
  async function reverifyAnchor(network: string) {
    setReverifying(network);
    try {
      const res = await fetch(EP.anchorReverify, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network })
      });
      const body = (await res.json()) as { ok: boolean; promoted?: boolean; reason?: string; error?: string };
      if (body.ok && body.promoted) toast.success(`${network}: קוּדֵם לנעוגן — הרשת אישרה את ה-txid`);
      else if (body.ok) toast.info(`${network}: עדיין לא מאומת — ${body.reason ?? "הרשת טרם אישרה"}`);
      else toast.error(`אימות-חוזר נדחה: ${body.error ?? "שגיאה לא ידועה"}`);
      void refreshKey("status", () => saosFetch(EP.status));
    } catch {
      toast.error("שגיאת רשת — האימות-החוזר לא בוצע");
    } finally {
      setReverifying(null);
    }
  }

  async function runSeal() {
    setSealing(true);
    try {
      const res = await fetch(EP.seal, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stamps: 5, memo: "command-center" })
      });
      const body = (await res.json()) as SealPostResponse;
      if (body.ok && body.seal) {
        toast.success(
          body.idempotent ? `פעימה זהה זוהתה (idempotent) — הוחזרה חותמה height ${body.seal.height}` : `חותמה נוצרה: height ${body.seal.height} · root ${body.seal.root.slice(0, 12)}…`
        );
        setSealOpen(false);
        void refreshKey("status", () => saosFetch(EP.status));
        void refreshKey("preflight", () => saosFetch(EP.preflight));
      } else {
        toast.error(`הפעימה נדחתה: ${body.error ?? "שגיאה לא ידועה"}`);
      }
    } catch {
      toast.error("שגיאת רשת — הפעימה לא בוצעה");
    } finally {
      setSealing(false);
    }
  }

  if (statusQ.state === "error") {
    return <ErrorState kind={statusQ.err.kind} detail={errText(statusQ.err)} onRetry={statusQ.refresh} retrying={statusQ.refreshing} />;
  }
  if (statusQ.state === "loading") {
    return <LoadingPanel rows={5} label="שרשרת ואימות" />;
  }

  const status = statusQ.data;
  const latest = status.seals[0] ?? null;
  const totalLeaves = status.seals.reduce((s, x) => s + x.leaves, 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-zinc-100">שרשרת ואימות — Chain Integrity</h2>
        <p className="text-xs text-zinc-500">האם השרשרת רציפה ומאומתת? מה השורש הנוכחי, כמה עלים וקבלות, ומה תוצאת האימות האחרון.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="מצב שרשרת נוכחי"
          icon={<Stamp className="size-4 text-amber-400" aria-hidden />}
          source="/api/saos/status"
          lastChecked={statusQ.lastChecked}
          onRefresh={statusQ.refresh}
          refreshing={statusQ.refreshing}
        >
          {latest ? (
            <>
              <MetaRows
                rows={[
                  { label: "גובה שרשרת (height)", value: latest.height, mono: true },
                  { label: "שורש נוכחי (root)", value: <Mono title={latest.root}>{latest.root.slice(0, 20)}…</Mono>, mono: true },
                  { label: "stateRoot", value: <Mono title={latest.stateRoot}>{latest.stateRoot.slice(0, 20)}…</Mono>, mono: true },
                  { label: "עלים בחותמה האחרונה", value: latest.leaves, mono: true },
                  { label: "עלים ב-8 החותמות שבמטמון", value: totalLeaves, mono: true },
                  { label: "חותמה נוצרה", value: fmtDateTime(latest.createdAt) }
                ]}
              />
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                רציפות חותמות וכשירות העלים נקבעים רק על-ידי ריצת אימות מלאה — לא מהמטמון.
              </p>
            </>
          ) : (
            <EmptyState
              title="אין חותמות — השרשרת ריקה"
              explanation="לא בוצעה אף פעימת איטום בסביבה זו. גובה, שורש ועלים אינם קיימים ולכן לא מוצגים."
              nextAction="הרץ פעימה ראשונה (POST /seal) — חישוב בלבד במצב dry-run, ללא שידור."
            />
          )}
        </Panel>

        <Panel
          title="פעולות מבצעיות"
          icon={<Play className="size-4 text-sky-400" aria-hidden />}
          source="פעולות על /api/saos/*"
          sourceKind="derived"
        >
          <div className="space-y-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
              <div className="text-xs font-bold text-zinc-200">הרץ אימות מלא (verify-chain)</div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                בודק את שרשרת הקבלות (דיג&apos;סטים וקישורים, עד 1000 קבלות ו-25 חותמות בריצה — ה-API מדווח בכנות כשחותך), מקומפל מחדש ומאמת כל עלה מרקל בכל חותמה. הריצה עצמה מוסיפה קבלת verify-chain לשרשרת — מדווח בתוצאה.
              </p>
              <Btn
                variant="outline"
                size="sm"
                className="mt-2"
                loading={verifyQ.refreshing}
                onClick={() => void refreshKey("verify-chain:chain", () => saosFetch(EP.verifyChain("?scope=chain")))}
                ariaLabel="הרץ אימות שרשרת מלא"
              >
                <ListChecks className="size-3.5" aria-hidden />
                הרץ אימות
              </Btn>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
              <div className="text-xs font-bold text-zinc-200">הרץ פעימה (POST /seal)</div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                יוצר חותמה חדשה: עיבוד אצווה בקרנל הדטרמיניסטי, height+1, שורש מרקל וקבלה. במצב {status.mode} — אין שידור לרשתות; העגינה נשארת advisory.
              </p>
              <Btn size="sm" className="mt-2" onClick={() => setSealOpen(true)} ariaLabel="פתח אישור להרצת פעימה">
                <Stamp className="size-3.5" aria-hidden />
                הרץ פעימה
              </Btn>
            </div>
          </div>
        </Panel>
      </div>

      {/* verify result */}
      {verifyQ.state === "error" && (
        <ErrorState kind={verifyQ.err.kind} detail={errText(verifyQ.err)} onRetry={verifyQ.refresh} retrying={verifyQ.refreshing} />
      )}
      {verifyQ.state === "ready" && <VerifyResult result={verifyQ.data} />}
      {verifyQ.state === "loading" && verifyQ.refreshing && <LoadingPanel rows={3} label="ריצת אימות" />}
      {verifyQ.state === "loading" && !verifyQ.refreshing && (
        <Panel title="תוצאת אימות מפורטת" icon={<ListChecks className="size-4 text-zinc-500" aria-hidden />} source="/api/saos/verify-chain?scope=chain" sourceKind="live">
          <EmptyState
            title="טרם הורץ אימות בסשן זה"
            explanation="סטטוס אימות מוצג רק מריצה אמיתית שנעשתה כאן — לא מהנחות. אימות היסטורי מתועד ב-docs/testing.md."
            nextAction="לחץ על הרץ אימות כדי לבדוק את השרשרת כעת."
          />
        </Panel>
      )}

      {/* seal history */}
      <Panel
        title="היסטוריית חותמות (8 אחרונות)"
        icon={<Stamp className="size-4 text-zinc-500" aria-hidden />}
        source="/api/saos/status · seals"
        lastChecked={statusQ.lastChecked}
        onRefresh={statusQ.refresh}
        refreshing={statusQ.refreshing}
      >
        {status.seals.length === 0 ? (
          <EmptyState
            title="אין פורקים היסטוריים ואין חותמות"
            explanation="היסטוריית חותמות ופיצולים היסטוריים (forks) מוצגים כאן רק כשהם קיימים בשרשרת המקומית."
            nextAction="הרץ פעימה כדי להתחיל לבנות שרשרת."
          />
        ) : (
          <ul className="space-y-2">
            {status.seals.map((s) => (
              <li key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900/70">
                <Collapsible.Root open={expandedSeal === s.id} onOpenChange={(o) => setExpandedSeal(o ? s.id : null)}>
                  <div className="flex flex-wrap items-center gap-2 p-2.5">
                    <Badge tone="gold">
                      height <Mono>{s.height}</Mono>
                    </Badge>
                    <Mono className="min-w-0 flex-1 truncate text-zinc-400" title={s.root}>
                      {s.root}
                    </Mono>
                    <span className="text-[10px] text-zinc-500">{fmtDateTime(s.createdAt)}</span>
                    <Collapsible.Trigger
                      aria-label={`הצג פרטי חותמה height ${s.height}`}
                      className="rounded-md border border-zinc-700 p-1.5 text-zinc-400 hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-amber-400"
                    >
                      <ChevronDown className={cn("size-3.5 transition-transform", expandedSeal === s.id && "rotate-180")} aria-hidden />
                    </Collapsible.Trigger>
                  </div>
                  <Collapsible.Content className="px-2.5 pb-2.5">
                    <MetaRows
                      rows={[
                        { label: "root מלא", value: <Mono className="break-all">{s.root}</Mono>, mono: true },
                        { label: "stateRoot מלא", value: <Mono className="break-all">{s.stateRoot}</Mono>, mono: true },
                        { label: "עלים", value: s.leaves, mono: true },
                        { label: "gasUsed", value: s.gasUsed, mono: true }
                      ]}
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.anchors.map((a, ai) => {
                        const info = ANCHOR_STATUS[a.status] ?? ANCHOR_STATUS.pending;
                        const canReverify = Boolean(a.txid) && a.status !== "anchored";
                        return (
                          <span key={`${a.network}:${ai}`} className="inline-flex items-center gap-1">
                            <Badge tone={info.tone} title={a.gate ?? a.txid ?? undefined}>
                              {a.network}: {info.label}
                              {a.txid ? ` · ${a.txid.slice(0, 10)}…` : ""}
                            </Badge>
                            {canReverify ? (
                              <button
                                type="button"
                                onClick={() => void reverifyAnchor(a.network)}
                                disabled={reverifying !== null}
                                aria-label={`אמת את עוגן ה-${a.network} מול הרשת הציבורית`}
                                className="rounded-md border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-amber-400/60 hover:text-amber-300 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-amber-400"
                              >
                                {reverifying === a.network ? "בודק…" : "אמת מול הרשת"}
                              </button>
                            ) : null}
                          </span>
                        );
                      })}
                    </div>
                  </Collapsible.Content>
                </Collapsible.Root>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* seal confirm dialog */}
      <Dialog.Root open={sealOpen} onOpenChange={setSealOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
          <Dialog.Content className="fixed start-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl focus-visible:outline-2 focus-visible:outline-amber-400">
            <Dialog.Title className="text-sm font-bold text-zinc-100">אישור הרצת פעימה</Dialog.Title>
            <Dialog.Description className="mt-2 text-xs leading-relaxed text-zinc-400">
              הפעולה תיצור חותמה חדשה בשרשרת (height+1) עם 5 עלים, שורש מרקל וקבלת-ראיה. זו כתיבה מקומית בלבד:
              הפעימה עצמה לא משדרת לשום רשת (השידור נפרד — עוגן-פעימה) והפעולה אינה הפיכה (החותמה נכנסת לשרשרת).
            </Dialog.Description>
            <div className="mt-4 flex justify-start gap-2">
              <Btn onClick={runSeal} loading={sealing} ariaLabel="אשר והרץ פעימה">
                אשר והרץ פעימה
              </Btn>
              <Dialog.Close asChild>
                <Btn variant="ghost" disabled={sealing} ariaLabel="בטל הרצת פעימה">
                  בטל
                </Btn>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function VerifyResult({ result }: { result: VerifyChainResponse }) {
  const rc = result.receiptChain;
  return (
    <Panel
      title="תוצאת אימות מפורטת"
      icon={<ListChecks className={cn("size-4", result.ok ? "text-emerald-400" : "text-rose-400")} aria-hidden />}
      source="/api/saos/verify-chain?scope=chain"
      lastChecked={null}
      actions={<Badge tone={result.ok ? "ok" : "danger"}>{result.ok ? "אימות עבר" : "אימות נכשל"}</Badge>}
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatMini label="חותמות שנבדקו" value={result.totals?.sealsChecked ?? 0} />
        <StatMini label="עלים שנבדקו" value={result.totals?.leafCount ?? 0} />
        <StatMini label="עלים מאומתים" value={result.totals?.verifiedLeaves ?? 0} tone="ok" />
        <StatMini label="עלים כושלים" value={result.totals?.invalidLeaves ?? 0} tone={result.totals?.invalidLeaves ? "danger" : "ok"} />
      </div>

      <div className="mt-3 space-y-2">
        <MetaRows
          rows={[
            { label: "שרשרת קבלות", value: rc?.ok ? "תקינה" : "פגומה", mono: false },
            { label: "קבלות שנבדקו", value: rc?.checked ?? "—", mono: true },
            { label: "שורש אחרון", value: result.root ? <Mono title={result.root}>{result.root.slice(0, 20)}…</Mono> : "—", mono: true },
            { label: "proofResult", value: result.proofResult, mono: true },
            { label: "קבלת הריצה", value: result.receipt ? <Mono title={result.receipt}>{result.receipt.slice(0, 20)}…</Mono> : "—", mono: true }
          ]}
        />
        {rc && rc.forks.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="text-xs font-bold text-amber-400">פיצולים היסטוריים (מדווחים, לעולם לא נשכתבים)</div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
              אינדקסים: <Mono>{rc.forks.join(", ")}</Mono> — ענפים מקבילים היסטוריים בשרשרת הקבלות; המבנה ממשיך קדימה באופן אטומי מאז. גילוי כנה, לא תיקון שקט.
            </p>
          </div>
        )}
        {result.errors.length > 0 && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3">
            <div className="text-xs font-bold text-rose-400">שגיאות אימות</div>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {result.errors.map((e) => (
                <li key={e} className="text-[11px] text-zinc-300" dir="auto">
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

function StatMini({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "ok" | "danger" }) {
  const tones = { default: "text-zinc-100", ok: "text-emerald-400", danger: "text-rose-400" };
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={cn("text-base font-bold tabular-nums", tones[tone])} dir="ltr">
        {value.toLocaleString("he-IL")}
      </div>
    </div>
  );
}
