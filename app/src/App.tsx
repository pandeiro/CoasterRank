import { BrowserRouter, Route, Routes, useRouteError } from 'react-router-dom'
import { lazy } from 'react'
import { HelmetProvider } from 'react-helmet-async'
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import Layout from './components/Layout'
import RequireAdmin from './components/RequireAdmin'
import RequireAuth from './components/RequireAuth'
import { AuthProvider } from './lib/auth'
// Board + auth-critical routes stay in the entry chunk (first paint and
// login/signup must not wait on a lazy round-trip). Everything else splits:
// dnd-kit (MyCoastersPage) and the admin panels are the heavy lifts —
// newcomers landing on / or a shared /riders/* link never download them.
import BoardPage from './pages/BoardPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import NotFoundPage from './pages/NotFoundPage'

const AdminPage = lazy(() => import('./pages/AdminPage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))
const FaqPage = lazy(() => import('./pages/FaqPage'))
const CoasterDetailPage = lazy(() => import('./pages/CoasterDetailPage'))
const MyCoastersPage = lazy(() => import('./pages/MyCoastersPage'))
const ParkDetailPage = lazy(() => import('./pages/ParkDetailPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const RiderPage = lazy(() => import('./pages/RiderPage'))
const SubmitPage = lazy(() => import('./pages/SubmitPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const TermsPage = lazy(() => import('./pages/TermsPage'))
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
  // Mutations surface to per-call onError toasts; without this they would
  // never reach Sentry (thrown mutation errors don't touch the QueryCache).
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      Sentry.captureException(error, {
        extra: { mutationKey: mutation.options.mutationKey },
      })
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
                <Route path="/about" element={<AboutPage />} />
                <Route path="/faq" element={<FaqPage />} />
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
