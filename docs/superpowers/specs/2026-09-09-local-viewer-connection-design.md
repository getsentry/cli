# Local Viewer Connection Landing

## Goal

Make a bare `local.sentry.dev` visit useful without weakening the existing
CLI-paired local receiver boundary. The common case should connect to a
running default receiver without a URL fragment; custom local and remote
streams remain an explicit user choice.

## Connection policy

The viewer resolves one endpoint in this order:

1. A valid CLI-provided `#stream` fragment.
2. A saved loopback endpoint from local storage.
3. The default receiver, `http://localhost:8969/stream`.

The UI removes the fragment from the address bar after reading it. A
successfully connected loopback endpoint is saved in local storage so a later
bare visit can reconnect. The default is saved only after it opens
successfully.

Users can submit an endpoint through the connection landing page. Loopback
`http` or `https` endpoints with a `/stream` path are accepted and persisted.
Remote endpoints must use `https`, have no embedded user credentials, and are
kept only in session storage. Remote streams connect directly from the browser;
`local.sentry.dev` never proxies them or receives their endpoint.

Remote servers are responsible for allowing the viewer origin with CORS. This
MVP does not support custom authorization headers because native `EventSource`
does not provide them. A user may paste an HTTPS stream URL with its own query
parameters when their receiver uses a URL-scoped token.

## User experience

When no receiver has opened yet, render one centered connection landing panel
instead of separate setup and empty-feed surfaces.

- Start by showing that the default receiver is being checked.
- When it opens, move directly to the normal event workspace and its
  `Waiting for events` state.
- When it cannot open, reveal a prefilled endpoint field, concise error text,
  a Connect button, and a copyable `sentry local serve --open` command.
- An Advanced disclosure explains custom local versus remote endpoints and the
  remote HTTPS requirement.
- A connected, empty workspace still offers a small Change receiver action,
  rather than forcing users to edit the browser URL.

The landing form has a visible label, validation feedback, keyboard submission,
and equivalent light and dark presentation.

## Components and boundaries

`apps/local/src/lib/spotlight.ts` owns endpoint parsing and classification. It
returns a normalized endpoint and persistence policy (`loopback` or `remote`)
without knowing about React or storage.

`App.tsx` owns resolution order, storage reads/writes, EventSource lifecycle,
and the state transition between connecting, connected, and failed states.
The connection landing component is presentational: it receives the input,
status, validation message, and callbacks. It does not create EventSources or
access storage directly.

The local CLI and receiver remain unchanged. Their existing `--open` fragment
continues to be the authoritative pairing path, and receiver CORS remains
limited to its existing read-only `/stream` policy for `local.sentry.dev`.

## Failure handling

Malformed URLs, non-loopback HTTP remote endpoints, credential-bearing URLs,
and paths other than `/stream` are rejected before a connection attempt. A
failed EventSource displays actionable status while retaining the entered URL.
Submitting another endpoint closes the prior EventSource before opening the
next one. Clearing the feed does not discard a selected receiver.

## Verification

- Pure tests cover source priority, loopback/remote classification, malformed
  endpoint rejection, persistence policy, and query-token preservation.
- Integration tests cover default connection, fallback form, manual local
  reconnection after reload, remote session-only behavior, error recovery, and
  clean EventSource replacement.
- Run the local app test suite, lint, and production build, plus the focused
  CLI local receiver tests.
- Manually verify the no-receiver, default-receiver, custom-receiver, and
  failed-receiver views in both light and dark themes.
