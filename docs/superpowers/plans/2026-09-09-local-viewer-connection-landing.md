# Local Viewer Connection Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Connect a bare Local viewer to its default receiver and provide an explicit, safe form for custom local and HTTPS remote streams.

**Architecture:** \`lib/spotlight.ts\` owns normalized endpoint parsing and persistence classification. A presentational connection landing owns form rendering only. \`App.tsx\` resolves source priority, owns storage and the replaceable EventSource, and switches between the landing and the read-only workspace.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, Vitest, Testing Library, native EventSource.

**Spec:** \`docs/superpowers/specs/2026-09-09-local-viewer-connection-design.md\`

## Global Constraints

- Preserve CLI \`#stream\` pairing and remove a supplied fragment from the address bar after reading it.
- The default endpoint is exactly \`http://localhost:8969/stream\`.
- Persist only successfully opened loopback endpoints in local storage and remote endpoints in session storage.
- Accept loopback HTTP/HTTPS or remote HTTPS URLs ending in \`/stream\`, reject credentials and fragments, and preserve explicit remote query parameters.
- Remote streams connect directly from the browser; do not change receiver CORS, add server proxies, mutation APIs, or custom EventSource headers.
- Preserve the bounded 500-item feed and all existing workspace behavior.

---

## File Structure

- \`apps/local/src/lib/spotlight.ts\`: stream parsing, classification, priority, and storage-key constants.
- \`apps/local/src/lib/spotlight.test.ts\`: pure parsing and priority assertions.
- \`apps/local/src/components/connection-landing.tsx\`: accessible form and default-probe/failure presentation.
- \`apps/local/src/App.tsx\`: endpoint state, storage, EventSource lifecycle, and visibility transitions.
- \`apps/local/src/App.integration.test.tsx\`: default probe, form, persistence, recovery, and workspace regression coverage.

### Task 1: Add the stream endpoint model

**Files:**
- Modify: \`apps/local/src/lib/spotlight.ts\`
- Modify: \`apps/local/src/lib/spotlight.test.ts\`

**Interfaces:**
- Produces: \`DEFAULT_STREAM_URL\`, \`REMOTE_STREAM_STORAGE_KEY\`, \`StreamEndpointKind\`, \`StreamEndpoint\`, \`parseStreamEndpoint(value)\`, and \`resolveInitialStreamUrl(hash, savedLoopback, savedRemote)\`.
- Consumes: Existing loopback validation and hash parsing.

- [x] **Step 1: Write failing pure tests**

~~~ts
test('classifies the default stream as loopback', () => {
  expect(DEFAULT_STREAM_URL).toBe('http://localhost:8969/stream')
  expect(parseStreamEndpoint(DEFAULT_STREAM_URL)).toEqual({
    url: DEFAULT_STREAM_URL,
    kind: 'loopback',
  })
})

test('accepts HTTPS remote streams with a query token', () => {
  expect(parseStreamEndpoint('https://receiver.example/stream?token=abc')).toEqual({
    url: 'https://receiver.example/stream?token=abc',
    kind: 'remote',
  })
})

test.each([
  'http://receiver.example/stream',
  'https://user:pass@receiver.example/stream',
  'https://receiver.example/other',
  'https://receiver.example/stream#fragment',
])('rejects unsafe endpoint %s', (url) => {
  expect(parseStreamEndpoint(url)).toBeUndefined()
})
~~~

- [x] **Step 2: Run the test to verify it fails**

Run: \`pnpm --filter local exec vitest run src/lib/spotlight.test.ts\`

Expected: FAIL because the endpoint model exports do not exist.

- [x] **Step 3: Add normalized parsing and priority**

~~~ts
export const DEFAULT_STREAM_URL = 'http://localhost:8969/stream'
export const REMOTE_STREAM_STORAGE_KEY = 'sentry.local.remote-stream-url'
export type StreamEndpointKind = 'loopback' | 'remote'
export type StreamEndpoint = { url: string; kind: StreamEndpointKind }

export function parseStreamEndpoint(value: string | null): StreamEndpoint | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.pathname !== '/stream' || url.username || url.password || url.hash) return undefined
    if (isLoopbackHost(url.hostname) && ['http:', 'https:'].includes(url.protocol)) {
      return { url: url.toString(), kind: 'loopback' }
    }
    return url.protocol === 'https:' ? { url: url.toString(), kind: 'remote' } : undefined
  } catch {
    return undefined
  }
}
~~~

\`resolveInitialStreamUrl\` must prefer a valid fragment, then saved loopback, then saved remote, then the default. Existing hash and local-storage helpers remain URL-string compatibility wrappers.

- [x] **Step 4: Add priority assertions and run the pure suite**

~~~ts
expect(resolveInitialStreamUrl('#stream=http%3A%2F%2Flocalhost%3A9000%2Fstream', null, null))
  .toBe('http://localhost:9000/stream')
expect(resolveInitialStreamUrl('', 'http://127.0.0.1:8970/stream', null))
  .toBe('http://127.0.0.1:8970/stream')
expect(resolveInitialStreamUrl('', null, null)).toBe(DEFAULT_STREAM_URL)
~~~

Run: \`pnpm --filter local exec vitest run src/lib/spotlight.test.ts\`

Expected: PASS, including envelope decoding and bounded-feed coverage.

- [x] **Step 5: Commit**

~~~bash
git add apps/local/src/lib/spotlight.ts apps/local/src/lib/spotlight.test.ts
git commit -m "feat(local): Classify custom stream endpoints"
~~~

### Task 2: Create the connection landing

**Files:**
- Create: \`apps/local/src/components/connection-landing.tsx\`
- Modify: \`apps/local/src/App.integration.test.tsx\`

**Interfaces:**
- Produces: \`ConnectionLanding(props)\`.
- Consumes: \`phase: 'probing' | 'failed' | 'editing'\`, \`endpoint\`, optional \`error\`, and callbacks to edit/submit the endpoint and copy the CLI command.

- [x] **Step 1: Write failing form interaction tests**

~~~tsx
renderViewerWithoutSavedStream()
await screen.findByText('Looking for Sentry Local')
await screen.findByRole('alert', { name: 'Could not connect to the default receiver' })

const input = screen.getByLabelText('Receiver endpoint')
expect(input.getAttribute('value')).toBe('http://localhost:8969/stream')
fireEvent.change(input, { target: { value: 'http://127.0.0.1:9000/stream' } })
fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
~~~

Also assert one primary heading, a command-copy button, an Advanced disclosure, and readable validation for plain-HTTP remote input.

- [x] **Step 2: Run the integration test to verify it fails**

Run: \`pnpm --filter local exec vitest run src/App.integration.test.tsx\`

Expected: FAIL because the landing, receiver field, and Connect action do not exist.

- [x] **Step 3: Add the presentational component**

~~~tsx
export type ConnectionLandingProps = {
  phase: 'probing' | 'failed' | 'editing'
  endpoint: string
  error?: string
  onEndpointChange: (value: string) => void
  onConnect: () => void
  onCopyCommand: () => void
}

export function ConnectionLanding(props: ConnectionLandingProps) {
  return (
    <section aria-labelledby="connection-title">
      <h1 id="connection-title">Connect a receiver</h1>
      <label htmlFor="receiver-endpoint">Receiver endpoint</label>
      <input
        id="receiver-endpoint"
        value={props.endpoint}
        onChange={(event) => props.onEndpointChange(event.target.value)}
      />
      <button type="button" onClick={props.onConnect}>Connect</button>
    </section>
  )
}
~~~

Use one centered compact panel for probing, failure, and editing. Submit on Enter. The Advanced disclosure explains remote HTTPS and CORS requirements.

- [x] **Step 4: Rerun the integration test and commit**

Run: \`pnpm --filter local exec vitest run src/App.integration.test.tsx\`

Expected: PASS with selected-event, search, filtering, clear-feed, JSON, and waterfall regressions.

~~~bash
git add apps/local/src/components/connection-landing.tsx apps/local/src/App.integration.test.tsx
git commit -m "feat(local): Add receiver connection landing"
~~~

### Task 3: Integrate storage and replaceable EventSource lifecycle

**Files:**
- Modify: \`apps/local/src/App.tsx\`
- Modify: \`apps/local/src/App.integration.test.tsx\`

**Interfaces:**
- Consumes: Task 1 endpoint model and Task 2 landing callbacks.
- Produces: EventSource replacement without reload and correct local/session persistence after \`open\`.

- [x] **Step 1: Write failing lifecycle tests**

~~~tsx
test('saves a successful custom loopback endpoint for a future bare visit', async () => {
  const { port } = await startReceiver()
  renderViewerWithoutSavedStream()
  submitEndpoint(\`http://127.0.0.1:\${port}/stream\`)
  await screen.findByText('Connected to local receiver')
  expect(window.localStorage.getItem(STREAM_STORAGE_KEY)).toBe(\`http://127.0.0.1:\${port}/stream\`)
})

test('keeps an explicit remote endpoint in session storage only', () => {
  renderViewerWithoutSavedStream()
  submitEndpoint('https://receiver.example/stream?token=abc')
  expect(window.localStorage.getItem(STREAM_STORAGE_KEY)).toBeNull()
  expect(window.sessionStorage.getItem(REMOTE_STREAM_STORAGE_KEY)).toBe(
    'https://receiver.example/stream?token=abc'
  )
})
~~~

Add a failed-default-to-custom-recovery test and a connected-empty-state Change receiver test.

- [x] **Step 2: Run the integration test to verify it fails**

Run: \`pnpm --filter local exec vitest run src/App.integration.test.tsx\`

Expected: FAIL because \`streamUrl\` is immutable and remote persistence does not exist.

- [x] **Step 3: Make the endpoint state replaceable in \`App.tsx\`**

~~~tsx
const [streamUrl, setStreamUrl] = useState(() => resolveInitialStreamUrl(
  window.location.hash, getSavedLoopbackStream(), getSavedRemoteStream()
))
const [connectionPhase, setConnectionPhase] = useState<'probing' | 'failed' | 'connected'>('probing')
const [draftEndpoint, setDraftEndpoint] = useState(streamUrl)

function connectToDraft() {
  const endpoint = parseStreamEndpoint(draftEndpoint)
  if (!endpoint) return setConnectionError('Enter a loopback stream or an HTTPS remote stream ending in /stream.')
  setStreamUrl(endpoint.url)
  setConnectionPhase('probing')
}
~~~

On EventSource \`open\`, persist by endpoint kind. On \`error\`, retain the input and show the form without clearing feed items. Cleanup closes the old source. Keep fragment removal in its initial effect. Offer Change receiver from the connected empty workspace.

- [x] **Step 4: Run all app quality gates**

Run: \`pnpm --filter local exec vitest run && pnpm --filter local run lint && pnpm --filter local run build\`

Expected: PASS with no lint warnings and a successful Vite build.

- [x] **Step 5: Run CLI regression tests and manually verify both themes**

Run: \`pnpm --filter sentry exec vitest run test/commands/local/server.test.ts test/commands/local/run.test.ts test/commands/local/ui.test.ts\`

Expected: PASS; CLI fragments, hosted read-only CORS, IPv6, and NDJSON behavior remain unchanged.

Run: \`pnpm --filter local dev\`

Verify default success, default failure form, custom loopback reload persistence, remote session-only selection, invalid remote feedback, command copy, and landing/workspace readability in light and dark mode.

- [x] **Step 6: Commit**

~~~bash
git add apps/local/src/App.tsx apps/local/src/App.integration.test.tsx
git commit -m "feat(local): Connect viewers without CLI pairing"
~~~
