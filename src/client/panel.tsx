import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  FiberPhase,
  HarnessVersionSource,
  PackageOrigin,
  PackageRow,
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

/** Human phase text; a package with no live root fiber says so rather than guessing. */
function phaseText(phase: FiberPhase): string {
  return phase === null ? '未观测' : PHASE_TEXT[phase]
}

/** The phase a package row shows: the worst state among its entries, so a failure is never hidden. */
function summaryPhase(row: PackageRow): FiberPhase {
  const phases = row.entries.map(entry => entry.fiberPhase)
  if (phases.includes('failed')) return 'failed'
  if (phases.includes('active')) return 'active'
  return phases.find(phase => phase !== null) ?? null
}

/** Local-time reading of the collection timestamp. */
function collectedText(iso: string): string {
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleTimeString()
}

/** One status dot plus its accessible name. */
function Dot({ phase, enabled }: { phase: FiberPhase, enabled: boolean }): ReactNode {
  const label = enabled ? phaseText(phase) : '已停用'
  return <span className={'dvi-dot ' + (enabled ? phase ?? '' : 'off')} role="img" aria-label={label} title={label}/>
}

/** One expandable package row. */
function PackageCard({ row }: { row: PackageRow }): ReactNode {
  const drift = row.versionDrift
  return (
    <details className="dvi-row">
      <summary>
        <Dot phase={summaryPhase(row)} enabled={row.entries.some(entry => entry.enabled)}/>
        <span className="dvi-name mono">{row.name}</span>
        {row.isBundle && <span className="dvi-tag">bundle</span>}
        {row.hasClientHalf && <span className="dvi-tag">web</span>}
        {row.entries.length > 1 && <span className="dvi-tag">{row.entries.length} 个条目</span>}
        <span
          className={'dvi-ver' + (drift ? ' drift' : row.version === null ? ' none' : '')}
          title={drift ? '版本与当前 Harness 版本不一致' : undefined}
        >
          {row.version ?? '版本未知'}
        </span>
      </summary>
      <dl className="dvi-detail">
        {row.description !== null && <><dt>说明</dt><dd>{row.description}</dd></>}
        <dt>位置</dt>
        <dd className="mono">{row.path ?? '未解析到 package.json'}</dd>
        <dt>条目</dt>
        <dd>
          <ul className="dvi-entries">
            {row.entries.map(entry => (
              <li key={entry.entryId}>
                <Dot phase={entry.fiberPhase} enabled={entry.enabled}/>
                <span className="mono">{entry.entryId}</span>
                <span className="muted">{entry.enabled ? phaseText(entry.fiberPhase) : '已停用'}</span>
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
      {rows.map(row => <PackageCard key={row.name} row={row}/>)}
    </details>
  )
}

/**
 * The Plugins settings tab: the running harness version, and the version of
 * every package the Loader mounted.
 * @param props - the slot-assembled props, carrying the registrant's `load`.
 * @returns the tab body.
 */
export function VersionInventoryTab({ load }: VersionInventoryTabProps): ReactNode {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)
  const [query, setQuery] = useState('')

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
    const packages = inventory?.packages ?? []
    const needle = query.trim().toLowerCase()
    if (needle === '') return packages
    return packages.filter(row =>
      row.name.toLowerCase().includes(needle)
      || (row.version ?? '').toLowerCase().includes(needle)
      || row.entries.some(entry => entry.entryId.toLowerCase().includes(needle)))
  }, [inventory, query])

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

  const { harness, packages, warnings, collectedAt } = state.inventory
  const entryCount = packages.reduce((total, row) => total + row.entries.length, 0)
  const thirdParty = packages.filter(row => row.origin === 'third-party').length
  const unhealthy = packages.filter(row =>
    row.entries.some(entry => entry.enabled && entry.fiberPhase !== 'active')).length
  const drifted = packages.filter(row => row.versionDrift).length

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
        <div className="dvi-metric"><b>{entryCount}</b><span>Loader 条目</span></div>
        <div className="dvi-metric"><b>{thirdParty}</b><span>第三方插件</span></div>
        <div className={'dvi-metric' + (unhealthy > 0 ? ' bad' : '')}>
          <b>{unhealthy}</b><span>未处于运行中</span>
        </div>
      </section>

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
          placeholder="按包名、版本或条目 id 过滤"
          aria-label="过滤版本清单"
          onChange={event => { setQuery(event.target.value) }}
        />
      </div>

      {filtered.length === 0
        ? <p className="dvi-empty">没有匹配的包。</p>
        : (
          <>
            <Group origin="third-party" rows={byOrigin('third-party')} open/>
            <Group origin="harness" rows={byOrigin('harness')} open={query.trim() !== ''}/>
            <Group origin="builtin" rows={byOrigin('builtin')} open={query.trim() !== ''}/>
          </>
        )}
    </div>
  )
}
