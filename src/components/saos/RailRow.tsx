import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { valueTone, type Tone } from './tones'

/**
 * T-21d · one label→value rail row (the repeated dt/dd justify-between pattern).
 * tabular-nums enforced for every value; `ltr` flips just the value for hashes/ids/units.
 */
export function RailRow({
  label,
  value,
  tone = 'slate',
  ltr = false,
  mono = false,
  strong = false,
  className,
}: {
  label: ReactNode
  value: ReactNode
  tone?: Tone
  ltr?: boolean
  mono?: boolean
  strong?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-baseline justify-between gap-3', className)}>
      <span className="shrink-0 text-[11px] leading-relaxed text-slate-500">{label}</span>
      <span
        dir={ltr ? 'ltr' : undefined}
        className={cn(
          'tnum min-w-0 text-end text-sm leading-relaxed',
          strong ? 'font-extrabold' : 'font-bold',
          mono && 'font-mono text-xs',
          valueTone[tone],
        )}
      >
        {value}
      </span>
    </div>
  )
}
