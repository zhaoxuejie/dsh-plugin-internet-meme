export const defaults = { enabled: true, density: 'normal', fontSize: 'normal', opacity: 86, blur: 'soft', theme: 'classic', customLines: '', colorMode: 'event', showIcons: true, maxVisible: 4, diagnostics: false }
export type Settings = typeof defaults

/** Validate persisted settings, including valid JSON with incorrect field types. */
export function normalizeSettings(value: unknown): Settings {
  const data = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const choice = (key: keyof Settings, allowed: string[], fallback: string) => typeof data[key] === 'string' && allowed.includes(data[key] as string) ? data[key] as string : fallback
  const boolean = (key: keyof Settings, fallback: boolean) => typeof data[key] === 'boolean' ? data[key] as boolean : fallback
  return {
    enabled: boolean('enabled', defaults.enabled),
    density: choice('density', ['quiet', 'normal', 'busy'], defaults.density),
    fontSize: choice('fontSize', ['small', 'normal', 'large'], defaults.fontSize),
    opacity: typeof data.opacity === 'number' && Number.isFinite(data.opacity) ? Math.round(Math.min(100, Math.max(35, data.opacity))) : defaults.opacity,
    blur: choice('blur', ['none', 'soft', 'strong'], defaults.blur),
    theme: choice('theme', ['classic', 'workplace', 'anime', 'cyber', 'custom'], defaults.theme),
    customLines: typeof data.customLines === 'string' ? data.customLines.slice(0, 20100).split(/\r?\n/).map((line) => line.trim().slice(0, 200)).filter(Boolean).slice(0, 100).join('\n') : '',
    colorMode: choice('colorMode', ['event', 'mono'], defaults.colorMode),
    showIcons: boolean('showIcons', defaults.showIcons),
    maxVisible: typeof data.maxVisible === 'number' && [3, 4, 5].includes(data.maxVisible) ? data.maxVisible : defaults.maxVisible,
    diagnostics: boolean('diagnostics', defaults.diagnostics),
  }
}
