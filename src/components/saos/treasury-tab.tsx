"use client";

import { Coins, Gem, Landmark, Sparkles, Target, TriangleAlert, Wallet } from "lucide-react";

import {
  Badge,
  Btn,
  ErrorState,
  LoadingPanel,
  Mono,
  Panel,
  Stat,
  cn
} from "@/components/ui/kit";
import { EP, errText, useSaos } from "./api";
import type { TreasuryBalanceRow, TreasuryGrapheneRow, TreasuryResponse } from "./types";

/**
 * קופה חיה (Task 41) — כל הכספים שלנו, אמיתיים, מהרשתות עצמן.
 * קריאה-בלבד לחלוטין: כתובות ציבוריות בלבד, אף מפתח לא נוגע במסך הזה.
 */
export function TreasuryTab() {
  const q = useSaos<TreasuryResponse>("treasury", () => fetch(EP.treasury).then((r) => r.json() as Promise<TreasuryResponse>));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-base font-bold">
          <Landmark className="size-4 text-amber-300" aria-hidden />
          <span className="text-gradient-gold">קופה חיה — כל הכספים שלנו, מהרשת בלבד</span>
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          יתרות אמיתיות מ-TRON / Ethereum / Solana / BLURT / STEEM / HIVE · קריאה-בלבד · אף מפתח לא מעורב · מטמון 60 שניות
        </p>
      </div>

      {q.state === "loading" && <LoadingPanel rows={6} label="קופה חיה" />}
      {q.state === "error" && <ErrorState kind={q.err.kind} detail={errText(q.err)} onRetry={q.refresh} retrying={q.refreshing} />}

      {q.state === "ready" && <TreasuryBody data={q.data} onRefresh={q.refresh} refreshing={q.refreshing} />}
    </div>
  );
}

function TreasuryBody({ data, onRefresh, refreshing }: { data: TreasuryResponse; onRefresh: () => void; refreshing: boolean }) {
  const s = data.summary;
  const gap = s.gapToUsdtSettlement;
  const gapPct = gap === null ? 0 : Math.min(100, Math.max(0, ((data.constants.trxPerUsdtTransfer - gap) / data.constants.trxPerUsdtTransfer) * 100));

  return (
    <div className="space-y-4">
      {data.degraded && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          מצב מופחת — חלק מהמקורות לא השיבו בזמן. הנתונים שכן הושגו מוצגים כנה.
        </div>
      )}

      {/* summary stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="TRX נזיל — סה״כ" value={s.totalTrx === null ? "—" : s.totalTrx.toFixed(2)} tone={s.totalTrx && s.totalTrx >= data.constants.trxPerUsdtTransfer ? "ok" : "danger"} hint={gap === 0 && s.totalTrx !== null ? "מספיק לישוב USDT" : gap !== null ? `חסר ${gap.toFixed(2)} TRX לישוב` : undefined} mono />
        <Stat label="USDT על TRON" value={s.totalTronUsdt === null ? "—" : s.totalTronUsdt.toFixed(2)} tone="gold" mono />
        <Stat label="ETH — סה״כ" value={s.totalEth === null ? "—" : s.totalEth.toFixed(4)} tone={s.totalEth ? "ok" : "default"} hint={`USDT: ${s.totalEthUsdt === null ? "—" : s.totalEthUsdt.toFixed(2)}`} mono />
        <Stat label="SOL — סה״כ" value={s.totalSol === null ? "—" : s.totalSol.toFixed(4)} tone={s.totalSol ? "ok" : "default"} hint={`USDT/USDC: ${s.totalSolUsdt === null ? "—" : s.totalSolUsdt.toFixed(2)}`} mono />
        <Stat label={`${data.account} — נזיל (BLURT+STEEM+HIVE)`} value={s.grapheneLiquid === null ? "—" : s.grapheneLiquid.toFixed(2)} tone="gold" hint="סכום מאוחד של שלוש הרשתות" mono />
        <Stat label="מקור" value="קריאה-בלבד" tone="info" hint={`עודכן ${new Date(data.generatedAt).toLocaleTimeString("he-IL")}`} />
      </div>

      {/* TRX gap to USDT settlement — the ONE number that gates TRC20 */}
      <Panel
        title="מד הפער — מה צריך כדי ליישב USDT על TRON"
        icon={<Target aria-hidden className="size-4 text-amber-300" />}
        source="/api/saos/treasury · gap"
        lastChecked={data.generatedAt}
        onRefresh={onRefresh}
        refreshing={refreshing}
      >
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs text-zinc-400">
              ישוב USDT (TRC20) שורף ≈ <strong className="text-zinc-200">{data.constants.trxPerUsdtTransfer} TRX</strong> אנרגיה להעברה. כרגע בקופה:{" "}
              <strong className={cn("tabular-nums", (s.totalTrx ?? 0) > 0 ? "text-amber-300" : "text-rose-300")}>{s.totalTrx === null ? "—" : s.totalTrx.toFixed(4)} TRX</strong>
            </p>
            {gap !== null && gap > 0 && <Badge tone="danger">חסר {gap.toFixed(2)} TRX</Badge>}
            {gap !== null && gap === 0 && <Badge tone="ok">הפער סגור</Badge>}
          </div>
          <div className="h-3 overflow-hidden rounded-full border border-white/[0.06] bg-white/[0.03]" role="progressbar" aria-valuenow={Math.round(gapPct)} aria-valuemin={0} aria-valuemax={100} aria-label="התקדמות לסגירת פער ה-TRX">
            <div className="h-full rounded-full bg-gradient-to-l from-amber-300 to-amber-500 shadow-[0_0_12px_rgba(245,184,65,0.5)] transition-all duration-700" style={{ width: `${gapPct}%` }} />
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            כל טעינת TRX לארנק החדש מתקדמת את המד הזה. המספר מחושב מרשת TRON עצמה (אנרגיית USDT ≈ 64,895 · שריפה 420 sun/יחידה) — לא הערכה.
          </p>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AddressTablePanel
          title="TRON — ארנק חדש + כספת פורנזית"
          icon={<Wallet aria-hidden className="size-4 text-emerald-300" />}
          rows={data.chains.tron.rows}
          explorer={data.chains.tron.explorer}
          nativeSymbol="TRX"
        />
        <AddressTablePanel
          title="Ethereum — ארנק חדש + כספת"
          icon={<Gem aria-hidden className="size-4 text-teal-300" />}
          rows={data.chains.evm.rows}
          explorer={data.chains.evm.explorer}
          nativeSymbol="ETH"
        />
      </div>

      <AddressTablePanel
        title="Solana — כספת פורנזית (ממתינה להחלטת בעלים)"
        icon={<Sparkles aria-hidden className="size-4 text-violet-300" />}
        rows={data.chains.solana.rows}
        explorer={data.chains.solana.explorer}
        nativeSymbol="SOL"
      />

      <GraphenePanel rows={data.chains.graphene.rows} account={data.account} lastChecked={data.generatedAt} onRefresh={onRefresh} refreshing={refreshing} />

      <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-zinc-500">
        שקיפות מלאה: המסך קורא רק יתרות ציבוריות של כתובות ידועות (docs/KEY-RECOVERY.md + docs/FORENSIC-AUDIT.md + הארנק החדש של הבעלים). תיקון 2026-09-10: שש-הכתובות שסומנו בעבר כ&quot;כספות TRON&quot; התגלו כמפתות-ציבוריים של STEEM/HIVE בקידומת שגויה — הוסרו מהמסך. כתובות נוספות של הבעלים (בורסות, ארנקי קר), לא נגישות למערכת ולכן לא מוצגות — הנתון כאן הוא תמיד &quot;מה המערכת באמת רואה&quot;, לא יותר.
      </p>
    </div>
  );
}

function AddressTablePanel({
  title,
  icon,
  rows,
  explorer,
  nativeSymbol
}: {
  title: string;
  icon: React.ReactNode;
  rows: TreasuryBalanceRow[];
  explorer: string;
  nativeSymbol: string;
}) {
  return (
    <Panel title={title} icon={icon} source="/api/saos/treasury" lastChecked={null}>
      <ul className="scroll-slim max-h-96 space-y-2 overflow-y-auto pl-1">
        {rows.map((r) => (
          <li key={r.address} className="glass rounded-xl p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-zinc-200">{r.label}</span>
              {r.status === "error" ? (
                <Badge tone="danger">שגיאה: {r.error}</Badge>
              ) : r.activated === false ? (
                <Badge tone="neutral">לא הופעל מעולם</Badge>
              ) : (
                <Badge tone="ok">פעיל</Badge>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Mono className="text-[11px] text-zinc-500" title={r.address}>
                {r.address.slice(0, 10)}…{r.address.slice(-6)}
              </Mono>
              {r.status === "ok" && (
                <>
                  <span className="text-xs tabular-nums text-zinc-300">
                    <strong className={cn("font-bold", (r.native ?? 0) > 0 ? "text-amber-300" : "text-zinc-400")}>{(r.native ?? 0).toFixed(r.nativeSymbol === "ETH" ? 6 : 4)}</strong> {nativeSymbol}
                  </span>
                  <span className="text-xs tabular-nums text-zinc-400">
                    USDT: <strong className="text-zinc-300">{(r.usdt ?? 0).toFixed(2)}</strong>
                  </span>
                </>
              )}
              <a href={`${explorer}${r.address}`} target="_blank" rel="noreferrer" className="ms-auto text-[11px] text-teal-400 underline-offset-2 hover:underline" aria-label={`צפה ב-${r.label} בסייר הבלוקים`}>
                סייר ↗
              </a>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function GraphenePanel({
  rows,
  account,
  lastChecked,
  onRefresh,
  refreshing
}: {
  rows: TreasuryGrapheneRow[];
  account: string;
  lastChecked: string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <Panel
      title={`החשבון הראשי — ${account} על BLURT / STEEM / HIVE`}
      icon={<Coins aria-hidden className="size-4 text-amber-300" />}
      source="condenser_api.get_accounts · ציבורי"
      lastChecked={lastChecked}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {rows.map((g) => (
          <div key={g.chain} className="glass rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-zinc-200">{g.chain}</span>
              {g.status === "ok" ? <Badge tone="ok">חי</Badge> : <Badge tone="danger">שגיאה: {g.error}</Badge>}
            </div>
            {g.status === "ok" && (
              <div className="mt-2 space-y-1 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-zinc-500">נזיל</span>
                  <strong className="font-mono text-sm text-amber-300">{g.liquid}</strong>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-zinc-500">SBD/HBD (חוב)</span>
                  <span className="font-mono text-[11px] text-zinc-300">{g.debt ?? "—"}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-zinc-500">מוקפא (VESTS)</span>
                  <span className="font-mono text-[10px] text-zinc-400">{g.vested}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Btn
          variant="outline"
          size="sm"
          onClick={() => window.open("https://rpc.beblurt.com", "_blank")}
          ariaLabel="בדיקת קשר ישירה מול נקודת הקצה של BLURT"
        >
          בדיקת קשר BLURT
        </Btn>
        <span className="text-[11px] text-zinc-500">הנזיל ב-BLURT הוא מקור דמי-העוגן בפועל (עמלת השידור 0.129 BLURT לעוגן).</span>
      </div>
    </Panel>
  );
}
