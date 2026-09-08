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
// Password-reset pages stay eager like login/signup: the recovery email link
// lands here directly, so first paint shouldn't wait on a lazy chunk.
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
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
const SuggestEditPage = lazy(() => import('./pages/SuggestEditPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const TermsPage = lazy(() => import('./pages/TermsPage'))
import React from 'react'
import ErrorFallback from './components/ErrorFallback'
import { isChunkLoadError, reloadForChunkError } from './lib/chunk-recovery'

// A tab that spans a deploy lazily imports chunk hashes the deploy deleted
// (SPA fallback answers with HTML → dynamic-import failure). One guarded
// reload self-heals; the splash below only paints for the instant before the
// browser unloads. If recovery can't fire (already attempted, or storage
// unavailable) we fall through to the normal fallback and report it — a
// reload that did NOT fix a chunk error is genuinely unexpected.
function ChunkReloadSplash() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <p style={{ color: '#4A4A5A', fontFamily: 'system-ui, sans-serif' }}>Updating CoasterRank…</p>
    </div>
  )
}

function RootErrorBoundary() {
  const error = useRouteError()
  const chunkError = isChunkLoadError(error)
  const [recoveryExhausted, setRecoveryExhausted] = React.useState(false)

  React.useEffect(() => {
    if (!error) return
    if (!chunkError) {
      Sentry.captureException(error)
      return
    }
    if (!reloadForChunkError(error)) {
      setRecoveryExhausted(true)
      Sentry.captureException(error)
    }
  }, [error, chunkError])

  if (chunkError && !recoveryExhausted) {
    return <ChunkReloadSplash />
  }

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
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route element={<RequireAuth />}>
                  <Route path="/me" element={<MyCoastersPage />} />
                  <Route path="/me/profile" element={<ProfilePage />} />
                  <Route path="/submit" element={<SubmitPage />} />
                  <Route path="/coasters/:slug/suggest-edit" element={<SuggestEditPage />} />
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
