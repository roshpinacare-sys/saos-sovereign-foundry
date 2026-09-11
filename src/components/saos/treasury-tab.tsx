"use client";

import { ArrowDownToLine, ArrowUpFromLine, Coins, Flame, Gem, Landmark, Route, Sparkles, Target, TriangleAlert, Wallet } from "lucide-react";

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
import { EP, errText, saosFetch, useSaos } from "./api";
import type { TreasuryBalanceRow, TreasuryGrapheneRow, TreasuryOpsResponse, TreasuryOpsRow, TreasuryResponse } from "./types";

/**
 * מימוש בפועל (Task 76) — התשובה העומדת לשאלת הבעלים: מה יש לנו ומה אפשר לעשות
 * איתו עכשיו באמת. מדידה-חיה keyless + מפת-ביצוע (מה מוכן בחותם / מה שער-בעלים).
 */
export function TreasuryOpsPanel() {
  const q = useSaos<TreasuryOpsResponse>("treasury-ops", () => saosFetch<TreasuryOpsResponse>(EP.treasuryOps));
  if (q.state === "loading") return <LoadingPanel rows={4} label="מימוש בפועל — מודד שרשראות" />;
  if (q.state === "error") {
    return (
      <Panel title="מימוש בפועל" icon={<Sparkles className="size-4 text-amber-300" />} source={EP.treasuryOps} lastChecked={null}>
        <ErrorState kind={q.err.kind} detail={errText(q.err)} onRetry={q.refresh} retrying={q.refreshing} />
      </Panel>
    );
  }
  const d = q.data;
  if (!d) return null;
  const nets = ["STEEM", "HIVE", "BLURT"] as const;
  const visible = (rows: TreasuryOpsRow[]) =>
    rows.filter((r) => r.exists && (r.account === "headcorner" || r.liquid >= 0.001 || r.rewardsMain + r.rewardsDebt + r.rewardsVests > 0 || r.hp >= 0.5 || r.ownerGated.length > 0));
  return (
    <Panel
      title="מימוש בפועל — מה יש ומה אפשר לעשות איתו עכשיו"
      icon={<Sparkles className="size-4 text-amber-300" />}
      source={EP.treasuryOps}
      lastChecked={d.at}
      onRefresh={q.refresh}
      refreshing={q.refreshing}
    >
      <div className="space-y-3">
        {nets.map((net) => {
          const rows = visible(d.graphene.rows.filter((r) => r.network === net));
          if (!rows.length) return null;
          const liquid = rows.reduce((s, r) => s + r.liquid, 0);
          const debt = rows.reduce((s, r) => s + r.debt, 0);
          const hp = rows.reduce((s, r) => s + r.hp, 0);
          const rew = rows.reduce((s, r) => s + r.rewardsMain + r.rewardsDebt + r.rewardsVests, 0);
          return (
            <div key={net} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone="gold">{net}</Badge>
                <span className="text-zinc-400">נזיל צי <Mono className="text-amber-200">{liquid.toFixed(3)}</Mono></span>
                {hp > 0.01 && <span>· HP <Mono>{hp.toFixed(2)}</Mono></span>}
                {debt > 0.0005 && <span>· {net === "HIVE" ? "HBD" : "SBD"} <Mono>{debt.toFixed(3)}</Mono></span>}
                {rew > 0.0001 && <span className="text-emerald-300">· ממתין-לאיסוף <Mono>{rew.toFixed(3)}</Mono></span>}
              </div>
              <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {rows.map((r) => (
                  <div key={`${r.network}-${r.account}`} className="rounded-md border border-zinc-800/70 bg-zinc-950/60 p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-zinc-200">{r.account}</span>
                      <span className="text-zinc-400">נזיל <Mono className="text-amber-200">{r.liquid.toFixed(3)}</Mono></span>
                      {r.hp >= 0.01 && <span>· HP <Mono>{r.hp.toFixed(2)}</Mono></span>}
                      {r.rcPercent !== null && (
                        <span className={r.rcPercent < d.rcFloorPercent ? "text-rose-300" : "text-zinc-500"}>
                          · RC <Mono>{r.rcPercent.toFixed(2)}%</Mono>
                          {r.rcEtaMinToFloor !== null && <span className="text-zinc-500"> (~{r.rcEtaMinToFloor >= 60 ? `${Math.floor(r.rcEtaMinToFloor / 60)}ש׳ ${r.rcEtaMinToFloor % 60}ד׳` : `${r.rcEtaMinToFloor}ד׳`} לסף {d.rcFloorPercent}%)</span>}
                        </span>
                      )}
                      {r.keysHeld && <Badge tone="ok">מפתחות-חיים</Badge>}
                    </div>
                    {(r.executableNow.length > 0 || r.ownerGated.length > 0) && (
                      <div className="mt-1 space-y-0.5 text-[11px] leading-relaxed">
                        {r.executableNow.map((x, i) => <div key={i} className="text-emerald-300">▸ מוכן לביצוע: {x}</div>)}
                        {r.ownerGated.map((x, i) => <div key={i} className="text-zinc-400">▸ שער-בעלים: {x}</div>)}
                      </div>
                    )}
                    {r.notes.length > 0 && (
                      <div className="mt-1 space-y-0.5 text-[11px] text-zinc-500">
                        {r.notes.map((n, i) => <div key={i}>· {n}</div>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="gold">TRX — מסלול-המימוש</Badge>
            <span className="text-zinc-400">משפחה נזיל <Mono className="text-amber-200">{d.tronPlan.familyLiquid.toFixed(6)}</Mono></span>
            <span>· כספת-ראשית <Mono>{d.tronPlan.vaultMain.toFixed(2)}</Mono></span>
            <span>· ארנק-2020 (ממתין-אימות-בעלים) <Mono>{d.tronPlan.ownerWalletPending.toFixed(6)}</Mono></span>
            <span>· סף-אסדר-USDT <Mono>{d.tronPlan.needForUsdtTransfer}</Mono></span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">{d.tronPlan.note}</p>
        </div>

        {d.executed.length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="text-xs font-semibold text-zinc-300">בוצע בפועל (יומן-עסקאות ציבורי)</div>
            <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto pr-1 text-[11px] leading-relaxed">
              {d.executed.map((e, i) => (
                <div key={i} className="text-zinc-500"><Mono className="text-zinc-600">{e.at.slice(0, 16).replace("T", " ")}</Mono> {e.detail}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/**
 * קופה חיה (Task 41) — כל הכספים שלנו, אמיתיים, מהרשתות עצמן.
 * קריאה-בלבד לחלוטין: כתובות ציבוריות בלבד, אף מפתח לא נוגע במסך הזה.
 */
export function TreasuryTab() {
  const q = useSaos<TreasuryResponse>("treasury", () => saosFetch<TreasuryResponse>(EP.treasury));

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

      <TreasuryOpsPanel />

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
        <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            <span>מצב מופחת — הסכומים למטה <strong>חלקיים</strong>: שורות שלא השיבו נשמטות מהסכום (roast 10.09: פעם זה היה מושתק). רעננו עד שכל המקורות עונים.</span>
          </div>
          {s.probes && s.probes.failed > 0 && (
            <div className="mt-1 text-[11px] text-amber-200/90">
              לא השיבו ({s.probes.failed}/{s.probes.ok + s.probes.failed}): {s.probes.failedList?.join(" · ") ?? "—"}
            </div>
          )}
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

      <MoneyFlowPanel data={data} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AddressTablePanel
          title="TRON — משפחת הארנקים (idx0..idx5) + כספת פורנזית"
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
        שקיפות מלאה: המסך קורא רק יתרות ציבוריות של כתובות ידועות (משפחת הארנק שנגזרה מהצירוף של הבעלים + docs/FORENSIC-AUDIT.md + יעדי-היציאה שאותרו במעקב הפורנזי). תיקון 2026-09-10: שש-הכתובות שסומנו בעבר כ&quot;כספות TRON&quot; התגלו כמפתות-ציבוריים של STEEM/HIVE בקידומת שגויה — הוסרו. מעקב 2026-09-10: הלדג׳ר המלא של כל העסקאות אומת מול הרשת — הפער בספירה הקודמת נסגר מתמטית. כתובות נוספות של הבעלים (בורסות, ארנקי קר), לא נגישות למערכת ולכן לא מוצגות.
      </p>
    </div>
  );
}

function MoneyFlowPanel({ data }: { data: TreasuryResponse }) {
  const f = data.flow;
  if (!f || !f.outflows?.length) return null;
  return (
    <Panel
      title="מסלול הכסף — פורנזיה מלאה של כל עסקה (מאומת מול הרשת)"
      icon={<Route aria-hidden className="size-4 text-amber-300" />}
      source="מעקב לדג׳ר מלא · TronGrid + Solana RPC"
      lastChecked={data.generatedAt}
    >
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div className="glass rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <ArrowDownToLine className="size-3.5 text-emerald-300" aria-hidden /> נכנס מבחוץ
          </div>
          <p className="mt-1 font-mono text-lg font-bold text-emerald-300 tabular-nums">{f.externalInTrx.toFixed(4)} TRX</p>
        </div>
        <div className="glass rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <ArrowUpFromLine className="size-3.5 text-rose-300" aria-hidden /> רוקן החוצה
          </div>
          <p className="mt-1 font-mono text-lg font-bold text-rose-300 tabular-nums">{f.sweptOutTrx.toFixed(4)} TRX</p>
        </div>
        <div className="glass rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <Flame className="size-3.5 text-amber-300" aria-hidden /> נשרף בעמלות (שיור מאוזן)
          </div>
          <p className="mt-1 font-mono text-lg font-bold text-amber-300 tabular-nums">{f.burnedFeesTrx === null ? "—" : f.burnedFeesTrx.toFixed(4)} TRX</p>
        </div>
      </div>

      <ol className="scroll-slim mt-3 max-h-64 space-y-1.5 overflow-y-auto pl-1">
        {f.story.map((line, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-400">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-400/70" aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ol>

      <div className="mt-3 space-y-2">
        <p className="text-[11px] font-bold text-zinc-300">יעדי-היציאה — היתרות שלהם כרגע (ציבורי):</p>
        {f.outflows.map((o) => (
          <div key={o.address} className="glass rounded-xl p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-zinc-200">{o.label}</span>
              {o.status === "error" ? (
                <Badge tone="danger">שגיאה: {o.error}</Badge>
              ) : (
                <span className="text-xs tabular-nums text-zinc-300">
                  <strong className="font-bold text-zinc-200">{(o.native ?? 0).toFixed(6)}</strong> {o.nativeSymbol}
                  {o.receivedFromUs !== undefined && <span className="ms-2 text-[10px] text-zinc-500">(מאיתנו: {o.receivedFromUs.toFixed(6)})</span>}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Mono className="text-[11px] text-zinc-500" title={o.address}>
                {o.address.slice(0, 10)}…{o.address.slice(-6)}
              </Mono>
              <Badge tone="neutral">{o.chain}</Badge>
              <a
                href={o.chain === "TRON" ? `https://tronscan.org/#/address/${o.address}` : `https://solscan.io/account/${o.address}`}
                target="_blank"
                rel="noreferrer"
                className="ms-auto text-[11px] text-teal-400 underline-offset-2 hover:underline"
                aria-label={`צפה ב-${o.label} בסייר הבלוקים`}
              >
                סייר ↗
              </a>
            </div>
            {o.note && <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">{o.note}</p>}
          </div>
        ))}
      </div>
    </Panel>
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
