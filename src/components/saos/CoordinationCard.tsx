'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, ClipboardCheck, Gauge, MessagesSquare, Radar, RefreshCw, Send, ShieldQuestion, Zap } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { cn } from '@/lib/utils'

/**
 * R231 · מרכז-תיאום הצי — the operator's coordination order made visible:
 *  (1) לוח-זמנים מפוזר — שכל אחד נכנס בזמן אחר (דטרמיניסטי, מרווח 20 דק)
 *  (2) מצב-כוח — VP/RC חי לכל חשבון + חוק-המשקל (שלא יבזבזו כוח)
 *  (3) מטריצת-שיחות — כיסוי הפוסטים שלנו × מי הגיב; פערים = משימות
 *  (4) מכ"ם-טרנדים — מה חם בהקשרים שלנו + נושאי-שיחה
 * Self-contained client component (one fetch, own state, zero coupling to
 * the page data flow — collision-safe for the multi-agent cockpit).
 * All numbers are chain-read or engine-measured; no invented values.
 */

type PowerAcc = {
  name: string; sp: number; vpEff: number | null; rcPct: number | null
  verdict: string; weightPct: number; lowRc?: boolean; steem?: number; lastVote?: string | null
}
type EngPost = {
  author: string; permlink: string; title: string; ageH: number
  fleetVotes: string[]; fleetRepliers: string[]; threads: number
  coveragePct: number; missing: string[]; covered: boolean
}
type TrendTopic = {
  id?: string; topic: string; angle?: string; talkTrack?: string
  tags?: string[]; score?: number | null
}
type ComplianceRow = {
  acc: string; total: number; inWindow: number; compliancePct: number | null
  clusters: number; verdict: string
  misses?: { kind: string; at: string; nearest: string }[]
}
type HistoryDay = {
  day: string; avgCompliancePct: number | null; verdict: string
  densestBurst?: number; clusterViolations?: number; accountsActive?: number
}
type TrendPoint = {
  day: string; cur: number | null; prev: number | null; delta: number | null
  curVerdict: string | null; prevVerdict: string | null; prevDay: string | null
}
type ComplianceDoc = {
  day?: string; at?: string
  rows?: ComplianceRow[]
  summary?: { accounts?: number; accountsActive?: number; totalActions?: number; avgCompliancePct?: number | null; densestBurst?: number; burstAt?: string | null; clusterViolations?: number; verdict?: string } | null
  history?: HistoryDay[]
  trend?: TrendPoint | null
}
type ThreadsSummary = {
  postsMeasured?: number; developed?: number; avgDepth?: number | null
  avgLayer2?: number | null; authorResponseRate?: number | null; avgScore?: number | null
}
type ThreadsDoc = { ok?: boolean; summary?: ThreadsSummary | null; metrics?: { author: string; permlink: string; depth: number; developed: boolean; authorResponded: boolean; score: number }[]; at?: string }
type DryPlanEntry = { kind: string; verdict: string; window?: number | null; target?: string; tasksCount?: number; vpEff?: number | null }
type ExecutionDoc = {
  day?: string; at?: string; minute?: number; rcPct?: number | null
  windows?: Record<string, { at?: string; verdict?: string; landed?: number }>
  actions?: { kind: string; verdict: string; to?: string; txid?: string | null; at: string }[]
}
type CoordPayload = {
  ok?: boolean
  coordination?: {
    day?: string; at?: string; protocol?: string
    schedule?: Record<string, { post: number; votes: number[]; engage: number }>
    power?: { ok?: boolean; accounts?: PowerAcc[]; at?: string }
    engagement?: { ok?: boolean; posts?: EngPost[]; summary?: { posts?: number; avgCoveragePct?: number; fullyCovered?: number; openThreads?: number } }
    threads?: ThreadsDoc | null
    assignments?: Record<string, { author: string; permlink: string; title: string; kind: string }[]>
    nextWindows?: { acc: string; kind: string; at: string; inMin: number }[]
    lastPublish?: { day?: string; at?: string; ok?: boolean; txid?: string | null; error?: string | null }
    scheduleNote?: string
  } | null
  compliance?: ComplianceDoc | null
  execution?: ExecutionDoc | null
  trends?: { fetchedAt?: string | null; verdict?: string | null; topics?: TrendTopic[] } | null
  error?: string
}

const hhmm = (m?: number | null) => {
  if (m == null) return '—'
  const x = ((Math.round(m) % 1440) + 1440) % 1440
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`
}

const vpTone = (vp: number | null): 'emerald' | 'amber' | 'rose' => {
  if (vp == null) return 'rose'
  if (vp >= 80) return 'emerald'
  if (vp >= 30) return 'amber'
  return 'rose'
}
const verdictText = (v: string): string => {
  switch (v) {
    case 'READY-FULL': return 'כוח-מלא · משקל 100%'
    case 'READY': return 'מוכן · משקל 80%'
    case 'REDUCED': return 'מופחת · משקל 50%'
    case 'VP-REST': return 'מנוחת-טעינה · ללא הצבעות'
    default: return v
  }
}

const complianceTone = (v: string): 'emerald' | 'amber' | 'rose' | 'slate' => {
  if (v === 'ADOPTED' || v === 'COMPLIANT') return 'emerald'
  if (v === 'PARTIAL') return 'amber'
  if (v === 'NOT-ADOPTED' || v === 'OFF-SCHEDULE') return 'rose'
  return 'slate'
}
const complianceHeb = (v: string): string => {
  switch (v) {
    case 'ADOPTED': return 'מאומץ · הפעילות בחלונות'
    case 'PARTIAL': return 'חלקי · חלק בחלונות'
    case 'NOT-ADOPTED': return 'לא-מאומץ · פעילות מחוץ-לחלונות'
    case 'QUIET': return 'שקט · אין פעילות-היום'
    case 'COMPLIANT': return 'בחלונות'
    case 'OFF-SCHEDULE': return 'מחוץ-לחלונות'
    case 'NO-ACTIVITY': return 'ללא פעילות'
    default: return v
  }
}

export function CoordinationCard() {
  const [d, setD] = useState<CoordPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [dryPlan, setDryPlan] = useState<DryPlanEntry[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/saos/coordination', { cache: 'no-store' })
      setD(await r.json())
    } catch { setD({ error: 'fetch-failed' }) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const act = async (action: 'refresh' | 'publish') => {
    setBusy(action)
    setMsg(null)
    try {
      const r = await fetch('/api/saos/coordination', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const j = await r.json()
      if (action === 'publish') {
        const p = j?.published ?? null
        setMsg(p?.ok ? `המנשר פורסם בשרשרת ✓ txid ${String(p.txid ?? '').slice(0, 18)}…` : `פרסום נחסם: ${p?.verdict ?? p?.error ?? j?.error ?? 'לא-ידוע'}`)
      } else {
        setMsg('רענון הושלם')
      }
      await load()
    } catch { setMsg('הפעולה נכשלה — נסה שוב') } finally { setBusy(null) }
  }

  /* R233 · dry preflight — proves the executor's gates/laws/targets resolve,
   * zero signing, zero state writes */
  const dryRun = async () => {
    setBusy('dry')
    setMsg(null)
    try {
      const r = await fetch('/api/saos/coordination', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dry-run' }),
      })
      const j = await r.json()
      if (j?.dry && Array.isArray(j.plan)) {
        setDryPlan(j.plan as DryPlanEntry[])
        setMsg(`בדיקת-יבשה הושלמה · RC ${j.rcPct ?? '?'}% · VP ${j.vpEff ?? '?'}% · ${j.plan.length} חלונות-פעילים כרגע`)
      } else {
        setMsg(`בדיקת-יבשה נחסמה: ${j?.verdict ?? j?.error ?? 'לא-ידוע'}`)
      }
    } catch { setMsg('בדיקת-היבשה נכשלה — נסה שוב') } finally { setBusy(null) }
  }

  const c = d?.coordination ?? null
  const power = c?.power?.accounts ?? []
  const eng = c?.engagement ?? null
  const threads = c?.threads ?? null
  const trends = d?.trends ?? null
  const next = c?.nextWindows ?? []
  const compliance = d?.compliance ?? null
  const execution = d?.execution ?? null
  const hist = compliance?.history ?? []
  const trend = compliance?.trend ?? null

  return (
    <SectionCard
      icon={CalendarClock}
      tone="orange"
      className="md:col-span-2 lg:col-span-4"
      title={<>מרכז-תיאום הצי <span dir="ltr" className="text-slate-500">(R231 · saos.fleet.coordination.v1)</span></>}
      meta={'תיאום בפועל עם החותם-השני: לו״ז מפוזר דטרמיניסטי (כל אחד בזמנו) + הצבעות לפי מצב-כוח + מענה לכל-הפוסטים שלנו + מכ״ם-טרנדים בהקשרים שלנו. המנשר מפורסם כ-custom_json ציבורי — השרשרת עצמה ערוץ-התיאום.'}
      actions={
        <>
          <button
            type="button"
            onClick={() => void act('refresh')}
            disabled={busy != null}
            aria-label="רענון מרכז-התיאום"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2.5 text-[11px] font-bold text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', (loading || busy === 'refresh') && 'animate-spin')} aria-hidden />
            רענון
          </button>
          <button
            type="button"
            onClick={() => void act('publish')}
            disabled={busy != null}
            aria-label="פרסום מנשר-התיאום בשרשרת"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-orange-500/40 bg-orange-500/15 px-2.5 text-[11px] font-bold text-orange-300 transition-colors hover:bg-orange-500/25 disabled:opacity-50"
          >
            <Send className={cn('h-3.5 w-3.5', busy === 'publish' && 'animate-pulse')} aria-hidden />
            פרסום-מנשר
          </button>
          {c?.day && <span className="tnum text-[10px] text-slate-500" dir="ltr">{c.day}</span>}
        </>
      }
    >
      {msg && (
        <p className={cn('rounded-md border px-2 py-1.5 text-[11px] font-bold leading-relaxed',
          msg.includes('✓') ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300')}>
          {msg}
        </p>
      )}
      {c?.lastPublish && (
        <p className="text-[10px] leading-relaxed text-slate-500">
          מנשר-אחרון: {c.lastPublish.ok ? <span className="font-bold text-emerald-400">פורסם ✓</span> : <span className="font-bold text-amber-400">{c.lastPublish.verdict || c.lastPublish.error || 'נחסם'}</span>}
          {c.lastPublish.at ? <span dir="ltr"> · {new Date(c.lastPublish.at).toLocaleTimeString('he-IL')}</span> : null}
          {c.lastPublish.txid ? <span dir="ltr"> · tx {String(c.lastPublish.txid).slice(0, 16)}…</span> : null}
        </p>
      )}

      {/* ─── 1 · לוח-זמנים מפוזר ─── */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-orange-300">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden /> לוח-זמנים מפוזר — כל אחד נכנס בזמן אחר (UTC, מרווח 20 דק')
        </p>
        {next.length > 0 ? (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="list" aria-label="החלונות הקרובים">
            {next.slice(0, 8).map((w, i) => (
              <div key={`${w.acc}-${w.kind}-${i}`} role="listitem"
                className="shrink-0 rounded-md border border-slate-800 bg-slate-900/70 px-2.5 py-1.5 text-center">
                <p className="tnum text-sm font-bold text-slate-100" dir="ltr">{w.at}</p>
                <p className="text-[10px] font-bold text-orange-300" dir="ltr">{w.acc}</p>
                <p className="text-[10px] text-slate-500">{w.kind === 'post' ? 'פרסום' : w.kind === 'engage' ? 'שיחה' : `הצבעה ${w.kind.replace('vote', '')}`}
                  <span dir="ltr"> · בעוד {w.inMin < 60 ? `${w.inMin} דק` : `${Math.round(w.inMin / 60)} שע'`}</span></p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-slate-500">הלו"ז ייבנה במחזור-התיאום הראשון (רענון יזיק אותו עכשיו)</p>
        )}
        {c?.schedule && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] font-bold text-slate-400 hover:text-slate-200">הלו"ז המלא של היום ({Object.keys(c.schedule).length} חשבונות)</summary>
            <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-slate-800">
              <table className="w-full min-w-[420px] text-[11px]">
                <thead className="sticky top-0 bg-slate-900 text-slate-500">
                  <tr>
                    <th className="px-2.5 py-1.5 text-start font-medium">חשבון</th>
                    <th className="px-2.5 py-1.5 text-start font-medium">פרסום</th>
                    <th className="px-2.5 py-1.5 text-start font-medium">הצבעות</th>
                    <th className="px-2.5 py-1.5 text-start font-medium">שיחה</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {Object.entries(c.schedule).map(([acc, w]) => (
                    <tr key={acc}>
                      <td className="px-2.5 py-1.5 font-bold text-slate-200" dir="ltr">{acc}</td>
                      <td className="tnum px-2.5 py-1.5 text-slate-300" dir="ltr">{hhmm(w.post)}</td>
                      <td className="tnum px-2.5 py-1.5 text-slate-300" dir="ltr">{w.votes.map(hhmm).join(', ')}</td>
                      <td className="tnum px-2.5 py-1.5 text-slate-300" dir="ltr">{hhmm(w.engage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>

      {/* ─── 2 · מצב-כוח ─── */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
          <Gauge className="h-3.5 w-3.5" aria-hidden /> מצב-כוח חי לכל הצי — הצבעות לפי יכולת, בלי-בזבוז
        </p>
        {power.length > 0 ? (
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {power.map((a) => (
              <div key={a.name} className="rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5">
                <div className="flex items-center justify-between gap-1">
                  <p className="truncate text-[10px] font-bold text-slate-200" dir="ltr">{a.name}</p>
                  <StatusBadge tone={vpTone(a.vpEff)}>{a.vpEff != null ? `${a.vpEff}%` : '?'}</StatusBadge>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-800" role="img" aria-label={`VP של ${a.name}: ${a.vpEff ?? '?'} אחוז`}>
                  <div className={cn('h-full rounded-full', a.vpEff != null && a.vpEff >= 80 ? 'bg-emerald-500' : a.vpEff != null && a.vpEff >= 30 ? 'bg-amber-500' : 'bg-rose-500')}
                    style={{ width: `${Math.min(100, Math.max(0, a.vpEff ?? 0))}%` }} />
                </div>
                <p className="mt-1 text-[9px] leading-tight text-slate-500">
                  RC {a.rcPct != null ? `${a.rcPct}%` : '?'}
                  {a.lowRc ? <span className="font-bold text-amber-400"> · החזקת-שידור</span> : null}
                  {' · '}{verdictText(a.verdict)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-slate-500">לוח-הכוח ייקרא מהשרשרת ברענון הראשון</p>
        )}
      </div>

      {/* ─── 3 · מטריצת-שיחות ─── */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-orange-200">
          <MessagesSquare className="h-3.5 w-3.5" aria-hidden /> מטריצת-שיחות — כיסוי הפוסטים שלנו × מי הגיב
        </p>
        {eng?.summary ? (
          <>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
              <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300">פוסטים-נסרקים (72ש') <b className="tnum text-slate-100">{eng.summary.posts ?? 0}</b></span>
              <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300">כיסוי-צי ממוצע <b className="tnum text-emerald-400">{eng.summary.avgCoveragePct ?? 0}%</b></span>
              <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300">מכוסים-מלא <b className="tnum text-emerald-400">{eng.summary.fullyCovered ?? 0}</b></span>
              <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300">שיחות-פתוחות <b className="tnum text-orange-300">{eng.summary.openThreads ?? 0}</b></span>
            </div>
            {/* R233 · מדד-עומק-שיח — האם התגובות מפתחות שיחות אמיתיות */}
            {threads?.summary && (
              <div className="mt-1.5 flex flex-wrap gap-2 text-[10px]">
                <span className="rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-1 text-fuchsia-300">עומק-שיח ממוצע <b className="tnum">{threads.summary.avgDepth ?? '—'}</b>/3</span>
                <span className="rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-1 text-fuchsia-300">שיחות-שהתפתחו (שכבה-2) <b className="tnum">{threads.summary.developed ?? 0}</b>/{threads.summary.postsMeasured ?? 0}</span>
                <span className="rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-1 text-fuchsia-300">הגב-מחבר <b className="tnum">{threads.summary.authorResponseRate != null ? `${threads.summary.authorResponseRate}%` : '—'}</b></span>
                <span className="rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-1 text-fuchsia-300">ציון-שיח <b className="tnum">{threads.summary.avgScore ?? '—'}</b>/10</span>
              </div>
            )}
            <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-slate-800">
              <table className="w-full min-w-[520px] text-[11px]">
                <thead className="sticky top-0 bg-slate-900 text-slate-500">
                  <tr>
                    <th className="px-2.5 py-1.5 text-start font-medium">פוסט</th>
                    <th className="px-2.5 py-1.5 text-end font-medium">כיסוי</th>
                    <th className="px-2.5 py-1.5 text-end font-medium">שיח</th>
                    <th className="px-2.5 py-1.5 text-start font-medium">פערים (לא-הגיבו)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {(eng.posts ?? []).map((p) => (
                    <tr key={`${p.author}/${p.permlink}`} className={cn(p.covered ? 'opacity-70' : '')}>
                      <td className="max-w-[220px] truncate px-2.5 py-1.5 text-slate-300">
                        <span dir="ltr" className="font-bold text-slate-200">{p.author}</span> · {p.title}
                      </td>
                      <td className="tnum px-2.5 py-1.5 text-end">
                        <span className={cn('font-bold', p.coveragePct >= 100 ? 'text-emerald-400' : p.coveragePct >= 50 ? 'text-amber-400' : 'text-rose-400')}>{p.coveragePct}%</span>
                      </td>
                      <td className="tnum px-2.5 py-1.5 text-end text-slate-300">{p.threads}</td>
                      <td className="max-w-[180px] truncate px-2.5 py-1.5 text-[10px] text-slate-500" dir="ltr">{p.missing.length ? p.missing.join(', ') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="mt-1 text-[11px] text-slate-500">מטריצת-השיחות תיסרק ברענון הראשון</p>
        )}
      </div>

      {/* ─── 4 · מכ"ם-טרנדים ─── */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
          <Radar className="h-3.5 w-3.5" aria-hidden /> מכ"ם-טרנדים בהקשרים שלנו — קריפטו · התפתחות-רשת · AI
          {trends?.verdict && <StatusBadge tone={trends.verdict === 'TRENDS-OK' ? 'emerald' : trends.verdict === 'BRIDGE-DOWN' ? 'rose' : 'slate'}>{trends.verdict}</StatusBadge>}
        </p>
        {trends?.topics?.length ? (
          <div className="mt-2 space-y-1.5">
            {trends.topics.slice(0, 5).map((t, i) => (
              <div key={t.id ?? i} className="rounded-md border border-slate-800 bg-slate-900/70 px-2.5 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-bold leading-snug text-slate-100">{t.topic}</p>
                  {t.score != null && <span className="tnum shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300" dir="ltr">{t.score}/10</span>}
                </div>
                {t.talkTrack && <p className="mt-1 text-[10px] leading-relaxed text-slate-400"><b className="text-slate-300">נושאי-שיחה:</b> {t.talkTrack}</p>}
                {t.angle && <p className="mt-0.5 text-[10px] text-slate-500"><b>זווית:</b> {t.angle}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-slate-500">המכ"ם ירוץ במחזור הבא (cadence 6ש') — או דרך רענון-מחזור</p>
        )}
        {trends?.fetchedAt && <p className="mt-1.5 text-[10px] text-slate-600">נסרק: {new Date(trends.fetchedAt).toLocaleTimeString('he-IL')} · כל-טרנד נושא מקור (פוסט-שרשרת או אינטל) — בלי-מקור לא-נכנס</p>}
      </div>

      {/* ─── 5 · לוח-ציות (R232) ─── */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-teal-300">
          <ClipboardCheck className="h-3.5 w-3.5" aria-hidden /> לוח-ציות — האם הפעילות בפועל נחתה בחלונות? (אמת-שרשרת)
          {compliance?.summary?.verdict && <StatusBadge tone={complianceTone(compliance.summary.verdict)}>{complianceHeb(compliance.summary.verdict)}</StatusBadge>}
        </p>
        {compliance?.summary ? (
          <>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
              <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300">ציות-ממוצע <b className="tnum text-teal-300">{compliance.summary.avgCompliancePct != null ? `${compliance.summary.avgCompliancePct}%` : '—'}</b></span>
              <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300">פעילים-היום <b className="tnum text-slate-100">{compliance.summary.accountsActive ?? 0}/{compliance.summary.accounts ?? 14}</b></span>
              <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300">הפרץ-הצפוף ביותר <b className={cn('tnum', (compliance.summary.densestBurst ?? 0) > 4 ? 'text-rose-400' : 'text-emerald-400')} dir="ltr">{compliance.summary.densestBurst ?? 0} פעולות/30דק</b>{compliance.summary.burstAt ? <span dir="ltr"> @{compliance.summary.burstAt}</span> : null}</span>
              <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300">קלאסטרים-צפופים <b className={cn('tnum', (compliance.summary.clusterViolations ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400')}>{compliance.summary.clusterViolations ?? 0}</b></span>
            </div>
            {/* R233 · קו-מגמת ציות יום-מול-יום — האימוץ משתפר? */}
            {hist.length > 0 && (
              <div className="mt-2 rounded-md border border-slate-800 bg-slate-900/50 px-2.5 py-2">
                <p className="text-[10px] font-bold text-slate-400">קו-מגמת ציות (יום-מול-יום, עד 30 ימים)</p>
                <div className="mt-1.5 flex items-end gap-1" role="img" aria-label="היסטוריית ציות יומית">
                  {hist.slice(-14).map((h) => {
                    const pct = h.avgCompliancePct ?? 0
                    return (
                      <div key={h.day} className="flex flex-1 flex-col items-center gap-0.5" title={`${h.day}: ${pct}% · ${h.verdict}`}>
                        <div className={cn('w-full max-w-6 rounded-t', pct >= 80 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : pct > 0 ? 'bg-rose-500' : 'bg-slate-700')}
                          style={{ height: `${Math.max(2, Math.round((pct / 100) * 28))}px` }} />
                        <span className="text-[8px] text-slate-600" dir="ltr">{h.day.slice(5)}</span>
                      </div>
                    )
                  })}
                </div>
                {trend && (
                  <p className="mt-1 text-[10px] text-slate-500">
                    היום <b className="tnum text-teal-300">{trend.cur != null ? `${trend.cur}%` : '—'}</b>
                    {trend.prev != null ? (<>
                      {' '}· אתמול <b className="tnum text-slate-300">{trend.prev}%</b>
                      {' '}· <span className={cn('font-bold', (trend.delta ?? 0) > 0 ? 'text-emerald-400' : (trend.delta ?? 0) < 0 ? 'text-rose-400' : 'text-slate-400')} dir="ltr">
                        {trend.delta != null && trend.delta > 0 ? `+${trend.delta}` : trend.delta ?? 0}
                      </span>
                    </>) : ' · עדיין אין יום-קודם להשוואה'}
                  </p>
                )}
              </div>
            )}
            <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-slate-800">
              <table className="w-full min-w-[420px] text-[11px]">
                <thead className="sticky top-0 bg-slate-900 text-slate-500">
                  <tr>
                    <th className="px-2.5 py-1.5 text-start font-medium">חשבון</th>
                    <th className="px-2.5 py-1.5 text-end font-medium">פעולות</th>
                    <th className="px-2.5 py-1.5 text-end font-medium">בחלון</th>
                    <th className="px-2.5 py-1.5 text-end font-medium">ציות</th>
                    <th className="px-2.5 py-1.5 text-end font-medium">צפיפות</th>
                    <th className="px-2.5 py-1.5 text-start font-medium">פסק-דין</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {(compliance.rows ?? []).map((r) => (
                    <tr key={r.acc}>
                      <td className="px-2.5 py-1.5 font-bold text-slate-200" dir="ltr">{r.acc}</td>
                      <td className="tnum px-2.5 py-1.5 text-end text-slate-300">{r.total}</td>
                      <td className="tnum px-2.5 py-1.5 text-end text-slate-300">{r.total > 0 ? `${r.inWindow}/${r.total}` : '—'}</td>
                      <td className="tnum px-2.5 py-1.5 text-end font-bold">
                        <span className={cn(r.compliancePct == null ? 'text-slate-600' : r.compliancePct >= 80 ? 'text-emerald-400' : r.compliancePct >= 40 ? 'text-amber-400' : 'text-rose-400')}>
                          {r.compliancePct != null ? `${r.compliancePct}%` : '—'}
                        </span>
                      </td>
                      <td className="tnum px-2.5 py-1.5 text-end">
                        <span className={cn(r.clusters > 0 ? 'font-bold text-amber-400' : 'text-slate-500')}>{r.clusters}</span>
                      </td>
                      <td className="px-2.5 py-1.5 text-[10px]">
                        <StatusBadge tone={complianceTone(r.verdict)}>{complianceHeb(r.verdict)}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[10px] text-slate-600">נמדד: {compliance.at ? new Date(compliance.at).toLocaleTimeString('he-IL') : '—'} · סבלנות-חלון 30 דק · קלאסטר = פער &lt;5 דק בין פעולות-עצמיות · QUIET = אין פעילות-היום (לא-הפרה)</p>
          </>
        ) : (
          <p className="mt-1 text-[11px] text-slate-500">טלמטריית-הציות תימדד במחזור הבא (cadence 30 דק) — או דרך רענון-מחזור</p>
        )}
      </div>

      {/* ─── 6 · הביצוע שלנו (R232) ─── */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-sky-300">
          <Zap className="h-3.5 w-3.5" aria-hidden /> הביצוע שלנו — חלונות headcorner בפועל (החוק חל גם עלינו)
          <button
            type="button"
            onClick={() => void dryRun()}
            disabled={busy != null}
            aria-label="בדיקת-יבשה של המבצע — אימות שערים וחוקים בלי חתימה"
            className="ml-auto inline-flex h-6 items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 px-2 text-[10px] font-bold text-sky-300 transition-colors hover:bg-sky-500/20 disabled:opacity-50"
          >
            <ShieldQuestion className={cn('h-3 w-3', busy === 'dry' && 'animate-pulse')} aria-hidden />
            בדיקת-יבשה
          </button>
        </p>
        {dryPlan && (
          <div className="mt-2 rounded-md border border-sky-500/25 bg-sky-500/5 px-2.5 py-2">
            <p className="text-[10px] font-bold text-sky-300">תוכנית-מבצע (יבשה — אפס חתימות):</p>
            {dryPlan.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {dryPlan.map((p) => (
                  <li key={p.kind} className="text-[10px] text-slate-300" dir="ltr">
                    <b className="text-sky-300">{p.kind}</b> @ {hhmm(p.window)} — <span className={cn(p.verdict.includes('DRY-VOTE') || p.verdict.includes('DRY-ENGAGE') ? 'font-bold text-emerald-400' : 'text-slate-400')}>{p.verdict}</span>
                    {p.target ? <span className="text-slate-500"> → {p.target}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[10px] text-slate-500">אין חלון-פעיל כרגע — השערים והקריאות נבדקו ותקינים (RC/VP חי). הפעולות ייחתמו כשהחלונות ייפתחו.</p>
            )}
          </div>
        )}
        {execution?.windows && Object.keys(execution.windows).length > 0 ? (
          <>
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {Object.entries(execution.windows).map(([kind, w]) => (
                <div key={kind} className="rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5">
                  <p className="text-[10px] font-bold text-slate-300">{kind === 'engage' ? 'חלון-שיחה' : kind === 'post' ? 'חלון-פרסום' : `חלון-הצבעה ${kind.replace('vote', '')}`}</p>
                  <p className="mt-0.5 text-[10px] leading-tight text-slate-500" dir="ltr">{w.verdict ?? '—'}</p>
                  {w.at && <p className="text-[9px] text-slate-600">{new Date(w.at).toLocaleTimeString('he-IL')}</p>}
                </div>
              ))}
            </div>
            {(execution.actions ?? []).length > 0 && (
              <div className="mt-2 max-h-32 overflow-y-auto rounded-md border border-slate-800">
                <table className="w-full min-w-[380px] text-[10px]">
                  <tbody className="divide-y divide-slate-800/60">
                    {(execution.actions ?? []).slice(-8).reverse().map((a, i) => (
                      <tr key={`${a.at}-${i}`}>
                        <td className="px-2 py-1 font-bold text-slate-300">{a.kind === 'engage' ? 'תגובה' : 'הצבעה'}</td>
                        <td className="max-w-[200px] truncate px-2 py-1 text-slate-400" dir="ltr">{a.to ?? '—'}</td>
                        <td className="px-2 py-1">
                          <span className={cn(a.verdict.startsWith('REPLIED') || a.verdict.startsWith('VOTED') ? 'font-bold text-emerald-400' : 'text-amber-400')} dir="ltr">{a.verdict}</span>
                        </td>
                        {a.txid ? <td className="px-2 py-1 text-slate-600" dir="ltr">tx {String(a.txid).slice(0, 10)}…</td> : <td className="px-2 py-1 text-slate-700">—</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-1.5 text-[10px] text-slate-600">RC {execution.rcPct != null ? `${execution.rcPct}%` : '?'} · יום {execution.day ?? '—'} · תקציב 3 תגובות/חלון · VP&lt;30 = מנוחה-חוקית · כל-פסק-דין ביומן השרשרת</p>
          </>
        ) : (
          <p className="mt-1 text-[11px] text-slate-500">החלונות שלנו ייפתחו ויבוצעו אוטומטית במחזור — ההערכה הראשונה תופיע כאן</p>
        )}
      </div>

      {d?.error && <p className="text-[11px] font-bold text-rose-400">שגיאה: {d.error}</p>}
    </SectionCard>
  )
}
