import { BrowserRouter, Route, Routes, useRouteError } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
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
import RiderPage from './pages/RiderPage'
import SignupPage from './pages/SignupPage'
import SubmitPage from './pages/SubmitPage'
import TermsPage from './pages/TermsPage'
import React from 'react'
import ErrorFallback from './components/ErrorFallback'

function RootErrorBoundary() {
  const error = useRouteError()

  React.useEffect(() => {
    if (error) {
      Sentry.captureException(error)
    }
  }, [error])

  return <ErrorFallback />
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      Sentry.captureException(error, { extra: { queryKey: query.queryKey } })
    },
  }),
})

export default function App() {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />} errorElement={<RootErrorBoundary />}>
                <Route path="/" element={<BoardPage />} />
                <Route path="/coasters/:slug" element={<CoasterDetailPage />} />
                <Route path="/parks/:slug" element={<ParkDetailPage />} />
                <Route path="/riders/:username" element={<RiderPage />} />
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
    </HelmetProvider>
  )
}
