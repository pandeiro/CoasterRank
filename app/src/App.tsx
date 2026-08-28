import { BrowserRouter, Route, Routes, useRouteError } from 'react-router-dom'
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import Layout from './components/Layout'
import RequireAdmin from './components/RequireAdmin'
import RequireAuth from './components/RequireAuth'
import { AuthProvider } from './lib/auth'
import AdminPage from './pages/AdminPage'
import BoardPage from './pages/BoardPage'
import CoasterDetailPage from './pages/CoasterDetailPage'
import LoginPage from './pages/LoginPage'
import MyCoastersPage from './pages/MyCoastersPage'
import ParkDetailPage from './pages/ParkDetailPage'
import ProfilePage from './pages/ProfilePage'
import NotFoundPage from './pages/NotFoundPage'
import PrivacyPage from './pages/PrivacyPage'
import SignupPage from './pages/SignupPage'
import SubmitPage from './pages/SubmitPage'
import TermsPage from './pages/TermsPage'
import React from 'react'

function RootErrorBoundary() {
  const error = useRouteError() as Error

  React.useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Something went wrong</h1>
      <p style={{ marginBottom: '2rem' }}>An unexpected error occurred while loading this page.</p>
      <button
        onClick={() => window.location.reload()}
        style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}
      >
        Reload Page
      </button>
    </div>
  )
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error.name === 'AbortError') return
      Sentry.captureException(error)
    },
  }),
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />} errorElement={<RootErrorBoundary />}>
              <Route path="/" element={<BoardPage />} />
              <Route path="/coasters/:slug" element={<CoasterDetailPage />} />
              <Route path="/parks/:slug" element={<ParkDetailPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route element={<RequireAuth />}>
                <Route path="/me" element={<MyCoastersPage />} />
                <Route path="/me/profile" element={<ProfilePage />} />
                <Route path="/submit" element={<SubmitPage />} />
              </Route>
              <Route element={<RequireAdmin />}>
                <Route path="/admin/:tab?" element={<AdminPage />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
