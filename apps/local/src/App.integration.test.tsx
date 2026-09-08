import { createSpotlightBuffer } from '@spotlightjs/spotlight/sdk'
import { EventSource as NodeEventSource } from 'eventsource'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/components/theme-provider.tsx'
import App from './App.tsx'
import {
  buildApp,
  tryListen,
} from '../../../packages/cli/src/commands/local/server.ts'

const SENTRY_CONTENT_TYPE = 'application/x-sentry-envelope'

type EnvelopeOptions = {
  level?: string
  operation?: string
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
                ...(options.operation ? { op: options.operation } : {}),
              },
            },
          }
        : {}),
      ...(options.statusCode ? { request: { status_code: options.statusCode } } : {}),
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

describe('local receiver to viewer integration', () => {
  beforeEach(() => {
    window.localStorage.clear()
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

      const events = screen.getAllByLabelText('View transaction event')
      fireEvent.click(events[1]!)

      await waitFor(() => {
        expect(screen.getByTestId('event-detail').textContent).toContain('GET /live-2')
      })
      expect(screen.getByRole('tab', { name: 'Overview' })).not.toBeNull()
      fireEvent.click(screen.getByRole('tab', { name: 'JSON' }))
      const code = screen.getByTestId('highlighted-json')
      expect(code.textContent).toContain('GET /live-2')
      await waitFor(() => {
        expect(screen.getByTestId('highlighted-json').querySelector('.shiki')).not.toBeNull()
      })
    } finally {
      cleanup()
      await stopReceiver(server)
    }
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

  test('shows other retained events from the selected trace', async () => {
    const { server, port } = await startReceiver()

    try {
      renderViewer(port)
      await screen.findByText('Connected to local receiver')
      await sendEnvelope(port, 'GET /trace/first', { traceId: 'shared-trace' })
      await sendEnvelope(port, 'GET /trace/second', { traceId: 'shared-trace' })

      await waitFor(() => {
        expect(screen.getAllByLabelText('View transaction event')).toHaveLength(2)
      })

      expect(screen.getByRole('heading', { name: 'Related trace items' })).not.toBeNull()
      expect(screen.getByText('1 related event')).not.toBeNull()
      expect(screen.getByRole('button', { name: 'View related GET /trace/second' })).not.toBeNull()
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

  test('summarizes the selected HTTP event before its fields', async () => {
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

      const summary = await screen.findByLabelText('Event summary')
      expect(summary.textContent).toContain('201')
      expect(summary.textContent).toContain('6.17ms')
      expect(summary.textContent).toContain('http.server')
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
