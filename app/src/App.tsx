import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import { AuthProvider } from './lib/auth'
import BoardPage from './pages/BoardPage'
import LoginPage from './pages/LoginPage'
import MyCoastersPage from './pages/MyCoastersPage'
import ProfilePage from './pages/ProfilePage'
import SignupPage from './pages/SignupPage'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<BoardPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route element={<RequireAuth />}>
                <Route path="/me" element={<MyCoastersPage />} />
                <Route path="/me/profile" element={<ProfilePage />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
