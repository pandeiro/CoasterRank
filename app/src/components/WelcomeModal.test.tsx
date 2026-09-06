import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WelcomeModal from './WelcomeModal'
import { useAllCoasters } from '../lib/coasters'

vi.mock('../lib/coasters', () => ({
  useAllCoasters: vi.fn(),
}))

vi.mock('./ui/Avatar', () => ({
  default: () => <div data-testid="avatar" />,
}))

function exampleRows() {
  return Array.from({ length: 20 }, (_, i) => ({
    id: `c${i + 1}`,
    name: `Coaster ${i + 1}`,
    slug: `coaster-${i + 1}`,
    park_name: `Park ${i + 1}`,
    rank: i + 1,
  }))
}

function renderModal(props: Partial<React.ComponentProps<typeof WelcomeModal>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WelcomeModal
          username="coaster_fan"
          userId="u1"
          avatarUrl={null}
          onClose={vi.fn()}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('WelcomeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAllCoasters).mockReturnValue({ data: exampleRows() } as never)
  })

  it('greets the user and states the private-by-default promise', () => {
    renderModal()
    expect(screen.getByText("You're in, coaster_fan!")).toBeInTheDocument()
    expect(screen.getByText(/private by default/i)).toBeInTheDocument()
  })

  it('previews five example coasters from the live board', () => {
    renderModal()
    expect(screen.getByText('Example')).toBeInTheDocument()
    // Five sampled from the top 20 — every rendered name comes from the data.
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(5)
  })

  it('offers the optional avatar step without blocking', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /add a photo \(optional\)/i })).toBeInTheDocument()
  })

  it('closes via Start ranking', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal({ onClose })
    await user.click(screen.getByRole('button', { name: /start ranking/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('also dismisses via the board link so no exit path skips persistence', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal({ onClose })
    await user.click(screen.getByRole('link', { name: /see the live board first/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows a loading state while board data resolves', () => {
    vi.mocked(useAllCoasters).mockReturnValue({ data: undefined } as never)
    renderModal()
    expect(screen.getByText(/loading popular coasters/i)).toBeInTheDocument()
  })
})
