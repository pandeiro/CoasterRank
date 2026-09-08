import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { initSentry } from './lib/sentry'
import { clearChunkReloadGuard } from './lib/chunk-recovery'
import './index.css'
import App from './App.tsx'
import ErrorFallback from './components/ErrorFallback'

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
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)

// A prior boot may have set the stale-chunk reload guard (lib/chunk-recovery).
// Reaching a healthy mount proves the reload fixed it, so re-arm one-shot
// recovery for the next deploy-window failure.
clearChunkReloadGuard()
