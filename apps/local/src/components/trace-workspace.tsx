import type { TraceGroup } from '../lib/trace-model';
import { TraceWaterfall } from './trace-waterfall';

type TraceWorkspaceProps = {
  onSelect: (traceId: string) => void;
  selectedTraceId?: string;
  traces: TraceGroup[];
};

function formatDuration(durationMs: number | undefined) {
  if (durationMs === undefined) {
    return '—';
  }

  if (durationMs < 1_000) {
    return `${Math.round(durationMs)} ms`;
  }

  return `${(durationMs / 1_000).toFixed(2)} s`;
}

export function TraceWorkspace({
  onSelect,
  selectedTraceId,
  traces,
}: TraceWorkspaceProps) {
  const selectedTrace =
    traces.find((trace) => trace.id === selectedTraceId) ?? traces[0];

  if (!selectedTrace) {
    return (
      <section
        className="flex min-h-0 flex-1 items-center justify-center p-6"
        aria-label="Traces"
      >
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold text-foreground">No traces captured</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Transactions and spans from your receiver will appear here as a single trace.
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside
        aria-label="Trace list"
        className="flex w-[min(100%,25rem)] shrink-0 flex-col border-r border-border bg-card"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="trace-list-heading" className="text-sm font-semibold text-foreground">Traces</h2>
          <span className="font-mono text-xs text-muted-foreground">
            {traces.length} trace{traces.length === 1 ? '' : 's'}
          </span>
        </header>

        <ol className="min-h-0 overflow-y-auto p-2" aria-labelledby="trace-list-heading">
          {traces.map((trace) => {
            const isSelected = trace.id === selectedTrace.id;

            return (
              <li key={trace.id}>
                <button
                  type="button"
                  aria-current={isSelected ? 'true' : undefined}
                  aria-label={`View trace ${trace.title}`}
                  className={`w-full rounded-md px-3 py-2.5 text-left transition-colors ${
                    isSelected
                      ? 'bg-primary/10 text-foreground'
                      : 'text-foreground hover:bg-muted/70'
                  }`}
                  onClick={() => onSelect(trace.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">{trace.title}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {formatDuration(trace.durationMs)}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-2 font-mono text-[11px] text-muted-foreground">
                    <span>{trace.spans.length} spans</span>
                    {trace.errorCount > 0 ? <span>{trace.errorCount} errors</span> : null}
                    {trace.logCount > 0 ? <span>{trace.logCount} logs</span> : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>

      <div className="min-w-0 flex-1 overflow-auto p-4 md:p-6">
        <TraceWaterfall trace={selectedTrace} />
      </div>
    </div>
  );
}
