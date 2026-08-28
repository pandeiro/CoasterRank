import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { initSentry } from './lib/sentry'
import './index.css'
import App from './App.tsx'

initSentry()

console.log(`
██╗    ██╗███████╗██╗      ██████╗  ██████╗ ███╗   ███╗███████╗    ████████╗ ██████╗
██║    ██║██╔════╝██║     ██╔════╝ ██╔═══██╗████╗ ████║██╔════╝    ╚══██╔══╝██╔═══██╗
██║ █╗ ██║█████╗  ██║     ██║      ██║   ██║██╔████╔██║█████╗         ██║   ██║   ██║
██║███╗██║██╔══╝  ██║     ██║   ██║██║   ██║██║╚██╔╝██║██╔══╝         ██║   ██║   ██║
╚███╔███╔╝███████╗███████╗╚██████╔╝╚██████╔╝██║ ╚═╝ ██║███████╗       ██║   ╚██████╔╝
 ╚══╝╚══╝ ╚══════╝╚══════╝ ╚═════╝  ╚═════╝ ╚═╝     ╚═╝╚══════╝       ╚═╝    ╚═════╝

 █████╗   ██████╗  █████╗ ███████╗████████╗███████╗██████╗ ██████╗  █████╗ ███╗   ██╗██╗  ██╗
██╔════╝ ██╔═══██╗██╔══██╗██╔════╝╚══██╔══╝██╔════╝██╔══██╗██╔══██╗██╔══██╗████╗  ██║██║ ██╔╝
██║      ██║   ██║███████║███████╗   ██║   █████╗  ██████╔╝██████╔╝███████║██╔██╗ ██║█████╔╝
██║   ██║██║   ██║██╔══██║╚════██║   ██║   ██╔══╝  ██╔══██╗██╔══██╗██╔══██║██║╚██╗██║██╔═██╗
╚██████╔╝╚██████╔╝██║  ██║███████║   ██║   ███████╗██║  ██║██║  ██║██║  ██║██║ ╚████║██║  ██╗
 ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝

            🎢 CoasterRank v${__APP_VERSION__}
            🌐 https://github.com/pandeiro/CoasterRank
`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>Something went wrong</h1>
          <p>An unexpected error occurred. Please try reloading the page.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}
          >
            Reload Page
          </button>
        </div>
      }
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
