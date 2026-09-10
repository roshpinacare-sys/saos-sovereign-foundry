"use client";

import { useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, ExternalLink, HeartPulse, RefreshCw, ShieldCheck, Wifi, WifiOff } from "lucide-react";

import { Badge, Btn, Card, CardContent, CardHeader, CardTitle, MetaRows, Mono, cn, fmtDateTime } from "@/components/ui/kit";
import { EP, saosFetch, useSaos } from "./api";
import type { LiveProofResponse } from "./types";

/** tone per network probe outcome — honest three-state (no invented success) */
function probeCellInfo(p: LiveProofResponse["networks"][number]["probe"]): { tone: "ok" | "warn" | "danger" | "neutral"; label: string; icon: React.ReactNode } {
  if (!p || !p.attempted) return { tone: "neutral" as const, label: "לא נבדקה", icon: <WifiOff className="size-3 text-zinc-500" aria-hidden /> };
  if (p.ok) return { tone: "ok" as const, label: "חיה (קריאה)", icon: <Wifi className="size-3 text-emerald-400" aria-hidden /> };
  return { tone: "warn" as const, label: "לא מאומתת", icon: <WifiOff className="size-3 text-amber-400" aria-hidden /> };
}

/**
 * הוכחת חיים (Live Proof) — Task 13 part ה.
 * Shows: system aliveness, per-network live read-only probe results, blocked
 * networks with their blockers, backups/repo/CI state, open critical decisions,
 * the current safe-live posture and the next action. Zero secrets — the
 * payload contains booleans/counts/public chain data only.
 */
export function LiveProofCard() {
  const liveQ = useSaos<LiveProofResponse>("live-proof", () => saosFetch<LiveProofResponse>(EP.liveProof));
  const [expanded, setExpanded] = useState(false);

  if (liveQ.state === "loading") {
    return (
      <Card>
        <CardHeader>
          <CardTitle icon={<HeartPulse className="size-4 text-emerald-400" aria-hidden />}>הוכחת חיים</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Activity className="size-4 animate-pulse" aria-hidden /> מריץ בדיקת חיים (קריאה-בלבד על 6 רשתות)…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (liveQ.state === "error") {
    return (
      <Card className="border-rose-500/40">
        <CardHeader>
          <CardTitle icon={<HeartPulse className="size-4 text-rose-400" aria-hidden />}>הוכחת חיים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-rose-300">בדיקת החיים לא הגיעה — השרת אינו מגיב או הוגבל-קצב.</p>
          <Btn variant="outline" size="sm" onClick={liveQ.refresh} ariaLabel="נסה שוב בדיקת חיים">
            <RefreshCw className="size-3.5" aria-hidden /> נסה שוב
          </Btn>
        </CardContent>
      </Card>
    );
  }

  const d = liveQ.data;
  const serviceTone = d.service === "ok" ? "ok" : d.service === "degraded" ? "warn" : "danger";
  const serviceLabel = d.service === "ok" ? "המערכת חיה" : d.service === "degraded" ? "חיה · מופחתת" : "לא חיה";
  const modeLabel = d.liveMode.mode;
  const probed = d.networks.filter((n) => n.probe?.attempted).length;
  const probedOk = d.networks.filter((n) => n.probe?.ok).length;
  const blocked = d.networks.filter((n) => !n.isReadyForAnchor);
  const ciOk = d.ci.available && d.ci.lastRun?.conclusion === "success";

  return (
    <Card className={cn(d.service === "ok" ? "border-emerald-500/40" : d.service === "degraded" ? "border-amber-500/40" : "border-rose-500/40")}>
      <CardHeader>
        <CardTitle icon={<HeartPulse className={cn("size-4", d.service === "ok" ? "text-emerald-400" : "text-amber-400")} aria-hidden />}>הוכחת חיים — Live Proof</CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={serviceTone}>{serviceLabel}</Badge>
          <Badge tone={modeLabel === "live" ? "gold" : "info"}>מצב: {modeLabel}</Badge>
          {d.safeLive ? (
            <Badge tone="ok">
              <ShieldCheck className="size-3" aria-hidden /> safe-live · אפס שידור
            </Badge>
          ) : (
            <Badge tone="danger">שידור אפשרי</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 6-network live probe grid */}
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
            <span className="text-xs font-bold text-zinc-300">בדיקת-קריאה חיה לכל 6 הרשתות (read-only, ללא מפתח)</span>
            <span className="text-[10px] text-zinc-500">
              {probedOk}/{probed} מאומתות חי · {d.probesSummary.cached ? "מטמון 60 שנ'" : "בדיקה חיה"} · {fmtDateTime(d.probesSummary.at)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {d.networks.map((n) => {
              const info = probeCellInfo(n.probe);
              return (
                <div key={n.network} className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-xs font-bold text-zinc-200">{n.network}</span>
                    {info.icon}
                  </div>
                  <div className="mt-1 text-[10px] leading-tight text-zinc-400">{info.label}</div>
                  {n.probe?.ok && n.probe.headBlock !== null && (
                    <div className="mt-0.5 font-mono text-[10px] text-emerald-400/90" dir="ltr">
                      #{n.probe.headBlock.toLocaleString("en-US")}
                    </div>
                  )}
                  {n.probe?.ok && n.probe.headBlock === null && n.probe.chainIdHex && (
                    <div className="mt-0.5 font-mono text-[10px] text-emerald-400/90" dir="ltr">
                      chain {n.probe.chainIdHex}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* system proof meta */}
        <MetaRows
          rows={[
            { label: "זמן בדיקה", value: fmtDateTime(d.timestamp) },
            { label: "מסד נתונים", value: d.database.ok ? `תקין · ${d.database.counts.seals} חותמות · ${d.database.counts.auditEvents} אירועי ביקורת` : "לא נגיש" },
            { label: "הרשאות", value: d.auth.configured ? `מוגדרות (hash בלבד) · ביטול-סשנים ${d.auth.revocationReady ? "זמין" : "לא-מוכן"}` : "לא מוגדרות — fail-closed" },
            { label: "הגבלת קצב", value: d.rateLimit.active ? `פעילה · live-proof ${d.rateLimit.liveProofPerMinute}/דק'` : "כבויה" },
            { label: "גיבוי", value: d.backups.fresh && d.backups.lastVerified ? `טרי ומאומת · ${fmtDateTime(d.backups.lastBackupAt)}` : d.backups.lastBackupAt ? `קיים אך לא טרי/מאומת · ${fmtDateTime(d.backups.lastBackupAt)}` : "אין גיבוי" },
            { label: "ריפו", value: d.repo.available ? `${d.repo.branch} · ${d.repo.sync === "synced" ? "מסונכרן" : `${d.repo.unpushedCommits} לא-דחופים`}` : "git לא זמין" },
            {
              label: "CI (GitHub Actions)",
              value: d.ci.available ? (
                <span className="inline-flex items-center gap-1.5">
                  {ciOk ? <CheckCircle2 className="size-3.5 text-emerald-400" aria-hidden /> : <AlertTriangle className="size-3.5 text-amber-400" aria-hidden />}
                  {d.ci.lastRun?.conclusion ?? d.ci.lastRun?.status ?? "—"}
                  {d.ci.lastRun?.headSha12 ? <Mono className="text-zinc-500">@{d.ci.lastRun.headSha12}</Mono> : null}
                </span>
              ) : (
                "לא נשלף (best-effort)"
              )
            },
            { label: "עוגן הוכחה", value: proofAnchor(d) },
            { label: "החלטות פתוחות", value: `${d.decisions.openTotal} · קריטיות: ${d.decisions.openCritical.length}${d.decisions.openCritical.length > 0 ? ` (${d.decisions.openCritical.join(", ")})` : ""}` },
            { label: "תור חתימות", value: `פתוחות ${d.signatureQueue.open ?? 0} · נרשמו ${d.signatureQueue.recorded ?? 0} · נדחו ${d.signatureQueue.cancelled ?? 0}` }
          ]}
        />

        {/* blocked networks summary */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
          <div className="text-[11px] font-bold text-zinc-300">רשתות חסומות לעוגן ({blocked.length}/6) — חסימות כנות:</div>
          <ul className="mt-1 space-y-1">
            {blocked.slice(0, expanded ? blocked.length : 3).map((n) => (
              <li key={n.network} className="text-[11px] leading-relaxed text-zinc-400">
                <span className="font-mono font-bold text-zinc-200">{n.network}</span>: {n.blocker ?? "—"}
              </li>
            ))}
          </ul>
          {blocked.length > 3 && (
            <Btn variant="ghost" size="sm" className="mt-1" onClick={() => setExpanded((v) => !v)} ariaLabel={expanded ? "הסתר חסימות" : "הצג את כל החסימות"}>
              {expanded ? "הצג פחות" : `הצג את כל ${blocked.length} החסימות`}
            </Btn>
          )}
        </div>

        {/* next action + safety note */}
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
          <div className="text-[11px] font-bold text-emerald-300">הפעולה הבאה:</div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-300">{(d.preflight.recommendedNextAction as string) ?? "—"}</p>
        </div>
        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500">
          <ShieldCheck className="mt-0.5 size-3 shrink-0 text-emerald-500" aria-hidden />
          {d.safety.note}
        </p>
        {d.errors.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
            <div className="text-[11px] font-bold text-amber-300">הערות כנות ({d.errors.length}):</div>
            <ul className="mt-0.5 space-y-0.5">
              {d.errors.map((e, i) => (
                <li key={i} className="text-[10px] text-zinc-400" dir="ltr">
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="outline" size="sm" onClick={liveQ.refresh} ariaLabel="הרץ שוב בדיקת חיים">
            <RefreshCw className={cn("size-3.5", liveQ.refreshing && "animate-spin")} aria-hidden /> בדיקה מחדש
          </Btn>
          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
            <ExternalLink className="size-3" aria-hidden /> מקור: /api/saos/live-proof · תיעוד: docs/live-proof.md
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function proofAnchor(d: LiveProofResponse): React.ReactNode {
  if (d.proofRoot && d.proofHeight !== null) {
    return (
      <span className="inline-flex items-center gap-1.5">
        height <Mono>{d.proofHeight}</Mono> · <Mono className="text-zinc-500">{d.proofRoot.slice(0, 14)}…</Mono>
      </span>
    );
  }
  return "אין חותמה בשרשרת";
}
