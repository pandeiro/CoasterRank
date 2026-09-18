import { Helmet } from 'react-helmet-async'
import { Panel } from '../components/ui'
import {
  formatHeightM,
  formatSpeedKmh,
  useSettings,
  type ThemeMode,
  type Units,
} from '../lib/settings'

// Local-only settings: stored in this browser only (cr.settings.v1), no
// account, works logged out. Changes apply instantly — no save button.

const UNIT_OPTIONS: Array<{ value: Units; title: string; detail: string }> = [
  {
    value: 'metric',
    title: 'Metric',
    detail: 'Meters, km/h — how the catalog stores every stat',
  },
  {
    value: 'imperial',
    title: 'Imperial',
    detail: 'Feet, mph — converted for display, data stays metric',
  },
]

const THEME_OPTIONS: Array<{ value: ThemeMode; title: string; detail: string }> = [
  {
    value: 'system',
    title: 'System',
    detail: 'Follows your device — flips automatically with it',
  },
  { value: 'light', title: 'Light', detail: 'Cream canvas, always' },
  { value: 'dark', title: 'Dark', detail: 'Ink-navy surfaces, always' },
]

function OptionCard<T extends string>({
  group,
  value,
  checked,
  title,
  detail,
  onSelect,
}: {
  group: string
  value: T
  checked: boolean
  title: string
  detail: string
  onSelect: (value: T) => void
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
        checked
          ? 'border-accent-text/50 bg-accent/10'
          : 'border-line bg-surface-bright hover:border-muted/50'
      }`}
    >
      <input
        type="radio"
        name={group}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="mt-1 h-4 w-4 shrink-0 accent-[#0D6C80]"
      />
      <span>
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted">{detail}</span>
      </span>
    </label>
  )
}

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings()

  return (
    <div className="mx-auto max-w-2xl">
      <Helmet>
        <title>Settings — CoasterRank</title>
        <meta
          name="description"
          content="Display settings for CoasterRank: units (metric/imperial) and appearance (system/light/dark). Stored only on this device."
        />
      </Helmet>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
        This device only
      </p>
      <h1 className="display-heading text-3xl text-ink sm:text-4xl">Settings</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
        Stored in this browser — no account needed, nothing leaves your device. Changes apply
        instantly.
      </p>

      <Panel className="mt-6 p-5 sm:p-6">
        <fieldset>
          <legend className="section-heading">Units</legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {UNIT_OPTIONS.map((option) => (
              <OptionCard
                key={option.value}
                group="units"
                value={option.value}
                checked={settings.units === option.value}
                title={option.title}
                detail={option.detail}
                onSelect={(units) => updateSettings({ units })}
              />
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted" aria-live="polite">
            Preview — Steel Vengeance: {formatHeightM(61, settings.units)} tall ·{' '}
            {formatSpeedKmh(119, settings.units)}
          </p>
        </fieldset>
      </Panel>

      <Panel className="mt-4 p-5 sm:p-6">
        <fieldset>
          <legend className="section-heading">Appearance</legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {THEME_OPTIONS.map((option) => (
              <OptionCard
                key={option.value}
                group="appearance"
                value={option.value}
                checked={settings.theme === option.value}
                title={option.title}
                detail={option.detail}
                onSelect={(theme) => updateSettings({ theme })}
              />
            ))}
          </div>
        </fieldset>
      </Panel>
    </div>
  )
}
