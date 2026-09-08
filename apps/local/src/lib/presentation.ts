export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'missing'

export type ConnectionPresentation = {
  label: string
  tone: 'neutral' | 'success' | 'warning'
}

export function getConnectionPresentation(
  connection: ConnectionState
): ConnectionPresentation {
  switch (connection) {
    case 'connected':
      return { label: 'Connected to local receiver', tone: 'success' }
    case 'connecting':
      return { label: 'Connecting to local receiver', tone: 'neutral' }
    case 'reconnecting':
      return { label: 'Reconnecting to local receiver', tone: 'warning' }
    case 'missing':
      return { label: 'Waiting for a local stream', tone: 'neutral' }
  }
}
