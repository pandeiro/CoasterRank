import * as Sentry from '@sentry/react'
import React from 'react'
import {
  useLocation,
  useNavigationType,
  createRoutesFromChildren,
  matchRoutes,
} from 'react-router-dom'

let replayStarted = false

export function startReplay() {
  if (replayStarted) return
  const replay = Sentry.getReplay()
  if (!replay) return
  replay.start()
  replayStarted = true
}

export function stopReplay() {
  if (!replayStarted) return
  const replay = Sentry.getReplay()
  if (!replay) return
  replay.stop()
  replayStarted = false
}

export function initSentry() {
  // Only initialize in production builds
  if (!import.meta.env.PROD) {
    return
  }

  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) {
    console.warn('[Sentry] VITE_SENTRY_DSN is missing; skipping initialization.')
    return
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: __APP_VERSION__,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect: React.useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  })
}
