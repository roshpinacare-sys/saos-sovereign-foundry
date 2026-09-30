'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Activity, Anchor, Banknote, BatteryCharging, Brain, BrainCircuit, CircleCheck, Cpu, GitBranch, HeartPulse, KeyRound, Lightbulb, PauseCircle,
  Play, PlayCircle, Radio, RefreshCw, Route, Scale, ShieldCheck, Sigma, Target, TrendingUp, Users, Wallet, Wrench
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
  daily?: { ok?: boolean; health?: 'ok' | 'blocked' | 'fail'; failures?: { failedSteps?: string[]; blockedSteps?: string[] }; finishedAt?: string; rollup?: { realizedSbd?: number | null; deployedSteem?: number | null; measuredTotalUsdPerDay?: number | null; honesty?: string } }
  measuredPerDay?: number | null
  spoilage?: { daysBlocked?: number; votesForegone?: number; estSteemForegone?: number; class?: string; note?: string } | null
  execution?: {
    credentialPresent?: boolean; fingerprint?: string | null; account?: string
    armed?: boolean; standingOrder?: boolean; operatorPaused?: boolean
    verdict?: string | null; reason?: string | null; guidance?: string | null
    proposedPubkeys?: Record<string, string> | null
    roles?: Record<string, { pubkey?: string; matched?: boolean }> | null
    caps?: Record<string, number> | null
    log?: { at?: string; tag?: string; account?: string; ok?: boolean; txid?: string | null; ops?: string[]; error?: string | null }[]
  } | null
  soldiers?: {
    deployed?: boolean; at?: string | null
    accounts?: { name?: string; fingerprint?: string }[]
    fundingTxid?: string | null; fundedEach?: { steem?: number; sbd?: number } | null
  } | null
  curator?: {
    verdict?: string | null; day?: string | null
    votesToday?: number; totalVotes?: number; vpEff?: number | null; maxPerDay?: number | null
    txid?: string | null; candidatesScanned?: number | null
    lastVotes?: { author?: string; permlink?: string; weight?: number; txid?: string | null }[]
    rejectedTop?: string[] | null
  } | null
  intel?: {
    at?: string | null
    decisions?: { kind?: string; decision?: string; reason?: string }[]
    book?: { bestAsk?: number | null; bestBid?: number | null; spreadBps?: number | null } | null
    spreadBpsRec?: number | null
  } | null
  learning?: {
    verdict?: string | null; at?: string | null; runsTotal?: number
    lessons?: { id?: string; severity?: string; lesson?: string; evidence?: string; action?: string }[]
    tuningsApplied?: { key?: string; from?: number; to?: number; added?: string; because?: string }[]
    tunings?: Record<string, unknown> | null
    lessonsTotal?: Record<string, number> | null
    cycleMetrics?: { okRate?: number | null; window?: number; failReasons?: Record<string, number> | null; msP50?: number | null }
  } | null
  discovery?: {
    verdict?: string | null; at?: string | null
    opportunities?: { id?: string; kind?: string; potentialClass?: string; evidence?: string; potential?: string | number | null; gate?: string }[]
    topTags?: { tag?: string; payoutsSbd?: number }[]
    curationEst?: { dailyPoolSteem?: number; estimatedSteemPerDay?: number; note?: string } | null
  } | null
  fleet?: {
    at?: string; verdict?: string
    counts?: { total?: number; alive?: number; idle?: number; blocked?: number; dead?: number }
    agents?: { id: string; role: string; status: 'ALIVE' | 'IDLE' | 'BLOCKED' | 'DEAD'; ageMin?: number | null; blockedBy?: string | null; evidence: string; revival?: string }[]
    honesty?: string
    lostEraNote?: string
  } | null
  credential?: {
    present?: boolean; keyFile?: string; armedButNoCredential?: boolean
    missingSince?: string | null; alerts?: number
    agentsAffected?: string[]; revival?: string | null
  } | null
  events?: { type?: string; at?: string; [k: string]: unknown }[]
}
type EngineResp = { ok?: boolean; health?: 'ok' | 'blocked' | 'fail'; failures?: { failedSteps?: string[]; blockedSteps?: string[] }; steps?: Record<string, { ok?: boolean; skipped?: boolean; verdict?: string; error?: string }>; rollup?: { measuredTotalUsdPerDay?: number | null; realizedSbd?: number | null }; finishedAt?: string; error?: string; engine?: string }
type Sovereign = {
  ok?: boolean
  at?: string
  state?: {
    bootedAt?: string; pid?: number; paused?: boolean
    watchdog?: { checks?: number; downs?: number; heals?: number; healVerified?: number; healFailed?: number; engineUp?: boolean; lastSpawnAt?: string | null }
    cycles?: { autoRuns?: number; ok?: number; fail?: number; blocked?: number; lastAt?: string | null; lastOk?: boolean | null; lastHealth?: string | null; lastMs?: number | null; nextAt?: string | null }
    selftest?: { runs?: number; lastAt?: string | null; lastOk?: boolean | null; passed?: number | null; total?: number | null }
  }
  intervals?: { watchdogSec?: number; cycleSec?: number; selftestSec?: number }
  events?: { at?: string; kind?: string; [k: string]: unknown }[]
}

const f2 = (v?: number | null) => (typeof v === 'number' ? v.toFixed(2) : '—')
const uptimeStr = (bootedAt?: string): string => {
  if (!bootedAt) return '—'
  const sec = Math.max(0, Math.floor((Date.now() - new Date(bootedAt).getTime()) / 1000))
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}ש ${m}דק` : `${m}דק`
}

export default function Home() {
  const [s, setS] = useState<Status | null>(null)
  const [sov, setSov] = useState<Sovereign | null>(null)
  const [loading, setLoading] = useState(false)
  const [cycling, setCycling] = useState(false)
  const [acting, setActing] = useState<string | null>(null)
  const [cycleMsg, setCycleMsg] = useState<string | null>(null)
  const [actMsg, setActMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // T-16 paste-revival state (the secret is never stored beyond this component)
  const [adoptText, setAdoptText] = useState('')
  const [adoptBusy, setAdoptBusy] = useState(false)
  const [adoptMsg, setAdoptMsg] = useState<{ ok: boolean; text: string } | null>(null)

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

  const loadSov = useCallback(async () => {
    try {
      const a = await fetch('/api/saos/sovereign', { cache: 'no-store' })
      setSov(await a.json())
    } catch { /* next poll retries */ }
  }, [])

  const runCycle = useCallback(async () => {
    setCycling(true)
    setCycleMsg(null)
    try {
      /* T-17: the engine acks the start IMMEDIATELY and runs the cycle
       * detached (single-flight + marker). The cockpit polls the engine's
       * own marker until it closes — a UI wait can never outlive-or-kill a
       * healthy multi-vote signing cycle again, and the truth message is
       * built from the ENGINE's own classification, not from a hope. */
      const r = await fetch('/api/saos/engine', { method: 'POST' })
      const ack = await r.json()
      if (!ack.ok && ack.error !== 'cycle-in-flight') {
        setCycleMsg(`המנוע לא זמין: ${ack.error ?? ack.engine ?? 'שגיאה'}`)
        setCycling(false)
        return
      }
      if (ack.error === 'cycle-in-flight') {
        setCycleMsg('מחזור כבר רץ על המנוע — ממתין לסיומו…')
      }
      type Marker = { running?: boolean; health?: string; ms?: number; steps?: Record<string, boolean>; blockedSteps?: string[] | null; failedSteps?: string[] | null; error?: string | null }
      type PollResp = { ok?: boolean; running?: boolean; marker?: Marker | null; rollup?: { measuredTotalUsdPerDay?: number | null } | null; error?: string }
      const deadline = Date.now() + 15 * 60_000
      let done: Marker | null = null
      let rollup: { measuredTotalUsdPerDay?: number | null } | null = null
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 3000))
        const st: PollResp = await fetch('/api/saos/cycle-status', { cache: 'no-store' }).then((x) => x.json())
        const m = st.marker ?? null
        if (m && m.running === false) { done = m; rollup = st.rollup ?? null; break }
        if (st.running === false && m && m.running !== false) { done = { ...m, running: false, health: 'fail', error: 'engine-restarted-mid-cycle' }; break }
      }
      const stepsStr = () => Object.entries(done?.steps ?? {}).map(([k, ok]) => `${k}:${ok ? 'תקין' : 'כשל'}`).join(' · ')
      const measured = `$${(rollup?.measuredTotalUsdPerDay ?? 0).toFixed(4)}/יום`
      if (!done) {
        setCycleMsg('המחזור עדיין רץ מעבר לתקציב-ההמתנה (15 דק) — המנוע ממשיך בצד-שלו; בדוק את כרטיס-המחזור לעדכון')
      } else if (done.health === 'ok') {
        setCycleMsg(`מחזור הושלם (${Math.round((done.ms ?? 0) / 100) / 10}s) · ${stepsStr()} · מדידה ${measured}`)
      } else if (done.health === 'blocked') {
        setCycleMsg(`מחזור הושלם (חסום-חוקי — החתימה ממתינה לאישורי: ${(done.blockedSteps ?? []).join(', ')}) · ${stepsStr()} · מדידה ${measured}`)
      } else {
        setCycleMsg(`מחזור הושלם (כשל — נכשלו: ${(done.failedSteps ?? []).join(', ') || done.error || 'לא-ידוע'}) · ${stepsStr()} · מדידה ${measured}`)
      }
      await load()
    } catch {
      setCycleMsg('הרצת-המחזור נכשלה — בדוק שהמנוע רץ על :3040')
    } finally {
      setCycling(false)
    }
  }, [load])

  const sovAct = useCallback(async (action: string, label: string) => {
    setActing(action)
    setActMsg(null)
    try {
      const r = await fetch('/api/saos/sovereign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const j = await r.json()
      setActMsg(j?.ok ? `${label}: בוצע` : `${label}: נכשל — ${j?.error ?? 'שגיאה'}`)
      await Promise.all([loadSov(), load()])
    } catch {
      setActMsg(`${label}: הרכיב לא זמין כרגע`)
    } finally {
      setActing(null)
    }
  }, [load, loadSov])

  // T-16 · paste-revival: adopt the credential, chain-verify it instantly,
  // then refresh the cockpit so the banner flips to alive. The pasted text
  // lives only in this component's state and the POST body — never logged.
  const adoptCred = useCallback(async () => {
    if (!adoptText.trim() || adoptBusy) return
    setAdoptBusy(true)
    setAdoptMsg(null)
    try {
      const r = await fetch('/api/saos/adopt-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: adoptText }),
      })
      const j = await r.json()
      if (j?.ok && j?.verified) {
        setAdoptMsg({ ok: true, text: `אומץ ואומת מול-השרשרת (${j.account} · טביעת-אצבע ${j.fingerprint}) — המחזור-הבא מקים את הצי החותם` })
        setAdoptText('')
        await load()
      } else if (j?.ok) {
        setAdoptMsg({ ok: false, text: `אומץ אך לא נמצא תואם לחשבון (${j.reason ?? 'CREDENTIAL-MISMATCH'}) — התקן את המפתחות-המוצעים ב-steemit.com או הדבק את הסיסמה-הנוכחית` })
      } else {
        setAdoptMsg({ ok: false, text: `אימוץ נכשל: ${j?.reason ?? j?.error ?? 'שגיאה'}` })
      }
    } catch {
      setAdoptMsg({ ok: false, text: 'המנוע לא זמין — נסה שוב' })
    } finally {
      setAdoptBusy(false)
    }
  }, [adoptText, adoptBusy, load])

  useEffect(() => {
    load()
    loadSov()
    const t = setInterval(load, 30000)
    const t2 = setInterval(loadSov, 30000)
    return () => { clearInterval(t); clearInterval(t2) }
  }, [load, loadSov])

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

        {/* T-15 · אזעקת-חתימה-מתה — לעולם לא שוב ריקבון-שקט: 3 סוכנים מתים בשקט יום-שלם עד שזה נחשף.
            המערכת חייבת לצרוח בראש-העמוד, עם נתיב-ההקמה המדויק. */}
        {s?.credential?.armedButNoCredential && (
          <Card className="mb-4 border-rose-500/40 bg-rose-500/10" role="alert">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 shrink-0 rounded-lg bg-rose-500/20 border border-rose-500/40 grid place-items-center">
                  <KeyRound className="h-5 w-5 text-rose-400" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-rose-300">חתימה-מתה · האישורי לא נמצא ({s.credential.agentsAffected?.join(', ') ?? 'סוכנים-חותמים'} לא עובדים)</p>
                  <p className="text-xs text-rose-200/80 mt-1 leading-relaxed">
                    איפוס-הסביבה מחק את <code className="text-rose-300" dir="ltr">{s.credential.keyFile ?? '.secrets/headcorner.key'}</code>
                    {s.credential.missingSince && <> · מת כנראה מאז <span dir="ltr">{s.credential.missingSince.slice(0, 16).replace('T', ' ')}</span> UTC</>}
                    · הספר על-השרשרת נשאר חי, המחזורים ממשיכים — רק פעולות-חתימה מושבתות.
                  </p>
                  <p className="text-xs text-emerald-300/90 mt-1.5 font-semibold leading-relaxed">
                    ההקמה (שירות-עצמי, אפס-ריסטרט): הדבק את האישורי למטה — המנוע מאבטח (0600), מאמץ, ומאמת מול-השרשרת באותו-רגע. ערוץ-חלופי: הפל את קובץ-הסיסמה-הראשית כ-<code dir="ltr">upload/headcorner.txt</code>.
                  </p>
                  {/* T-16 · בזבוז-VP — המחיר-הנראה של החתימה-החסומה (מדוד + מוערך) */}
                  {!!s.spoilage && ((s.spoilage.votesForegone ?? 0) > 0 || (s.spoilage.estSteemForegone ?? 0) > 0) && (
                    <p className="text-xs text-amber-300 mt-1.5 font-semibold">
                      בזבוז-VP מתמשך: <span dir="ltr">{s.spoilage.votesForegone}</span> קולות-שנמנעו ב־<span dir="ltr">{s.spoilage.daysBlocked}</span> ימי-חסימה
                      {(s.spoilage.estSteemForegone ?? 0) > 0 && <> · ~<span dir="ltr">{s.spoilage.estSteemForegone}</span> STEEM שנמנעו <Badge variant="outline" className="mx-1 border-amber-500/40 text-amber-300 text-[10px] px-1 py-0">מוערך</Badge></>}
                      <span className="text-amber-200/60 font-normal"> · {s.spoilage.note}</span>
                    </p>
                  )}
                  {/* T-16 · paste-revival — הדרך-המהירה ביותר בחזרה לצי-חותם */}
                  <div className="mt-2 flex flex-col sm:flex-row gap-2">
                    <input
                      type="password"
                      value={adoptText}
                      onChange={(e) => setAdoptText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void adoptCred() }}
                      placeholder="הדבק כאן: <שם-חשבון> <סיסמה-ראשית> — נשלח ישירות למנוע (0600), לעולם לא נרשם"
                      aria-label="הדבקת אישורי-חשבון להקמה"
                      className="flex-1 rounded-md border border-rose-500/30 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-rose-500/40"
                      dir="ltr"
                      autoComplete="off"
                    />
                    <Button
                      size="sm"
                      disabled={adoptBusy || !adoptText.trim()}
                      onClick={() => void adoptCred()}
                      className="bg-rose-600 hover:bg-rose-500 text-white font-bold min-h-[36px]"
                    >
                      {adoptBusy ? 'מאמת מול-השרשרת…' : 'אמץ ואמת'}
                    </Button>
                  </div>
                  {adoptMsg && (
                    <p className={`text-xs mt-1.5 font-semibold ${adoptMsg.ok ? 'text-emerald-300' : 'text-amber-300'}`} role="status">
                      {adoptMsg.text}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
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
            {/* הצי · אמת-אחת לכל-הסוכנים (T-15) — התשובה המבנית ל"60+ סוכנים, רובם מתים" */}
            <Card className="border-orange-500/25 bg-gradient-to-br from-orange-500/10 to-slate-900/60 md:col-span-2 lg:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-orange-300 flex-wrap">
                  <Users className="h-4 w-4" aria-hidden /> הצי · רישום-סוכנים מאוחד (T-15)
                  <Badge variant="default" className={
                    s.fleet?.verdict === 'FLEET-OK' ? 'bg-emerald-500/20 text-emerald-300'
                      : s.fleet?.verdict?.startsWith('DEAD') ? 'bg-rose-500/20 text-rose-300'
                      : 'bg-amber-500/20 text-amber-300'
                  }>{s.fleet?.verdict ?? '—'}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">חיים {s.fleet?.counts?.alive ?? '—'}</Badge>
                  <Badge variant="outline" className="border-slate-600/50 text-slate-300">בהמתנה-חוקית {s.fleet?.counts?.idle ?? '—'}</Badge>
                  <Badge variant="outline" className="border-amber-500/40 text-amber-300">חסומים {s.fleet?.counts?.blocked ?? '—'}</Badge>
                  <Badge variant="outline" className={((s.fleet?.counts?.dead ?? 0) > 0) ? 'border-rose-500/40 text-rose-300' : 'border-slate-600/50 text-slate-400'}>מתים {s.fleet?.counts?.dead ?? '—'}</Badge>
                  <span className="text-slate-500">· סה\"כ {s.fleet?.counts?.total ?? '—'} סוכנים · חיות-נמדדת מהפלט-המוקלט של כל סוכן (לא ספירות-יומרה)</span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-80 overflow-y-auto pe-1">
                  {(s.fleet?.agents ?? []).map((a) => (
                    <div key={a.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-100" dir="ltr">{a.id}</span>
                        <Badge variant="outline" className={
                          a.status === 'ALIVE' ? 'border-emerald-500/40 text-emerald-300'
                            : a.status === 'IDLE' ? 'border-slate-600/50 text-slate-400'
                            : a.status === 'BLOCKED' ? 'border-amber-500/40 text-amber-300'
                            : 'border-rose-500/40 text-rose-300'
                        }>{a.status === 'ALIVE' ? 'חי' : a.status === 'IDLE' ? 'המתנה' : a.status === 'BLOCKED' ? 'חסום' : 'מת'}</Badge>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 leading-snug">{a.role}</p>
                      <p className="text-[11px] text-slate-600 mt-1 leading-snug" dir="ltr">{a.evidence}</p>
                      {a.status === 'BLOCKED' && a.blockedBy && (
                        <p className="text-[11px] text-amber-300/90 mt-1">חסום-על-ידי: {a.blockedBy === 'credential-missing' ? 'אישורי-חסר' : a.blockedBy}{a.revival ? ` · ${a.revival}` : ''}</p>
                      )}
                    </div>
                  ))}
                  {!s.fleet?.agents?.length && (
                    <p className="text-xs text-slate-500">הרישום-המאוחד ייפתח כשהמנוע יגיב…</p>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                  {s.fleet?.lostEraNote ?? 'הרישום הזה הוא האמת היחידה על-הסוכנים.'} · {s.fleet?.honesty ?? ''}
                </p>
              </CardContent>
            </Card>

            {/* ריבונות-מתמשכת · המערכת דואגת לעצמה (T-10) */}
            <Card className="border-violet-500/25 bg-gradient-to-br from-violet-500/10 to-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-violet-300">
                  <ShieldCheck className="h-4 w-4" aria-hidden /> ריבונות-מתמשכת · דואגת-לעצמה (T-10)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="default" className={sov?.state?.paused ? 'bg-amber-500/20 text-amber-300' : 'bg-violet-500/20 text-violet-300'}>
                    <span className="relative flex h-2 w-2 me-1.5">
                      {!sov?.state?.paused && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${sov?.state?.paused ? 'bg-amber-400' : 'bg-violet-400'}`} />
                    </span>
                    {sov?.state?.paused ? 'מושהה' : 'חמושה-אוטומטית'}
                  </Badge>
                  <Badge variant="outline" className="border-slate-700 text-slate-300">זמן-רציפות: {uptimeStr(sov?.state?.bootedAt)}</Badge>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm mt-3">
                  <div><dt className="text-xs text-slate-500">בדיקות-דופק</dt><dd className="font-bold tabular-nums">{sov?.state?.watchdog?.checks ?? '—'} <span className="text-xs text-slate-500">· נפילות {sov?.state?.watchdog?.downs ?? 0}</span></dd></div>
                  <div><dt className="text-xs text-slate-500">ריפויים-עצמיים</dt><dd className="font-bold tabular-nums">{sov?.state?.watchdog?.heals ?? 0} <span className="text-xs text-emerald-400">(אומתו {sov?.state?.watchdog?.healVerified ?? 0})</span></dd></div>
                  <div><dt className="text-xs text-slate-500">מחזורים-אוטומטיים</dt><dd className={`font-bold tabular-nums ${((sov?.state?.cycles?.ok ?? 0) > 0 && sov?.state?.cycles?.lastOk !== false) ? 'text-emerald-400' : 'text-slate-300'}`}>{sov?.state?.cycles?.ok ?? 0} תקינים · {sov?.state?.cycles?.blocked ?? 0} חסומים-חוקי · {sov?.state?.cycles?.fail ?? 0} כשלים</dd></div>
                  <div><dt className="text-xs text-slate-500">מחזור-בא-בעקבות</dt><dd className="font-bold tabular-nums text-xs">{sov?.state?.cycles?.nextAt ? `${Math.max(0, Math.round((new Date(sov.state.cycles.nextAt).getTime() - Date.now()) / 60000))} דק` : '—'}</dd></div>
                  <div className="col-span-2"><dt className="text-xs text-slate-500">ביקורת-איכות (selftest)</dt>
                    <dd className="font-bold flex items-center gap-2">
                      {sov?.state?.selftest?.lastAt ? (
                        <>
                          <Badge variant="outline" className={sov.state.selftest.lastOk ? 'border-emerald-500/40 text-emerald-400' : 'border-rose-500/40 text-rose-400'}>
                            {sov.state.selftest.lastOk ? 'עובר' : 'נכשל'} {sov.state.selftest.passed}/{sov.state.selftest.total}
                          </Badge>
                          <span className="text-xs text-slate-500">כל 6 שעות</span>
                        </>
                      ) : <span className="text-xs text-slate-500">ריצה-ראשונה בעוד רגעים…</span>}
                    </dd>
                  </div>
                </dl>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <Button onClick={() => sovAct(sov?.state?.paused ? 'resume' : 'pause', sov?.state?.paused ? 'הפעלה' : 'השהיה')} disabled={acting !== null} size="sm" variant="outline" aria-label={sov?.state?.paused ? 'הפעל-ריבונות' : 'השהה-ריבונות'} className="border-slate-700 hover:bg-slate-800 px-0">
                    {sov?.state?.paused ? <PlayCircle className="h-4 w-4" aria-hidden /> : <PauseCircle className="h-4 w-4" aria-hidden />}
                    <span className="sr-only">{sov?.state?.paused ? 'הפעל ריבונות' : 'השהה ריבונות'}</span>
                    <span className="text-[11px] ms-1">{sov?.state?.paused ? 'הפעל' : 'השהה'}</span>
                  </Button>
                  <Button onClick={() => sovAct('kick-cycle', 'כפיית-מחזור')} disabled={acting !== null || sov?.state?.paused} size="sm" variant="outline" aria-label="כפה-מחזור-ריבונות" className="border-slate-700 hover:bg-slate-800 px-0">
                    <HeartPulse className="h-4 w-4" aria-hidden />
                    <span className="text-[11px] ms-1">מחזור</span>
                  </Button>
                  <Button onClick={() => sovAct('force-heal', 'כפיית-ריפוי')} disabled={acting !== null} size="sm" variant="outline" aria-label="כפה-ריפוי-ריבונות" className="border-slate-700 hover:bg-slate-800 px-0">
                    <Wrench className="h-4 w-4" aria-hidden />
                    <span className="text-[11px] ms-1">ריפוי</span>
                  </Button>
                </div>
                {actMsg && <p className="text-[11px] text-violet-300/90 mt-2 break-words">{actMsg}</p>}
                <Separator className="my-3 bg-slate-800" />
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {(sov?.events ?? []).slice(0, 4).map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="tabular-nums">{e.at?.slice(11, 19)}</span>
                      <span className="text-violet-300/80">{e.kind}</span>
                    </div>
                  ))}
                  {!sov?.events?.length && <p className="text-[11px] text-slate-500">יומן-החלטות ייפתח עם הביקורת-הראשונה…</p>}
                </div>
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                  עצמאית-מהפעלה-שלך: מתעוררת עם השרת · דופק כל {sov?.intervals?.watchdogSec ?? 60} שניות · מחזור כל {Math.round((sov?.intervals?.cycleSec ?? 600) / 60)} דק · איכות כל {Math.round((sov?.intervals?.selftestSec ?? 21600) / 3600)} שעות. החתימה על-השרשרת מוחזקת-מנוע מאז T-12 (הוראת-עומד, מוגבלת-דוקטרינה) · השהיה = מתג-ההרג שלך.
                </p>
              </CardContent>
            </Card>

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
                    {engineUp ? 'למעלה · מפתח-מוחזק-מנוע · מוגבל-דוקטרינה' : 'מושבת'}
                  </Badge>
                  <Badge variant="outline" className="border-slate-700 text-slate-300">account: {s?.engine?.info?.account ?? 'headcorner'}</Badge>
                </div>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  observe → intel → tick → peg → convert → curate → execute → soldiers → learn → report — הכל מקומי, אפס-רפו-חיצוני. חתימה-מנוע-מוחזקת מאז T-12 (מוגבלת-דוקטרינה) · מתג-הרג = השהיה.
                </p>
                <Button onClick={runCycle} disabled={cycling || !engineUp} size="sm" aria-label="הרץ-מחזור-מנוע" className="mt-3 w-full bg-cyan-500/20 text-cyan-200 border border-cyan-500/40 hover:bg-cyan-500/30">
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
                  {s?.execution?.verdict === 'VERIFIED'
                    ? 'מצב-חי (T-12): המנוע חתום וריבוני — ספר-פאריטי פרוס בחוקי-הרצפה, צי-חיילים על-הספר, מסילת-קידום רצה, הכל מוגבל-דוקטרינה ומתועד-על-השרשרת. ההכנסה נמדדת ממילויים אמת בלבד.'
                    : 'כל-מסילות-הביצוע קיימות וחמושות (ספר · המרה · חיילים · קידום) — מוגבלות-דוקטרינה. החסימה-היחידה: התאמת-מפתח.'}
                </p>
              </CardContent>
            </Card>

            {/* מה-יש-לנו · פוטנציאל-ריבוני (T-10) */}
            {(() => {
              const steemLiquid = parseFloat(String(s?.live?.balances?.steem ?? '').replace(/[^0-9.]/g, '')) || 0
              const sbdLiquid = parseFloat(String(s?.live?.balances?.sbd ?? '').replace(/[^0-9.]/g, '')) || 0
              const parity = s?.offer?.marks?.paritySbdPerSteem ?? null
              const steemUsd = s?.observe?.parity?.steemUsd ?? null
              const capitalUsd = parity ? steemLiquid * parity + sbdLiquid : (steemUsd ? steemLiquid * steemUsd + sbdLiquid : null)
              const rate = usdPerDay ?? 0
              const needed = capitalUsd && rate > 0 ? capitalUsd * (1000 / rate) : null
              return (
                <Card className="border-teal-500/25 bg-gradient-to-br from-teal-500/10 to-slate-900/60">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm text-teal-300">
                      <TrendingUp className="h-4 w-4" aria-hidden /> מה-יש-לנו · פוטנציאל-ריבוני (T-10)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      <div><dt className="text-xs text-slate-500">הון-נזיל (STEEM)</dt><dd className="font-bold tabular-nums">{steemLiquid > 0 ? steemLiquid.toFixed(1) : '—'}</dd></div>
                      <div><dt className="text-xs text-slate-500">SBD נזיל</dt><dd className="font-bold tabular-nums">{sbdLiquid > 0 ? sbdLiquid.toFixed(2) : '—'}</dd></div>
                      <div><dt className="text-xs text-slate-500">שווי-הון-עובד (מוערך)</dt><dd className="font-bold tabular-nums text-teal-300">{capitalUsd ? `$${capitalUsd.toFixed(2)}` : '—'}</dd></div>
                      <div><dt className="text-xs text-slate-500">קצב-נמדד (כנות)</dt><dd className="font-bold tabular-nums">${rate.toFixed(4)}/יום</dd></div>
                    </dl>
                    <Separator className="my-3 bg-slate-800" />
                    <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-300">
                      <li className="flex items-start gap-1.5"><CircleCheck className="h-3 w-3 mt-0.5 text-emerald-400 shrink-0" aria-hidden /><span><b className="text-slate-100">ספר-פאריטי</b> — תשתית מוכנה מלאה: תכנון OFFER-READY בכל-מחזור + ביצוע-מוסיף (D-021/D-022) + רצפת-ערך (r134-VF1). הפוטנציאל: קציר-מרווחים מעל-פאריטי על ~925 STEEM.</span></li>
                      <li className="flex items-start gap-1.5"><CircleCheck className="h-3 w-3 mt-0.5 text-emerald-400 shrink-0" aria-hidden /><span><b className="text-slate-100">קיורציה</b> — נמדדה $4.26/יום כשהייתה פעילה; כרגע רדומה, ממתינה ל-authority פוסטינג (שער X-1). הכלי קיים ומתוכנת (A-12).</span></li>
                      <li className="flex items-start gap-1.5"><CircleCheck className="h-3 w-3 mt-0.5 text-emerald-400 shrink-0" aria-hidden /><span><b className="text-slate-100">מסילת-המרה D-023</b> — יתרון פנימי שנמדד +40.8% (SBD→STEEM פנ-$1); מתחממת אוטומטית כשהאסקים קוצרים SBD.</span></li>
                      <li className="flex items-start gap-1.5"><CircleCheck className="h-3 w-3 mt-0.5 text-emerald-400 shrink-0" aria-hidden /><span><b className="text-slate-100">ריבונות-רציפה (היום)</b> — watchdog + מחזורים-אוטומטיים + ביקורת-איכות + ריפוי-עצמי; זמן-רציפות חי בכרטיס הראשון.</span></li>
                    </ul>
                    <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                      כנות: פוטנציאל ≠ רווח-נמדד. בקצב-הנמדד הנוכחי ${rate.toFixed(4)}/יום, ל-$1000/יום נדרש הון של {needed ? `≈ $${needed.toFixed(0)}` : '—'} (אנלוגיית X-2) או מסילות-תשואה-גבוהות-יותר. כל-מספר כאן חי וממקור-chain או מדידה-מקומית.
                    </p>
                  </CardContent>
                </Card>
              )
            })()}

            {/* ביצוע-חי · מפתח-ראשי (T-12) */}
            <Card className="border-violet-500/25 bg-gradient-to-br from-violet-500/10 to-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-violet-300">
                  <KeyRound className="h-4 w-4" aria-hidden /> ביצוע-חי · מפתח-ראשי (T-12)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={
                    s?.execution?.verdict === 'VERIFIED' ? 'border-emerald-500/40 text-emerald-400'
                    : s?.execution?.operatorPaused ? 'border-amber-500/40 text-amber-400'
                    : 'border-violet-500/40 text-violet-300'
                  }>
                    {s?.execution?.verdict ?? (s?.execution?.credentialPresent ? 'בודק' : 'אין-תעודה')}
                  </Badge>
                  {s?.execution?.fingerprint && <span className="text-[11px] text-slate-500">טביעת-אצבע: {s.execution.fingerprint}</span>}
                  {s?.execution?.armed != null && (
                    <span className={`text-[11px] ${s.execution.armed ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {s.execution.armed ? 'חמוש · דוקטרינה-מוגבל' : 'מושהה/מנוטרל'}
                    </span>
                  )}
                </div>
                {s?.execution?.verdict === 'CREDENTIAL-MISMATCH' && (
                  <p className="text-[11px] leading-relaxed text-amber-400/90 mt-2">
                    כנות: התעודה שהועלתה תקינה-מבנית אך המפתחות-הנגזרים-ממנה אינם תואמים את רשויות-השרשרת של {s.execution?.account ?? 'החשבון'} (נבדק מול הרשאות חיות). שני-מסלולים: (א) העלה את סיסמת-האם-הנוכחית כ-upload/headcorner.txt — המנוע מאבטח ומאמץ אוטומטית; (ב) ב-steemit.com → Permissions החלף את המפתחות ל-proposedPubkeys — לאחר-צעד-אחד זה המערכת ריבונית-מלאה לתמיד.
                  </p>
                )}
                {s?.execution?.proposedPubkeys && (
                  <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/80 p-2 text-[10px] leading-relaxed text-slate-400 font-mono overflow-x-auto">
                    {Object.entries(s.execution.proposedPubkeys).map(([k, v]) => <div key={k}><span className="text-violet-300">{k}</span>: {v}</div>)}
                  </div>
                )}
                {s?.execution?.roles && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {Object.entries(s.execution.roles).map(([k, v]) => (
                      <Badge key={k} variant="outline" className={v.matched ? 'border-emerald-500/40 text-emerald-400' : 'border-slate-700 text-slate-500'}>{k}:{v.matched ? 'תואם' : 'לא-תואם'}</Badge>
                    ))}
                  </div>
                )}
                {!!s?.execution?.log?.length && (
                  <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800/70">
                    {[...s.execution.log].reverse().map((l, i) => (
                      <div key={i} className="px-2 py-1.5 text-[10px] flex flex-wrap gap-x-2 items-center">
                        <span className="text-slate-500 tabular-nums">{l.at?.replace('T', ' ')?.slice(0, 19)}</span>
                        <Badge variant="outline" className={l.ok ? 'border-emerald-500/40 text-emerald-400' : 'border-red-500/40 text-red-400'}>{l.tag ?? l.ops?.join('+') ?? '?'}</Badge>
                        {l.txid && <span className="text-slate-400 font-mono">tx {l.txid.slice(0, 12)}…</span>}
                        {l.error && <span className="text-red-400">{l.error.slice(0, 60)}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* חיילים · צי-גרידים (T-12) */}
            <Card className="border-cyan-500/25 bg-gradient-to-br from-cyan-500/10 to-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-cyan-300">
                  <Users className="h-4 w-4" aria-hidden /> חיילים · צי-גרידים (T-12)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={s?.soldiers?.deployed ? 'border-emerald-500/40 text-emerald-400' : 'border-cyan-500/40 text-cyan-300'}>
                    {s?.soldiers?.deployed ? `פרוס · ${s.soldiers.accounts?.length ?? 0} חיילים` : 'ממתין-לפריסה'}
                  </Badge>
                  {s?.soldiers?.fundedEach && (
                    <span className="text-[11px] text-slate-500">{s.soldiers.fundedEach.steem} STEEM + {s.soldiers.fundedEach.sbd} SBD לחייל</span>
                  )}
                </div>
                {!!s?.soldiers?.accounts?.length && (
                  <div className="mt-2 space-y-1">
                    {s.soldiers.accounts.map((a, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-200">{a.name}</span>
                        <span className="text-slate-500 font-mono text-[10px]">fp {a.fingerprint}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!s?.soldiers?.deployed && (
                  <p className="text-[11px] leading-relaxed text-slate-500 mt-2">
                    תוכנית-הצי: 3 חיילים (hcsoldier1..3) · מומנו מהמאסטר · כל-אחד מריץ סולם-מיקרו-משלו עם-אותן-חוקי-רצפת/פאריטי — מעמיק את האחיזה בספר. הפריסה חסומה-כנות עד-התאמת-מפתח (fail-closed).
                  </p>
                )}
              </CardContent>
            </Card>

            {/* קיורציה · מסילת-דלק (T-13) */}
            <Card className="border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-emerald-300">
                  <BatteryCharging className="h-4 w-4" aria-hidden /> קיורציה · מסילת-דלק (T-13)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={s?.curator?.verdict === 'VOTED' ? 'border-emerald-500/40 text-emerald-400' : s?.curator?.verdict === 'DAY-CAP' ? 'border-amber-500/40 text-amber-400' : 'border-slate-500/40 text-slate-400'}>
                    {s?.curator?.verdict === 'VOTED' ? 'חי · מצביע'
                      : s?.curator?.verdict === 'DAY-CAP' ? 'מכסה-יומית מלאה'
                      : s?.curator?.verdict ? s.curator.verdict : 'מתחמם'}
                  </Badge>
                  {s?.curator?.vpEff != null && (
                    <span className="text-[11px] text-slate-500">VP אפקטיבי <b className="tabular-nums text-slate-300">{s.curator.vpEff}%</b> · רצפה 60%</span>
                  )}
                </div>
                <dl className="grid grid-cols-3 gap-2 mt-3">
                  <div><dt className="text-xs text-slate-500">הצבעות-היום</dt><dd className="font-bold tabular-nums text-emerald-400">{s?.curator?.votesToday ?? 0}/{s?.curator?.maxPerDay ?? 10}</dd></div>
                  <div><dt className="text-xs text-slate-500">סה״כ</dt><dd className="font-bold tabular-nums">{s?.curator?.totalVotes ?? 0}</dd></div>
                  <div><dt className="text-xs text-slate-500">מועמדים-נסרקו</dt><dd className="font-bold tabular-nums">{s?.curator?.candidatesScanned ?? '—'}</dd></div>
                </dl>
                {!!s?.curator?.lastVotes?.length && (
                  <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                    {s.curator.lastVotes.map((v, i) => (
                      <div key={i} className="flex items-center justify-between text-xs gap-2">
                        <span className="font-bold text-slate-200 truncate">{v.author}<span className="text-slate-500 font-normal"> · {v.permlink?.slice(0, 24)}</span></span>
                        <span className="text-slate-500 font-mono text-[10px] shrink-0">w{(v.weight ?? 0) / 100}% · {v.txid?.slice(0, 8)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[11px] leading-relaxed text-slate-500 mt-2">
                  ה-VP המלא (98%+) ישב בטל — עכשיו 4034 SP עובדים: הצבעות-בוקר טריות עם-ירידת-משקל-לפי-גיל, מכסה-יומית, רצפת-VP, אפס-הצבעה-עצמית, סינון-ספאם. מפתח-פרסום בלבד — פעולת-הצבעה לא-יכולה להזיז כספים. התשואה נמדדת מ-curation_reward חי (מסילת-הדלק).
                </p>
              </CardContent>
            </Card>

            {/* למידה-מתמשכת · גדילה (T-14) */}
            <Card className="border-cyan-500/25 bg-gradient-to-br from-cyan-500/10 to-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-cyan-300">
                  <BrainCircuit className="h-4 w-4" aria-hidden /> למידה-מתמשכת · גדילה (T-14)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={s?.learning?.verdict === 'LEARNED' ? 'border-cyan-500/40 text-cyan-300' : 'border-slate-500/40 text-slate-400'}>
                    {s?.learning?.verdict === 'LEARNED' ? 'למד · התעדכן'
                      : s?.learning?.verdict === 'NO-NEW-LESSONS' ? 'אין-שיעורים-חדשים (תקין)'
                      : s?.learning?.verdict ? s.learning.verdict : 'הלולאה תרוץ במחזור-הבא'}
                  </Badge>
                  {s?.learning?.cycleMetrics?.okRate != null && (
                    <span className="text-[11px] text-slate-500">מחזורים-תקינים <b className="tabular-nums text-slate-300">{s.learning.cycleMetrics.okRate}%</b> מ-{s.learning.cycleMetrics.window ?? 0} אחרונים</span>
                  )}
                  {!!s?.learning?.runsTotal && (
                    <span className="text-[11px] text-slate-500">סבבי-למידה: <b className="tabular-nums text-slate-300">{s.learning.runsTotal}</b></span>
                  )}
                </div>
                {!!s?.learning?.lessons?.length ? (
                  <ul className="space-y-1.5 mt-3 max-h-44 overflow-y-auto">
                    {s.learning.lessons.map((l, i) => (
                      <li key={i} className="text-[11px] leading-relaxed">
                        <div className="flex items-start gap-1.5">
                          <Badge variant="outline" className={l.severity === 'high' ? 'border-rose-500/40 text-rose-300 shrink-0' : l.severity === 'medium' ? 'border-amber-500/40 text-amber-300 shrink-0' : 'border-slate-600/50 text-slate-400 shrink-0'}>{l.severity ?? '?'}</Badge>
                          <span><b className="text-slate-100">{l.lesson}</b></span>
                        </div>
                        {l.evidence && <div className="text-slate-500 mr-6">ראיה: {l.evidence}</div>}
                        {l.action && <div className="text-cyan-400/90 mr-6">פעולה: {l.action}</div>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-2">לומד מהיסטוריה-מוקלטת בלבד — אפס המצאות: היסטוריה-ריקה = שיעורים-אפס.</p>
                )}
                {!!s?.learning?.tuningsApplied?.length && (
                  <div className="mt-2 text-[11px]">
                    <span className="text-slate-500">כיוונים-חסומים-שהוחלו: </span>
                    {s.learning.tuningsApplied.map((t, i) => (
                      <Badge key={i} variant="outline" className="border-cyan-500/30 text-cyan-300 mr-1 font-mono text-[10px]">
                        {t.key}{t.to != null ? ` ${t.from}→${t.to}` : t.added ? ` +${t.added}` : ''}
                      </Badge>
                    ))}
                    <div className="text-slate-600 mt-1">מוגבל-חוק (LEARN_CLAMP 30–60% משקל · גיל 5–12 דק · תגיות ≤8) — החוקים (רצפת-VF1, רצפת-VP, מכסה-יומית) בלתי-נגישים-ללמידה.</div>
                  </div>
                )}
                {!!s?.discovery?.opportunities?.length && (
                  <div className="mt-3 border-t border-slate-800 pt-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1">
                      <Lightbulb className="h-3.5 w-3.5 text-amber-300" aria-hidden /> אופציות-גדילה-שהתגלו ({s.discovery.verdict === 'OPTIONS-FOUND' ? 'מדורגות' : s.discovery.verdict ?? '—'})
                    </div>
                    <ul className="space-y-1 max-h-36 overflow-y-auto">
                      {s.discovery.opportunities.map((o, i) => (
                        <li key={i} className="text-[11px] leading-relaxed flex items-start gap-1.5">
                          <Badge variant="outline" className={o.potentialClass === 'measured' ? 'border-emerald-500/40 text-emerald-300 shrink-0' : o.potentialClass === 'estimated' ? 'border-amber-500/40 text-amber-300 shrink-0' : 'border-slate-600/50 text-slate-400 shrink-0'}>{o.potentialClass === 'measured' ? 'נמדד' : o.potentialClass === 'estimated' ? 'מוערך' : 'פוטנציאל'}</Badge>
                          <span><b className="text-slate-100">{o.kind}</b> — <span className="text-slate-400">{o.evidence}</span>{o.gate && <span className="text-slate-600"> · שער: {o.gate}</span>}</span>
                        </li>
                      ))}
                    </ul>
                    {!!s.discovery.curationEst?.estimatedSteemPerDay && (
                      <p className="text-[10px] text-slate-500 mt-1">אומדן-מנת-קיורציה ציבורי: ~{s.discovery.curationEst.estimatedSteemPerDay} STEEM/יום (מוערך — רק curation_reward חי נחשב-נמדד)</p>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-slate-500 mt-2">לולאה-סוגרת-עצמה: קורא-היסטוריה → שיעורים-מבוססי-ראיות → כיוונים-חסומים → המחזור-הבא רץ-חכם-יותר. הגילוי מדרג ביושר: נמדד &gt; מוערך &gt; פוטנציאל, ולעולם לא מבצע — השערים מחליטים.</p>
              </CardContent>
            </Card>

            {/* אינטליגנציה · מפעילה-את-עצמה (T-12) */}
            <Card className="border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-500/10 to-slate-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-fuchsia-300">
                  <Brain className="h-4 w-4" aria-hidden /> אינטליגנציה · מחליטה-בעצמה (T-12)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {s?.intel?.book?.spreadBps != null && (
                  <div className="flex items-center gap-3 text-xs text-slate-400 mb-2">
                    <span>מרווח-ספר: <b className="tabular-nums text-slate-200">{s.intel.book.spreadBps}bps</b></span>
                    {s.intel.book.bestAsk != null && <span>ask {s.intel.book.bestAsk.toFixed(4)}</span>}
                    {s.intel.book.bestBid != null && <span>bid {s.intel.book.bestBid.toFixed(4)}</span>}
                  </div>
                )}
                {!s?.intel?.decisions?.length ? (
                  <p className="text-sm text-slate-500">הסריקה-הראשונה תרוץ במחזור-הבא (כל 10 דק)</p>
                ) : (
                  <ul className="space-y-1.5 max-h-44 overflow-y-auto">
                    {s.intel.decisions.map((d, i) => (
                      <li key={i} className="text-[11px] leading-relaxed flex items-start gap-1.5">
                        <Badge variant="outline" className="border-fuchsia-500/30 text-fuchsia-300 shrink-0">{d.kind}</Badge>
                        <span><b className="text-slate-100">{d.decision}</b> — <span className="text-slate-400">{d.reason}</span></span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-slate-500 mt-2">כל-החלטה עם-נימוק — המפעיל רואה הכל, המערכת מריצה הכל בעצמה.</p>
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
                  <p className="text-sm text-slate-500">אין-אירועים עדיין — השכבה-הריבונית מריצה מחזורים אוטומטית כל 10 דק (T-10)</p>
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
          <p>אמת-מוטבעת-על-שרשרת בלבד · מפתח-מוחזק-מנוע · מוגבל-דוקטרינה · לעולם לא נרשם · ראיות: mini-services/saos-engine/state</p>
          <p>T-12 · ריבונות-מלאה · {s?.asof?.slice(11, 19) ?? ''} UTC</p>
        </div>
      </footer>
    </div>
  )
}
