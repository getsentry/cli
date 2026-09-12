import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { NuqsAdapter } from 'nuqs/adapters/react'
import App from './App.tsx'

const localRouter = createBrowserRouter([
  { path: '/', Component: App },
  { path: '/live', Component: App },
  { path: '/traces', Component: App },
  { path: '/errors', Component: App },
  { path: '/logs', Component: App },
  { path: '/ai', Component: App },
  { path: '/envelopes', Component: App },
  { path: '/sdks', Component: App },
  { path: '/feedback', Component: App },
  { path: '/profiles', Component: App },
  { path: '*', element: <Navigate to="/live" replace /> },
])

export function LocalRouter() {
  return (
    <NuqsAdapter>
      <RouterProvider router={localRouter} />
    </NuqsAdapter>
  )
}
