import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  Enablement,
  EntryPlane,
  EntryRow,
  FiberPhase,
  HarnessVersionSource,
  PackageOrigin,
  PackageRow,
  PresetSummary,
  VersionInventory,
} from '../types.js'
import { css } from './style.js'

/** Registration-side face: the tab reads the host through its registrant, not through fetch itself. */
export interface VersionInventoryInjected {
  /** Read one current inventory snapshot. */
  load: (signal?: AbortSignal) => Promise<VersionInventory>
}

/** Full component props assembled by the Settings slot renderer. */
export type VersionInventoryTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & InjectFace<VersionInventoryInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error', readonly message: string }
  | { readonly status: 'ready', readonly inventory: VersionInventory }

/** Which plane the list is restricted to. */
type PlaneFilter = 'all' | 'global' | 'preset'

const PHASE_TEXT: Record<Exclude<FiberPhase, null>, string> = {
  pending: '等待中',
  loading: '加载中',
  active: '运行中',
  failed: '失败',
  unloading: '卸载中',
}

const SOURCE_TEXT: Record<HarnessVersionSource, string> = {
  install: '读自安装目录',
  resolved: '解析自 profile',
  inferred: '由已加载包推断',
  unknown: '未能确定',
}

const GROUP_TEXT: Record<PackageOrigin, string> = {
  'third-party': '第三方插件',
  harness: 'Harness 官方包',
  builtin: 'Cordis 内置',
}

const PLANE_FILTER_TEXT: Record<PlaneFilter, string> = {
  all: '全部平面',
  global: '仅全局平面',
  preset: '仅 preset 平面',
}

/** Display name for one plane: the preset's own name, falling back to its id. */
function planeText(plane: EntryPlane): string {
  return plane.kind === 'global' ? '全局' : plane.presetName ?? plane.presetId
}

/** Human phase text; a mount with no live root fiber says so rather than guessing. */
function phaseText(phase: FiberPhase): string {
  return phase === null ? '未观测' : PHASE_TEXT[phase]
}

/** Human enablement text, keeping `conditional` distinct from plainly disabled. */
function enablementText(row: EntryRow): string {
  if (row.enabled === 'conditional') return '条件启用'
  return row.enabled ? phaseText(row.fiberPhase) : '已停用'
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

/** Local-time reading of the collection timestamp. */
function collectedText(iso: string): string {
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleTimeString()
}

/** One status dot plus its accessible name. */
function Dot({ phase, on, label }: { phase: FiberPhase, on: boolean, label: string }): ReactNode {
  return <span className={'dvi-dot ' + (on ? phase ?? '' : 'off')} role="img" aria-label={label} title={label}/>
}

/** The planes a package is mounted on, as compact tags. */
function PlaneTags({ entries }: { entries: readonly EntryRow[] }): ReactNode {
  const global = entries.some(entry => entry.plane.kind === 'global')
  const presets = [...new Set(entries
    .filter(entry => entry.plane.kind === 'preset')
    .map(entry => planeText(entry.plane)))]
  return (
    <>
      {global && <span className="dvi-tag">全局</span>}
      {presets.length > 2
        ? <span className="dvi-tag">{presets.length} 个 preset</span>
        : presets.map(name => <span key={name} className="dvi-tag preset">{name}</span>)}
    </>
  )
}

/** One expandable package row. */
function PackageCard({ row }: { row: PackageRow }): ReactNode {
  const live = row.entries.some(entry => isOn(entry.enabled))
  return (
    <details className="dvi-row">
      <summary>
        <Dot
          phase={summaryPhase(row.entries)}
          on={live}
          label={live ? phaseText(summaryPhase(row.entries)) : '已停用'}
        />
        <span className="dvi-name mono">{row.name}</span>
        {row.duplicate && (
          <span className="dvi-tag bad" title="同一个包在本进程里存在多份副本">副本</span>
        )}
        <PlaneTags entries={row.entries}/>
        {row.isBundle && <span className="dvi-tag">bundle</span>}
        {row.hasClientHalf && <span className="dvi-tag">web</span>}
        <span
          className={'dvi-ver' + (row.duplicate || row.versionDrift ? ' drift' : row.version === null ? ' none' : '')}
          title={row.versionDrift ? '版本与当前 Harness 版本不一致' : undefined}
        >
          {row.version ?? '版本未知'}
        </span>
      </summary>
      <dl className="dvi-detail">
        {row.description !== null && <><dt>说明</dt><dd>{row.description}</dd></>}
        <dt>位置</dt>
        <dd className="mono">{row.path ?? '未解析到 package.json'}</dd>
        <dt>挂载</dt>
        <dd>
          <ul className="dvi-entries">
            {row.entries.map((entry, index) => (
              <li key={(entry.entryId ?? entry.specifier) + '@' + String(index)}>
                <Dot
                  phase={entry.fiberPhase}
                  on={isOn(entry.enabled)}
                  label={enablementText(entry)}
                />
                <span className="mono">{entry.entryId ?? '（未声明 id）'}</span>
                <span className="dvi-tag">{planeText(entry.plane)}</span>
                <span className="muted">{enablementText(entry)}</span>
                {entry.condition !== null && (
                  <span className="mono muted" title="该行自己的 !!js disabled 表达式">
                    disabled: {entry.condition}
                  </span>
                )}
                {entry.specifier !== row.name && <span className="mono muted">{entry.specifier}</span>}
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
  { origin, rows, open }: { origin: PackageOrigin, rows: readonly PackageRow[], open: boolean },
): ReactNode {
  if (rows.length === 0) return null
  return (
    <details className="dvi-group" open={open}>
      <summary>
        {GROUP_TEXT[origin]}
        <span className="muted">{rows.length} 个包</span>
      </summary>
      {/* Two copies of one package share a name, so the path is the identity. */}
      {rows.map(row => <PackageCard key={row.path ?? row.name} row={row}/>)}
    </details>
  )
}

/** The preset roster, so an empty preset plane is legible instead of just absent. */
function PresetRoster({ presets }: { presets: readonly PresetSummary[] }): ReactNode {
  if (presets.length === 0) return null
  return (
    <details className="dvi-group">
      <summary>
        Agent Preset 名册
        <span className="muted">{presets.length} 个 preset</span>
      </summary>
      {presets.map(preset => (
        <div key={preset.id} className="dvi-row dvi-preset">
          <span className="dvi-name">
            {preset.name ?? preset.id}
            {preset.name !== null && <span className="mono muted"> {preset.id}</span>}
          </span>
          {preset.isDefault && <span className="dvi-tag">默认</span>}
          <span className="dvi-tag">{preset.trust === 'system' ? '内置' : '用户'}</span>
          {preset.broken === null
            ? <span className="dvi-ver">{preset.rowCount} 行</span>
            : <span className="dvi-ver drift" title={preset.broken}>读取失败</span>}
        </div>
      ))}
    </details>
  )
}

/**
 * The Plugins settings tab: the running harness version, and the version of
 * every package mounted on either harness plane.
 * @param props - the slot-assembled props, carrying the registrant's `load`.
 * @returns the tab body.
 */
export function VersionInventoryTab({ load }: VersionInventoryTabProps): ReactNode {
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
        setState({ status: 'error', message: error instanceof Error ? error.message : '读取失败。' })
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
          || planeText(entry.plane).toLowerCase().includes(needle)))
  }, [inventory, query, plane])

  const byOrigin = useCallback(
    (origin: PackageOrigin) => filtered.filter(row => row.origin === origin),
    [filtered],
  )

  if (state.status === 'loading') {
    return <div className="dvi"><style>{css}</style><p className="dvi-empty">正在读取版本清单…</p></div>
  }
  if (state.status === 'error') {
    return (
      <div className="dvi">
        <style>{css}</style>
        <div className="dvi-error">
          <span>读取版本清单失败：{state.message}</span>
          <button type="button" onClick={refresh}>重试</button>
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
  const duplicated = new Set(packages.filter(row => row.duplicate).map(row => row.name))
  const expanded = query.trim() !== '' || plane !== 'all'

  return (
    <div className="dvi">
      <style>{css}</style>

      <section className="dvi-head">
        <div>
          <h2>DeepSeek Harness</h2>
          <div className="dvi-version">
            <strong>{harness.version ?? '版本未知'}</strong>
            <span className="dvi-tag">{SOURCE_TEXT[harness.source]}</span>
          </div>
          <dl className="dvi-facts">
            <dt>Node</dt><dd className="mono">{harness.node} · {harness.platform}</dd>
            <dt>DSH_HOME</dt><dd className="mono">{harness.home}</dd>
            {harness.path !== null && <><dt>安装位置</dt><dd className="mono">{harness.path}</dd></>}
          </dl>
        </div>
        <div className="dvi-headside">
          <button type="button" onClick={refresh}>刷新</button>
          <span className="muted">采集于 {collectedText(collectedAt)}</span>
        </div>
      </section>

      <section className="dvi-metrics">
        <div className="dvi-metric"><b>{packages.length}</b><span>已加载的包</span></div>
        <div className="dvi-metric"><b>{mountCount}</b><span>挂载点</span></div>
        <div className="dvi-metric"><b>{thirdParty}</b><span>第三方插件</span></div>
        <div className={'dvi-metric' + (unhealthy > 0 ? ' bad' : '')}>
          <b>{unhealthy}</b><span>未处于运行中</span>
        </div>
      </section>

      {duplicated.size > 0 && (
        <p className="dvi-note bad">
          有 {duplicated.size} 个包在本进程里存在多份副本（{[...duplicated].join('、')}）。
          Cordis 服务、品牌类型和 <code>instanceof</code> 都按运行时身份匹配，重复副本会静默失配 —— 展开对比它们的「位置」找出多出来的那份。
        </p>
      )}
      {drifted > 0 && (
        <p className="dvi-note">
          有 {drifted} 个官方包的版本与当前 Harness 版本（{harness.version}）不一致，已在列表中标出。
        </p>
      )}
      {warnings.map(warning => <p key={warning} className="dvi-note">{warning}</p>)}

      <div className="dvi-toolbar">
        <input
          type="search"
          value={query}
          placeholder="按包名、版本、挂载 id 或 preset 名过滤"
          aria-label="过滤版本清单"
          onChange={event => { setQuery(event.target.value) }}
        />
        <select
          value={plane}
          aria-label="按平面过滤"
          onChange={event => { setPlane(event.target.value as PlaneFilter) }}
        >
          {Object.entries(PLANE_FILTER_TEXT).map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0
        ? <p className="dvi-empty">没有匹配的包。</p>
        : (
          <>
            <Group origin="third-party" rows={byOrigin('third-party')} open/>
            <Group origin="harness" rows={byOrigin('harness')} open={expanded}/>
            <Group origin="builtin" rows={byOrigin('builtin')} open={expanded}/>
          </>
        )}

      <PresetRoster presets={presets}/>
    </div>
  )
}
