import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { sentryVitePlugin } from '@sentry/vite-plugin'

function getBuildInfo() {
  const fallback = { version: '0.0.0', sha: 'unknown', dirty: false }

  try {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
    const version: string = pkg.version ?? fallback.version

    let sha: string
    try {
      sha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
    } catch {
      sha = 'unknown'
    }

    let dirty = false
    try {
      execSync('git diff --quiet', { stdio: 'ignore' })
      execSync('git diff --cached --quiet', { stdio: 'ignore' })
    } catch {
      dirty = true
    }

    return { version, sha, dirty }
  } catch {
    return fallback
  }
}

const buildInfo = getBuildInfo()
const versionString = `${buildInfo.version}-${buildInfo.sha}` + (buildInfo.dirty ? '-dirty' : '')

const hasSentryAuth = !!process.env.SENTRY_AUTH_TOKEN
const hasSentryOrg = !!process.env.SENTRY_ORG
const hasSentryProject = !!process.env.SENTRY_PROJECT
const sentryUploadEnabled = hasSentryAuth && hasSentryOrg && hasSentryProject

// Make the skip loud: this runs at build time (Vite config evaluation) so the
// warning is visible in Cloudflare Workers build logs. Silent skips were
// the root cause of shipped Sentry events without matching source maps.
// Vitest runs also evaluate this config, but there source maps are irrelevant
// — suppress the warning there to keep CI logs clean.
if (!process.env.VITEST) {
  if (!sentryUploadEnabled) {
    const missing = [
      !hasSentryAuth ? 'SENTRY_AUTH_TOKEN' : null,
      !hasSentryOrg ? 'SENTRY_ORG' : null,
      !hasSentryProject ? 'SENTRY_PROJECT' : null,
    ]
      .filter(Boolean)
      .join(', ')
    // Cloudflare Workers auto-deploy (and any CI build that intends to upload
    // source maps) must have these three vars set in the build environment.
    // See docs/RUNBOOKS.md "Connect Cloudflare" and docs/PLAN.md §8 / §9.4.
    console.warn(
      `[sentry] Source-map upload DISABLED — missing build env: ${missing}. ` +
        'Build will emit NO sourcemaps (sourcemap: false) and skip sentryVitePlugin. ' +
        'To fix: set SENTRY_AUTH_TOKEN (as a Cloudflare secret), SENTRY_ORG, and SENTRY_PROJECT in the Cloudflare Workers dashboard ' +
        '(Settings → Variables & Secrets → Build variables), plus VITE_SENTRY_DSN.',
    )
  } else {
    console.log(`[sentry] Source-map upload enabled for release ${versionString}`)
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  envDir: '..',
  plugins: [
    react(),
    sentryUploadEnabled
      ? sentryVitePlugin({
          org: process.env.SENTRY_ORG!,
          project: process.env.SENTRY_PROJECT!,
          release: {
            name: versionString,
          },
          sourcemaps: {
            assets: ['./dist/**'],
            filesToDeleteAfterUpload: ['**/*.map'],
          },
        })
      : null,
  ].filter(Boolean),
  define: {
    __APP_VERSION__: JSON.stringify(versionString),
    __GIT_SHA__: JSON.stringify(buildInfo.sha),
    __IS_DIRTY__: JSON.stringify(buildInfo.dirty),
  },
  build: {
    sourcemap: sentryUploadEnabled ? 'hidden' : false,
    rollupOptions: {
      input: {
        app: resolve('index.html'),
        design: resolve('design.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    // Dummy values so lib/supabase's env guard passes in tests; tests that
    // touch Supabase mock the module, so these never hit the network.
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
