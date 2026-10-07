'use client'

import { useCallback, useEffect, useState } from 'react'
import { Coins, RefreshCw, Vote, MessageSquare, FileText, TrendingUp, ExternalLink } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { cn } from '@/lib/utils'

/**
 * R236 · צינור-הרווחים — הפערים שנמצאו ונסגרו, על-המסך:
 *  · מו"ל (publisher): 12 טיוטות ישבו בלי-שידור (authorOps 0) — מסילה חדשה משדרת (2/יום, txid)
 *  · גרינד-הצי: הציות נמדד ל-14 אבל בוצע רק למאסטר — עכשיו כל חשבון-מפתח גורד תוכן
 *  · מטריצת-אפשרויות: היכן הכסף באמת — מדוד מול מוסדר
 * אפס ערכים מומצאים: הכל פסקי-דין מנוע + txids על-השרשרת. Self-fetching.
 */

type Rec = { target?: string | null; verdict?: string | null; txid?: string | null; at?: string; weightPct?: number | null; vpEff?: number | null }
type GrindAcc = { vote?: Rec | null; engage?: Rec | null }
type GrindDoc = {
  ok?: boolean; engine?: string
  grind?: {
    day?: string; at?: string | null; verdict?: string | null
    votes?: number; replies?: number; failed?: number; skipped?: number
    accounts?: Record<string, GrindAcc>
    schedule?: { name: string; windowStart: string; windowEnd: string }[]
    law?: string
  } | null
  publisher?: {
    day?: string; verdict?: string | null; posted?: { id: string; title: string; txid: string | null; permlink: string | null; verdict: string }[]
  } | null
}

function railTone(v?: string | null): 'emerald' | 'amber' | 'slate' {
  if (!v) return 'slate'
  if (v === 'PUBLISHED' || v === 'POSTED' || v.startsWith('GRIND:')) return 'emerald'
  if (v.startsWith('HOLD') || v.startsWith('FAIL') || v.startsWith('ERR') || v.startsWith('NO-LAND')) return 'amber'
  return 'slate'
}

export function ProfitPipelineCard() {
  const [doc, setDoc] = useState<GrindDoc | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/saos/fleet-grind', { cache: 'no-store' })
      setDoc(await r.json())
    } catch { setDoc({ ok: false, engine: 'down' }) }
    finally { setBusy(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const grind = doc?.grind
  const publisher = doc?.publisher
  const sched = grind?.schedule ?? []
  const accounts = grind?.accounts ?? {}
  const doneAccs = Object.entries(accounts).filter(([, a]) => a?.vote?.verdict || a?.engage?.verdict)

  return (
    <SectionCard
      icon={Coins}
      tone="emerald"
      title={<>צינור-הרווחים <span dir="ltr" className="text-slate-500">(R236)</span></>}
      actions={
        <div className="flex items-center gap-2">
          <StatusBadge tone={railTone(grind?.verdict)}>גרינד-צי</StatusBadge>
          <StatusBadge tone={railTone(publisher?.verdict)}>מו&quot;ל</StatusBadge>
          <button
            onClick={load}
            className="rounded-md border border-slate-700 p-1.5 text-slate-400 transition hover:border-emerald-500/40 hover:text-emerald-300"
            aria-label="רענן צינור-רווחים"
          >
            <RefreshCw size={14} className={cn(busy && 'animate-spin')} />
          </button>
        </div>
      }
    >
      {doc?.ok === false && (
        <p className="text-[11px] text-amber-300">המנוע לא זמין — {String(doc.engine ?? '')}</p>
      )}

      {/* מסילת-פרסום */}
      <div className="mb-3 rounded-md border border-slate-800 bg-slate-900/40 p-3">
        <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-slate-200">
          <FileText size={13} className="text-emerald-400" />
          מסילת-פרסום — טיוטות → פוסטים (מקס 2/יום)
        </div>
        {publisher?.posted?.length ? (
          <div className="space-y-1">
            {publisher.posted.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-slate-300">{p.title}</span>
                <span className={cn('shrink-0 font-mono', p.verdict === 'POSTED' ? 'text-emerald-400' : 'text-amber-400')}>
                  {p.verdict === 'POSTED' && p.txid ? (
                    <a href={`https://steemtx.driglo.com/tx/${p.txid}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:underline" dir="ltr">
                      {p.txid.slice(0, 10)}… <ExternalLink size={10} />
                    </a>
                  ) : p.verdict}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">
            היום: {publisher?.verdict ?? '—'} · הטיוטות משודרות אוטומטית במחזור (עד 2 ביום, ותיקות ראשונות)
          </p>
        )}
      </div>

      {/* גרינד-הצי */}
      <div className="mb-3 rounded-md border border-slate-800 bg-slate-900/40 p-3">
        <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-slate-200">
          <Vote size={13} className="text-emerald-400" />
          גרינד-הצי — הצבעה + אינטראקציה לכל חשבון-מפתח (חלונות מפוזרים)
        </div>
        <div className="mb-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded border border-slate-800 bg-slate-950/60 p-1.5">
            <div className="text-[15px] font-semibold text-emerald-400">{grind?.votes ?? 0}</div>
            <div className="text-[10px] text-slate-500">הצבעות</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/60 p-1.5">
            <div className="text-[15px] font-semibold text-emerald-400">{grind?.replies ?? 0}</div>
            <div className="text-[10px] text-slate-500">תגובות</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/60 p-1.5">
            <div className="text-[15px] font-semibold text-slate-300">{sched.length}</div>
            <div className="text-[10px] text-slate-500">חשבונות בתוכנית</div>
          </div>
        </div>
        {doneAccs.length > 0 && (
          <div className="mb-2 max-h-32 space-y-1 overflow-y-auto">
            {doneAccs.map(([name, a]) => (
              <div key={name} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-mono text-slate-300" dir="ltr">{name}</span>
                <span className="flex items-center gap-2">
                  {a.vote?.verdict && (
                    <span className={cn('inline-flex items-center gap-0.5', a.vote.verdict === 'VOTED' ? 'text-emerald-400' : a.vote.verdict.startsWith('HOLD') ? 'text-amber-400' : 'text-slate-500')}>
                      <Vote size={10} /> {a.vote.verdict === 'VOTED' && a.vote.txid ? `${a.vote.txid.slice(0, 8)}…` : a.vote.verdict}
                    </span>
                  )}
                  {a.engage?.verdict && (
                    <span className={cn('inline-flex items-center gap-0.5', a.engage.verdict === 'REPLIED' ? 'text-emerald-400' : a.engage.verdict.startsWith('HOLD') ? 'text-amber-400' : 'text-slate-500')}>
                      <MessageSquare size={10} /> {a.engage.verdict === 'REPLIED' && a.engage.txid ? `${a.engage.txid.slice(0, 8)}…` : a.engage.verdict}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        {sched.length > 0 && (
          <details className="text-[11px] text-slate-500">
            <summary className="cursor-pointer hover:text-slate-300">חלונות יומיים ({sched.length})</summary>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
              {sched.map((s) => (
                <div key={s.name} className="flex justify-between font-mono" dir="ltr">
                  <span className="text-slate-400">{s.name}</span>
                  <span>{s.windowStart}–{s.windowEnd}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* מטריצת-אפשרויות */}
      <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
        <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-slate-200">
          <TrendingUp size={13} className="text-emerald-400" />
          מטריצת-הזדמנויות — היכן הכסף (מדוד מול מוסדר)
        </div>
        <div className="space-y-1.5 text-[11px] leading-relaxed">
          <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2">
            <span className="font-medium text-emerald-300">1 · מסחר-פנימי (חי)</span>
            <span className="text-slate-400"> — ספרייד סביב-ערך-שיווי; היום: מכירות בספר הפנימי, הכנסות SBD נמדדות בכרטיס הכלכלה. נזילות-הוונוה הפנימי דל — נוכחות ×13 מגדילה סיכויי-פוזה.</span>
          </div>
          <div className="rounded border border-slate-700/40 bg-slate-950/40 p-2">
            <span className="font-medium text-slate-200">2 · תגמולי-מחבר + קיורציה (חי מ-R236)</span>
            <span className="text-slate-400"> — פוסטים + הצבעות צי = מיצוי בריכת-התגמולים; קטן בהתחלה, מתגלגל עם מוניטין ו-SP.</span>
          </div>
          <div className="rounded border border-slate-700/40 bg-slate-950/40 p-2">
            <span className="font-medium text-slate-200">3 · יציאה-חיצונית (ביננס ~$1-10M/יום)</span>
            <span className="text-slate-400"> — הנזילות הגדולה באמת; דורש חשבון-בורסה של המפעיל (החלטת-מפעיל). המכונה מכינה: כמויות + תזמון + שערי-יציאה.</span>
          </div>
          <div className="rounded border border-slate-700/40 bg-slate-950/40 p-2">
            <span className="font-medium text-slate-200">4 · צמיחת-SP</span>
            <span className="text-slate-400"> — הצבעות קיורציה מגדילות SP → כוח-הצבעה ורווח-עתידי; חוק-VP שומר על הרצפה.</span>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}
