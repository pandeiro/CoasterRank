import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BoardPage from './pages/BoardPage'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<BoardPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
