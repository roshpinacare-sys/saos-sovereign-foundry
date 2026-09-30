"use client";

import { CheckCircle2, FileLock2, Fingerprint, GitBranch, KeyRound, Link2, LogOut, RefreshCw, ShieldCheck, Unlink, XCircle } from "lucide-react";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";

import {
  Badge,
  Btn,
  ErrorState,
  LoadingPanel,
  MetaRows,
  Mono,
  Panel,
  fmtDateTime
} from "@/components/ui/kit";
import { EP, errText, refreshKey, saosAction, saosFetch, useSaos } from "./api";
import type { AuthStateResponse, LiveGateResponse, OwnerKeysIngestResponse, OwnerKeysStatusResponse, RepoStatusResponse, RevokeAllResponse, VerifyLiveResponse } from "./types";

export function SecurityTab() {
  const repoQ = useSaos<RepoStatusResponse>("repo-status", () => saosFetch<RepoStatusResponse>(EP.repoStatus));
  const gateQ = useSaos<LiveGateResponse>("live-gate", () => saosFetch<LiveGateResponse>(EP.liveGate));
  const authQ = useSaos<AuthStateResponse>("auth", () => saosFetch<AuthStateResponse>(EP.auth));
  const ownerKeysQ = useSaos<OwnerKeysStatusResponse>("owner-keys", () => saosFetch<OwnerKeysStatusResponse>(EP.ownerKeys));

  if (repoQ.state === "error" && gateQ.state === "error") {
    const e = repoQ;
    return <ErrorState kind={e.err.kind} detail={errText(e.err)} onRetry={() => { repoQ.refresh(); gateQ.refresh(); }} retrying={repoQ.refreshing} />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-zinc-100">אבטחה ומאגר — Security &amp; Repo</h2>
        <p className="text-xs text-zinc-500">סודות, הרשאות, מצב ריפו ודחיפה, גיבויים ושער ה-live — ממקורות קריאה-בלבד, ללא ערכי סוד.</p>
      </div>

      <OwnerKeysCard
        statusQ={ownerKeysQ}
        onIngested={() => {
          void refreshKey("owner-keys", () => saosFetch(EP.ownerKeys));
          void refreshKey("signer", () => saosFetch(EP.signer));
        }}
      />

      <AuthCard
        state={authQ.state === "ready" ? authQ.data : null}
        loading={authQ.state === "loading"}
        onChanged={() => {
          void refreshKey("auth", () => saosFetch(EP.auth));
          // roast 63: raw fetch stored a 401 {ok:false} body as READY data for
          // the "audit" key — opening the audit tab after logout then crashed
          // on data.counts.total (the roast-55-6 crash class, via the logout
          // path). saosFetch classifies 401 as an error state instead.
          void refreshKey("audit", () => saosFetch(EP.audit()));
          void refreshKey("preflight", () => saosFetch(EP.preflight));
        }}
        refresh={authQ.refresh}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {repoQ.state === "ready" ? <SecretHygieneCard data={repoQ.data} /> : <LoadingPanel rows={3} label="היגיינת סודות" />}
        <SessionRevocationCard authState={authQ.state === "ready" ? authQ.data : null} onChanged={authQ.refresh} />
      </div>

      {repoQ.state === "ready" ? <RepoPanel data={repoQ.data} onRefresh={repoQ.refresh} refreshing={repoQ.refreshing} /> : <LoadingPanel rows={4} label="מצב ריפו" />}
      {repoQ.state === "error" && <ErrorState kind={repoQ.err.kind} detail={errText(repoQ.err)} onRetry={repoQ.refresh} retrying={repoQ.refreshing} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {gateQ.state === "ready" ? <GatePanel data={gateQ.data} onRefresh={gateQ.refresh} refreshing={gateQ.refreshing} /> : gateQ.state === "error" ? <ErrorState kind={gateQ.err.kind} detail={errText(gateQ.err)} onRetry={gateQ.refresh} retrying={gateQ.refreshing} /> : <LoadingPanel rows={4} label="שער live" />}
        <BackupsPanel />
      </div>
    </div>
  );
}

function AuthCard({
  state,
  loading,
  onChanged,
  refresh
}: {
  state: AuthStateResponse | null;
  loading: boolean;
  onChanged: () => void;
  refresh: () => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function login() {
    setBusy(true);
    try {
      const res = await fetch(EP.auth, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      const body = (await res.json()) as { ok: boolean; error?: string; actor?: string; via?: string };
      if (body.ok) {
        toast.success(
          body.via
            ? `התחברות הצליחה עם מפתח הבעלים (${body.via}) — פעולות רגישות מאושרות`
            : "התחברות הצליחה — פעולות רגישות מאושרות",
          { duration: 6000 }
        );
        setKey("");
        onChanged();
      } else {
        toast.error(`התחברות נדחתה: ${body.error ?? "שגיאה"}`);
      }
    } catch {
      toast.error("שגיאת רשת — לא התחבר");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await fetch(EP.auth, { method: "DELETE" });
      toast.success("התנתקת — הפעלה-מחדש של פעולות רגישות דורשת התחברות");
      onChanged();
    } catch {
      // roast 63: a network failure here used to be an unhandled rejection
      toast.error("שגיאת רשת — ההתנתקות לא אושרה, נסה שוב");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="שכבת הרשאות (אופרטור)"
      icon={<KeyRound className="size-4 text-amber-400" aria-hidden />}
      source="/api/saos/auth"
      lastChecked={null}
      onRefresh={refresh}
      refreshing={loading}
    >
      {state === null ? (
        <LoadingPanel rows={1} label="מצב הרשאות" />
      ) : !state.authConfigured ? (
        <ErrorState kind="auth-unconfigured" detail="SAOS_ADMIN_KEY_HASH לא מוגדר — כל פעולה רגישה נדחית (fail-closed). הגדרה: docs/deployment.md §3." />
      ) : state.authenticated ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
            <CheckCircle2 className="size-4" aria-hidden />{" "}
            {state.actor.startsWith("owner:") ? (
              <>מחובר כבעלים: <Mono>{state.actor.slice("owner:".length)}</Mono></>
            ) : state.actor === "dev-managed-session" ? (
              <>מחובר — סשן מנוהל ומאובטח (TTL לפי השרת)</>
            ) : (
              <>מחובר — סשן פעיל ומאובטח</>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            session cookie חתום HMAC (HttpOnly, SameSite=Strict, TTL ארוך-טווח לפי הגדרת השרת SAOS_SESSION_TTL_H). השרת מחזיק hash בלבד — מפתח הגלם לעולם לא נשמר במערכת.
          </p>
          <Btn variant="danger" size="sm" onClick={logout} loading={busy} ariaLabel="התנתקות מהסשן">
            <LogOut className="size-3.5" aria-hidden />
            התנתק
          </Btn>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void login();
          }}
        >
          <p className="text-[11px] leading-relaxed text-zinc-400">
            פעולות רגישות (יצירת בקשות חתימה, רישום תוצאות, עדכון החלטות, יומן ביקורת) דורשות התחברות.
            אפשר להתחבר <strong className="font-semibold text-zinc-200">עם מפתח הבעלים הראשי</strong> (owner/active — STEEM/HIVE/BLURT) או עם מפתח-אופרטור.
            המפתח נשלח פעם אחת לאימות (hash בלבד, בתוך החותם-החיצוני) — לעולם לא נשמר בדפדפן או בשרת.
          </p>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-300">מפתח אופרטור / מפתח הבעלים</span>
            <input
              type="password"
              dir="ltr"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-amber-400"
              placeholder="מפתח ראשי (STEEM/HIVE/BLURT) או admin key"
              required
            />
          </label>
          <div className="flex items-center gap-2">
            <Btn type="submit" loading={busy} ariaLabel="התחבר עם מפתח האופרטור">
              התחבר
            </Btn>
            <span className="text-[10px] text-zinc-500">הגבלה: 8 ניסיונות/דקה (429 מעבר לכך)</span>
          </div>
        </form>
      )}
    </Panel>
  );
}

function SecretHygieneCard({ data }: { data: RepoStatusResponse }) {
  const s = data.secrets;
  const inTree = s.adminKeyFileInTree;
  return (
    <Panel
      title="היגיינת סודות (SH)"
      icon={<Fingerprint className="size-4 text-amber-400" aria-hidden />}
      source="/api/saos/repo-status · secrets"
      lastChecked={data.generatedAt}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={inTree ? "warn" : "ok"}>{inTree ? "SH-7 פתוח: קובץ מפתח בתוך עץ הפרויקט" : "אין קובץ מפתח בעץ הפרויקט"}</Badge>
        <Badge tone={s.envValuesExposed === false ? "ok" : "danger"}>{s.envValuesExposed === false ? "אפס ערכי-סוד ב-API" : "חשיפה?"}</Badge>
      </div>
      <MetaRows
        rows={[
          { label: "כלל hash בלבד", value: "המערכת מאחסנת hash של מפתח-האדמין — לעולם לא המפתח" },
          { label: "קובץ מפתח בעץ הפרויקט", value: inTree ? "קיים (קיום בלבד נבדק — התוכן לא נקרא)" : "לא נמצא", mono: false },
          { label: "הרשאות .env", value: s.envFilePerms ?? "—", mono: true },
          { label: "סריקת סודות אחרונה", value: `${s.scanCoveredFiles} קבצים · ${s.scanMatches.length} התאמות` }
        ]}
      />
      {inTree && (
        <p className="mt-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-200">
          פעולת בעלים מומלצת: להעביר את הקובץ מחוץ לעץ הפרויקט (למשל <Mono>~/.secrets/saos-admin-key</Mono> עם הרשאות 600), בלי להדפיס/להעתיק את המפתח בשום ערוץ. אם יש חשש שנחשף — רוטציה מלאה (מפתח חדש + hash חדש ב-.env) ותיעוד כפעולת בעלים. הנוהל: <Mono>docs/secret-hygiene.md</Mono>.
        </p>
      )}
      {!inTree && (
        <p className="mt-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[11px] leading-relaxed text-emerald-200">
          SH-7 סגור: אין קובץ מפתח בעץ הפרויקט. רוטציה נותרת פעולת בעלים אופציונלית אם יש חשש חשיפה: <Mono>docs/secret-hygiene.md §7</Mono>.
        </p>
      )}
      {s.scanMatches.length > 0 && (
        <ul dir="ltr" className="mt-2 space-y-0.5 font-mono text-[10px] text-zinc-500">
          {s.scanMatches.map((m, i) => (
            <li key={`${m.file}-${m.pattern}-${i}`} className="break-all">
              {m.file} → {m.pattern}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SessionRevocationCard({ authState, onChanged }: { authState: AuthStateResponse | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function revokeAll() {
    setBusy(true);
    try {
      const res = await fetch(EP.revokeAll, { method: "POST" });
      if (res.status === 401 || res.status === 403) {
        toast.error("נדרשת התחברות — התחבר במסך זה ואז נתק את הסשנים", { duration: 6000 });
        return;
      }
      if (res.status === 429) {
        toast.error("הגבלת קצב — המתן מספר שניות ונסה שוב");
        return;
      }
      const body = (await res.json()) as RevokeAllResponse;
      if (body.ok) {
        toast.success("כל הסשנים נותקו — נדרשת התחברות מחדש (האירוע נרשם ביומן הביקורת)", { duration: 7000 });
        setOpen(false);
        onChanged();
      } else {
        toast.error(`ניתוק נדחה: ${body.error ?? "שגיאה"}`);
      }
    } catch {
      toast.error("שגיאת רשת — הניתוק לא בוצע");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="ביטול סשנים גלובלי"
      icon={<Unlink className="size-4 text-rose-400" aria-hidden />}
      source="POST /api/saos/auth/revoke-all"
      lastChecked={null}
    >
      <p className="text-xs leading-relaxed text-zinc-400">
        ניתוק מיידי של <strong className="text-zinc-200">כל</strong> סשני האופרטור הפעילים — כולל הסשן שלך — באמצעות רוטציית epoch של הסשן. ללא אחסון רשימת סשנים וללא חומר-סוד; האירוע נרשם ביומן הביקורת. מפתח Bearer (סקריפטים) אינו מושפע מכוון.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Btn variant="danger" size="sm" onClick={() => setOpen(true)} disabled={authState ? !authState.authenticated : false} ariaLabel="נתק את כל הסשנים הפעילים">
          <Unlink className="size-3.5" aria-hidden />
          נתק את כל הסשנים
        </Btn>
        {authState && !authState.authenticated && (
          <span className="text-[11px] text-zinc-500">נדרשת התחברות לפני ביצוע הניתוק</span>
        )}
      </div>

      <Dialog.Root open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
          <Dialog.Content className="fixed start-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 rounded-xl border border-rose-500/40 bg-zinc-900 p-5 shadow-2xl focus-visible:outline-2 focus-visible:outline-rose-400">
            <Dialog.Title className="text-sm font-bold text-zinc-100">לנתק את כל הסשנים?</Dialog.Title>
            <Dialog.Description className="mt-2 text-xs leading-relaxed text-zinc-400">
              כל סשני האופרטור יבוטלו מיידית — כולל הסשן הנוכחי, ותידרש התחברות מחדש. הפעולה נרשמת ביומן הביקורת. לא מבוצע שינוי מפתח, לא מבוצע שידור, ולא מוצג חומר-סוד.
            </Dialog.Description>
            <div className="mt-4 flex justify-start gap-2">
              <Btn variant="danger" onClick={revokeAll} loading={busy} ariaLabel="אישור ניתוק כל הסשנים">
                כן — נתק הכול
              </Btn>
              <Dialog.Close asChild>
                <Btn variant="ghost" disabled={busy} ariaLabel="ביטול — סגור בלי ניתוק">
                  בטל
                </Btn>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Panel>
  );
}

function RepoPanel({ data, onRefresh, refreshing }: { data: RepoStatusResponse; onRefresh: () => void; refreshing: boolean }) {
  const g = data.git;
  return (
    <Panel
      title="מאגר ודחיפה (git)"
      icon={<GitBranch className="size-4 text-sky-400" aria-hidden />}
      source="/api/saos/repo-status"
      lastChecked={data.generatedAt}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      {!g.available ? (
        <p className="text-xs text-zinc-400">git אינו זמין בסביבה — מצב המאגר לא ניתן לקריאה.</p>
      ) : (
        <>
          <MetaRows
            rows={[
              { label: "ענף", value: g.branch ?? "—", mono: true },
              { label: "קומיט אחרון", value: g.lastCommit ? `${g.lastCommit.sha} — ${g.lastCommit.subject ?? ""}` : "—", mono: true },
              { label: "קומיטים לא נדחפו", value: g.unpushedCommits ?? "—", mono: true },
              { label: "קבצים לא מקומתים", value: g.uncommittedFiles ?? "—", mono: true },
              { label: "רימוט", value: g.remoteConfigured ? `מוגדר (${g.remoteHost ?? "?"})` : "לא מוגדר" }
            ]}
          />
          {g.uncommittedSample.length > 0 && (
            <details className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
              <summary className="cursor-pointer text-[11px] font-semibold text-zinc-400">קבצים שהשתנו ({g.uncommittedFiles})</summary>
              <ul dir="ltr" className="mt-1.5 space-y-0.5 font-mono text-[10px] text-zinc-500">
                {g.uncommittedSample.map((f) => (
                  <li key={f} className="break-all">
                    {f}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="mt-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px] leading-relaxed text-zinc-400">
            מדיניות דחיפה: קומיט מקומי → סריקת סודות → דחיפה רגילה <strong className="text-zinc-200">רק באישור בעלים</strong>, לפי הפרוטוקול הבטוח — ללא כוח, ללא מחיקה, ללא שכתוב היסטוריה. האישור מנוהל במסך החלטות בעלים.
          </p>
        </>
      )}
    </Panel>
  );
}

function GatePanel({ data, onRefresh, refreshing }: { data: LiveGateResponse; onRefresh: () => void; refreshing: boolean }) {
  return (
    <Panel
      title="שער live — רשימת בדיקה"
      icon={<ShieldCheck className="size-4 text-emerald-400" aria-hidden />}
      source="/api/saos/live-gate"
      lastChecked={data.generatedAt ?? null}
      onRefresh={onRefresh}
      refreshing={refreshing}
      actions={<Badge tone={data.readyForLive ? "ok" : "danger"}>{data.readyForLive ? "readyForLive" : "חסום ל-live"}</Badge>}
    >
      <ul className="space-y-2">
        {data.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
            {c.status === "pass" ? (
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" aria-hidden />
            ) : c.status === "warn" ? (
              <XCircle className="mt-0.5 size-3.5 shrink-0 text-amber-400" aria-hidden />
            ) : (
              <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-400" aria-hidden />
            )}
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-zinc-200" dir="ltr">
                {c.id}
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-400">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        השער מדווח בלבד — הפעלת live מחייבת החלטת בעלים + הפעלה-מחדש עם שני דגלים (SAOS_MODE=live ו-SAOS_LIVE_CONFIRM=YES).
      </p>
    </Panel>
  );
}

export function BackupsPanel() {
  const repoQ = useSaos<RepoStatusResponse>("repo-status", () => saosFetch<RepoStatusResponse>(EP.repoStatus));
  if (repoQ.state === "error") {
    return <ErrorState kind={repoQ.err.kind} detail={errText(repoQ.err)} onRetry={repoQ.refresh} retrying={repoQ.refreshing} />;
  }
  if (repoQ.state === "loading") {
    return <LoadingPanel rows={2} label="גיבויים" />;
  }
  const b = repoQ.data.backups;
  return (
    <Panel
      title="גיבויים (VACUUM INTO + manifest)"
      icon={<FileLock2 className="size-4 text-emerald-400" aria-hidden />}
      source="/api/saos/repo-status · backups + OpLog"
      lastChecked={repoQ.data.generatedAt}
      onRefresh={repoQ.refresh}
      refreshing={repoQ.refreshing}
      actions={<Badge tone={b.lastVerifiedOk ? "ok" : "danger"}>{b.lastVerifiedOk ? "גיבוי מאומת" : "אין גיבוי מאומת"}</Badge>}
    >
      {b.count === 0 ? (
        <p className="text-xs leading-relaxed text-zinc-400">
          אין גיבויים בסביבה. הרץ <Mono>bun run backup</Mono> (מחוץ לממשק — פעולת תחזוקה מקומית) כדי ליצור snapshot מאומת.
        </p>
      ) : (
        <ul className="scroll-slim max-h-56 space-y-1.5 overflow-y-auto pl-1">
          {b.recent.map((bk) => (
            <li key={bk.name} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-1.5">
              <Mono className="text-[11px] text-zinc-300">{bk.name}</Mono>
              {bk.verified === true && <Badge tone="ok">verified</Badge>}
              {bk.verified === false && <Badge tone="danger">לא מאומת</Badge>}
              <span className="text-[10px] text-zinc-500">
                {fmtDateTime(bk.createdAt)} · {(bk.bytes / 1024).toFixed(0)} KB
              </span>
            </li>
          ))}
        </ul>
      )}
      <MetaRows
        rows={[
          { label: "סריקת סודות אחרונה", value: `${repoQ.data.secrets.scanCoveredFiles} קבצים · ${repoQ.data.secrets.scanMatches.length} התאמות` },
          { label: "הרשאות .env", value: repoQ.data.secrets.envFilePerms ?? "—", mono: true }
        ]}
      />
    </Panel>
  );
}

// ── Task 29: owner key entry point — the ONLY place the owner's key is connected ──
function OwnerKeysCard({
  statusQ,
  onIngested
}: {
  statusQ: ReturnType<typeof useSaos<OwnerKeysStatusResponse>>;
  onIngested: () => void;
}) {
  const [steemKey, setSteemKey] = useState("");
  const [hiveKey, setHiveKey] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<OwnerKeysIngestResponse | null>(null);
  const [liveCheck, setLiveCheck] = useState<VerifyLiveResponse | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);

  const status = statusQ.state === "ready" ? statusQ.data : null;
  const netRow = (net: "STEEM" | "HIVE") => {
    const slot = status?.main?.networks?.[net]?.active;
    const ok = slot?.loaded === true && slot?.match === true;
    const loaded = slot?.loaded === true;
    return (
      <div key={net} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <Mono>{net}</Mono>
          <span className="text-[10px] font-normal text-zinc-500">מפתח-פעיל</span>
        </span>
        {ok ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400"><CheckCircle2 className="size-3.5" aria-hidden /> חובר ותואם לרשות-חיה</span>
        ) : loaded ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-400"><XCircle className="size-3.5" aria-hidden /> קיים אך לא תואם (חסר מפתח-הבעלים)</span>
        ) : (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-zinc-500"><XCircle className="size-3.5" aria-hidden /> חסר</span>
        )}
      </div>
    );
  };

  async function submit() {
    const entries = [
      steemKey.trim() ? { network: "STEEM", wif: steemKey.trim() } : null,
      hiveKey.trim() ? { network: "HIVE", wif: hiveKey.trim() } : null
    ].filter((e): e is { network: string; wif: string } => e !== null);
    if (!entries.length) {
      toast.error("הדבק מפתח-פעיל אחד לפחות (STEEM או HIVE)");
      return;
    }
    setBusy(true);
    try {
      const r = await saosAction<OwnerKeysIngestResponse>(EP.ownerKeys, { method: "POST", body: JSON.stringify({ entries }) });
      if (!r.ok) {
        // roast 63: 401/429 now classified instead of being shown as a verdict
        toast.error(r.err.kind === "auth" ? "נדרשת התחברות — התחבר במסך זה ואז חבר את המפתח" : `החיבור נכשל: ${errText(r.err)}`);
        return;
      }
      const body = r.data;
      setVerdict(body);
      if (body.ok) {
        toast.success(`המפתח חובר, אומת מול השרשרת ונאטם בכספת (${(body.ingested ?? []).map((i) => `${i.network}→${i.account}`).join(", ")})`);
        setSteemKey("");
        setHiveKey("");
        onIngested();
      } else {
        toast.error(body.error ?? "המפתח לא תואם לרשות-חיה — לא נכתב דבר");
      }
    } catch {
      toast.error("שגיאת רשת — המפתח לא נשלח");
    } finally {
      setBusy(false);
    }
  }

  // v2.4.0 — חיבור חכם: כל פורמט שהוא — קובץ מפתחות מלא, מפתח בודד, סיסמת-אב או seed
  async function submitUniversal() {
    const text = pasteText.trim();
    if (!text) {
      toast.error("הדבק קודם את חומר-המפתח בתיבה");
      return;
    }
    setBusy(true);
    try {
      const r = await saosAction<OwnerKeysIngestResponse>(EP.ownerKeys, { method: "POST", body: JSON.stringify({ text }) });
      if (!r.ok) {
        toast.error(r.err.kind === "auth" ? "נדרשת התחברות — התחבר במסך זה ואז חבר את המפתח" : `החיבור נכשל: ${errText(r.err)}`);
        return;
      }
      const body = r.data;
      setVerdict(body);
      if (body.ok) {
        toast.success(`חובר! ${(body.ingested ?? []).length} מפתח/ות אומתו מול השרשרת ונכתבו לתפקידיהם`);
        setPasteText("");
        onIngested();
      } else {
        toast.error(body.error ?? "לא נמצאה התאמה — שום דבר לא נכתב");
      }
    } catch {
      toast.error("שגיאת רשת — לא נשלח");
    } finally {
      setBusy(false);
    }
  }

  async function checkLive() {
    setLiveBusy(true);
    try {
      const res = await fetch(EP.verifyLive, { method: "POST" });
      const body = (await res.json()) as VerifyLiveResponse;
      // roast 63: a 401/429 body ({ok:false, no summary}) used to render the
      // success line "✓ מחוברים-חי: 0 סלוטים" — failure rendered as success.
      if (body.ok === false) {
        toast.error(res.status === 401 ? "נדרשת התחברות לבדיקת-החיבור" : body.error ?? "הבדיקה נכשלה");
        return;
      }
      setLiveCheck(body);
      const s = body.summary;
      if (s && (s.drift ?? 0) === 0 && (s.errors ?? 0) === 0) toast.success(`הכל מחובר — ${s.slots ?? 0} סלוטים מאומתים-חי מול השרשרת`);
      else if (s) toast.warning(`${s.slots ?? 0} מחוברים · ${s.drift ?? 0} לא-תואמים (מפתחות ישנים) — ראה הפירוט למטה`);
      onIngested();
    } catch {
      toast.error("שגיאת רשת בבדיקת-החיבור");
    } finally {
      setLiveBusy(false);
    }
  }

  return (
    <Panel
      title="מפתח-בעלים — נקודת חיבור (STEEM / HIVE)"
      icon={<KeyRound className="size-4 text-emerald-400" aria-hidden />}
      source="/api/saos/owner-keys"
      lastChecked={statusQ.state === "ready" ? statusQ.lastChecked : null}
      onRefresh={statusQ.refresh}
      refreshing={statusQ.refreshing}
    >
      <div className="space-y-3">
        <p className="text-[11px] leading-relaxed text-zinc-400">
          זו הכתובת שבה מחברים את המפתח. המפתח עובר מכאן <strong className="text-zinc-200">ישירות לחותם-החיצוני בתוך הסביבה</strong> —
          לעולם לא נשמר בשיחה, בלוג, בדפדפן או בריפו. לפני קבלה הוא נגזר למפתח-ציבורי ונבדק מול{" "}
          <strong className="text-zinc-200">הרשויות-החיות על השרשרת</strong> — מפתח שגוי או זר נדחה ושום דבר לא נכתב.
        </p>

        <div className="space-y-1.5">
          {netRow("STEEM")}
          {netRow("HIVE")}
        </div>

        {/* ── חיבור חכם: כל פורמט ── */}
        <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3">
          <p className="text-xs font-bold text-emerald-300">חיבור חכם — הדבק כל פורמט שהוא</p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
            קובץ מפתחות מלא (<Mono>OWNER = 5K…</Mono>), מפתח בודד, סיסמת-אב (<Mono>P…</Mono>) או seed של SAOS-ROT1 (64-hex) —
            המערכת מזהה לבד, מאמתת מול השרשרת וכותבת כל מפתח לתפקידו האמיתי (owner/active/posting/memo × STEEM/HIVE).
          </p>
          <textarea
            dir="ltr"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={4}
            autoComplete="off"
            spellCheck={false}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 focus-visible:outline-2 focus-visible:outline-emerald-400"
            placeholder={"STEEM\nOWNER = 5K…\nACTIVE = 5J…\nPOSTING = 5J…\nMEMO = 5J…\nHIVE\nOWNER = 5K…\n..."}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Btn onClick={() => void submitUniversal()} loading={busy} ariaLabel="חיבור חכם של כל פורמט מפתח">
              <Fingerprint className="size-3.5" aria-hidden />
              חיבור חכם
            </Btn>
            <Btn variant="ghost" onClick={() => void checkLive()} loading={liveBusy} ariaLabel="בדיקת חיבור חי לכל הסלוטים">
              <ShieldCheck className="size-3.5" aria-hidden />
              בדיקת חיבור-חי (הכל מחובר?)
            </Btn>
          </div>
          {liveCheck && (
            <div className="mt-2 space-y-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              {liveCheck.skipped ? (
                <p className="text-[11px] text-amber-400">הבדיקה דולגה — {liveCheck.reason ?? "נסה שוב"}</p>
              ) : (
                <>
                  <p className="text-[11px] font-semibold text-emerald-400">
                    ✓ מחוברים-חי: {liveCheck.summary?.slots ?? 0} סלוטים · לא-תואמים: {liveCheck.summary?.drift ?? 0} · שגיאות: {liveCheck.summary?.errors ?? 0} ({fmtDateTime(liveCheck.checkedAt ?? "")})
                  </p>
                  {(liveCheck.drifts ?? []).slice(0, 8).map((d, i) => (
                    <p key={`d-${i}`} className="text-[10px] text-zinc-500">
                      <Mono>{d.account}</Mono> {d.network}/{d.role} — מפתח-ישן (סובב בשרשרת); מצופה {d.expected.slice(0, 14)}…
                    </p>
                  ))}
                  {(liveCheck.drifts?.length ?? 0) > 8 && <p className="text-[10px] text-zinc-600">…ועוד {(liveCheck.drifts?.length ?? 0) - 8} סלוטים ישנים</p>}
                </>
              )}
            </div>
          )}
          {status?.drift?.lastCheck && (
            <p className="mt-1.5 text-[10px] text-zinc-500">
              בדיקת-סטייה אחרונה: {fmtDateTime(status.drift.lastCheck)} · סטיות פתוחות: {status.drift.openDrifts}
            </p>
          )}
        </div>

        <details className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
          <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-zinc-300">
            <Link2 className="size-3.5" aria-hidden /> איפה מוצאים את המפתח? (לחץ להצגה)
          </summary>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-[11px] leading-relaxed text-zinc-400">
            <li>STEEM: כניסה ל-steemitwallet.com → Permissions → לצד Active לחיצה על “Show private key” → העתקה.</li>
            <li>HIVE: כניסה ל-wallet.hive.blog / peakey.io → Permissions → Active → “Reveal private key” → העתקה.</li>
            <li>המפתח הוא מחרוזת ארוכה (WIF). להדביק כאן למטה בשדה המתאים ולחיצה על “חיבור”.</li>
            <li>מפתח-ה-posting ומפתח-ה-memo נשארים כמו שהם — נדרש רק ה-Active לפעולות ההמרה.</li>
            <li>יש seed של SAOS-ROT1 (מחרוזת 64-hex מצ‘אט הסיבוב)? אפשר להדביק אותו בכל שדה — המערכת תגזור את כל העץ, תאמת מול השרשרת ותחבר את כל החשבונות שנסובבו בבת אחת.</li>
          </ol>
        </details>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-zinc-300">מפתח-פעיל STEEM</span>
            <input
              type="password"
              dir="ltr"
              value={steemKey}
              onChange={(e) => setSteemKey(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-emerald-400"
              placeholder="STEEM active WIF"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-300">מפתח-פעיל HIVE</span>
            <input
              type="password"
              dir="ltr"
              value={hiveKey}
              onChange={(e) => setHiveKey(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-emerald-400"
              placeholder="HIVE active WIF"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Btn onClick={() => void submit()} loading={busy} ariaLabel="חיבור מפתח הבעלים">
            <RefreshCw className="size-3.5" aria-hidden />
            חיבור המפתח
          </Btn>
          {status?.sealedAt ? (
            <span className="text-[10px] text-zinc-500">כספת נאטמה: {fmtDateTime(status.sealedAt)} · חותם v{status.version ?? "?"}</span>
          ) : statusQ.state === "error" ? (
            <span className="text-[10px] text-amber-400">החותם לא נגיש — {errText(statusQ.err)}</span>
          ) : null}
        </div>

        {verdict && (
          <div className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            {(verdict.ingested ?? []).map((i) => (
              <div key={`${i.network}-${i.account}`} className="flex items-center gap-2 text-[11px] font-semibold text-emerald-400">
                <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                <span>
                  <Mono>{i.network}</Mono> — הותאם לחשבון <Mono>{i.account}</Mono> ונכתב לכספת המוצפנת ({fmtDateTime(i.sealedAt)})
                </span>
              </div>
            ))}
            {(verdict.refused ?? []).map((r, idx) => (
              <div key={`r-${idx}`} className="flex items-start gap-2 text-[11px] font-semibold text-rose-400">
                <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  <Mono>{r.network ?? "?"}</Mono> — {r.error ?? "לא תואם לרשות-חיה (שום דבר לא נכתב)"}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] leading-relaxed text-zinc-500">
          לאחר חיבור מוצלח: המסילה (DEX → חותם) מאומתת אוטומטית, ופעולות ההמרה והעגינות ירוצו דרך השערים הקיימים
          (החוזים והמגבלות החיים מדווחים ב&apos;קופה חיה&apos; ובשערים — לא מקודדים כאן).
        </p>
      </div>
    </Panel>
  );
}
