import { ChevronDown, Moon, Sun, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import type { ConnectionPresentation } from '@/lib/presentation.ts'

type ReceiverControlsProps = {
  connection: ConnectionPresentation
  eventCount: number
  onClear: () => void
}

/** Status and viewer-only actions kept together without exposing receiver mutations. */
export function ReceiverControls({ connection, eventCount, onClear }: ReceiverControlsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  useEffect(() => {
    const closeOnOutsidePointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const dotClassName =
    connection.tone === 'success'
      ? 'bg-emerald-500 shadow-[0_0_10px_oklch(0.72_0.19_160)]'
      : connection.tone === 'warning'
        ? 'bg-amber-500'
        : 'bg-muted-foreground'

  return (
    <div ref={rootRef} className="relative flex shrink-0">
      <div className="flex h-8 items-center overflow-hidden rounded-md border border-border bg-background shadow-xs">
        <span
          role="status"
          aria-label={connection.label}
          title={connection.label}
          className="flex h-full items-center gap-2 px-2.5"
        >
          <span className={`size-2 rounded-full ${dotClassName}`} />
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
            {connection.label.replace(' to local receiver', '')}
          </span>
          <span className="sr-only">{connection.label}</span>
        </span>
        <button
          type="button"
          aria-label="Receiver options"
          aria-expanded={isOpen}
          aria-controls="receiver-options"
          className="flex h-full w-8 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onClick={() => setIsOpen((open) => !open)}
        >
          <ChevronDown className={`size-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {isOpen ? (
        <div
          id="receiver-options"
          aria-label="Receiver options"
          className="absolute top-10 right-0 z-10 w-48 border border-border bg-background p-1 text-foreground shadow-lg"
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={() => {
              setTheme(isDark ? 'light' : 'dark')
              setIsOpen(false)
            }}
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            Use {isDark ? 'light' : 'dark'} mode
          </button>
          <button
            type="button"
            disabled={eventCount === 0}
            className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={() => {
              onClear()
              setIsOpen(false)
            }}
          >
            <Trash2 className="size-4" />
            Clear all events
          </button>
        </div>
      ) : null}
    </div>
  )
}
