"use client";

import { Globe, Wallet } from "lucide-react";

import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingPanel,
  MetaRows,
  Mono,
  Panel,
  fmtDateTime,
  fmtNum
} from "@/components/ui/kit";
import { EP, errText, saosFetch, useSaos } from "./api";
import { CHAIN_TYPE_LABEL, NETWORK_STATUS, RPC_STATUS_LABEL } from "./labels";
import type { PlansResponse, StatusResponse } from "./types";

export function NetworksTab() {
  const statusQ = useSaos<StatusResponse>("status", () => saosFetch<StatusResponse>(EP.status));
  const plansQ = useSaos<PlansResponse>("plans", () => saosFetch<PlansResponse>(EP.plans));

  if (statusQ.state === "error" || plansQ.state === "error") {
    const e = statusQ.state === "error" ? statusQ : plansQ.state === "error" ? plansQ : null;
    return (
      e && e.state === "error" ? (
        <ErrorState kind={e.err.kind} detail={errText(e.err)} onRetry={() => { statusQ.refresh(); plansQ.refresh(); }} retrying={statusQ.refreshing || plansQ.refreshing} />
      ) : null
    );
  }
  if (statusQ.state === "loading" || plansQ.state === "loading") {
    return <LoadingPanel rows={6} label="רשתות ומשאבים" />;
  }

  const status = statusQ.data;
  const plans = plansQ.data;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-zinc-100">רשתות ומשאבים — Networks &amp; Resources</h2>
        <p className="text-xs text-zinc-500">
          מצב כל רשת לפי חישוב מקומי כנה (אפס קריאות רשת חיות): סטטוס, חסימה, משאב נדרש, תוכנית שחרור והמלצה.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {status.networks.map((n) => {
          const info = NETWORK_STATUS[n.status] ?? { label: n.status, tone: "neutral" as const };
          return (
            <Panel
              key={n.network}
              title={n.network}
              icon={<Globe className="size-4 text-sky-400" aria-hidden />}
              source="/api/saos/status · networks"
              lastChecked={n.lastChecked}
            >
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={info.tone}>{info.label}</Badge>
                <Badge tone="neutral">מצב: {n.mode === "advisory" ? "advisory (חישוב בלבד)" : "direct"}</Badge>
                <Badge tone={n.isDryRunOnly ? "warn" : "ok"}>{n.isDryRunOnly ? "dry-run בלבד" : "מסלול שידור קיים"}</Badge>
                <Badge tone={n.isReadyForAnchor ? "ok" : "danger"}>{n.isReadyForAnchor ? "מוכנה לעוגן" : "לא מוכנה לעוגן"}</Badge>
                {n.chainType && <Badge tone="info">{CHAIN_TYPE_LABEL[n.chainType] ?? n.chainType}</Badge>}
                {n.rpcStatus && <Badge tone={RPC_STATUS_LABEL[n.rpcStatus]?.tone ?? "neutral"}>{RPC_STATUS_LABEL[n.rpcStatus]?.label ?? n.rpcStatus}</Badge>}
              </div>

              {(n.chainId || (n.anchorTypes && n.anchorTypes.length > 0)) && (
                <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-sky-400">זהות שרשרת (Task 12)</div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
                    {n.chainId && (
                      <span>
                        {"מזהה/קלאסטר: "}
                        <Mono className="break-all">{n.chainId}</Mono>
                      </span>
                    )}
                    {n.anchorTypes && n.anchorTypes.length > 0 && (
                      <span>
                        {"סוגי עיגון אפשריים: "}
                        <span dir="ltr">{n.anchorTypes.join(" · ")}</span>
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                    מקור: קבועים מתועדים בלבד (אין קריאת רשת חיה בחישוב ברירת-המחדל; probe אופציונלי קריאה-בלבד בלבד).
                  </p>
                </div>
              )}

              <div className="mt-3 space-y-2">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-rose-400">חסימה</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-300">{n.blocker ?? "אין חסימה מדווחת"}</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-amber-400">משאב נדרש</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-300">{n.requiredResource ?? "לא רלוונטי"}</p>
                  {!n.resourceLiveChecked && (
                    <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">לא נבדק חי — הערך מוצג מ-env/היסטוריה; המערכת אינה ממציאה ערך חי ואינה מבצעת קריאה שמחייבת משאב.</p>
                  )}
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-sky-400">המלצה — פעולה הבאה</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-300">{n.nextAction}</p>
                </div>
                {n.ownerOptions.length > 0 && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-amber-400">אפשרויות בעלים</div>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                      {n.ownerOptions.map((o) => (
                        <li key={o} className="text-[11px] leading-relaxed text-zinc-400">
                          {o}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <MetaRows
                  rows={[
                    ...(n.estimatedTime ? [{ label: "זמן משוער לפתרון", value: n.estimatedTime }] : []),
                    ...(n.estimatedCost ? [{ label: "עלות משוערת", value: n.estimatedCost }] : []),
                    { label: "פעולת בעלים", value: n.ownerAction },
                    {
                      label: "עוגן מאומת אחרון",
                      value: n.lastVerifiedAnchor ? <Mono className="break-all">{n.lastVerifiedAnchor}</Mono> : "חסר — אין עוגן מאומת לרשת זו",
                      mono: true
                    },
                    { label: "נבדק", value: fmtDateTime(n.lastChecked) }
                  ]}
                />
                {n.unblockPlan.length > 0 && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-400">תוכנית פעולה לשחרור החסימה</div>
                    <ol className="mt-1 list-inside list-decimal space-y-0.5">
                      {n.unblockPlan.map((step) => (
                        <li key={step} className="text-[11px] leading-relaxed text-zinc-400">
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel
        title="תוכניות משאבים (EnergyPlan) — 10 אחרונות"
        icon={<Wallet className="size-4 text-amber-400" aria-hidden />}
        source="/api/saos/plans"
        lastChecked={plansQ.lastChecked}
        onRefresh={plansQ.refresh}
        refreshing={plansQ.refreshing}
      >
        {plans.energyPlans.length === 0 ? (
          <EmptyState
            title="אין תוכניות משאבים שמורות"
            explanation="תוכניות (TRON energize / HIVE rc-recovery) נשמרות כשמופקות דרך /api/saos/energy. כאן מוצג רק מה שנשמר בפועל."
            nextAction="הפק תוכנית דרך GET /api/saos/energy?net=tron&trx=… (חישוב בלבד) — או השתמש במספרים מכרטיסי הרשתות לעיל."
          />
        ) : (
          <ul className="scroll-slim max-h-72 space-y-2 overflow-y-auto pl-1">
            {plans.energyPlans.map((p) => (
              <li key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info" className="font-mono">
                    {p.network}
                  </Badge>
                  <Badge tone="neutral">{p.mode}</Badge>
                  <span className="text-[10px] text-zinc-500">{fmtDateTime(p.createdAt)}</span>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-400 sm:grid-cols-4">
                  {p.trxStaked !== null && <span dir="ltr">stake: {fmtNum(p.trxStaked)} TRX</span>}
                  {p.energyOut !== null && <span dir="ltr">energy/day: {fmtNum(p.energyOut)}</span>}
                  {p.settlements !== null && <span dir="ltr">settlements: {fmtNum(p.settlements)}</span>}
                  {p.burnCost !== null && <span dir="ltr">burn: {fmtNum(p.burnCost)} TRX/day</span>}
                  {p.rcFloorPct !== null && <span dir="ltr">rc floor: {p.rcFloorPct}%</span>}
                </div>
                {p.notes && <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{p.notes}</p>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          מקור רמות המשאבים: HIVE RC = מדידה-חיה (rc_api, cache-10 דק׳ — Task 26-c) עם HIVE_RC_PCT כ-fallback · TRON = מדידה-חיה (getaccount על כל כתובות הכספת, cache-10 דק׳ — 2026-09-11) עם TRON_ENERGY כ-fallback · עיגון-הצי רץ אוטומטית רק כשדמון fleet-cure (:3034) חי וסטטוסו טרי (עד 15 דק׳) — פסקי-הדין למעלה הם הראייה החיה, לא הבטחה מקובץ קפוא.
        </p>
      </Panel>
    </div>
  );
}
