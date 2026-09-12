# Local Command Search and Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Local Explorer keyboard-searchable and URL-addressable without changing the Local receiver contract.

**Architecture:** React Router v7 maps canonical Explorer paths to one Local workspace route. Nuqs v2 parses and updates shareable selection, filter, and query state. A ShadCN command dialog consumes existing retained telemetry and emits navigation/selection actions through a small route-state boundary.

**Tech Stack:** React 19, Vite 8, React Router v7, Nuqs v2, ShadCN `cmdk`/Radix Dialog, Vitest, Testing Library, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-12-local-command-search-routing-design.md`

## Global Constraints

- Keep `#stream` endpoint pairing, SSE lifecycle, 500-envelope memory bounds, and hosted read-only receiver behavior unchanged.
- Canonical paths are `/live`, `/traces`, `/errors`, `/logs`, `/ai`, `/envelopes`, `/sdks`, `/feedback`, and `/profiles`; `/` remains a compatible Live Activity entry point.
- Nuqs parameters are `event`, `trace`, `filter`, and `q`; omit defaults and replace history for text/filter changes.
- Use ShadCN primitives for the dialog and command list; do not implement focus trapping or fuzzy filtering by hand.
- Preserve the Local dense visual language and no-data connection states.

---

### Task 1: Establish router and ShadCN command dependencies

**Files:**
- Modify: `apps/local/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/local/src/components/ui/dialog.tsx`
- Create: `apps/local/src/components/ui/command.tsx`
- Create: `apps/local/src/router.tsx`
- Modify: `apps/local/src/main.tsx`
- Test: `apps/local/src/router.test.tsx`

**Interfaces:**
- Produces `localRouter`, a router created once outside React state.
- Produces ShadCN `Dialog`, `DialogContent`, `Command`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, and `CommandEmpty` exports.
- Router renders `LocalWorkspaceRoute` at `/` and every canonical workspace path.

- [ ] **Step 1: Add the router rendering test**

```tsx
test('renders Live Activity for the compatible root route', async () => {
  window.history.replaceState(null, '', '/')
  render(<LocalRouter />)
  expect(await screen.findByRole('heading', { name: 'Live Activity' })).not.toBeNull()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir apps/local exec vitest run src/router.test.tsx`

Expected: FAIL because `LocalRouter` does not exist.

- [ ] **Step 3: Install the supported dependencies and generate primitives**

```bash
pnpm --dir apps/local add react-router@^7 nuqs@^2 cmdk @radix-ui/react-dialog
pnpm --dir apps/local exec shadcn@latest add command dialog
```

Adapt the generated imports to the repository `@/` alias and existing `cn` helper. Create `src/router.tsx` with a static `createBrowserRouter` tree whose root and canonical paths use `LocalWorkspaceRoute`. Mount `<NuqsAdapter>` and `<RouterProvider router={localRouter}>` inside the existing theme provider in `main.tsx`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir apps/local exec vitest run src/router.test.tsx`

Expected: PASS, with `/` rendering the existing connection or Live Activity route without an uncaught router error.

- [ ] **Step 5: Commit the foundation**

```bash
git add apps/local/package.json pnpm-lock.yaml apps/local/src/main.tsx apps/local/src/router.tsx apps/local/src/components/ui/dialog.tsx apps/local/src/components/ui/command.tsx apps/local/src/router.test.tsx
git commit -m "feat(local): Add workspace router foundation"
```

### Task 2: Extract route and query state contracts

**Files:**
- Create: `apps/local/src/lib/workspace.ts`
- Create: `apps/local/src/lib/workspace-query.ts`
- Create: `apps/local/src/lib/workspace.test.ts`
- Modify: `apps/local/src/App.tsx`

**Interfaces:**
- `WorkspaceView` is the union of canonical Local views.
- `workspacePath(view: WorkspaceView): string` returns the canonical path.
- `workspaceForItem(item: LocalFeedItem): WorkspaceView` returns the view where an event belongs.
- `useWorkspaceQueryState()` returns `{ eventId, traceId, filter, query, setEventId, setTraceId, setFilter, setQuery }`.

- [ ] **Step 1: Write pure state-contract tests**

```ts
test('maps a raw envelope and an error to their canonical workspaces', () => {
  expect(workspaceForItem({ type: 'envelope', id: 'raw', text: '[]' })).toBe('envelopes')
  expect(workspaceForItem({ type: 'event', id: 'error', text: '{}', metadata: { level: 'error' } })).toBe('errors')
})

test('uses Live Activity as the root route and canonical path otherwise', () => {
  expect(workspaceFromPath('/')).toBe('live')
  expect(workspacePath('traces')).toBe('/traces')
})
```

- [ ] **Step 2: Run the state-contract test to verify it fails**

Run: `pnpm --dir apps/local exec vitest run src/lib/workspace.test.ts`

Expected: FAIL because the workspace module does not exist.

- [ ] **Step 3: Implement the pure workspace module and typed Nuqs hook**

```ts
export const workspaceViews = ['live', 'traces', 'errors', 'logs', 'ai', 'envelopes', 'sdks', 'feedback', 'profiles'] as const

export function workspacePath(view: WorkspaceView) {
  return view === 'live' ? '/live' : `/${view}`
}

const queryParsers = {
  event: parseAsString,
  trace: parseAsString,
  filter: parseAsStringEnum(eventFilters).withDefault('all'),
  q: parseAsString.withDefault(''),
}
```

Move `WorkspaceView`, `EventFilter`, navigation definitions, `matchesSearch`, `matchesEventFilter`, and event-to-workspace logic out of `App.tsx`. Ensure Nuqs setter options use `history: 'replace'` for `q` and `filter`, and `history: 'push'` for `event` and `trace`.

- [ ] **Step 4: Run state and existing integration tests**

Run: `pnpm --dir apps/local exec vitest run src/lib/workspace.test.ts src/App.integration.test.tsx`

Expected: PASS, including the existing receiver-backed Explorer cases.

- [ ] **Step 5: Commit the route-state boundary**

```bash
git add apps/local/src/lib/workspace.ts apps/local/src/lib/workspace-query.ts apps/local/src/lib/workspace.test.ts apps/local/src/App.tsx
git commit -m "ref(local): Extract workspace route state"
```

### Task 3: Add the global ShadCN command dialog

**Files:**
- Create: `apps/local/src/components/event-command-dialog.tsx`
- Create: `apps/local/src/components/event-command-dialog.test.tsx`
- Modify: `apps/local/src/App.tsx`

**Interfaces:**
- `EventCommandDialog` accepts `items`, `navigation`, `open`, `query`, `onOpenChange`, `onNavigate`, `onSelectItem`, and `onQueryChange`.
- `onNavigate(view)` navigates to a canonical route.
- `onSelectItem(item)` navigates to `workspaceForItem(item)` and sets `event`.

- [ ] **Step 1: Write failing command-dialog tests**

```tsx
const event = {
  id: 'transaction-1',
  type: 'transaction' as const,
  text: '{}',
  metadata: { title: 'GET /api/users/42', method: 'GET', route: '/api/users/42' },
}
const onSelectItem = vi.fn()

function CommandHarness() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  return <EventCommandDialog items={[event]} navigation={workspaceNavigation} open={open} onOpenChange={setOpen} onNavigate={vi.fn()} onQueryChange={setQuery} onSelectItem={onSelectItem} query={query} />
}

test('opens with Meta+K and selects a fuzzy-matched retained event', () => {
  render(<CommandHarness />)
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
  fireEvent.change(screen.getByPlaceholderText('Search events and views'), { target: { value: 'usr 42' } })
  fireEvent.click(screen.getByRole('option', { name: /GET \/api\/users\/42/i }))
  expect(onSelectItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'transaction-1' }))
})

test('includes a navigation result for Traces', () => {
  render(<EventCommandDialog items={[]} navigation={workspaceNavigation} open onOpenChange={vi.fn()} onNavigate={vi.fn()} onQueryChange={vi.fn()} onSelectItem={vi.fn()} query="" />)
  expect(screen.getByRole('option', { name: /Traces/i })).not.toBeNull()
})
```

- [ ] **Step 2: Run the command-dialog test to verify it fails**

Run: `pnpm --dir apps/local exec vitest run src/components/event-command-dialog.test.tsx`

Expected: FAIL because `EventCommandDialog` does not exist.

- [ ] **Step 3: Implement the dialog with generated ShadCN primitives**

```tsx
<CommandDialog open={open} onOpenChange={onOpenChange}>
  <CommandInput placeholder="Search events and views" value={query} onValueChange={onQueryChange} />
  <CommandList>
    <CommandGroup heading="Navigate">
      {navigation.map((view) => <CommandItem key={view.id} value={view.label} onSelect={() => onNavigate(view.id)}>{view.label}</CommandItem>)}
    </CommandGroup>
    <CommandGroup heading="Events">
      {items.map((item) => <CommandItem key={item.id} value={eventSearchValue(item)} onSelect={() => onSelectItem(item)}>{getMetadata(item).title}</CommandItem>)}
    </CommandGroup>
    <CommandEmpty>No matching events or views.</CommandEmpty>
  </CommandList>
</CommandDialog>
```

Build each item `value` from event type, title, method, route, operation, status, and trace ID so `cmdk` can score out-of-order partial terms. Replace the header input with a button labeled `Search events` and a `⌘K` hint. Register a window keydown handler for Meta/Ctrl+K only while the connected event workspace is available, preserving browser text-entry shortcuts in inputs and textareas.

- [ ] **Step 4: Run the command-dialog test to verify it passes**

Run: `pnpm --dir apps/local exec vitest run src/components/event-command-dialog.test.tsx`

Expected: PASS for keyboard invocation, fuzzy event selection, Escape close, and navigation results.

- [ ] **Step 5: Commit the command dialog**

```bash
git add apps/local/src/components/event-command-dialog.tsx apps/local/src/components/event-command-dialog.test.tsx apps/local/src/App.tsx
git commit -m "feat(local): Add global event command search"
```

### Task 4: Compose route-driven workspace selection

**Files:**
- Create: `apps/local/src/routes/local-workspace-route.tsx`
- Modify: `apps/local/src/App.tsx`
- Modify: `apps/local/src/App.integration.test.tsx`
- Test: `apps/local/src/App.integration.test.tsx`

**Interfaces:**
- `LocalWorkspaceRoute` owns route pathname translation and passes a typed view into the workspace shell.
- The workspace shell receives `view`, query values, and callbacks; it does not own `workspaceView`, `selectedItemId`, `selectedTraceId`, `filter`, or `searchQuery` React state.

- [ ] **Step 1: Write receiver-backed URL behavior tests**

```tsx
test('hydrates the Errors view and selected event from a shared URL', async () => {
  window.history.replaceState(null, '', '/errors?event=event-broken')
  renderViewer(port)
  await sendEnvelope(port, 'GET /broken', { type: 'event', level: 'error', eventId: 'event-broken' })
  expect(await screen.findByRole('heading', { name: 'Errors' })).not.toBeNull()
  expect(screen.getByTestId('event-detail').textContent).toContain('GET /broken')
})

test('navigates a global command result to its canonical workspace URL', async () => {
  await selectCommandResult('Envelope event-raw')
  expect(window.location.pathname).toBe('/envelopes')
  expect(new URLSearchParams(window.location.search).get('event')).toBe('event-raw')
})
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `pnpm --dir apps/local exec vitest run src/App.integration.test.tsx`

Expected: FAIL because route and query state are not yet wired to the workspace shell.

- [ ] **Step 3: Implement route-driven selections and compatibility behavior**

Use `useLocation` and `useNavigate` in `LocalWorkspaceRoute`. Use the Nuqs hook for URL state. Keep the existing `#stream` cleanup effect in the receiver shell, preserve root `/` as Live Activity, and route unknown paths back to `/live` without resetting the receiver. Derive fallback selection from the current telemetry snapshot when a query ID is missing.

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `pnpm --dir apps/local exec vitest run src/App.integration.test.tsx`

Expected: PASS for direct URLs, command-driven navigation, query filtering, invalid selection fallback, receiver connection, traces, envelopes, and all Explorer views.

- [ ] **Step 5: Commit the route-driven workspace**

```bash
git add apps/local/src/routes/local-workspace-route.tsx apps/local/src/App.tsx apps/local/src/App.integration.test.tsx
git commit -m "feat(local): Make Explorer state shareable"
```

### Task 5: Verify the complete Local workflow

**Files:**
- Modify only if verification exposes a defect in the files above.

**Interfaces:**
- No new interface; this task validates the full receiver-to-viewer path.

- [ ] **Step 1: Run all automated checks**

Run: `pnpm --dir apps/local test && pnpm --dir apps/local lint && pnpm --dir apps/local build && git diff --check`

Expected: all tests, lint, TypeScript, production build, and whitespace checks pass.

- [ ] **Step 2: Run a visual Local session**

Run: `pnpm --dir apps/local dev --host 127.0.0.1 --port 4173`

Open a fixture-backed receiver session, use Meta+K and Ctrl+K, select a transaction and raw envelope, reload a copied `/envelopes?event=event-raw` URL, use browser back/forward, and verify Escape restores focus to Search events.

- [ ] **Step 3: Commit any verification fix and push the branch**

```bash
git add apps/local/package.json pnpm-lock.yaml apps/local/src docs/superpowers/specs/2026-09-12-local-command-search-routing-design.md docs/superpowers/plans/2026-09-12-local-command-search-routing.md
git commit -m "fix(local): Polish command search routing"
git push origin codex/feat/local-observability-workspace
```
