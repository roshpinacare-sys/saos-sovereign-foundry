"use client";

import { CheckCircle2, FileLock2, Fingerprint, GitBranch, KeyRound, LogOut, ShieldCheck, Unlink, XCircle } from "lucide-react";
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
import { EP, errText, refreshKey, useSaos } from "./api";
import type { AuthStateResponse, LiveGateResponse, RepoStatusResponse, RevokeAllResponse } from "./types";

export function SecurityTab() {
  const repoQ = useSaos<RepoStatusResponse>("repo-status", () => fetch(EP.repoStatus).then((r) => r.json() as Promise<RepoStatusResponse>));
  const gateQ = useSaos<LiveGateResponse>("live-gate", () => fetch(EP.liveGate).then((r) => r.json() as Promise<LiveGateResponse>));
  const authQ = useSaos<AuthStateResponse>("auth", () => fetch(EP.auth).then((r) => r.json() as Promise<AuthStateResponse>));

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

      <AuthCard
        state={authQ.state === "ready" ? authQ.data : null}
        loading={authQ.state === "loading"}
        onChanged={() => {
          void refreshKey("auth", () => fetch(EP.auth).then((r) => r.json()));
          void refreshKey("audit", () => fetch(`${EP.audit()}&x=${Date.now()}`).then((r) => r.json()));
          void refreshKey("preflight", () => fetch(EP.preflight).then((r) => r.json()));
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
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (body.ok) {
        toast.success("התחברות הצליחה — פעולות רגישות מאושרות ל-12 שעות");
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
            <CheckCircle2 className="size-4" aria-hidden /> מחובר כ-actor: <Mono>{state.actor}</Mono>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            session cookie חתום HMAC (HttpOnly, SameSite=Strict, 12h). השרת מחזיק hash בלבד — מפתח הגלם לעולם לא נשמר במערכת.
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
            המפתח נשלח פעם אחת לאימות sha256 — אינו נשמר בדפדפן או בשרת.
          </p>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-300">מפתח אופרטור</span>
            <input
              type="password"
              dir="ltr"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-amber-400"
              placeholder="admin key"
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
      lastChecked={null}
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
  const repoQ = useSaos<RepoStatusResponse>("repo-status", () => fetch(EP.repoStatus).then((r) => r.json() as Promise<RepoStatusResponse>));
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
