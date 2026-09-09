import { createSpotlightBuffer } from '@spotlightjs/spotlight/sdk'
import { EventSource as NodeEventSource } from 'eventsource'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/components/theme-provider.tsx'
import App from './App.tsx'
import {
  REMOTE_STREAM_STORAGE_KEY,
  STREAM_STORAGE_KEY,
} from './lib/spotlight.ts'
import {
  buildApp,
  tryListen,
} from '../../../packages/cli/src/commands/local/server.ts'

const SENTRY_CONTENT_TYPE = 'application/x-sentry-envelope'

type EnvelopeOptions = {
  level?: string
  operation?: string
  spanId?: string
  spans?: unknown[]
  statusCode?: number
  startTimestamp?: number
  traceId?: string
  type?: string
}

function envelope(transaction: string, options: EnvelopeOptions = {}): string {
  return [
    JSON.stringify({ event_id: crypto.randomUUID() }),
    JSON.stringify({ type: options.type ?? 'transaction' }),
    JSON.stringify({
      transaction,
      timestamp: 1_700_000_000,
      ...(options.startTimestamp ? { start_timestamp: options.startTimestamp } : {}),
      ...(options.level ? { level: options.level } : {}),
      ...(options.traceId || options.operation
        ? {
            contexts: {
              trace: {
                ...(options.traceId ? { trace_id: options.traceId } : {}),
                ...(options.spanId ? { span_id: options.spanId } : {}),
                ...(options.operation ? { op: options.operation } : {}),
              },
            },
          }
        : {}),
      ...(options.statusCode ? { request: { status_code: options.statusCode } } : {}),
      ...(options.spans ? { spans: options.spans } : {}),
    }),
    '',
  ].join('\n')
}

async function startReceiver() {
  return tryListen(buildApp(createSpotlightBuffer(10)), 0, '127.0.0.1')
}

async function stopReceiver(
  server: Awaited<ReturnType<typeof startReceiver>>['server']
) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function sendEnvelope(
  port: number,
  transaction: string,
  options?: EnvelopeOptions
) {
  const response = await fetch(`http://127.0.0.1:${port}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': SENTRY_CONTENT_TYPE },
    body: envelope(transaction, options),
  })
  expect(response.status).toBe(204)
}

function renderViewer(port: number) {
  window.history.replaceState(
    null,
    '',
    `/#stream=${encodeURIComponent(`http://127.0.0.1:${port}/stream`)}`
  )
  return render(
    <ThemeProvider attribute="class" defaultTheme="light">
      <App />
    </ThemeProvider>
  )
}

function renderBareViewer() {
  window.history.replaceState(null, '', '/')
  return render(
    <ThemeProvider attribute="class" defaultTheme="light">
      <App />
    </ThemeProvider>
  )
}

class OpeningEventSource extends EventTarget {
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(_url: string) {
    super()
    queueMicrotask(() => this.onopen?.(new Event('open')))
  }

  close() {}
}

describe('local receiver to viewer integration', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.stubGlobal('EventSource', NodeEventSource)
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', '/')
  })

  test('keeps the selected live transaction open in the detail pane', async () => {
    const { server, port } = await startReceiver()

    try {
      renderViewer(port)
      await screen.findByText('Connected to local receiver')

      const shell = screen.getByTestId('app-shell')
      expect(shell.className).not.toContain('px-')
      expect(shell.className).not.toContain('py-')
      expect(screen.getByRole('banner').className).not.toContain('border-b')

      await sendEnvelope(port, 'GET /live')
      await screen.findByLabelText('View transaction event')
      await sendEnvelope(port, 'GET /live-2')

      await waitFor(() => {
        expect(screen.getAllByLabelText('View transaction event')).toHaveLength(2)
      })
      const eventList = screen.getByTestId('event-list')
      expect(eventList.className).toContain('flex-1')
      expect(eventList.className).not.toContain('max-h-[42rem]')
      expect(screen.getByRole('complementary', { name: 'Events' })).not.toBeNull()
      const detail = screen.getByTestId('event-detail')
      expect(detail.textContent).toContain('GET /live')
      expect(detail.textContent).not.toContain('GET /live-2')
      expect(detail.textContent).not.toContain('GETGET /live')

      const events = screen.getAllByLabelText('View transaction event')
      fireEvent.click(events[1]!)

      await waitFor(() => {
        expect(screen.getByTestId('event-detail').textContent).toContain('GET /live-2')
      })
      expect(screen.getByRole('tab', { name: 'Overview' })).not.toBeNull()
      fireEvent.click(screen.getByRole('tab', { name: 'JSON' }))
      const code = screen.getByTestId('highlighted-json')
      expect(code.textContent).toContain('GET /live-2')
      fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }))
      expect(screen.getByRole('status', { name: 'JSON copied' })).not.toBeNull()
      await waitFor(() => {
        expect(screen.getByTestId('highlighted-json').querySelector('.shiki')).not.toBeNull()
      })
      fireEvent.click(events[0]!)
      fireEvent.click(screen.getByRole('tab', { name: 'JSON' }))
      expect(screen.getByRole('button', { name: 'Copy JSON' }).textContent).toContain('Copy JSON')
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })

  test('offers a useful connection landing for a bare viewer visit', () => {
    renderBareViewer()

    expect(screen.getByText('Looking for Sentry Local')).not.toBeNull()
    const endpoint = screen.getByLabelText('Receiver endpoint') as HTMLInputElement
    expect(endpoint.value).toBe('http://localhost:8969/stream')
    expect(screen.getByRole('button', { name: 'Connect' })).not.toBeNull()
    expect(screen.getByText('Advanced connection')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Copy local serve command' })).not.toBeNull()
  })

  test('connects a bare viewer to a custom loopback receiver and saves it after opening', async () => {
    const { server, port } = await startReceiver()

    try {
      renderBareViewer()
      fireEvent.change(screen.getByLabelText('Receiver endpoint'), {
        target: { value: `http://127.0.0.1:${port}/stream` },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

      await screen.findByText('Connected to local receiver')
      expect(window.localStorage.getItem('sentry.local.stream-url')).toBe(
        `http://127.0.0.1:${port}/stream`
      )
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })

  test('keeps a successfully opened remote receiver only for this browser session', async () => {
    vi.stubGlobal('EventSource', OpeningEventSource)
    renderBareViewer()
    await screen.findByText('Connected to local receiver')
    window.localStorage.clear()
    fireEvent.click(screen.getByRole('button', { name: 'Change receiver' }))

    fireEvent.change(screen.getByLabelText('Receiver endpoint'), {
      target: { value: 'https://receiver.example/stream?token=abc' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => {
      expect(window.sessionStorage.getItem(REMOTE_STREAM_STORAGE_KEY)).toBe(
        'https://receiver.example/stream?token=abc'
      )
    })
    expect(window.localStorage.getItem(STREAM_STORAGE_KEY)).toBeNull()
  })

  test('replays an envelope buffered before the viewer opens', async () => {
    const { server, port } = await startReceiver()

    try {
      await sendEnvelope(port, 'GET /buffered')
      renderViewer(port)

      await screen.findByText('Connected to local receiver')
      expect((await screen.findByTestId('event-detail')).textContent).toContain(
        'GET /buffered'
      )
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })

  test('does not mark the receiver replay as new events', async () => {
    const { server, port } = await startReceiver()

    try {
      await sendEnvelope(port, 'GET /buffered-first')
      await sendEnvelope(port, 'GET /buffered-second')
      renderViewer(port)

      await waitFor(() => {
        expect(screen.getAllByLabelText('View transaction event')).toHaveLength(2)
      })
      expect(screen.queryByRole('button', { name: /View .* new event/ })).toBeNull()
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })

  test('filters the feed by event class', async () => {
    const { server, port } = await startReceiver()

    try {
      renderViewer(port)
      await screen.findByText('Connected to local receiver')
      await sendEnvelope(port, 'GET /healthy')
      await sendEnvelope(port, 'GET /broken', { type: 'event', level: 'error' })

      await screen.findByLabelText('View transaction event')
      await screen.findByLabelText('View event event')

      fireEvent.click(screen.getByRole('button', { name: 'Errors (1)' }))

      expect(screen.queryByLabelText('View transaction event')).toBeNull()
      expect(screen.getByLabelText('View event event').textContent).toContain(
        '/broken'
      )
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })

  test('marks an error entry in the mixed event feed', async () => {
    const { server, port } = await startReceiver()

    try {
      renderViewer(port)
      await screen.findByText('Connected to local receiver')
      await sendEnvelope(port, 'GET /broken', { type: 'event', level: 'error' })

      expect((await screen.findByLabelText('View event event')).textContent).toContain('Error')
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })

  test('filters retained events from the top navigation search', async () => {
    const { server, port } = await startReceiver()

    try {
      renderViewer(port)
      await screen.findByText('Connected to local receiver')
      await sendEnvelope(port, 'GET /customers/42')
      await sendEnvelope(port, 'POST /orders')

      await waitFor(() => {
        expect(screen.getAllByLabelText('View transaction event')).toHaveLength(2)
      })
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search events' }), {
        target: { value: 'customers' },
      })

      expect(screen.getAllByLabelText('View transaction event')).toHaveLength(1)
      expect(screen.getByTestId('event-list').textContent).toContain('/customers/42')
      expect(screen.getByTestId('event-list').textContent).not.toContain('/orders')
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })

  test('clears the local viewer feed from receiver options', async () => {
    const { server, port } = await startReceiver()

    try {
      renderViewer(port)
      await screen.findByText('Connected to local receiver')
      await sendEnvelope(port, 'GET /clear-me')
      await screen.findByLabelText('View transaction event')

      fireEvent.click(screen.getByRole('button', { name: 'Receiver options' }))
      fireEvent.click(screen.getByRole('button', { name: 'Clear all events' }))

      expect(screen.queryByLabelText('View transaction event')).toBeNull()
      expect(screen.getByText('Waiting for events')).not.toBeNull()
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })

  test('summarizes other retained events in the selected trace overview', async () => {
    const { server, port } = await startReceiver()

    try {
      renderViewer(port)
      await screen.findByText('Connected to local receiver')
      await sendEnvelope(port, 'GET /trace/first', { traceId: 'shared-trace' })
      await sendEnvelope(port, 'GET /trace/second', { traceId: 'shared-trace' })

      await waitFor(() => {
        expect(screen.getAllByLabelText('View transaction event')).toHaveLength(2)
      })

      const details = screen.getByRole('table', { name: 'Event details' })
      expect(details.textContent).toContain('Related events')
      expect(details.textContent).toContain('1')
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })

  test('offers new events without interrupting the selected detail', async () => {
    const { server, port } = await startReceiver()

    try {
      renderViewer(port)
      await screen.findByText('Connected to local receiver')
      await sendEnvelope(port, 'GET /selected')
      fireEvent.click(await screen.findByLabelText('View transaction event'))
      await sendEnvelope(port, 'GET /new')

      await waitFor(() => {
        expect(screen.getAllByLabelText('View transaction event')).toHaveLength(2)
      })

      expect(screen.getByTestId('event-detail').textContent).toContain('GET /selected')
      const newEvents = screen.getByRole('button', { name: 'View 1 new event' })
      fireEvent.click(newEvents)

      expect(screen.getByTestId('event-detail').textContent).toContain('GET /new')
      expect(screen.queryByRole('button', { name: 'View 1 new event' })).toBeNull()
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })

  test('only offers new events that match the active filter', async () => {
    const { server, port } = await startReceiver()

    try {
      renderViewer(port)
      await screen.findByText('Connected to local receiver')
      await sendEnvelope(port, 'GET /first-error', { type: 'event', level: 'error' })
      await screen.findByLabelText('View event event')
      fireEvent.click(screen.getByRole('button', { name: 'Errors (1)' }))
      await sendEnvelope(port, 'GET /healthy')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'All (2)' })).not.toBeNull()
      })
      expect(screen.queryByRole('button', { name: /View 1 new event/ })).toBeNull()

      await sendEnvelope(port, 'GET /second-error', { type: 'event', level: 'error' })

      const newEvents = await screen.findByRole('button', { name: 'View 1 new event' })
      fireEvent.click(newEvents)
      expect(screen.getByTestId('event-detail').textContent).toContain('GET /second-error')
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })

  test('shows a copyable, grouped inspector table in the selected event overview', async () => {
    const { server, port } = await startReceiver()

    try {
      renderViewer(port)
      await screen.findByText('Connected to local receiver')
      await sendEnvelope(port, 'GET /summary', {
        operation: 'http.server',
        startTimestamp: 1_699_999_999.99383,
        statusCode: 201,
        traceId: 'summary-trace',
      })

      const details = await screen.findByRole('table', { name: 'Event details' })
      expect(details.textContent).toContain('201')
      expect(details.textContent).toContain('6.17ms')
      expect(details.textContent).toContain('http.server')
      expect(screen.getByRole('rowheader', { name: 'Method' })).not.toBeNull()
      expect(screen.getByRole('rowheader', { name: 'Trace ID' })).not.toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Copy Route' }))
      expect(screen.getByRole('status', { name: 'Route copied' })).not.toBeNull()
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })

  test('shows a trace waterfall for a transaction with child spans', async () => {
    const { server, port } = await startReceiver()

    try {
      renderViewer(port)
      await screen.findByText('Connected to local receiver')
      await sendEnvelope(port, 'GET /waterfall', {
        operation: 'http.server',
        spanId: 'root-span',
        traceId: 'waterfall-trace',
        startTimestamp: 1_699_999_999.988,
        spans: [
          {
            span_id: 'db-span',
            parent_span_id: 'root-span',
            op: 'db.query',
            description: 'SELECT * FROM orders',
            start_timestamp: 1_699_999_999.99,
            timestamp: 1_699_999_999.994,
          },
          {
            span_id: 'http-span',
            parent_span_id: 'root-span',
            op: 'http.client',
            description: 'GET https://inventory.test/items/42',
            start_timestamp: 1_699_999_999.995,
            timestamp: 1_699_999_999.998,
          },
        ],
      })

      fireEvent.click(await screen.findByRole('tab', { name: 'Trace' }))

      expect(screen.getByRole('region', { name: 'Trace waterfall' })).not.toBeNull()
      expect(screen.getByRole('columnheader', { name: 'Span' })).not.toBeNull()
      expect(
        screen.getByRole('columnheader', { name: 'Timeline from 0ms to 12ms' })
      ).not.toBeNull()
      expect(screen.getByRole('columnheader', { name: 'Duration' })).not.toBeNull()
      expect(screen.getByLabelText('Trace summary').textContent).toContain('3 spans')
      expect(screen.getByText('db.query')).not.toBeNull()
      expect(screen.getByText('http.client')).not.toBeNull()
      expect(screen.getByRole('cell', { name: 'Duration 4.00ms' })).not.toBeNull()
      expect(screen.getByTestId('waterfall-bar-db-span')).not.toBeNull()
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })

  test('moves between detail tabs with arrow keys', async () => {
    const { server, port } = await startReceiver()

    try {
      renderViewer(port)
      await screen.findByText('Connected to local receiver')
      await sendEnvelope(port, 'GET /tabs')

      const overview = await screen.findByRole('tab', { name: 'Overview' })
      fireEvent.keyDown(overview, { key: 'ArrowRight' })

      expect(screen.getByRole('tab', { name: 'JSON' }).getAttribute('aria-selected')).toBe(
        'true'
      )
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })

  test('reserves space for the CLI logo', async () => {
    const { server, port } = await startReceiver()

    try {
      renderViewer(port)

      const logo = await screen.findByAltText('Sentry CLI')
      expect(logo.getAttribute('width')).toBe('117')
      expect(logo.getAttribute('height')).toBe('20')
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })
})
