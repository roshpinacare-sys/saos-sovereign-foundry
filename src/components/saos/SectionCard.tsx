import type { ReactNode, ComponentType } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { cardTone, type Tone } from './tones'

/**
 * T-21d · the one glass panel every cockpit card is built from.
 * Accent-tinted gradient border + icon chip + small uppercase Hebrew title,
 * consistent p-4 content and gap-4 grids everywhere.
 */
export function SectionCard({
  icon: Icon,
  title,
  tone = 'slate',
  meta,
  actions,
  className,
  contentClassName,
  children,
}: {
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
  title: ReactNode
  tone?: Tone
  /** small meta line rendered under the title (e.g. honesty note) */
  meta?: ReactNode
  /** right-slot actions/badges in the header row */
  actions?: ReactNode
  className?: string
  contentClassName?: string
  children: ReactNode
}) {
  const t = cardTone[tone]
  return (
    <Card className={cn('glass-panel gap-3 rounded-xl py-4 backdrop-blur-sm transition-colors', t.card, className)}>
      <CardHeader className="px-4 pb-0">
        <CardTitle className={cn('flex flex-wrap items-center gap-2 text-[13px] font-bold tracking-wide', t.title)}>
          {Icon && (
            <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg border', t.chip)} aria-hidden>
              <Icon className="h-4 w-4" />
            </span>
          )}
          <span className="min-w-0 leading-snug">{title}</span>
          {actions && <span className="flex flex-wrap items-center gap-1.5 ms-auto">{actions}</span>}
        </CardTitle>
        {meta && <div className="text-[11px] leading-relaxed text-slate-500">{meta}</div>}
      </CardHeader>
      <CardContent className={cn('px-4 [&:first-child]:pt-0', contentClassName)}>{children}</CardContent>
    </Card>
  )
}
