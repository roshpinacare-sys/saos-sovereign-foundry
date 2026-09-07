"use client";

import { Ban, ChevronDown, Info, Plus, RefreshCcw, Signature as SignatureIcon } from "lucide-react";
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
import { EP, errText, refreshKey, useSaos } from "./api";
import { SIGNATURE_STATUS, VERIFICATION_STATUS } from "./labels";
import type { SignatureRow, SignerResponse } from "./types";

const OPEN_STATUSES: SignatureRow["status"][] = ["pending", "awaiting-approval"];
const TERMINAL_NO_RESULT: SignatureRow["status"][] = ["expired", "cancelled", "failed"];
const ALL_STATUSES = ["pending", "awaiting-approval", "signed-externally", "recorded", "failed", "expired", "cancelled"] as const;

export function SignaturesTab() {
  const signerQ = useSaos<SignerResponse>("signer", () => fetch(EP.signer).then((r) => r.json() as Promise<SignerResponse>));
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [recordRow, setRecordRow] = useState<SignatureRow | null>(null);
  const [cancelRow, setCancelRow] = useState<SignatureRow | null>(null);

  if (signerQ.state === "error") {
    return <ErrorState kind={signerQ.err.kind} detail={errText(signerQ.err)} onRetry={signerQ.refresh} retrying={signerQ.refreshing} />;
  }
  if (signerQ.state === "loading") {
    return <LoadingPanel rows={5} label="חתימות ועוגנים" />;
  }

  const data = signerQ.data;
  const rows = data.pending;
  const filtered = rows.filter((r) => {
    if (statusFilter === "open") return OPEN_STATUSES.includes(r.status) || r.status === "signed-externally";
    if (statusFilter === "all") return true;
    return r.status === statusFilter;
  });

  const openCount = data.counts.awaitingApproval;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-zinc-100">חתימות ועוגנים — Signatures &amp; Anchors</h2>
        <p className="text-xs text-zinc-500">
          ממשק keyless: המערכת מכינה payload ו-digestToSign, הבעלים חותם מחוץ למערכת, ורק התוצאה הציבורית (txid) נרשמת חזרה — ונאמתת אם נדרש.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="תור בקשות חתימה — ספירות מחזור-חיים"
          icon={<SignatureIcon className="size-4 text-amber-400" aria-hidden />}
          source="/api/saos/signer"
          lastChecked={signerQ.lastChecked}
          onRefresh={signerQ.refresh}
          refreshing={signerQ.refreshing}
        >
          <div className="flex flex-wrap gap-1.5">
            {ALL_STATUSES.map((st) => {
              const info = SIGNATURE_STATUS[st];
              const count = data.counts.byStatus[st] ?? 0;
              return (
                <Badge key={st} tone={count > 0 ? info.tone : "neutral"}>
                  {info.label}: {count}
                </Badge>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
            סטטוסים מדווחים כפי שהם: unverified לעולם לא מוצג כעוגן סופי, ורישום txid הוא בלתי-הפיך.
          </p>
        </Panel>

        <Panel
          title="רישום חותמים (registry)"
          icon={<Info className="size-4 text-sky-400" aria-hidden />}
          source="/api/saos/signer · registry"
          lastChecked={signerQ.lastChecked}
        >
          <ul className="space-y-2">
            {data.registry.map((s) => (
              <li key={s.signer} className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-zinc-200">{s.signer}</span>
                  <Badge tone={s.status === "ready" ? "ok" : s.status === "awaiting-approval" ? "warn" : "neutral"}>{s.status}</Badge>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{s.detail}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        title="בקשות חתימה — תור מלא (20 אחרונות)"
        icon={<SignatureIcon className="size-4 text-zinc-500" aria-hidden />}
        source="/api/saos/signer · pending"
        lastChecked={signerQ.lastChecked}
        onRefresh={signerQ.refresh}
        refreshing={signerQ.refreshing}
        actions={
          <Btn size="sm" onClick={() => setCreateOpen(true)} ariaLabel="צור בקשת חתימה חדשה">
            <Plus className="size-3.5" aria-hidden />
            צור בקשת חתימה
          </Btn>
        }
      >
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="סינון לפי סטטוס">
          {[
            { id: "open", label: `פתוחות (${openCount})` },
            { id: "all", label: `הכול (${rows.length})` },
            ...ALL_STATUSES.map((st) => ({ id: st, label: SIGNATURE_STATUS[st].label }))
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              aria-pressed={statusFilter === f.id}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                "min-h-[32px] focus-visible:outline-2 focus-visible:outline-amber-400",
                statusFilter === f.id
                  ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
                  : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="אין בקשות חתימה בסינון הנוכחי"
            explanation="התור נשאב חי מ-/api/saos/signer. בקשה נוצרת רק על-ידי פעולה מפורשת — לא קיימות בקשות ממוצאות."
            nextAction="צור בקשת חתימה (חתימה ידנית מחוץ למערכת), או שנה את הסינון."
          />
        ) : (
          <ul className="space-y-2">
            {filtered.map((r) => {
              const info = SIGNATURE_STATUS[r.status] ?? SIGNATURE_STATUS.pending;
              const canMutate = r.txid === null && !TERMINAL_NO_RESULT.includes(r.status) && r.status !== "recorded";
              return (
                <li key={r.id} className="rounded-lg border border-zinc-800 bg-zinc-900/70">
                  <div className="flex flex-wrap items-center gap-2 p-2.5">
                    <Badge tone="info" className="font-mono">
                      {r.network}
                    </Badge>
                    <Badge tone={info.tone}>{info.label}</Badge>
                    {r.sealHeight !== null && (
                      <Badge tone="gold">
                        seal <Mono>{r.sealHeight}</Mono>
                      </Badge>
                    )}
                    {r.verificationStatus && r.verificationStatus !== "not-checked" && (
                      <Badge tone={VERIFICATION_STATUS[r.verificationStatus]?.tone ?? "neutral"} title={r.verificationSource ?? undefined}>
                        {VERIFICATION_STATUS[r.verificationStatus]?.label ?? r.verificationStatus}
                      </Badge>
                    )}
                    <Mono className="min-w-0 flex-1 truncate text-[11px] text-zinc-500" title={r.id}>
                      {r.id}
                    </Mono>
                    <div className="flex items-center gap-1">
                      {r.txid === null && canMutate && (
                        <>
                          <Btn
                            variant="outline"
                            size="sm"
                            onClick={() => setRecordRow(r)}
                            ariaLabel={`רשום תוצאה ציבורית לבקשה ${r.id}`}
                          >
                            רשום תוצאה
                          </Btn>
                          <Btn variant="danger" size="sm" onClick={() => setCancelRow(r)} ariaLabel={`בטל בקשת חתימה ${r.id}`}>
                            בטל
                          </Btn>
                        </>
                      )}
                      <Collapsible.Root open={expanded === r.id} onOpenChange={(o) => setExpanded(o ? r.id : null)}>
                        <Collapsible.Trigger
                          aria-label={`הצג פרטי בקשה ${r.id}`}
                          className="rounded-md border border-zinc-700 p-1.5 text-zinc-400 hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-amber-400"
                        >
                          <ChevronDown className={cn("size-3.5 transition-transform", expanded === r.id && "rotate-180")} aria-hidden />
                        </Collapsible.Trigger>
                      </Collapsible.Root>
                    </div>
                  </div>

                  {(r.txid || r.cancelReason) && (
                    <div className="px-2.5 pb-2.5">
                      {r.txid && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                          txid: <Mono title={r.txid}>{r.txid}</Mono>
                          {r.verificationStatus === "not-checked" && (
                            <span className="text-zinc-500">· טרם נבדק מול רשת ציבורית — לא סופי</span>
                          )}
                        </div>
                      )}
                      {r.cancelReason && <div className="text-[11px] text-zinc-500">סיבה: {r.cancelReason}</div>}
                      {r.purpose && <div className="text-[11px] text-zinc-500">מטרה: {r.purpose}</div>}
                    </div>
                  )}

                  <Collapsible.Root open={expanded === r.id} onOpenChange={(o) => setExpanded(o ? r.id : null)}>
                    <Collapsible.Content className="px-2.5 pb-2.5">
                      <MetaRows
                        rows={[
                          { label: "מטרה (purpose)", value: r.purpose },
                          { label: "payloadHash", value: <Mono className="break-all">{r.payloadHash}</Mono>, mono: true },
                          { label: "digestToSign (חותמים את זה)", value: <Mono className="break-all">{r.digestToSign}</Mono>, mono: true },
                          { label: "sealRoot", value: r.sealRoot ? <Mono className="break-all">{r.sealRoot}</Mono> : "—", mono: true },
                          { label: "proofRef", value: r.proofRef ? <Mono className="break-all">{r.proofRef}</Mono> : "—", mono: true },
                          { label: "anchorRef", value: r.anchorRef ? <Mono className="break-all">{r.anchorRef}</Mono> : "—", mono: true },
                          {
                            label: "מצב אימות",
                            value:
                              r.verificationStatus === "verified"
                                ? r.verificationSource ?? "אומת"
                                : r.verificationStatus === "unverified"
                                  ? `לא אומת — ${r.verificationSource ?? "סיבה לא ידועה"}`
                                  : r.verificationStatus === "not-checked"
                                    ? "טרם נבדק מול רשת — לא סופי"
                                    : "—"
                          },
                          { label: "נוצר", value: fmtDateTime(r.createdAt) },
                          { label: "פג תוקף", value: fmtDateTime(r.expiresAt) },
                          { label: "חותם", value: `${r.signer} (${r.signerStatus})`, mono: true }
                        ]}
                      />
                      {r.auditTrail.length > 0 && (
                        <details className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
                          <summary className="cursor-pointer text-[11px] font-semibold text-zinc-400">היסטוריית ביקורת ({r.auditTrail.length})</summary>
                          <ul className="mt-1.5 space-y-1" aria-label={`היסטוריית ביקורת לבקשה ${r.id}`}>
                            {r.auditTrail.map((ev, i) => (
                              <li key={`${ev.at}-${i}`} className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                                <span className="tabular-nums">{fmtDateTime(ev.at)}</span>
                                <Badge tone="neutral">{ev.kind}</Badge>
                                <Mono className="text-zinc-400">{ev.actor}</Mono>
                                <span dir="ltr" className="min-w-0 flex-1 truncate font-mono text-zinc-500" title={ev.detail}>
                                  {ev.detail}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <details className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
                        <summary className="cursor-pointer text-[11px] font-semibold text-zinc-400">payload קנוני (ציבורי)</summary>
                        <pre dir="ltr" className="scroll-slim mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-zinc-400">
                          {JSON.stringify(r.payload, null, 2)}
                        </pre>
                      </details>
                    </Collapsible.Content>
                  </Collapsible.Root>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <CreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onDone={() => {
          void refreshKey("signer", () => fetch(EP.signer).then((r) => r.json()));
          void refreshKey("preflight", () => fetch(EP.preflight).then((r) => r.json()));
        }}
      />
      {recordRow && (
        <RecordDialog
          row={recordRow}
          onClose={() => setRecordRow(null)}
          onDone={() => {
            void refreshKey("signer", () => fetch(EP.signer).then((r) => r.json()));
            void refreshKey("preflight", () => fetch(EP.preflight).then((r) => r.json()));
          }}
        />
      )}
      {cancelRow && (
        <CancelDialog
          row={cancelRow}
          onClose={() => setCancelRow(null)}
          onDone={() => void refreshKey("signer", () => fetch(EP.signer).then((r) => r.json()))}
        />
      )}
    </div>
  );
}

/** shared 401 handler — points the operator to the login card */
function authToast(): void {
  toast.error("נדרשת התחברות — התחבר במסך אבטחה ומאגר ואז נסה שוב", { duration: 6000 });
}

function CreateDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [network, setNetwork] = useState("STEEM");
  const [signer, setSigner] = useState("manual");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(EP.signer, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network, signer })
      });
      if (res.status === 401 || res.status === 403) {
        authToast();
        return;
      }
      const body = (await res.json()) as { ok: boolean; idempotent?: boolean; error?: string; signature?: { id: string; status: string; digestToSign: string } };
      if (body.ok && body.signature) {
        toast.success(
          body.idempotent
            ? `קיימת כבר בקשה פתוחה ל-${network} — הוחזרה הקיימת (idempotent)`
            : `בקשת חתימה נוצרה (${body.signature.status}) — חותמים מחוץ למערכת ואז רושמים את ה-txid`
        );
        onOpenChange(false);
        onDone();
      } else {
        toast.error(`יצירה נדחתה: ${body.error ?? "שגיאה"}`);
      }
    } catch {
      toast.error("שגיאת רשת — הבקשה לא נוצרה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl focus-visible:outline-2 focus-visible:outline-amber-400">
          <Dialog.Title className="text-sm font-bold text-zinc-100">צור בקשת חתימה</Dialog.Title>
          <Dialog.Description className="mt-2 text-xs leading-relaxed text-zinc-400">
            המערכת מכינה payload קנוני + digestToSign על חותמת השרשרת האחרונה. לא נאסף ולא נדרש מפתח פרטי — החתימה מתבצעת אצלך, מחוץ למערכת.
          </Dialog.Description>
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-zinc-300">רשת יעד</span>
              <select
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-amber-400"
              >
                {["STEEM", "BLURT", "HIVE", "TRON"].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-300">סוג חותם</span>
              <select
                value={signer}
                onChange={(e) => setSigner(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-amber-400"
              >
                <option value="manual">manual — חתימה ידנית מחוץ למערכת (מוכן)</option>
                <option value="external">external — שירות חיצוני (מנותק — הבקשה תישאר pending)</option>
                <option value="hardware">hardware — מכשיר חומרה (מנותק)</option>
              </select>
            </label>
          </div>
          <div className="mt-4 flex justify-start gap-2">
            <Btn onClick={submit} loading={busy} ariaLabel="צור את בקשת החתימה">
              צור בקשה
            </Btn>
            <Dialog.Close asChild>
              <Btn variant="ghost" disabled={busy} ariaLabel="סגור ללא יצירה">
                בטל
              </Btn>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RecordDialog({ row, onClose, onDone }: { row: SignatureRow; onClose: () => void; onDone: () => void }) {
  const [txid, setTxid] = useState("");
  const [proofRef, setProofRef] = useState("");
  const [anchorRef, setAnchorRef] = useState("");
  const [verify, setVerify] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(EP.signer, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, txid, proofRef: proofRef || undefined, anchorRef: anchorRef || undefined, verify })
      });
      if (res.status === 401 || res.status === 403) {
        authToast();
        return;
      }
      const body = (await res.json()) as { ok: boolean; error?: string; note?: string; signature?: { status: string; verified: boolean | null; verificationSource: string | null } };
      if (body.ok) {
        if (body.signature?.verified === false) {
          toast.warning(`התוצאה נרשמה אך לא אומתה: ${body.signature.verificationSource ?? "סיבה לא ידועה"} — מוצגת כ-unverified`, { duration: 8000 });
        } else if (body.signature?.status === "recorded") {
          toast.success("התוצאה נרשמה ואומתה מול הרשת הציבורית (recorded)");
        } else {
          toast.success("התוצאה הציבורית נרשמה (בלי אימות רשת)");
        }
        onClose();
        onDone();
      } else {
        toast.error(`רישום נדחה: ${body.error ?? "שגיאה"}`);
      }
    } catch {
      toast.error("שגיאת רשת — הרישום לא בוצע");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl focus-visible:outline-2 focus-visible:outline-amber-400">
          <Dialog.Title className="text-sm font-bold text-zinc-100">רשום תוצאה ציבורית</Dialog.Title>
          <Dialog.Description className="mt-2 text-xs leading-relaxed text-zinc-400">
            רישום txid הוא <strong className="text-rose-400">בלתי-הפיך</strong>. הזן רק נתונים ציבוריים מהחתימה שביצעת מחוץ למערכת ({row.network}).
          </Dialog.Description>
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-zinc-300">txid (חובה, 8–128 תווים)</span>
              <input
                dir="ltr"
                value={txid}
                onChange={(e) => setTxid(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-amber-400"
                placeholder="txid מהסייר הציבורי"
                required
                minLength={8}
                maxLength={128}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-300">proofRef (קישור הוכחה — אופציונלי)</span>
              <input
                dir="ltr"
                value={proofRef}
                onChange={(e) => setProofRef(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 focus-visible:outline-2 focus-visible:outline-amber-400"
                placeholder="https://explorer/…"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-300">anchorRef (רפרנס עוגן — אופציונלי)</span>
              <input
                dir="ltr"
                value={anchorRef}
                onChange={(e) => setAnchorRef(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 focus-visible:outline-2 focus-visible:outline-amber-400"
                placeholder="saos.weave.v1/…"
              />
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <input
                type="checkbox"
                checked={verify}
                onChange={(e) => setVerify(e.target.checked)}
                className="mt-0.5 size-4 accent-amber-500"
              />
              <span className="text-[11px] leading-relaxed text-zinc-400">
                אמת txid מול רשת ציבורית (קריאה בלבד). אם האימות נכשל (למשל: אין יציאת-רשת מהסנדבוקס) התוצאה תישמר כ-unverified — לעולם לא תוצג כעוגן סופי.
              </span>
            </label>
          </div>
          <div className="mt-4 flex justify-start gap-2">
            <Btn onClick={submit} loading={busy} disabled={txid.trim().length < 8} ariaLabel="רשום את התוצאה הציבורית">
              <RefreshCcw className="size-3.5" aria-hidden />
              רשום תוצאה
            </Btn>
            <Dialog.Close asChild>
              <Btn variant="ghost" disabled={busy} ariaLabel="סגור בלי רישום">
                בטל
              </Btn>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CancelDialog({ row, onClose, onDone }: { row: SignatureRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(EP.signer, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, action: "cancel", reason: reason || undefined })
      });
      if (res.status === 401 || res.status === 403) {
        authToast();
        return;
      }
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (body.ok) {
        toast.success("הבקשה בוטלה");
        onClose();
        onDone();
      } else {
        toast.error(`ביטול נדחה: ${body.error ?? "שגיאה"}`);
      }
    } catch {
      toast.error("שגיאת רשת — הביטול לא בוצע");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl focus-visible:outline-2 focus-visible:outline-amber-400">
          <Dialog.Title className="text-sm font-bold text-zinc-100">בטל בקשת חתימה</Dialog.Title>
          <Dialog.Description className="mt-2 text-xs leading-relaxed text-zinc-400">
            ביטול אפשרי רק לפני שנרשמה תוצאה ציבורית. הבקשה תסומן cancelled עם סיבה ציבורית.
          </Dialog.Description>
          <label className="mt-4 block">
            <span className="text-xs font-semibold text-zinc-300">סיבה ציבורית (אופציונלי)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-amber-400"
              placeholder="למה הבקשה מבוטלת?"
            />
          </label>
          <div className="mt-4 flex justify-start gap-2">
            <Btn variant="danger" onClick={submit} loading={busy} ariaLabel="אשר ביטול הבקשה">
              <Ban className="size-3.5" aria-hidden />
              אשר ביטול
            </Btn>
            <Dialog.Close asChild>
              <Btn variant="ghost" disabled={busy} ariaLabel="סגור בלי ביטול">
                סגור
              </Btn>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
