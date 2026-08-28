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

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  envDir: '..',
  plugins: [
    react(),
    process.env.SENTRY_AUTH_TOKEN
      ? sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
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
    sourcemap: true,
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
