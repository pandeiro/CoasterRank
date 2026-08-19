import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
import SignupPage from './pages/SignupPage'
import SubmitPage from './pages/SubmitPage'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<BoardPage />} />
              <Route path="/coasters/:slug" element={<CoasterDetailPage />} />
              <Route path="/parks/:slug" element={<ParkDetailPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route element={<RequireAuth />}>
                <Route path="/me" element={<MyCoastersPage />} />
                <Route path="/me/profile" element={<ProfilePage />} />
                <Route path="/submit" element={<SubmitPage />} />
              </Route>
              <Route element={<RequireAdmin />}>
                <Route path="/admin" element={<AdminPage />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
