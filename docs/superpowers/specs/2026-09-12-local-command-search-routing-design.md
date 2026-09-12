# Local Command Search and Routing Design

## Goal

Replace the inline Local event search with a keyboard-first ShadCN command dialog, and make every Explorer view, selected event or trace, filter, and search query URL-addressable.

## Constraints

- Preserve the dense Local visual language, bounded in-memory telemetry, existing SSE receiver lifecycle, CLI `#stream` pairing, and read-only remote stream behavior.
- Use ShadCN `Command` and `Dialog` primitives (`cmdk` and Radix Dialog), React Router v7, and Nuqs v2 with the React Router v7 adapter.
- The command dialog opens on click, `Meta+K`, and `Control+K`; it closes on Escape and restores focus to its trigger.
- Search is global: navigation targets and every retained Local event type appear in one fuzzy-search dialog.
- A copied URL carries workspace location and query state but never telemetry payloads. A selected ID that is absent from the active session falls back to the route's normal empty or first-item state.
- Do not change receiver endpoints, envelope decoding, storage bounds, CORS, or connection semantics.

## URL Contract

The root path remains a compatible entry point for CLI `#stream` handoff and resolves to Live Activity. Canonical Explorer paths are:

| View | Path |
| --- | --- |
| Live Activity | `/live` |
| Traces | `/traces` |
| Errors | `/errors` |
| Logs | `/logs` |
| AI | `/ai` |
| Envelopes | `/envelopes` |
| Sessions & SDKs | `/sdks` |
| Feedback | `/feedback` |
| Profiles | `/profiles` |

Nuqs manages only these typed query parameters:

| Parameter | Type | Meaning |
| --- | --- | --- |
| `event` | optional string | Selected non-trace event ID |
| `trace` | optional string | Selected trace ID on `/traces` |
| `filter` | `all`, `errors`, `transactions`, or `logs` | Live Activity filter; defaults to `all` |
| `q` | optional string | Global command term and current list filter |

Defaults are omitted from the URL. Updating a selection pushes browser history; editing `q` and changing `filter` replace the current history entry to avoid a history entry per keystroke or filter click.

## Components and Responsibilities

- `src/lib/workspace.ts` contains the `WorkspaceView` and `EventFilter` unions, canonical path map, navigation definitions, event-to-workspace mapping, and reusable matching helpers. It has no React dependencies.
- `src/lib/workspace-query.ts` wraps Nuqs parsers in `useWorkspaceQueryState`, returning typed `event`, `trace`, `filter`, and `q` values plus setters with the history policy above.
- `src/components/ui/dialog.tsx` and `src/components/ui/command.tsx` are generated ShadCN primitives. Application code consumes them rather than duplicating focus-trap or keyboard behavior.
- `src/components/event-command-dialog.tsx` renders navigation and event command groups. It receives existing event data and typed callbacks; it never owns receiver or URL state.
- `src/routes/local-workspace-route.tsx` composes the workspace shell, synchronizes React Router location with `WorkspaceView`, and coordinates selection/query callbacks. Existing detail, trace, connection, and receiver-control components remain responsible only for their domain UI.
- `src/router.tsx` defines the root compatibility route and the canonical workspace paths once. `main.tsx` mounts `RouterProvider` inside `NuqsAdapter` and the existing theme/analytics providers.

## Command Dialog Behavior

The header control is a button labeled `Search events` with a visible shortcut hint. It launches `EventCommandDialog`.

The dialog provides three result groups:

1. **Navigate** — every Explorer view, selected with route navigation.
2. **Events** — every retained event and raw envelope. Each result shows its type, primary title, and relevant route/status metadata. `cmdk` filters the combined text value so short, out-of-order terms can match titles, route, operation, trace ID, and type.
3. **Filter current view** — when text is present, applies `q` to the current route without selecting an event; this makes a filtered list copyable and shareable.

Choosing an event first derives its canonical workspace, navigates to the path, writes `event`, clears `trace`, marks the event as seen, and closes the dialog. Choosing a trace writes `trace` on `/traces`. Choosing a navigation result clears selection parameters but preserves the current `q`; URL hydration restores all supported state on initial load, browser back, and browser forward.

## Error and Empty States

- The command trigger stays unavailable while no connected Local receiver has retained events, matching the current connection landing behavior.
- If `event` or `trace` does not exist in the active session, no error is shown: the view displays its existing first available item or empty state.
- When `q` has no results, existing workspace empty-state copy is used and the command dialog displays ShadCN's empty-result state.
- Invalid query enum values fall back to `filter=all`; unknown paths resolve to Live Activity without changing receiver state.

## Tests and Verification

- Unit-test path/view conversion, event-to-workspace conversion, global matching terms, and typed query defaults.
- Add receiver-backed integration coverage for keyboard invocation, dialog navigation, selecting an event into its canonical route, URL hydration, back/forward state, and missing selected IDs.
- Run `pnpm --dir apps/local test`, `pnpm --dir apps/local lint`, `pnpm --dir apps/local build`, and `git diff --check`.
- Visually test a fixture-backed Local session: open via `Meta+K` and `Control+K`, fuzzy-find a transaction and a raw envelope, copy a URL, reload it, and confirm the command dialog focus/escape behavior.
