"use client";

import {
  CheckCircle2,
  Database,
  GitBranch,
  ListChecks,
  ReceiptText,
  Rocket,
  Server,
  ShieldAlert,
  Target
} from "lucide-react";
import { toast } from "sonner";

import {
  Badge,
  Btn,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CheckRow,
  EmptyState,
  ErrorState,
  LoadingPanel,
  MetaRows,
  Mono,
  Panel,
  Stat,
  fmtDateTime
} from "@/components/ui/kit";
import { EP, errText, useSaos } from "./api";
import { ANCHOR_STATUS, NETWORK_STATUS } from "./labels";
import type { DecisionsResponse, PreflightResponse, RepoStatusResponse, StatusResponse } from "./types";

/** which screen handles each preflight blocker — priority mirrors the server's own recommendedNextAction order */
function blockerTab(blockerIds: string[], hasOpenSignature: boolean): string {
  if (blockerIds.includes("backup-fresh-verified") || blockerIds.includes("auth-ready")) return "security";
  if (blockerIds.includes("seal-present") || blockerIds.includes("chain-intact")) return "chain";
  if (blockerIds.includes("network-resources")) return "networks";
  if (blockerIds.includes("mode-allows-broadcast")) return "decisions";
  if (blockerIds.includes("signature-request-open") || hasOpenSignature) return "signatures";
  return "chain";
}

export function OverviewTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const statusQ = useSaos<StatusResponse>("status", () => fetch(EP.status).then((r) => r.json() as Promise<StatusResponse>));
  const preflightQ = useSaos<PreflightResponse>("preflight", () => fetch(EP.preflight).then((r) => r.json() as Promise<PreflightResponse>));
  const repoQ = useSaos<RepoStatusResponse>("repo-status", () => fetch(EP.repoStatus).then((r) => r.json() as Promise<RepoStatusResponse>));
  const decQ = useSaos<DecisionsResponse>("decisions", () => fetch(EP.decisions).then((r) => r.json() as Promise<DecisionsResponse>));

  const ready = statusQ.state === "ready" && preflightQ.state === "ready" && repoQ.state === "ready" && decQ.state === "ready";
  if (!ready) {
    if (statusQ.state === "error" || preflightQ.state === "error" || repoQ.state === "error" || decQ.state === "error") {
      const firstErr = [statusQ, preflightQ, repoQ, decQ].find((q) => q.state === "error");
      return (
        <ErrorState
          kind={firstErr && firstErr.state === "error" ? firstErr.err.kind : "server"}
          detail={firstErr && firstErr.state === "error" ? errText(firstErr.err) : undefined}
          onRetry={() => {
            statusQ.refresh();
            preflightQ.refresh();
            repoQ.refresh();
            decQ.refresh();
          }}
        />
      );
    }
    return <LoadingPanel rows={6} label="סקירה כללית" />;
  }

  const status = statusQ.data;
  const preflight = preflightQ.data;
  const repo = repoQ.data;
  const decisions = decQ.data;
  const latestSeal = status.seals[0] ?? null;
  const blockers = preflight.blockers;
  const warnings = preflight.warnings;
  const targetTab = blockerTab(blockers.map((b) => b.id), preflight.pendingSignatureQueue.open > 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-zinc-100">סקירה כללית — Command Center</h2>
        <p className="text-xs text-zinc-500">מה המצב עכשיו, מה חסום, ומה הפעולה הבאה — משוך מנתוני /api/saos/* חיים בלבד.</p>
      </div>

      {/* the single recommended action */}
      <Card className={blockers.length > 0 ? "border-rose-500/40" : "border-emerald-500/40"}>
        <CardHeader>
          <CardTitle icon={<Target className="size-4 text-amber-400" aria-hidden />}>פעולה מומלצת אחת</CardTitle>
          <Badge tone={preflight.readyForAnchor ? "ok" : "danger"}>
            {preflight.readyForAnchor ? "מוכן לעוגן" : `לא מוכן לעוגן · ${blockers.length} חסימות`}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm font-semibold leading-relaxed text-zinc-100">{preflight.recommendedNextAction}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={() => onNavigate(targetTab)} ariaLabel="מעבר למסך שבו מבוצעת הפעולה המומלצת">
              <Rocket className="size-3.5" aria-hidden />
              מעבר לביצוע
            </Btn>
            <span className="text-[11px] text-zinc-500">מקור: /api/saos/anchor-preflight · {fmtDateTime(preflight.generatedAt)}</span>
          </div>
        </CardContent>
      </Card>

      {/* status stat row */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="מצב מערכת" value={status.mode} tone={status.mode === "dry-run" ? "info" : status.mode === "live" ? "warn" : "default"} hint={status.broadcastCapable ? "שידור אפשרי" : "אפס שידור"} />
        <Stat label="גובה שרשרת" value={latestSeal ? <Mono>{latestSeal.height}</Mono> : "—"} tone={latestSeal ? "gold" : "default"} hint={latestSeal ? "חותמה אחרונה" : "אין חותמות"} />
        <Stat label="חסימות פעילות" value={blockers.length} tone={blockers.length ? "danger" : "ok"} hint={warnings.length ? `${warnings.length} אזהרות` : "אין אזהרות"} />
        <Stat label="החלטות פתוחות" value={decisions.counts.open} tone={decisions.counts.openCritical ? "warn" : "ok"} hint={`${decisions.counts.openCritical} קריטיות`} />
        <Stat label="סנכרון ריפו" value={repo.git.available ? (repo.git.unpushedCommits === 0 && repo.git.uncommittedFiles === 0 ? "מסונכרן" : `${repo.git.uncommittedFiles ?? 0} שינויים · ${repo.git.unpushedCommits ?? 0} לדחיפה`) : "—"} tone={repo.git.available ? (repo.git.unpushedCommits === 0 ? "ok" : "warn") : "default"} />
        <Stat label="גיבוי מאומת" value={repo.backups.lastVerifiedOk ? "תקין" : "חסר"} tone={repo.backups.lastVerifiedOk ? "ok" : "danger"} hint={repo.backups.lastVerifiedAt ? fmtDateTime(repo.backups.lastVerifiedAt) : "הרץ bun run backup"} />
      </div>

      {/* blockers */}
      <Panel
        title="חסימות פעילות ואזהרות"
        icon={<ShieldAlert className="size-4 text-rose-400" aria-hidden />}
        source="/api/saos/anchor-preflight"
        lastChecked={preflightQ.lastChecked}
        onRefresh={preflightQ.refresh}
        refreshing={preflightQ.refreshing}
      >
        {blockers.length === 0 && warnings.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 className="size-4" aria-hidden /> אין חסימות ואין אזהרות — כל 10 בדיקות ה-preflight עברו.
          </div>
        ) : (
          <div className="space-y-2">
            {preflight.checks
              .filter((c) => c.status !== "pass")
              .map((c) => (
                <CheckRow key={c.id} status={c.status} title={c.id} detail={c.detail} />
              ))}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* server + DB health */}
        <Panel
          title="בריאות שרת ומסד-נתונים"
          icon={<Server className="size-4 text-emerald-400" aria-hidden />}
          source="/api/saos/status"
          lastChecked={statusQ.lastChecked}
          onRefresh={statusQ.refresh}
          refreshing={statusQ.refreshing}
        >
          <MetaRows
            rows={[
              { label: "שרת API", value: status.ok ? "מגיב (HTTP 200)" : "לא מגיב" },
              { label: "מסד נתונים (SQLite)", value: status.opsLogged !== undefined ? `נגיש · ${status.opsLogged} רישומי תפעול` : "—", mono: false },
              { label: "שכבת הרשאות", value: status.security.authConfigured ? "מוגדרת (hash בלבד)" : "לא מוגדרת — fail-closed" },
              { label: "הגבלת קצב", value: status.security.rateLimit.active ? `פעילה · status ${status.security.rateLimit.status}/דק' · seal ${status.security.rateLimit.seal}/דק'` : "כבויה" },
              { label: "כתיבה", value: status.writesEnabled ? "מאושרת (dry-run)" : "נדחית במצב הנוכחי" },
              { label: "שידור חיצוני", value: status.broadcastCapable ? "אפשרי" : "לא אפשרי — אין חותם מחובר" }
            ]}
          />
          <div className="mt-3 flex items-center gap-2">
            <Btn
              variant="outline"
              size="sm"
              ariaLabel="הרץ selftest של הקרנל — בדיקה חיה של 7 תכונות"
              onClick={async () => {
                toast.info("מריץ selftest…");
                const res = await fetch(EP.kernel).then((r) => r.json() as Promise<{ ok: boolean; result?: { checks?: { pass: boolean }[] }; error?: string }>);
                if (res.ok && res.result?.checks?.every((c) => c.pass)) toast.success("selftest 7/7 עבר — הקרנל דטרמיניסטי ותקין");
                else toast.error(`selftest נכשל: ${res.error ?? "תשובה לא תקינה"}`);
              }}
            >
              <ListChecks className="size-3.5" aria-hidden />
              הרץ selftest קרנל (7 תכונות)
            </Btn>
          </div>
        </Panel>

        {/* networks mini */}
        <Panel
          title="רשתות חיצוניות — מצב כנה"
          icon={<GitBranch className="size-4 text-sky-400" aria-hidden />}
          source="/api/saos/status · networks"
          lastChecked={statusQ.lastChecked}
          onRefresh={statusQ.refresh}
          refreshing={statusQ.refreshing}
          actions={
            <Btn variant="ghost" size="sm" onClick={() => onNavigate("networks")} ariaLabel="מעבר למסך הרשתות המלא">
              לפירוט
            </Btn>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {status.networks.map((n) => {
              const info = NETWORK_STATUS[n.status] ?? { label: n.status, tone: "neutral" as const };
              return (
                <div key={n.network} className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-xs font-bold text-zinc-200">{n.network}</span>
                    <Badge tone={info.tone}>{info.label}</Badge>
                  </div>
                  <div className="mt-1.5 space-y-1 text-[10px] leading-tight text-zinc-500">
                    <div>{n.isDryRunOnly ? "dry-run בלבד" : "מסלול ישיר"}</div>
                    <div>{n.isReadyForAnchor ? "מוכנה לעוגן" : "לא מוכנה לעוגן"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* recent seals + receipts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="חותמות אחרונות"
          icon={<Database className="size-4 text-amber-400" aria-hidden />}
          source="/api/saos/status · seals[8]"
          lastChecked={statusQ.lastChecked}
          onRefresh={statusQ.refresh}
          refreshing={statusQ.refreshing}
          actions={
            <Btn variant="ghost" size="sm" onClick={() => onNavigate("chain")} ariaLabel="מעבר למסך השרשרת המלא">
              לשרשרת
            </Btn>
          }
        >
          {status.seals.length === 0 ? (
            <EmptyState
              title="אין חותמות בשרשרת"
              explanation="השרשרת ריקה — לא בוצעה עדיין אף פעימת איטום בסביבה זו. אין נתונים מומצאים; השרשרת נבנית רק מפעימות אמיתיות."
              nextAction="מסך שרשרת ואימות → הרץ פעימה (POST /seal) כדי ליצור את החותמה הראשונה."
            />
          ) : (
            <ul className="space-y-2" aria-label="שמונה חותמות אחרונות">
              {status.seals.slice(0, 4).map((s) => (
                <li key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="gold">height <Mono>{s.height}</Mono></Badge>
                    <Mono className="text-zinc-400">{s.root.slice(0, 16)}…</Mono>
                    <span className="text-[10px] text-zinc-500">{fmtDateTime(s.createdAt)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">{s.leaves} עלים</span>
                    {s.anchors.map((a) => {
                      const info = ANCHOR_STATUS[a.status] ?? ANCHOR_STATUS.pending;
                      return (
                        <Badge key={a.network} tone={info.tone}>
                          {a.network}: {info.label}
                        </Badge>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="זרם קבלות-ראיות אחרון"
          icon={<ReceiptText className="size-4 text-zinc-500" aria-hidden />}
          source="/api/saos/status · receipts[10]"
          lastChecked={statusQ.lastChecked}
          onRefresh={statusQ.refresh}
          refreshing={statusQ.refreshing}
        >
          {status.receipts.length === 0 ? (
            <EmptyState
              title="אין קבלות"
              explanation="שרשרת הקבלות (hash-chained receipts) ריקה — כל פעולה ראויה-ראיה תוסיף קבלה כאן."
              nextAction="הרץ selftest או פעימה כדי ליצור את הקבלה הראשונה."
            />
          ) : (
            <ul className="scroll-slim max-h-64 space-y-1.5 overflow-y-auto pl-1" aria-label="עשר קבלות אחרונות">
              {status.receipts.slice(0, 8).map((r, i) => (
                <li key={r.digest} className="flex items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/60 px-2.5 py-1.5">
                  <Badge tone="neutral">{r.kind}</Badge>
                  <Mono className="min-w-0 flex-1 truncate text-zinc-400" title={r.digest}>
                    {r.digest}
                  </Mono>
                  <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">{fmtDateTime(r.at)}</span>
                  <span className="sr-only">קבלה {i + 1}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
