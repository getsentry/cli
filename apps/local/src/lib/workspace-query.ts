import { parseAsString, parseAsStringEnum, useQueryStates } from 'nuqs'
import { eventFilterValues } from './workspace.ts'

const workspaceQueryParsers = {
  event: parseAsString,
  trace: parseAsString,
  filter: parseAsStringEnum(eventFilterValues).withDefault('all'),
  q: parseAsString.withDefault(''),
}

export function useWorkspaceQueryState() {
  const [state, setState] = useQueryStates(workspaceQueryParsers)

  return {
    eventId: state.event,
    filter: state.filter,
    query: state.q,
    traceId: state.trace,
    clearWorkspace: () =>
      setState({ event: null, q: null, trace: null }, { history: 'replace' }),
    resetWorkspace: () =>
      setState({ event: null, filter: null, trace: null }, { history: 'replace' }),
    selectEvent: (eventId: string) =>
      setState({ event: eventId, trace: null }, { history: 'push' }),
    selectTrace: (traceId: string) =>
      setState({ event: null, trace: traceId }, { history: 'push' }),
    setLiveFilter: (filter: (typeof eventFilterValues)[number]) =>
      setState({ event: null, filter, trace: null }, { history: 'replace' }),
    setSearchQuery: (query: string) =>
      setState({ q: query || null }, { history: 'replace' }),
  }
}
