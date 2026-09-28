'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Activity, Anchor, Banknote, BatteryCharging, CircleCheck, GitBranch, Radio,
  RefreshCw, Route, Scale, Sigma, Target, Wallet
} from 'lucide-react'

type Order = { orderid: number; side: string; base: string; quote: string; unit: number; created: string }
type Status = {
  ok?: boolean
  asof?: string
  grid?: {
    asof?: string; runCount?: number
    market?: { refPrice?: number; source?: string; stale?: boolean }
    feeMeter?: { simMu?: number; simFills?: number; realFills?: number; realSbdDelta?: number; _lastRealSeq?: number; queue?: string[] }
    grids?: { id: string; strategy: string; active: boolean; inventoryMu: number; pnlSimMu: number }[]
  }
  pnl?: { real?: { fills?: number; sbdDelta?: number }; sim?: { fills?: number; feesMu?: number } }
  offer?: { verdict?: string; parityBps?: number; blocker?: string[] | null; marks?: { paritySbdPerSteem?: number }; plan?: { asks?: unknown[]; bids?: unknown[] }; publishedAt?: string }
  live?: { orders?: Order[]; orderTotals?: { askedSteem?: number; bidSbd?: number }; balances?: { steem: string; sbd: string; vests: string } | null; chainReadOk?: boolean }
  profit?: {
    fills?: number; buys?: number; sells?: number
    realizedSbd?: number; positionSteem?: number; positionAvgCost?: number | null
    unbasedSteem?: number; unbasedSbd?: number; unrealizedAtParitySbd?: number | null
    parityRef?: number | null
  }
  kpi?: { revenuePerDayReal?: { usd?: number }; ladder?: { current?: string; next?: string; consecutiveGreenDays?: number; proven?: boolean } }
  rails?: {
    fuel?: number | null; book?: number | null
    deployedSteem?: number; bidSbd?: number
    convertArb?: { verdict?: string; marketUsd?: number; discountPct?: number } | null
    curation?: { planned?: number | null; executed?: number; status?: string }
    autonomy?: { ok?: boolean; lastCycle?: string | null; steps?: Record<string, string> } | null
  }
  fleet?: { claims?: { rows: number; done: number; open: number; other: number } }
  mover?: { tail?: { at?: string; cancelled?: unknown[]; placed?: unknown[]; dryRun?: boolean }[] }
}
type SignerResp = { ok?: boolean; total?: number; entries?: { idx?: number; at?: string; dryRun?: boolean; cancelled?: { id?: number; txid?: string }[]; placed?: unknown[] }[] }

const f2 = (v?: number | null) => (typeof v === 'number' ? v.toFixed(2) : '—')

export default function Home() {
  const [s, setS] = useState<Status | null>(null)
  const [sig, setSig] = useState<SignerResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [a, b] = await Promise.all([
        fetch('/api/saos/status', { cache: 'no-store' }),
        fetch('/api/saos/signer?limit=12', { cache: 'no-store' }),
      ])
      setS(await a.json())
      setSig(await b.json())
    } catch {
      setErr('קריאת-הסטטוס נכשלה — נסה רענון')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const realFills = s?.pnl?.real?.fills ?? 0
  const sbdDelta = s?.pnl?.real?.sbdDelta
  const simFills = s?.pnl?.sim?.fills ?? 0
  const usdPerDay = s?.kpi?.revenuePerDayReal?.usd ?? null
  const orders = s?.live?.orders ?? []
  const asks = orders.filter((o) => o.side === 'ask')
  const bids = orders.filter((o) => o.side === 'bid')
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
              <h1 className="text-base sm:text-lg font-bold leading-tight truncate">
                <span dir="ltr" className="inline-block align-baseline">SAOS FLEET COCKPIT</span>
                <span> · תא-הפיקוד</span>
              </h1>
              <p className="text-xs text-slate-400 truncate">headcorner · רשת-טריגרים ריבונית · אמת-מוטבעת-על-שרשרת</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">
              <span className="relative flex h-2 w-2 me-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              חי
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
            {/* מד-אמת חי */}
            <Card className="border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-emerald-300">
                  <Sigma className="h-4 w-4" aria-hidden /> מד-אמת חי · מילויים-מהשרשרת
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-black text-emerald-400 tabular-nums">{realFills}</div>
                <p className="text-xs text-slate-400 mt-1">fill_order אמת מה-chain (real:true)</p>
                <Separator className="my-3 bg-slate-800" />
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-slate-500">דלתא-SBD נטו</dt><dd className={`font-bold tabular-nums ${(sbdDelta ?? 0) >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>{typeof sbdDelta === 'number' ? `${sbdDelta.toFixed(3)} SBD` : '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">seq-אחרון</dt><dd className="font-bold tabular-nums">{s?.grid?.feeMeter?._lastRealSeq ?? '—'}</dd></div>
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
                  <div><dt className="text-xs text-slate-500">ספר · נזיל</dt><dd className="font-bold tabular-nums">{s?.live?.orderTotals?.askedSteem ?? '—'} / {s?.live?.balances?.steem ?? '—'}</dd></div>
                </dl>
                <p className="text-[11px] leading-relaxed text-slate-500 mt-2">
                  כנות: מכירה בלי יסוד-עלות נמדד ({typeof s?.profit?.unbasedSteem === 'number' ? s.profit.unbasedSteem.toFixed(1) : '—'} STEEM → {typeof s?.profit?.unbasedSbd === 'number' ? s.profit.unbasedSbd.toFixed(1) : '—'} SBD) נרשמת unbased — לא נטענת כרווח.
                </p>
              </CardContent>
            </Card>

            {/* מסילות-מהקיים (T-7) */}
            <Card className="border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-emerald-300">
                  <Route className="h-4 w-4" aria-hidden /> מסילות-מהקיים · T-7 (אפס-הון-חוץ)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-slate-500">דלק SP/יום</dt><dd className="font-bold tabular-nums text-emerald-400">{typeof s?.rails?.fuel === 'number' ? `$${s.rails.fuel.toFixed(4)}` : '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">ספר/יום (KPI)</dt><dd className="font-bold tabular-nums">{typeof s?.rails?.book === 'number' ? `$${s.rails.book.toFixed(4)}` : '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">הון-עובד מוצב</dt><dd className="font-bold tabular-nums">{typeof s?.rails?.deployedSteem === 'number' ? s.rails.deployedSteem.toFixed(1) : '—'} STEEM</dd></div>
                  <div><dt className="text-xs text-slate-500">המרת-SBD</dt><dd className={`font-bold ${(s?.rails?.convertArb?.verdict ?? '').includes('POSITIVE') ? 'text-emerald-400' : 'text-slate-400'}`}>{s?.rails?.convertArb?.verdict === 'CONVERT-POSITIVE' ? `+${s.rails.convertArb?.discountPct?.toFixed(1)}% אדג׳` : s?.rails?.convertArb?.verdict === 'NO-EDGE' ? 'ללא-אדג׳' : '—'}</dd></div>
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">קיורציה (A-12 · posting-only)</dt>
                    <dd className="font-bold">{s?.rails?.curation?.planned != null ? `${s.rails.curation.planned} הצבעות מתוכננות · ${s.rails.curation.executed ?? 0} בוצעו · ${s.rails.curation.status}` : '—'}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">אוטונומיה (A-8 · מחזור-יומי)</dt>
                    <dd className="font-bold flex items-center gap-2">
                      <Badge variant={s?.rails?.autonomy?.ok ? 'default' : 'secondary'} className={s?.rails?.autonomy?.ok ? 'bg-emerald-500/20 text-emerald-300' : ''}>
                        {s?.rails?.autonomy?.ok ? 'CYCLE-OK' : s?.rails?.autonomy ? 'DEGRADED' : 'טרם-רץ'}
                      </Badge>
                      {s?.rails?.autonomy?.steps && <span className="text-xs text-slate-500">{Object.entries(s.rails.autonomy.steps).map(([k, v]) => `${k}:${v}`).join(' · ')}</span>}
                    </dd>
                  </div>
                </dl>
                <p className="text-[11px] leading-relaxed text-slate-500 mt-2">
                  הרוסט-שהפך-לקוד: "מוגבל-רק-ע"י הון" היה פסיביות — קיורציה, המרה, פריסה-אוטומטית ויסוד-אמת נבנו מהקיים. המכפיל-השקט: הכל מזין SP → הדלק גדל.
                </p>
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
                  כנות: הפער = שער-X-2 (הון). המכונה חיה ומוכחת — הצטברות-אמת נרשמת אוטומטית מהשרשרת.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="border-slate-700 text-slate-300">מדרגה {s?.kpi?.ladder?.current ?? '?'}</Badge>
                  <Badge variant="outline" className="border-slate-700 text-slate-300">{s?.kpi?.ladder?.consecutiveGreenDays ?? 0} ימים ירוקים</Badge>
                  <Badge variant="outline" className="border-slate-700 text-slate-300">לוח: {s?.fleet?.claims?.done ?? 0} DONE</Badge>
                </div>
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
                <div className="flex items-center gap-2">
                  <Badge className={s?.offer?.verdict === 'OFFER-READY' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/30'}>
                    <CircleCheck className="h-3 w-3 me-1" aria-hidden />{s?.offer?.verdict ?? '—'}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm mt-3">
                  <div><dt className="text-xs text-slate-500">פאריטי</dt><dd className="font-bold tabular-nums">{s?.offer?.marks?.paritySbdPerSteem ?? '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">סטייה (bps)</dt><dd className="font-bold tabular-nums">{s?.offer?.parityBps ?? '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">אסקים</dt><dd className="font-bold tabular-nums text-amber-400">{s?.offer?.plan?.asks?.length ?? '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">בידים</dt><dd className="font-bold tabular-nums text-emerald-400">{s?.offer?.plan?.bids?.length ?? '—'}</dd></div>
                </dl>
                <p className="text-[11px] text-slate-500 mt-2">דוקטרינה: אמת-מחיר-או-כלום · אין-מכירה-מתחת-לפאריטי</p>
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
                  <p className="text-sm text-slate-500">אין-פקודות-פתוחות כרגע (או-קריאת-chain נכשלה)</p>
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
                  <div><dt className="text-xs text-slate-500">מילויי-סימולציה</dt><dd className="font-bold tabular-nums">{simFills}</dd></div>
                  <div><dt className="text-xs text-slate-500">עמלות-סימולציה (µ)</dt><dd className="font-bold tabular-nums">{f2(s?.pnl?.sim?.feesMu)}</dd></div>
                  <div><dt className="text-xs text-slate-500">בתור-להולדה</dt><dd className="font-bold">{s?.grid?.feeMeter?.queue?.length ?? 0}</dd></div>
                </dl>
                <p className="text-[11px] text-slate-500 mt-2">מחיר-אמת: {s?.grid?.market?.refPrice ?? '—'} ({s?.grid?.market?.source ?? '—'}{s?.grid?.market?.stale ? ' · stale' : ''})</p>
              </CardContent>
            </Card>

            {/* יומן-החותם */}
            <Card className="border-slate-800 bg-slate-900/60 md:col-span-2 lg:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-slate-300">
                  <Anchor className="h-4 w-4" aria-hidden /> יומן-החותם · mover (ראיה-פומבית בלבד)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!sig?.ok ? (
                  <p className="text-sm text-slate-500">יומן-המוביל לא-זמין</p>
                ) : (
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800/70">
                    {sig.entries?.map((e, i) => (
                      <div key={i} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs hover:bg-slate-800/40 transition-colors">
                        <span className="text-slate-500 tabular-nums">{e.at?.replace('T', ' ')?.slice(0, 19)}</span>
                        {e.dryRun && <Badge variant="outline" className="border-slate-700 text-slate-400">dry-run</Badge>}
                        {!e.dryRun && <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">חי</Badge>}
                        {typeof e.cancelled === 'object' && e.cancelled !== null && <span className="text-slate-400">ביטולים: {e.cancelled.length}</span>}
                        {typeof e.placed === 'object' && e.placed !== null && <span className="text-slate-400">הצבות: {e.placed.length}</span>}
                        {JSON.stringify(e).includes('txid') && <span className="text-slate-500">txid ✓ ביומן</span>}
                      </div>
                    ))}
                    <div className="px-3 py-2 text-[11px] text-slate-500">סה&quot;כ רשומות: {sig.total}</div>
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
          <p>אמת-מוטבעת-על-שרשרת בלבד · אפס-מפתחות בשירות-זה · ראיות: saos-dex/grids/state · Defi/fleet</p>
          <p>צי R130 · AGENT-A / AGENT-Z / AGENT-C · {s?.asof?.slice(11, 19) ?? ''} UTC</p>
        </div>
      </footer>
    </div>
  )
}
