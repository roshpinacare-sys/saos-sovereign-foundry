'use client'

import { useCallback, useEffect, useState } from 'react'
import { Grid3X3, RefreshCw, Vault, Lock } from 'lucide-react'
import { SectionCard } from './SectionCard'
import { StatusBadge } from './StatusBadge'
import { cn } from '@/lib/utils'

/**
 * R234 · גריד-הצבא — הוראת-המפעיל (trace 1a113f67a0ed4be9) על-המסך:
 *  "צריך לוודא שגם החשבונות שלנו הקיימים עושים גריד ולא לפתוח חדשים לפני זה"
 *  "מה שיש לו מפתח אטום בכספת בטוח בגיט יכול להיות בטוח לשימוש"
 *
 * לוח אמת בשלושה דורות + סטטוס-גריד חי לכל חשבון-צבא. הכל נתוני-שרשרת
 * או פסקי-דין מנוע — אפס ערכים מומצאים. Self-fetching, אפס-צימוד לדף.
 */

type FundRec = { txid: string | null; amount: number; at: string }
type AccRec = {
  slot?: number; runs?: number; lastVerdict?: string | null; decision?: string | null
  reason?: string | null; live?: number; steem?: number | null; sbd?: number | null
  rcPct?: number | null; txid?: string | null
}
type FleetGridDoc = {
  ok?: boolean; engine?: string
  orderTrace?: string; law?: string; enabled?: boolean; running?: boolean
  tickMs?: number; startedAt?: string | null; lastTickAt?: string | null; runs?: number
  parity?: number | null
  funding?: { verdict?: string | null; txid?: string | null; funded?: Record<string, FundRec> }
  accounts?: Record<string, AccRec>
  conf?: { fundEach?: number; minLevel?: number; levels?: number; rcMinPct?: number; rebalanceDriftBps?: number }
}

const ARMY = ['cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq']

function verdictTone(v?: string | null): 'emerald' | 'amber' | 'slate' {
  if (!v) return 'slate'
  if (v.startsWith('BROADCAST') || v.startsWith('NO-CHANGE')) return 'emerald'
  if (v.startsWith('FAIL') || v.startsWith('ERROR') || v.startsWith('NO-CUSTODY')) return 'amber'
  return 'slate'
}

export function FleetGridCard() {
  const [doc, setDoc] = useState<FleetGridDoc | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/saos/fleet-grid', { cache: 'no-store' })
      setDoc(await r.json())
    } catch { setDoc({ ok: false, engine: 'down' }) }
    finally { setBusy(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const funded = doc?.funding?.funded ?? {}
  const fundedCount = ARMY.filter((n) => funded[n]).length
  const liveOrders = ARMY.reduce((s, n) => s + (doc?.accounts?.[n]?.live ?? 0), 0)

  return (
    <SectionCard
      icon={Grid3X3}
      tone="orange"
      title={<>גריד-הצבא · הצי-הקיים גורד קודם <span dir="ltr" className="text-slate-500">(R234)</span></>}
      actions={
        <div className="flex items-center gap-2">
          <StatusBadge tone={doc?.running ? 'emerald' : 'amber'}>
            {doc?.running ? `חי · ${liveOrders} הזמנות` : doc?.engine === 'down' ? 'מנוע-מורד' : 'מושבת'}
          </StatusBadge>
          <button onClick={load} disabled={busy} aria-label="רענון גריד-הצבא"
            className="rounded-md border border-slate-700 p-1.5 text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:opacity-40">
            <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
          </button>
        </div>
      }
    >
      <p dir="rtl" className="mb-2 rounded-md border border-orange-500/30 bg-orange-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-orange-300">
        הוראת-מפעיל R234 (trace <span dir="ltr">{doc?.orderTrace ?? '1a113f67a0ed4be9'}</span>): ״לוודא שגם החשבונות-הקיימים שלנו עושים גריד — ולא לפתוח חדשים לפני זה״ · ״מה שיש לו מפתח אטום בכספת בטוח בגיט — שמיש לשימוש״
      </p>

      {/* שלושת הדורות — אמת-מלאה */}
      <div className="mb-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        <div className="rounded-md border border-slate-800 bg-slate-900/40 p-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300"><Lock className="h-3 w-3 text-red-400" /> דור-1 · hcsoldier1-3</div>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">אבודי-מפתח לצמיתות (T-78b) · <span className="text-amber-400">56.001 STEEM + 0.417 SBD תקועים</span> · לא יקבלו כלום</p>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-900/40 p-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300"><Vault className="h-3 w-3 text-emerald-400" /> דור-2 · hcsoldier4-6</div>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">אפוטרופסות-מוכחת בכספת-גיט (12/12) · <span className="text-slate-400">מושהה</span> — יופעל רק אחרי שהצי-הקיים גורד</p>
        </div>
        <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300"><Grid3X3 className="h-3 w-3" /> הצבא · 10 חשבונות-קיימים</div>
          <p className="mt-1 text-[10px] leading-relaxed text-emerald-400/80">אפוטרופסות שוחזרה 10/10 מהכספת · ממומן {fundedCount}/10 · גריד חי על-השרשרת</p>
        </div>
      </div>

      {/* ראית-המימון */}
      {doc?.funding?.txid && (
        <p className="mb-2 text-[10px] text-slate-500">
          מימון חד-פעמי: <span dir="ltr" className="font-mono">{doc.funding.txid.slice(0, 16)}…</span> · {doc?.conf?.fundEach ?? 1} STEEM לחשבון · פסק-דין: {doc.funding.verdict ?? '—'}
        </p>
      )}

      {/* סטטוס חי לכל חשבון */}
      <div className="space-y-1">
        {ARMY.map((n) => {
          const rec = doc?.accounts?.[n]
          return (
            <div key={n} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-bold text-slate-200">{n}</span>
              <span className="flex items-center gap-2 font-mono text-[10px] text-slate-500">
                <span dir="ltr">live {rec?.live ?? 0}</span>
                <span dir="ltr">{typeof rec?.steem === 'number' ? `${rec.steem.toFixed(2)} STEEM` : '—'}</span>
                <span dir="ltr">{typeof rec?.rcPct === 'number' ? `RC ${rec.rcPct}%` : ''}</span>
                <span className={cn(verdictTone(rec?.lastVerdict) === 'emerald' && 'text-emerald-400', verdictTone(rec?.lastVerdict) === 'amber' && 'text-amber-400', verdictTone(rec?.lastVerdict) === 'slate' && 'text-slate-500')}>
                  {rec?.lastVerdict ?? 'ממתין-לטיק'}
                </span>
              </span>
            </div>
          )
        })}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
        חוק-סולם-מיקרו: {doc?.conf?.levels ?? 5} רמות-ASK × {doc?.conf?.minLevel ?? 0.2} STEEM לרמה, מעוגן-פריטה (band ±{doc?.conf?.rebalanceDriftBps ?? 25}bps) · ה-SBD שנצבר מההצמדות מדליק את צד-ה-BID מעצמו · טיק כל {Math.round((doc?.tickMs ?? 180000) / 60000)} דק · ריצות: {doc?.runs ?? 0}
      </p>
    </SectionCard>
  )
}
