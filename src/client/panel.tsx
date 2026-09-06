import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  Enablement,
  EntryPlane,
  EntryRow,
  FiberPhase,
  HarnessVersionSource,
  InventoryWarning,
  PackageOrigin,
  PackageRow,
  PresetSummary,
  VersionInventory,
} from '../types.js'
import type { VersionInventoryLocaleKey } from './locales.js'
import { css } from './style.js'

/** Registration-side face: the tab reads the host through its registrant, not through fetch itself. */
export interface VersionInventoryInjected {
  /** Read one current inventory snapshot. */
  load: (signal?: AbortSignal) => Promise<VersionInventory>
  /**
   * The harness's active locale id, read at call time.
   *
   * `t` covers the copy, but a timestamp is formatted by Intl, and Intl's
   * default is the BROWSER's language — which is not the setting the user
   * changed. Reading DSH's own active locale keeps the whole tab on one
   * language instead of two.
   */
  activeLocale: () => string
}

/** Full component props assembled by the Settings slot renderer. */
export type VersionInventoryTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.versionInventory'>
  & InjectFace<VersionInventoryInjected>

/** The translate seat the renderer synthesizes from the declared namespace. */
type Translate = VersionInventoryTabProps['t']

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error', readonly message: string }
  | { readonly status: 'ready', readonly inventory: VersionInventory }

/** Which plane the list is restricted to. */
type PlaneFilter = 'all' | 'global' | 'preset'

const PHASE_KEYS = {
  pending: 'phasePending',
  loading: 'phaseLoading',
  active: 'phaseActive',
  failed: 'phaseFailed',
  unloading: 'phaseUnloading',
} satisfies Record<Exclude<FiberPhase, null>, VersionInventoryLocaleKey>

const SOURCE_KEYS = {
  install: 'sourceInstall',
  resolved: 'sourceResolved',
  inferred: 'sourceInferred',
  unknown: 'sourceUnknown',
} satisfies Record<HarnessVersionSource, VersionInventoryLocaleKey>

const GROUP_KEYS = {
  'third-party': 'groupThirdParty',
  harness: 'groupHarness',
  builtin: 'groupBuiltin',
} satisfies Record<PackageOrigin, VersionInventoryLocaleKey>

const PLANE_FILTER_KEYS = {
  all: 'planeAll',
  global: 'planeGlobalOnly',
  preset: 'planePresetOnly',
} satisfies Record<PlaneFilter, VersionInventoryLocaleKey>

/** Display name for one plane: the preset's own name, falling back to its id. */
function planeText(plane: EntryPlane, t: Translate): string {
  return plane.kind === 'global' ? t('planeGlobal') : plane.presetName ?? plane.presetId
}

/** Human phase text; a mount with no live root fiber says so rather than guessing. */
function phaseText(phase: FiberPhase, t: Translate): string {
  return t(phase === null ? 'phaseUnobserved' : PHASE_KEYS[phase])
}

/** Human enablement text, keeping `conditional` distinct from plainly disabled. */
function enablementText(row: EntryRow, t: Translate): string {
  if (row.enabled === 'conditional') return t('stateConditional')
  return row.enabled ? phaseText(row.fiberPhase, t) : t('stateDisabled')
}

/** The phase a package row shows: the worst state among its mounts, so a failure is never hidden. */
function summaryPhase(entries: readonly EntryRow[]): FiberPhase {
  const phases = entries.map(entry => entry.fiberPhase)
  if (phases.includes('failed')) return 'failed'
  if (phases.includes('active')) return 'active'
  return phases.find(phase => phase !== null) ?? null
}

/** A mount counts as live unless it is plainly disabled; `conditional` is undecided, not off. */
function isOn(enabled: Enablement): boolean {
  return enabled !== false
}

/**
 * Local-time reading of the collection timestamp, formatted for the harness's
 * active locale rather than the browser's.
 * @param iso - the collection timestamp.
 * @param locale - the harness's active locale id.
 * @returns the local time, or the raw value when it does not parse.
 */
function collectedText(iso: string, locale: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  try {
    return parsed.toLocaleTimeString(locale)
  } catch {
    // An unknown tag from a language pack must not blank the header.
    return parsed.toLocaleTimeString()
  }
}

/** Render one structured collection warning in the reader's language. */
function warningText(warning: InventoryWarning, t: Translate): string {
  switch (warning.kind) {
    case 'harness-unlocated':
      return t('warnHarnessUnlocated', { package: warning.package, scope: warning.scope })
    case 'unresolved-mounts':
      return t('warnUnresolved', { count: warning.count })
    case 'duplicate-packages':
      return t('warnDuplicates', { names: warning.names.join(', ') })
    case 'preset-roots-unreadable':
      return t('warnPresetRoots', { reason: warning.reason })
    case 'preset-inventory-unreadable':
      return t('warnPresetInventory', { reason: warning.reason })
  }
}

/** A stable key for one warning, so the list survives a refresh without remounting. */
function warningKey(warning: InventoryWarning): string {
  return warning.kind
}

/** One status dot plus its accessible name. */
function Dot({ phase, on, label }: { phase: FiberPhase, on: boolean, label: string }): ReactNode {
  return <span className={'dvi-dot ' + (on ? phase ?? '' : 'off')} role="img" aria-label={label} title={label}/>
}

/**
 * One mount's config summary — the only thing that tells two mounts of the
 * same package apart.
 */
function ConfigSummary({ entry, t }: { entry: EntryRow, t: Translate }): ReactNode {
  if (entry.config === null) {
    return <span className="muted" title={t('configHiddenTitle')}>{t('configHidden')}</span>
  }
  if (entry.config.length === 0) return <span className="muted">{t('configNone')}</span>
  return (
    <span className="dvi-config">
      {entry.config.map(field => (
        <span key={field.key} className="mono">
          {field.key}=
          <b className={field.redacted ? 'redacted' : undefined}>{field.value}</b>
        </span>
      ))}
      {entry.configOverflow > 0 && <span className="muted">+{entry.configOverflow}</span>}
    </span>
  )
}

/** The planes a package is mounted on, as compact tags. */
function PlaneTags({ entries, t }: { entries: readonly EntryRow[], t: Translate }): ReactNode {
  const global = entries.some(entry => entry.plane.kind === 'global')
  const presets = [...new Set(entries
    .filter(entry => entry.plane.kind === 'preset')
    .map(entry => planeText(entry.plane, t)))]
  return (
    <>
      {global && <span className="dvi-tag">{t('planeGlobal')}</span>}
      {presets.length > 2
        ? <span className="dvi-tag">{t('planePresetCount', { count: presets.length })}</span>
        : presets.map(name => <span key={name} className="dvi-tag preset">{name}</span>)}
    </>
  )
}

/** One expandable package row. */
function PackageCard({ row, t }: { row: PackageRow, t: Translate }): ReactNode {
  const live = row.entries.some(entry => isOn(entry.enabled))
  const phase = summaryPhase(row.entries)
  return (
    <details className="dvi-row">
      <summary>
        <Dot phase={phase} on={live} label={live ? phaseText(phase, t) : t('stateDisabled')}/>
        <span className="dvi-name mono">{row.name}</span>
        {row.duplicate && (
          <span className="dvi-tag bad" title={t('tagDuplicateTitle')}>{t('tagDuplicate')}</span>
        )}
        <PlaneTags entries={row.entries} t={t}/>
        {row.isBundle && <span className="dvi-tag">bundle</span>}
        {row.hasClientHalf && <span className="dvi-tag">web</span>}
        <span
          className={'dvi-ver' + (row.duplicate || row.versionDrift ? ' drift' : row.version === null ? ' none' : '')}
          title={row.versionDrift ? t('driftTitle') : undefined}
        >
          {row.version ?? t('versionUnknown')}
        </span>
      </summary>
      <dl className="dvi-detail">
        {row.description !== null && <><dt>{t('detailDescription')}</dt><dd>{row.description}</dd></>}
        <dt>{t('detailPath')}</dt>
        <dd className="mono">{row.path ?? t('pathUnresolved')}</dd>
        <dt>{t('detailMounts')}</dt>
        <dd>
          <ul className="dvi-entries">
            {row.entries.map((entry, index) => (
              <li key={(entry.entryId ?? entry.specifier) + '@' + String(index)}>
                <span className="dvi-entry-head">
                  <Dot phase={entry.fiberPhase} on={isOn(entry.enabled)} label={enablementText(entry, t)}/>
                  <span className="mono">{entry.entryId ?? t('entryNoId')}</span>
                  <span className="dvi-tag">{planeText(entry.plane, t)}</span>
                  <span className="muted">{enablementText(entry, t)}</span>
                  {entry.specifier !== row.name && <span className="mono muted">{entry.specifier}</span>}
                </span>
                <ConfigSummary entry={entry} t={t}/>
                {entry.condition !== null && (
                  <span className="mono muted" title={t('conditionTitle')}>
                    disabled: {entry.condition}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </dd>
      </dl>
    </details>
  )
}

/** One origin group; empty groups are not rendered at all. */
function Group(
  { origin, rows, open, t }:
  { origin: PackageOrigin, rows: readonly PackageRow[], open: boolean, t: Translate },
): ReactNode {
  if (rows.length === 0) return null
  return (
    <details className="dvi-group" open={open}>
      <summary>
        {t(GROUP_KEYS[origin])}
        <span className="muted">{t('countPackages', { count: rows.length })}</span>
      </summary>
      {/* Two copies of one package share a name, so the path is the identity. */}
      {rows.map(row => <PackageCard key={row.path ?? row.name} row={row} t={t}/>)}
    </details>
  )
}

/** The preset roster, so an empty preset plane is legible instead of just absent. */
function PresetRoster({ presets, t }: { presets: readonly PresetSummary[], t: Translate }): ReactNode {
  if (presets.length === 0) return null
  return (
    <details className="dvi-group">
      <summary>
        {t('rosterTitle')}
        <span className="muted">{t('rosterCount', { count: presets.length })}</span>
      </summary>
      {presets.map(preset => (
        <div key={preset.id} className="dvi-row dvi-preset">
          <span className="dvi-name">
            {preset.name ?? preset.id}
            {preset.name !== null && <span className="mono muted"> {preset.id}</span>}
          </span>
          {preset.isDefault && <span className="dvi-tag">{t('presetDefault')}</span>}
          <span className="dvi-tag">{t(preset.trust === 'system' ? 'presetSystem' : 'presetUser')}</span>
          {preset.broken === null
            ? <span className="dvi-ver">{t('presetRows', { count: preset.rowCount })}</span>
            : <span className="dvi-ver drift" title={preset.broken}>{t('presetBroken')}</span>}
        </div>
      ))}
    </details>
  )
}

/**
 * The Plugins settings tab: the running harness version, and the version of
 * every package mounted on either harness plane.
 * @param props - the slot-assembled props, carrying the registrant's `load` and `t`.
 * @returns the tab body.
 */
export function VersionInventoryTab({ load, activeLocale, t }: VersionInventoryTabProps): ReactNode {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)
  const [query, setQuery] = useState('')
  const [plane, setPlane] = useState<PlaneFilter>('all')

  useEffect(() => {
    const abort = new AbortController()
    setState({ status: 'loading' })
    load(abort.signal).then(
      inventory => { if (!abort.signal.aborted) setState({ status: 'ready', inventory }) },
      (error: unknown) => {
        if (abort.signal.aborted) return
        setState({ status: 'error', message: error instanceof Error ? error.message : '' })
      },
    )
    return () => { abort.abort() }
  }, [load, nonce])

  const refresh = useCallback(() => { setNonce(value => value + 1) }, [])

  const inventory = state.status === 'ready' ? state.inventory : undefined
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (inventory?.packages ?? [])
      // Restricting the plane also drops the mounts from the other plane, so a
      // package kept for one preset row does not still list its global entries.
      .map(row => plane === 'all'
        ? row
        : { ...row, entries: row.entries.filter(entry => entry.plane.kind === plane) })
      .filter(row => row.entries.length > 0)
      .filter(row => needle === ''
        || row.name.toLowerCase().includes(needle)
        || (row.version ?? '').toLowerCase().includes(needle)
        || row.entries.some(entry =>
          (entry.entryId ?? '').toLowerCase().includes(needle)
          || planeText(entry.plane, t).toLowerCase().includes(needle)))
  }, [inventory, query, plane, t])

  const byOrigin = useCallback(
    (origin: PackageOrigin) => filtered.filter(row => row.origin === origin),
    [filtered],
  )

  if (state.status === 'loading') {
    return <div className="dvi"><style>{css}</style><p className="dvi-empty">{t('loading')}</p></div>
  }
  if (state.status === 'error') {
    return (
      <div className="dvi">
        <style>{css}</style>
        <div className="dvi-error">
          <span>{t('loadFailed', { message: state.message })}</span>
          <button type="button" onClick={refresh}>{t('retry')}</button>
        </div>
      </div>
    )
  }

  const { harness, packages, presets, warnings, collectedAt } = state.inventory
  const mountCount = packages.reduce((total, row) => total + row.entries.length, 0)
  const thirdParty = packages.filter(row => row.origin === 'third-party').length
  const unhealthy = packages.filter(row =>
    row.entries.some(entry => entry.enabled === true && entry.fiberPhase !== 'active')).length
  const drifted = packages.filter(row => row.versionDrift).length
  const duplicated = [...new Set(packages.filter(row => row.duplicate).map(row => row.name))]
  const expanded = query.trim() !== '' || plane !== 'all'

  return (
    <div className="dvi">
      <style>{css}</style>

      <section className="dvi-head">
        <div>
          <h2>DeepSeek Harness</h2>
          <div className="dvi-version">
            <strong>{harness.version ?? t('versionUnknown')}</strong>
            <span className="dvi-tag">{t(SOURCE_KEYS[harness.source])}</span>
          </div>
          <dl className="dvi-facts">
            <dt>{t('nodeLabel')}</dt><dd className="mono">{harness.node} · {harness.platform}</dd>
            <dt>{t('homeLabel')}</dt><dd className="mono">{harness.home}</dd>
            {harness.path !== null && (
              <><dt>{t('installLabel')}</dt><dd className="mono">{harness.path}</dd></>
            )}
          </dl>
        </div>
        <div className="dvi-headside">
          <button type="button" onClick={refresh}>{t('refresh')}</button>
          <span className="muted">{t('collectedAt', { time: collectedText(collectedAt, activeLocale()) })}</span>
        </div>
      </section>

      <section className="dvi-metrics">
        <div className="dvi-metric"><b>{packages.length}</b><span>{t('metricPackages')}</span></div>
        <div className="dvi-metric"><b>{mountCount}</b><span>{t('metricMounts')}</span></div>
        <div className="dvi-metric"><b>{thirdParty}</b><span>{t('metricThirdParty')}</span></div>
        <div className={'dvi-metric' + (unhealthy > 0 ? ' bad' : '')}>
          <b>{unhealthy}</b><span>{t('metricNotRunning')}</span>
        </div>
      </section>

      {duplicated.length > 0 && (
        <p className="dvi-note bad">
          {t('noteDuplicates', { count: duplicated.length, names: duplicated.join(', ') })}
        </p>
      )}
      {drifted > 0 && (
        <p className="dvi-note">
          {t('noteDrift', { count: drifted, version: harness.version ?? t('versionUnknown') })}
        </p>
      )}
      {warnings.map(warning => (
        <p key={warningKey(warning)} className="dvi-note">{warningText(warning, t)}</p>
      ))}

      <div className="dvi-toolbar">
        <input
          type="search"
          value={query}
          placeholder={t('filterPlaceholder')}
          aria-label={t('filterLabel')}
          onChange={event => { setQuery(event.target.value) }}
        />
        <select
          value={plane}
          aria-label={t('planeLabel')}
          onChange={event => { setPlane(event.target.value as PlaneFilter) }}
        >
          {Object.entries(PLANE_FILTER_KEYS).map(([value, key]) => (
            <option key={value} value={value}>{t(key)}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0
        ? <p className="dvi-empty">{t('emptyFiltered')}</p>
        : (
          <>
            <Group origin="third-party" rows={byOrigin('third-party')} open t={t}/>
            <Group origin="harness" rows={byOrigin('harness')} open={expanded} t={t}/>
            <Group origin="builtin" rows={byOrigin('builtin')} open={expanded} t={t}/>
          </>
        )}

      <PresetRoster presets={presets} t={t}/>
    </div>
  )
}
