'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Activity, Anchor, Banknote, BatteryCharging, CircleCheck, Cpu, GitBranch, Play,
  Radio, RefreshCw, Route, Scale, Sigma, Target, Wallet
} from 'lucide-react'

type Order = { orderid: number; side: string; base: string; quote: string; unit: number; created: string }
type Status = {
  ok?: boolean
  asof?: string
  engine?: { up?: boolean; info?: { account?: string; keyless?: boolean } | null }
  grid?: { runCount?: number; simFills?: number; simFeesMu?: number; grids?: { id?: string; strategy?: string; active?: boolean }[] }
  observe?: {
    parity?: { parity?: number; source?: string; lowConfidence?: boolean; steemUsd?: number; sbdUsd?: number }
    feed?: number
    band?: { ok?: boolean; bps?: number; reason?: string }
    inventory?: { steem?: number; sbd?: number; spOwn?: number; rcPct?: number } | null
    ordersOk?: boolean
    orders?: unknown[]
    fills?: number
    lastFillAt?: string | null
    fuel?: { fuelUsdPerDay?: number | null; authorUsdPerDay?: number | null; curationOps?: number; authorOps?: number; windowNote?: string | null; windowSpanDays?: number; histLen?: number }
  } | null
  offer?: { verdict?: string; parityBps?: number | null; blocker?: string[] | null; marks?: { paritySbdPerSteem?: number; source?: string; lowConfidence?: boolean; internalFeed?: number; dragK?: number; floor?: number; ceiling?: number }; plan?: { asks?: unknown[]; bids?: unknown[] }; publishedAt?: string }
  live?: { orders?: Order[]; orderTotals?: { askedSteem?: number; bidSbd?: number }; balances?: { steem: string; sbd: string; vests: string } | null; chainReadOk?: boolean }
  profit?: {
    fills?: number; buys?: number; sells?: number
    realizedSbd?: number; positionSteem?: number; positionAvgCost?: number | null
    unbasedSteem?: number; unbasedSbd?: number; unrealizedAtParitySbd?: number | null
    parityRef?: number | null
  }
  rails?: {
    fuel?: number | null; author?: number | null; fuelWindowNote?: string | null; fuelHistory?: string
    deployedSteem?: number; bidSbd?: number; bookEmpty?: boolean; bookNote?: string | null
    convert?: { verdict?: string | null; reason?: string | null; amountSbd?: number; marketSbdUsd?: number | null; impliedSbdUsd?: number | null; marketSourceNote?: string | null; at?: string | null } | null
    autonomy?: { ok?: boolean; lastCycle?: string | null; steps?: Record<string, string> } | null
    note?: string
  }
  daily?: { ok?: boolean; finishedAt?: string; rollup?: { realizedSbd?: number | null; deployedSteem?: number | null; measuredTotalUsdPerDay?: number | null; honesty?: string } }
  measuredPerDay?: number | null
  events?: { type?: string; at?: string; [k: string]: unknown }[]
}
type EngineResp = { ok?: boolean; steps?: Record<string, { ok?: boolean; skipped?: boolean; verdict?: string; error?: string }>; rollup?: { measuredTotalUsdPerDay?: number | null; realizedSbd?: number | null }; finishedAt?: string; error?: string; engine?: string }

const f2 = (v?: number | null) => (typeof v === 'number' ? v.toFixed(2) : '—')

export default function Home() {
  const [s, setS] = useState<Status | null>(null)
  const [loading, setLoading] = useState(false)
  const [cycling, setCycling] = useState(false)
  const [cycleMsg, setCycleMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const a = await fetch('/api/saos/status', { cache: 'no-store' })
      setS(await a.json())
    } catch {
      setErr('קריאת-הסטטוס נכשלה — נסה רענון')
    } finally {
      setLoading(false)
    }
  }, [])

  const runCycle = useCallback(async () => {
    setCycling(true)
    setCycleMsg(null)
    try {
      const r = await fetch('/api/saos/engine', { method: 'POST' })
      const j: EngineResp = await r.json()
      if (j.ok) {
        const steps = Object.entries(j.steps ?? {}).map(([k, v]) => `${k}:${v.ok === false ? 'כשל' : v.skipped ? 'דילוג' : 'תקין'}`).join(' · ')
        setCycleMsg(`מחזור הושלם · ${steps} · מדידה $${(j.rollup?.measuredTotalUsdPerDay ?? 0).toFixed(4)}/יום`)
      } else {
        setCycleMsg(`המנוע לא זמין: ${j.error ?? j.engine ?? 'שגיאה'}`)
      }
      await load()
    } catch {
      setCycleMsg('הרצת-המחזור נכשלה — בדוק שהמנוע רץ על :3040')
    } finally {
      setCycling(false)
    }
  }, [load])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const realFills = s?.profit?.fills ?? 0
  const realized = s?.profit?.realizedSbd
  const usdPerDay = s?.measuredPerDay ?? null
  const orders = s?.live?.orders ?? []
  const asks = orders.filter((o) => o.side === 'ask')
  const bids = orders.filter((o) => o.side === 'bid')
  const engineUp = s?.engine?.up ?? false
  const target = 1000

  return (
    <div dir="rtl" className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* HEADER */}
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 backdrop-blur supports-[backdrop-filter]:bg-slate-950/70">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-lg bg-emerald-500/15 border border-emerald-500/30 grid place-items-center">
              <Radio className="h-5 w-5 text-emerald-400" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-lg font-bold leading-tight truncate">
                <span dir="ltr" className="inline-block align-baseline">SAOS <span className="hidden sm:inline">SOVEREIGN </span>COCKPIT</span>
                <span> · תא-הפיקוד</span>
              </h1>
              <p className="text-xs text-slate-400 truncate">headcorner · מנוע-ריבוני-מקומי · אמת-מוטבעת-על-שרשרת · אפס-תלות-חיצונית</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={engineUp ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15' : 'bg-rose-500/15 text-rose-400 border-rose-500/30 hover:bg-rose-500/15'}>
              <span className="relative flex h-2 w-2 me-1.5">
                {engineUp && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${engineUp ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              </span>
              {engineUp ? 'מנוע-חי' : 'מנוע-כבוי'}
            </Badge>
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="border-slate-700 hover:bg-slate-800">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
              <span className="hidden sm:inline ms-1.5">רענון</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
        {err && (
          <Card className="mb-4 border-rose-500/30 bg-rose-500/5">
            <CardContent className="p-4 text-sm text-rose-300">{err}</CardContent>
          </Card>
        )}

        {!s && !err && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="border-slate-800 bg-slate-900/60 animate-pulse">
                <CardContent className="p-6 h-32" />
              </Card>
            ))}
          </div>
        )}

        {s && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* מנוע-ריבוני מקומי · שליטה (T-9d) */}
            <Card className="border-cyan-500/25 bg-gradient-to-br from-cyan-500/10 to-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-cyan-300">
                  <Cpu className="h-4 w-4" aria-hidden /> מנוע-ריבוני-מקומי · :3040 (T-9)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={engineUp ? 'default' : 'secondary'} className={engineUp ? 'bg-emerald-500/20 text-emerald-300' : ''}>
                    {engineUp ? 'למעלה · keyless' : 'מושבת'}
                  </Badge>
                  <Badge variant="outline" className="border-slate-700 text-slate-300">account: {s?.engine?.info?.account ?? 'headcorner'}</Badge>
                </div>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  observe → tick → peg → convert → report — הכל מקומי, אפס-רפו-חיצוני, אפס-מפתחות. ביצוע-חתימות = שער-אופרטור בלבד.
                </p>
                <Button onClick={runCycle} disabled={cycling || !engineUp} size="sm" className="mt-3 w-full bg-cyan-500/20 text-cyan-200 border border-cyan-500/40 hover:bg-cyan-500/30">
                  <Play className="h-4 w-4 me-1.5" aria-hidden />
                  {cycling ? 'מריץ מחזור…' : 'הרץ מחזור עכשיו'}
                </Button>
                {cycleMsg && <p className="text-[11px] text-cyan-300/90 mt-2 leading-relaxed break-words">{cycleMsg}</p>}
                <Separator className="my-3 bg-slate-800" />
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-slate-500">מחזור-אחרון</dt><dd className="font-bold tabular-nums text-xs">{s?.rails?.autonomy?.lastCycle ? s.rails.autonomy.lastCycle.slice(11, 19) + ' UTC' : '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">טיקים</dt><dd className="font-bold tabular-nums">{s?.grid?.runCount ?? '—'}</dd></div>
                </dl>
              </CardContent>
            </Card>

            {/* מד-אמת חי */}
            <Card className="border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-emerald-300">
                  <Sigma className="h-4 w-4" aria-hidden /> מד-אמת חי · מילויים-מהשרשרת
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-black text-emerald-400 tabular-nums">{realFills}</div>
                <p className="text-xs text-slate-400 mt-1">fill_order אמת בחלון-המדידה</p>
                <Separator className="my-3 bg-slate-800" />
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-slate-500">ממומש (A-10)</dt><dd className={`font-bold tabular-nums ${((realized ?? 0) >= 0 ? 'text-emerald-400' : 'text-amber-400')}`}>{typeof realized === 'number' ? `${realized.toFixed(3)} SBD` : '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">מילוי-אחרון</dt><dd className="font-bold tabular-nums text-xs">{s?.observe?.lastFillAt ? s.observe.lastFillAt.slice(0, 16).replace('T', ' ') : '—'}</dd></div>
                </dl>
              </CardContent>
            </Card>

            {/* רווחיות-אמת (A-10) */}
            <Card className="border-amber-500/25 bg-gradient-to-br from-amber-500/10 to-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-amber-300">
                  <Banknote className="h-4 w-4" aria-hidden /> רווחיות-אמת · יסוד-עלות ממומש
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-black tabular-nums ${((s?.profit?.realizedSbd ?? 0) >= 0 ? 'text-emerald-400' : 'text-amber-400')}`}>
                    {typeof s?.profit?.realizedSbd === 'number' ? `${s.profit.realizedSbd.toFixed(3)} SBD` : '—'}
                  </span>
                  <span className="text-xs text-slate-400">ממומש (A-10)</span>
                </div>
                <Separator className="my-3 bg-slate-800" />
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-slate-500">פוזיציה פתוחה</dt><dd className="font-bold tabular-nums">{typeof s?.profit?.positionSteem === 'number' ? s.profit.positionSteem.toFixed(1) : '—'} STEEM</dd></div>
                  <div><dt className="text-xs text-slate-500">יסוד-עלות ממוצע</dt><dd className="font-bold tabular-nums">{s?.profit?.positionAvgCost ?? '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">בלתי-ממומש @ פאריטי</dt><dd className={`font-bold tabular-nums ${((s?.profit?.unrealizedAtParitySbd ?? 0) >= 0 ? 'text-emerald-400' : 'text-amber-400')}`}>{typeof s?.profit?.unrealizedAtParitySbd === 'number' ? `${s.profit.unrealizedAtParitySbd.toFixed(3)} SBD` : '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">ספר · נזיל</dt><dd className="font-bold tabular-nums">{f2(s?.rails?.deployedSteem)} / {s?.live?.balances?.steem ?? '—'}</dd></div>
                </dl>
                <p className="text-[11px] leading-relaxed text-slate-500 mt-2">
                  כנות: מכירה בלי יסוד-עלות נמדד ({typeof s?.profit?.unbasedSteem === 'number' ? s.profit.unbasedSteem.toFixed(1) : '—'} STEEM → {typeof s?.profit?.unbasedSbd === 'number' ? s.profit.unbasedSbd.toFixed(1) : '—'} SBD) נרשמת unbased — לא נטענת כרווח.
                </p>
              </CardContent>
            </Card>

            {/* מסילות-אמת (T-9) */}
            <Card className="border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-emerald-300">
                  <Route className="h-4 w-4" aria-hidden /> מסילות-אמת · מדידה-מקומית-ריבונית
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-slate-500">דלק-קיורציה/יום</dt><dd className={`font-bold tabular-nums ${((s?.rails?.fuel ?? 0) > 0) ? 'text-emerald-400' : 'text-amber-400'}`}>{typeof s?.rails?.fuel === 'number' ? `$${s.rails.fuel.toFixed(4)}` : '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">מחבר/יום</dt><dd className="font-bold tabular-nums">{typeof s?.rails?.author === 'number' ? `$${s.rails.author.toFixed(4)}` : '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">הון-עובד מוצב</dt><dd className={`font-bold tabular-nums ${s?.rails?.bookEmpty ? 'text-amber-400' : 'text-emerald-400'}`}>{f2(s?.rails?.deployedSteem)} STEEM</dd></div>
                  <div><dt className="text-xs text-slate-500">SBD בספר</dt><dd className="font-bold tabular-nums">{f2(s?.rails?.bidSbd)}</dd></div>
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">מסילת-ההמרה D-023 (פנ-$1 → ‎3.5 ימים → STEEM)</dt>
                    <dd className="font-bold flex flex-wrap items-center gap-2 mt-0.5">
                      <Badge variant={s?.rails?.convert?.verdict === 'CONVERT-PLAN' ? 'default' : 'secondary'} className={s?.rails?.convert?.verdict === 'CONVERT-PLAN' ? 'bg-emerald-500/20 text-emerald-300' : ''}>
                        {s?.rails?.convert?.verdict ?? '—'}
                      </Badge>
                      {s?.rails?.convert?.impliedSbdUsd != null && (
                        <span className="text-xs text-slate-400">proxy-מרומז: ${s.rails.convert.impliedSbdUsd.toFixed(3)} (לא-מזין-חימוש)</span>
                      )}
                    </dd>
                    {s?.rails?.convert?.marketSourceNote && <dd className="text-[11px] text-slate-500 mt-1 leading-relaxed">{s.rails.convert.marketSourceNote}</dd>}
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">אוטונומיה (מחזור-מנוע)</dt>
                    <dd className="font-bold flex items-center gap-2 flex-wrap">
                      <Badge variant={s?.rails?.autonomy?.ok ? 'default' : 'secondary'} className={s?.rails?.autonomy?.ok ? 'bg-emerald-500/20 text-emerald-300' : ''}>
                        {s?.rails?.autonomy?.ok ? 'CYCLE-OK' : s?.rails?.autonomy ? 'DEGRADED' : 'טרם-רץ'}
                      </Badge>
                      {s?.rails?.autonomy?.steps && <span className="text-xs text-slate-500">{Object.entries(s.rails.autonomy.steps).map(([k, v]) => `${k}:${v}`).join(' · ')}</span>}
                    </dd>
                  </div>
                </dl>
                {(s?.rails?.bookNote || s?.rails?.fuelWindowNote) && (
                  <p className="text-[11px] leading-relaxed text-amber-400/80 mt-2">
                    {s?.rails?.bookNote && <span className="block">{s.rails.bookNote}</span>}
                    {s?.rails?.fuelWindowNote && <span className="block">{s.rails.fuelWindowNote}</span>}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* משימה */}
            <Card className="border-slate-800 bg-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-slate-300">
                  <Target className="h-4 w-4" aria-hidden /> המשימה · $1000/יום
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black tabular-nums">${usdPerDay !== null ? usdPerDay.toFixed(2) : '—'}</span>
                  <span className="text-xs text-slate-400">נמדד/יום · מתוך ${target}</span>
                </div>
                <Progress value={Math.min(((usdPerDay ?? 0) / target) * 100, 100)} className="mt-3 h-2 bg-slate-800 [&>div]:bg-amber-400" />
                <p className="text-[11px] leading-relaxed text-slate-500 mt-2">
                  כנות-מלאה (T-9): הספר ריק והקיורציה רדומה — ההכנסה-הנמדדת כרגע $0/יום. שני-שערים: X-1 (מפתחות/חתימה) לפריסת-925 ה-STEEM, ו-authority פוסטינג לקיורציה. המנוע מתכנן OFFER-READY בכל-מחזור וממתין.
                </p>
              </CardContent>
            </Card>

            {/* פאריטי + הצעה */}
            <Card className="border-slate-800 bg-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-slate-300">
                  <Scale className="h-4 w-4" aria-hidden /> הצעת-פאריטי · peg
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={s?.offer?.verdict === 'OFFER-READY' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/30'}>
                    <CircleCheck className="h-3 w-3 me-1" aria-hidden />{s?.offer?.verdict ?? '—'}
                  </Badge>
                  {s?.offer?.marks?.lowConfidence && <Badge variant="outline" className="border-amber-500/40 text-amber-400">מקור-פנימי · ביטחון-מופחת</Badge>}
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm mt-3">
                  <div><dt className="text-xs text-slate-500">פאריטי</dt><dd className="font-bold tabular-nums">{s?.offer?.marks?.paritySbdPerSteem ?? '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">סטייה (bps)</dt><dd className="font-bold tabular-nums">{s?.offer?.parityBps ?? '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">אסקים</dt><dd className="font-bold tabular-nums text-amber-400">{s?.offer?.plan?.asks?.length ?? '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">בידים</dt><dd className="font-bold tabular-nums text-emerald-400">{s?.offer?.plan?.bids?.length ?? '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">רצפה</dt><dd className="font-bold tabular-nums">{s?.offer?.marks?.floor ?? '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">dragK</dt><dd className="font-bold tabular-nums">{s?.offer?.marks?.dragK ?? '—'}</dd></div>
                </dl>
                <p className="text-[11px] text-slate-500 mt-2">דוקטרינה: אמת-מחיר-או-כלום · אין-מכירה-מתחת-לפאריטי · מקור: {s?.offer?.marks?.source ?? '—'}</p>
              </CardContent>
            </Card>

            {/* יתרות ודלק */}
            <Card className="border-slate-800 bg-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-slate-300">
                  <Wallet className="h-4 w-4" aria-hidden /> יתרות-ודלק · headcorner
                </CardTitle>
              </CardHeader>
              <CardContent>
                {s?.live?.balances ? (
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="text-xs text-slate-500">STEEM נזיל</dt><dd className="font-bold tabular-nums">{s.live.balances.steem}</dd></div>
                    <div><dt className="text-xs text-slate-500">SBD</dt><dd className="font-bold tabular-nums">{s.live.balances.sbd}</dd></div>
                    <div className="col-span-2"><dt className="text-xs text-slate-500">מלאי-מוקפא בפקודות-פתוחות</dt><dd className="font-bold">{asks.length} אסקים · {bids.length} בידים חיים</dd></div>
                  </dl>
                ) : (
                  <p className="text-sm text-slate-500">קריאת-chain לא-זמינה כרגע (RPC) — מוצג-בכנות</p>
                )}
                <Separator className="my-3 bg-slate-800" />
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <BatteryCharging className="h-4 w-4 text-emerald-400" aria-hidden />
                    <span className="text-xs text-slate-500">דלק-RC</span>
                  </div>
                  <span className={`font-bold tabular-nums ${typeof s?.live?.rc?.rcPct === 'number' && s.live.rc.rcPct < 20 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {typeof s?.live?.rc?.rcPct === 'number' ? `${s.live.rc.rcPct}%` : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm mt-1.5">
                  <span className="text-xs text-slate-500 ps-6">רשת-טריגרים</span>
                  <span className="font-bold">{s?.grid?.grids?.filter((g) => g.active).length ?? 0}/{s?.grid?.grids?.length ?? 0} פעילים</span>
                </div>
              </CardContent>
            </Card>

            {/* סולם-חי */}
            <Card className="border-slate-800 bg-slate-900/60 md:col-span-2 lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-slate-300">
                  <Activity className="h-4 w-4" aria-hidden /> הסולם-החי · פקודות-פתוחות על ספר-STEEM
                </CardTitle>
              </CardHeader>
              <CardContent>
                {orders.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    הספר ריק באמת (ordersOk: {String(s?.observe?.ordersOk ?? true)}) — כל ההון נזיל וממתין לפריסה בשער-האופרטור. התוכנית הדוקטרינית מוכנה בכל-מחזור.
                  </p>
                ) : (
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-800">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-900 text-xs text-slate-400">
                        <tr>
                          <th className="text-start font-medium px-3 py-2">orderid</th>
                          <th className="text-start font-medium px-3 py-2">צד</th>
                          <th className="text-start font-medium px-3 py-2">מוכן-למכירה</th>
                          <th className="text-start font-medium px-3 py-2">מקבל</th>
                          <th className="text-start font-medium px-3 py-2">יחידה SBD/STEEM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o) => (
                          <tr key={o.orderid} className="border-t border-slate-800/70 hover:bg-slate-800/40 transition-colors">
                            <td className="px-3 py-2 tabular-nums text-slate-400">{o.orderid}</td>
                            <td className="px-3 py-2">
                              <Badge variant="outline" className={o.side === 'ask' ? 'border-amber-500/40 text-amber-400' : 'border-emerald-500/40 text-emerald-400'}>
                                {o.side === 'ask' ? 'מכירה' : 'קנייה'}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 tabular-nums">{o.base}</td>
                            <td className="px-3 py-2 tabular-nums text-slate-300">{o.quote}</td>
                            <td className="px-3 py-2 tabular-nums font-bold">{o.unit.toFixed(4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* רשת-טריגרים */}
            <Card className="border-slate-800 bg-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-slate-300">
                  <GitBranch className="h-4 w-4" aria-hidden /> רשת-הטריגרים · דבר-גורר-דבר
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-slate-500">טיקים</dt><dd className="font-bold tabular-nums">{s?.grid?.runCount ?? '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">מילויי-סימולציה</dt><dd className="font-bold tabular-nums">{s?.grid?.simFills ?? '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">עמלות-סימולציה (µ)</dt><dd className="font-bold tabular-nums">{f2(s?.grid?.simFeesMu)}</dd></div>
                  <div><dt className="text-xs text-slate-500">גרידים-פעילים</dt><dd className="font-bold">{s?.grid?.grids?.filter((g) => g.active).length ?? 0}/{s?.grid?.grids?.length ?? 0}</dd></div>
                </dl>
                <p className="text-[11px] text-slate-500 mt-2">טיק מזריק אירועים ל-bus → peg ומוביל ניזונים ממנו — השרשרת הפנימית חיה.</p>
              </CardContent>
            </Card>

            {/* יומן-אירועים מקומי */}
            <Card className="border-slate-800 bg-slate-900/60 md:col-span-2 lg:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-slate-300">
                  <Anchor className="h-4 w-4" aria-hidden /> יומן-אירועים · מנוע-ריבוני (state/events.jsonl)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!s?.events?.length ? (
                  <p className="text-sm text-slate-500">אין-אירועים עדיין — הרץ מחזור מהכרטיס הראשון</p>
                ) : (
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800/70">
                    {[...s.events].reverse().map((e, i) => (
                      <div key={i} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs hover:bg-slate-800/40 transition-colors">
                        <span className="text-slate-500 tabular-nums">{e.at?.replace('T', ' ')?.slice(0, 19)}</span>
                        <Badge variant="outline" className="border-cyan-500/30 text-cyan-300">{e.type ?? '?'}</Badge>
                        {Object.entries(e)
                          .filter(([k, v]) => !['type', 'at'].includes(k) && v !== null && v !== undefined && typeof v !== 'object')
                          .slice(0, 4)
                          .map(([k, v]) => <span key={k} className="text-slate-400">{k}: {String(v)}</span>)}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* FOOTER — sticky */}
      <footer className="mt-auto border-t border-slate-800 bg-slate-950">
        <div className="mx-auto max-w-6xl px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <p>אמת-מוטבעת-על-שרשרת בלבד · אפס-מפתחות · ראיות: mini-services/saos-engine/state · docs/ESTATE-INVENTORY · docs/ADOPTIONS</p>
          <p>T-9 · מנוע-ריבוני-מקומי · {s?.asof?.slice(11, 19) ?? ''} UTC</p>
        </div>
      </footer>
    </div>
  )
}
