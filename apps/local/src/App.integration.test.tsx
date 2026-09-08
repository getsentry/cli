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

function envelope(transaction: string): string {
  return [
    JSON.stringify({ event_id: crypto.randomUUID() }),
    JSON.stringify({ type: 'transaction' }),
    JSON.stringify({ transaction, timestamp: 1_700_000_000 }),
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

async function sendEnvelope(port: number, transaction: string) {
  const response = await fetch(`http://127.0.0.1:${port}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': SENTRY_CONTENT_TYPE },
    body: envelope(transaction),
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

  test('renders live transactions as collapsed, expandable JSON entries', async () => {
    const { server, port } = await startReceiver()

    try {
      renderViewer(port)
      await screen.findByText('Connected to local receiver')

      await sendEnvelope(port, 'GET /live')
      await screen.findByLabelText('View transaction event')
      await sendEnvelope(port, 'GET /live-2')

      await waitFor(() => {
        expect(screen.getAllByLabelText('View transaction event')).toHaveLength(2)
      })
      const disclosures = screen.getAllByLabelText('View transaction event')
      expect(disclosures[0]?.closest('details')?.open).toBe(false)

      fireEvent.click(disclosures[0]!)

      expect(disclosures[0]?.closest('details')?.open).toBe(true)
      const code = await screen.findByTestId('highlighted-json')
      expect(code.textContent).toContain('GET /live')
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
      const disclosure = await screen.findByLabelText('View transaction event')
      fireEvent.click(disclosure)
      expect((await screen.findByTestId('highlighted-json')).textContent).toContain(
        'GET /buffered'
      )
    } finally {
      cleanup()
      await stopReceiver(server)
    }
  })
})
