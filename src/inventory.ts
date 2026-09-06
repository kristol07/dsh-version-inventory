/**
 * Host-side collection: read both harness planes — the profile's own Loader
 * tree and every agent preset's composition — resolve each mount back to the
 * package manifest that owns its module, and report the versions.
 *
 * Nothing here is cached. The Loader already maintains `Entry.fiber` and
 * `Fiber.state`, and the preset registry deliberately re-reads its roots on
 * every call, so a second lifecycle truth would only be one more thing to keep
 * synchronized; the manifest reads are a few dozen `readFileSync` calls behind
 * a user gesture, not a hot path.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {
  ConfigField,
  EntryPlane,
  EntryRow,
  FiberPhase,
  HarnessRow,
  HarnessVersionSource,
  PackageOrigin,
  PackageRow,
  PresetSummary,
  VersionInventory,
} from './types.js'

/** The npm package that owns the `dsh` bin — the thing whose version IS the harness version. */
const HARNESS_PACKAGE = '@deepseek-ai/dsh'

/** Manifest-name prefix that marks a package as shipped with the harness. */
const HARNESS_SCOPE = '@deepseek-ai/'

/**
 * Runtime mirror of Cordis's `FiberState`, which is a `const enum` and so has
 * no runtime object to read. DISPOSED maps to null: a disposed fiber is not a
 * live root fiber, and reporting it as a phase would overstate what is running.
 */
const FIBER_PHASE: Record<number, FiberPhase> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
}

/** The one plane marker every global Loader entry shares. */
const GLOBAL_PLANE: EntryPlane = { kind: 'global' }

/** Top-level config fields reported per mount; the rest are counted, not listed. */
const CONFIG_FIELD_LIMIT = 8

/** Longest string value shown before it is truncated. */
const CONFIG_VALUE_LIMIT = 60

/** Nested object keys named in a shape marker before it elides the rest. */
const CONFIG_SHAPE_KEYS = 3

/**
 * Key fragments that make a value a credential rather than a setting. Matched
 * against the key with its separators stripped, so `apiKey`, `api_key`, and
 * `API-KEY` all hit. Over-redaction is the safe direction here: withholding a
 * benign value costs a reader one glance at the config file, while printing a
 * token costs a rotation.
 */
const SECRET_KEY_FRAGMENTS = ['key', 'token', 'secret', 'password', 'passwd', 'credential', 'auth']

/** Whether a config key names something that must not be printed. */
function isSecretKey(key: string): boolean {
  const flattened = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return SECRET_KEY_FRAGMENTS.some(fragment => flattened.includes(fragment))
}

/**
 * Render one config value for display, without ever printing a nested value.
 * @param value - the raw config value.
 * @returns a scalar's own text (truncated), or a shape marker.
 */
function renderConfigValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return '[' + String(value.length) + ']'
  if (typeof value === 'object') {
    const keys = Object.keys(value as object)
    if (keys.length === 0) return '{}'
    const shown = keys.slice(0, CONFIG_SHAPE_KEYS).join(', ')
    return '{' + shown + (keys.length > CONFIG_SHAPE_KEYS ? ', …' : '') + '}'
  }
  const text = String(value)
  return text.length > CONFIG_VALUE_LIMIT ? text.slice(0, CONFIG_VALUE_LIMIT) + '…' : text
}

/**
 * Summarize a mount's config into displayable top-level fields.
 * @param config - the raw config the entry declares.
 * @returns the fields shown and the count of those left out.
 */
function summarizeConfig(config: unknown): { fields: ConfigField[], overflow: number } {
  if (config === undefined || config === null) return { fields: [], overflow: 0 }
  if (typeof config !== 'object' || Array.isArray(config)) {
    return { fields: [{ key: 'config', value: renderConfigValue(config), redacted: false }], overflow: 0 }
  }
  const entries = Object.entries(config as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
  const fields = entries.slice(0, CONFIG_FIELD_LIMIT).map(([key, value]) => {
    const redacted = isSecretKey(key)
    return { key, value: redacted ? '***' : renderConfigValue(value), redacted }
  })
  return { fields, overflow: Math.max(0, entries.length - fields.length) }
}

/** The manifest fields this plugin reads. Everything else in a package.json is ignored. */
interface Manifest {
  readonly name?: unknown
  readonly version?: unknown
  readonly description?: unknown
  readonly dsh?: {
    readonly bundle?: { readonly patch?: unknown }
    readonly client?: { readonly platform?: unknown }
  }
}

/** A located package manifest plus the directory that owns it. */
interface LocatedPackage {
  readonly dir: string
  readonly manifest: Manifest
}

/**
 * Read and parse one package.json.
 * @param path - absolute manifest path.
 * @returns the manifest, or undefined when it is missing or malformed.
 */
function readManifest(path: string): Manifest | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return parsed as Manifest
  } catch {
    return undefined
  }
}

/**
 * Walk up from a module file to the nearest ancestor package.json that names
 * itself. This deliberately ignores the `exports` map: a package that does not
 * publish `./package.json` still has one on disk, and the directory walk is the
 * only resolver that always reaches it.
 * @param from - absolute directory inside the package.
 * @param expectedName - when given, only a manifest declaring this name matches.
 * @returns the owning package, or undefined when the walk reaches the root.
 */
function nearestPackage(from: string, expectedName?: string): LocatedPackage | undefined {
  let dir = from
  while (true) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      const manifest = readManifest(candidate)
      const name = manifest?.name
      if (manifest !== undefined && typeof name === 'string'
        && (expectedName === undefined || name === expectedName)) {
        return { dir, manifest }
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** Node 22/23 internal module loader surface. */
interface ResolverV1 {
  readonly version?: string
  resolveSync(specifier: string, parentURL: string, attributes: object): { url: string }
}

/** Node 24+ internal module loader surface. */
interface ResolverV2 {
  readonly version: 'v2'
  resolveSync(parentURL: string, request: { specifier: string, attributes: object }): { url: string }
}

/** The Loader surface this module reads; narrower than the full service. */
interface LoaderFace {
  readonly internal?: unknown
}

/**
 * Resolve one module specifier against one base. Loader internals come first
 * because they honor the process's active ESM hooks (a source launch runs
 * plugins through tsx); the `require` fallback covers a runtime that exposes no
 * internals.
 * @param loader - the live Loader service.
 * @param specifier - the module specifier a mount names.
 * @param baseUrl - resolution base to try.
 * @returns the module URL, or undefined when the name resolves to nothing here.
 */
function resolveModuleUrl(
  loader: LoaderFace,
  specifier: string,
  baseUrl: string,
): string | undefined {
  const internal = loader.internal
  if (internal !== null && typeof internal === 'object'
    && typeof Reflect.get(internal, 'resolveSync') === 'function') {
    try {
      return (internal as ResolverV1 | ResolverV2).version === 'v2'
        ? (internal as ResolverV2).resolveSync(baseUrl, { specifier, attributes: {} }).url
        : (internal as ResolverV1).resolveSync(specifier, baseUrl, {}).url
    } catch {
      // Fall through: a name the internals reject may still resolve through
      // the owning tree's plain `require`.
    }
  }
  try {
    // A path-like specifier is only resolved if the file is really there.
    // `new URL` happily composes a path that does not exist, and the caller
    // would then walk up from a wrong directory to some unrelated manifest.
    if (specifier.startsWith('file:') || isAbsolute(specifier) || specifier.startsWith('.')) {
      const url = specifier.startsWith('file:') ? specifier
        : isAbsolute(specifier) ? pathToFileURL(specifier).href
          : new URL(specifier, baseUrl).href
      return existsSync(fileURLToPath(url)) ? url : undefined
    }
    return pathToFileURL(createRequire(baseUrl).resolve(specifier)).href
  } catch {
    return undefined
  }
}

/**
 * Locate the package owning one mount's module, trying each base in order.
 *
 * Preset rows need more than one base, and the order is not arbitrary: the
 * roster itself resolves a row's package name from the composition's own base
 * inside the installed harness, precisely because a user-authored preset lives
 * under the harness home where Node's upward `node_modules` walk never reaches
 * the harness's dependencies. So the profile base goes first, and a preset's
 * own directory is only the fallback that answers a relative name.
 * @param loader - the live Loader service.
 * @param specifier - the module specifier a mount names.
 * @param baseUrls - resolution bases, most specific first.
 * @returns the owning package, or undefined when no base resolves it.
 */
function locatePackage(
  loader: LoaderFace,
  specifier: string,
  baseUrls: readonly string[],
): LocatedPackage | undefined {
  // `cordis:` builtins are registered objects, not modules: they have no
  // package and no version, and saying otherwise would invent one.
  if (specifier.startsWith('cordis:')) return undefined
  for (const baseUrl of baseUrls) {
    const moduleUrl = resolveModuleUrl(loader, specifier, baseUrl)
    if (moduleUrl === undefined || !moduleUrl.startsWith('file:')) continue
    const located = nearestPackage(dirname(fileURLToPath(moduleUrl)))
    if (located !== undefined) return located
  }
  return undefined
}

/** Classify a package by its manifest name, never by where it sits on disk. */
function originOf(name: string): PackageOrigin {
  if (name.startsWith('cordis:')) return 'builtin'
  return name.startsWith(HARNESS_SCOPE) ? 'harness' : 'third-party'
}

/** Mutable accumulator for one package while its mounts are being folded in. */
interface PackageDraft {
  name: string
  version: string | null
  description: string | null
  origin: PackageOrigin
  path: string | null
  hasClientHalf: boolean
  isBundle: boolean
  entries: EntryRow[]
}

/**
 * Packages found so far, keyed by the directory that owns them. Both planes
 * fold into one index: the version question is plane-independent, and a package
 * mounted on both planes should answer once, with every mount listed under it.
 *
 * The key is the PATH, not the name, and that is the whole point. Two copies of
 * one package at two versions is the condition most worth finding — duplicate
 * runtime identities mismatch silently — and keying by name would fold the
 * second copy into the first and drop its version. A mount that resolved to no
 * package keys by its specifier instead, so two unresolvable names stay apart.
 */
class PackageIndex {
  private readonly drafts = new Map<string, PackageDraft>()

  /** Mounts whose module resolved to no package on disk. */
  unresolved = 0

  /**
   * Fold one mount into the index.
   * @param located - the package the mount's module belongs to, when found.
   * @param row - the mount itself.
   */
  add(located: LocatedPackage | undefined, row: EntryRow): void {
    if (located === undefined && !row.specifier.startsWith('cordis:')) this.unresolved += 1
    const key = located?.dir ?? row.specifier
    const existing = this.drafts.get(key)
    if (existing !== undefined) {
      existing.entries.push(row)
      return
    }
    const manifest = located?.manifest
    const name = stringField(manifest?.name) ?? row.specifier
    this.drafts.set(key, {
      name,
      version: stringField(manifest?.version),
      description: stringField(manifest?.description),
      origin: originOf(name),
      path: located?.dir ?? null,
      hasClientHalf: manifest?.dsh?.client?.platform === 'web',
      isBundle: typeof manifest?.dsh?.bundle?.patch === 'string',
      entries: [row],
    })
  }

  /** Every package folded in so far, in insertion order. */
  values(): PackageDraft[] {
    return [...this.drafts.values()]
  }
}

/**
 * Names claimed by more than one loaded directory.
 * @param drafts - collected packages.
 * @returns the duplicated names, sorted.
 */
function duplicateNames(drafts: readonly PackageDraft[]): ReadonlySet<string> {
  const seen = new Map<string, number>()
  for (const draft of drafts) seen.set(draft.name, (seen.get(draft.name) ?? 0) + 1)
  return new Set([...seen].filter(([, count]) => count > 1).map(([name]) => name).sort())
}

/** Read a manifest string field, or null when it is absent or wrongly typed. */
function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Locate the running `@deepseek-ai/dsh` install and read its version.
 *
 * `process.argv[1]` is the authority: it is the bin that is actually running,
 * whether that is `node_modules/@deepseek-ai/dsh/lib/bin.js` from an install or
 * `apps/cli/src/bin.ts` from a source checkout. Resolution from the profile's
 * own base is the fallback, and neither is guessed at — an unlocated harness is
 * reported as such rather than as a version the caller cannot trust.
 * @param baseUrl - a Loader tree's resolution base, when one was observed.
 * @param warnings - collector for human-readable degradation notes.
 * @returns the located install, or a null-version row.
 */
function locateHarness(
  baseUrl: string | undefined,
  warnings: string[],
): { version: string | null, source: HarnessVersionSource, path: string | null } {
  const bin = process.argv[1]
  if (typeof bin === 'string' && bin.length > 0) {
    const located = nearestPackage(dirname(resolvePath(bin)), HARNESS_PACKAGE)
    const version = stringField(located?.manifest.version)
    if (located !== undefined && version !== null) {
      return { version, source: 'install', path: located.dir }
    }
  }
  if (baseUrl !== undefined) {
    try {
      const manifestPath = createRequire(baseUrl).resolve(HARNESS_PACKAGE + '/package.json')
      const version = stringField(readManifest(manifestPath)?.version)
      if (version !== null) return { version, source: 'resolved', path: dirname(manifestPath) }
    } catch {
      // No install of the harness package is reachable from the profile.
    }
  }
  warnings.push(
    '无法定位 ' + HARNESS_PACKAGE + ' 的安装位置；下面的版本号由已加载的 '
    + HARNESS_SCOPE + '* 包推断得出。',
  )
  return { version: null, source: 'unknown', path: null }
}

/**
 * The most common version among the harness packages actually loaded.
 * @param drafts - collected packages.
 * @returns the modal version, or null when no harness package reported one.
 */
function modalHarnessVersion(drafts: readonly PackageDraft[]): string | null {
  const counts = new Map<string, number>()
  for (const draft of drafts) {
    if (draft.origin !== 'harness' || draft.version === null) continue
    counts.set(draft.version, (counts.get(draft.version) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [version, count] of counts) {
    if (count > bestCount) {
      best = version
      bestCount = count
    }
  }
  return best
}

/**
 * The profile's own resolution base, read from the Loader's configuration.
 *
 * `ctx.loader.ctx` is the ACCESSING context, not the Loader's own, so its
 * `baseUrl` is unset here; the configured value is the same one every root
 * entry tree carries, and it answers even when the global tree is empty.
 * @param ctx - a context whose fiber injects `loader`.
 * @returns the base URL, or undefined when the Loader was mounted without one.
 */
function profileBase(ctx: Context): string | undefined {
  return ctx.loader.config?.baseUrl
}

/**
 * Fold the profile's own Loader tree into the index.
 *
 * Each entry resolves from its OWN tree's base rather than the profile's: an
 * included subtree carries its own base, and a row it owns resolves relative to
 * the file that declared it.
 * @param ctx - a context whose fiber injects `loader`.
 * @param index - the accumulator to fold into.
 * @returns the first entry-tree base observed, as a fallback profile base.
 */
function collectGlobalPlane(ctx: Context, index: PackageIndex): string | undefined {
  let observedBaseUrl: string | undefined
  for (const entry of ctx.loader.entries() as Iterable<Entry>) {
    // A group is a container for other entries, not a plugin of its own.
    if (entry.options.group === true) continue
    const baseUrl = entry.parent.tree.ctx.baseUrl
    observedBaseUrl ??= baseUrl
    const state = entry.fiber?.state
    const config = summarizeConfig(entry.options.config)
    const row: EntryRow = {
      entryId: entry.id,
      specifier: entry.options.name,
      plane: GLOBAL_PLANE,
      enabled: !entry.disabled,
      condition: null,
      fiberPhase: state === undefined ? null : FIBER_PHASE[state] ?? null,
      config: config.fields,
      configOverflow: config.overflow,
    }
    index.add(
      baseUrl === undefined ? undefined : locatePackage(ctx.loader, row.specifier, [baseUrl]),
      row,
    )
  }
  return observedBaseUrl
}

/**
 * Fold every agent preset's composition into the index.
 *
 * A preset composition mounts per session, so its rows are normally absent from
 * `ctx.loader.entries()` — reading them here is the only way a plugin whose tool
 * lives in one preset (`@deepseek-ai/dsh-tool-cordis` in the shipped `cordis`
 * preset, say) shows up at all. `agentPresets` is an optional service: a
 * deployment that composes no roster is a real shape, not a failure, and it
 * simply contributes no rows.
 * @param ctx - the plugin's context.
 * @param index - the accumulator to fold into.
 * @param globalBaseUrl - the profile's resolution base, used after the preset's own.
 * @param warnings - collector for human-readable degradation notes.
 * @returns one summary per roster preset, in roster order.
 */
async function collectPresetPlane(
  ctx: Context,
  index: PackageIndex,
  globalBaseUrl: string | undefined,
  warnings: string[],
): Promise<PresetSummary[]> {
  const presets = ctx.get('agentPresets')
  if (presets === undefined) return []

  // The composition inventory carries no filesystem path. Joining the roster
  // by id supplies each preset's directory, which is the fallback base for a
  // relative name; a preset that appeared or vanished between the two reads
  // simply resolves from the profile base alone.
  const roots = new Map<string, string>()
  try {
    for (const preset of await presets.list()) {
      roots.set(preset.id, pathToFileURL(dirname(preset.path)).href + '/')
    }
  } catch (error) {
    warnings.push('读取 preset 目录失败，preset 行只按 profile 的解析基址查找：' + reason(error))
  }

  let compositions
  try {
    compositions = await presets.compositionInventory()
  } catch (error) {
    warnings.push('读取 preset composition 失败，面板只反映全局平面：' + reason(error))
    return []
  }

  const summaries: PresetSummary[] = []
  for (const composition of compositions) {
    const plane: EntryPlane = {
      kind: 'preset',
      presetId: composition.id,
      presetName: composition.name ?? null,
      isDefault: composition.isDefault,
    }
    const baseUrls = [globalBaseUrl, roots.get(composition.id)]
      .filter((base): base is string => base !== undefined)
    for (const row of composition.rows) {
      index.add(locatePackage(ctx.loader, row.moduleName, baseUrls), {
        entryId: row.entryId,
        specifier: row.moduleName,
        plane,
        enabled: row.enabled,
        condition: row.condition ?? null,
        fiberPhase: row.fiberState === undefined ? null : FIBER_PHASE[row.fiberState] ?? null,
        // The roster's composition inventory carries no config, so this plane
        // reports none rather than an empty one that would read as "no config".
        config: null,
        configOverflow: 0,
      })
    }
    summaries.push({
      id: composition.id,
      name: composition.name ?? null,
      isDefault: composition.isDefault,
      trust: composition.trust,
      broken: composition.broken ?? null,
      rowCount: composition.rows.length,
    })
  }
  return summaries
}

/** One-line reason for a caught value, for a warning a human reads. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Take one reading of the running composition, across both planes.
 * @param ctx - a context whose fiber injects `loader`.
 * @returns the inventory, with every degradation recorded in `warnings`.
 */
export async function collect(ctx: Context): Promise<VersionInventory> {
  const warnings: string[] = []
  const index = new PackageIndex()

  const observedBaseUrl = collectGlobalPlane(ctx, index)
  // The Loader root's base is the profile's own, and it answers even when the
  // global tree is empty; the first entry tree's base covers a Loader mounted
  // without an explicit one.
  const baseUrl = profileBase(ctx) ?? observedBaseUrl
  const presets = await collectPresetPlane(ctx, index, baseUrl, warnings)

  if (index.unresolved > 0) {
    warnings.push(index.unresolved + ' 个挂载无法解析到 package.json，其版本显示为未知。')
  }

  const drafted = index.values()
  const duplicates = duplicateNames(drafted)
  if (duplicates.size > 0) {
    warnings.push(
      '同一个包存在多份副本：' + [...duplicates].join('、')
      + '。Cordis 服务、品牌类型和 instanceof 都按运行时身份匹配，重复副本会静默失配。',
    )
  }
  const install = locateHarness(baseUrl, warnings)
  const harnessVersion = install.version ?? modalHarnessVersion(drafted)
  const harness: HarnessRow = {
    version: harnessVersion,
    source: install.version !== null
      ? install.source
      : harnessVersion !== null ? 'inferred' : 'unknown',
    path: install.path,
    node: process.version,
    platform: process.platform + ' ' + process.arch,
    home: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
  }

  // Third-party packages first: they are the ones a user installed, and the
  // ones whose version they are usually here to check.
  const order: Record<PackageOrigin, number> = { 'third-party': 0, harness: 1, builtin: 2 }
  const packages: PackageRow[] = drafted
    .map(draft => ({
      ...draft,
      versionDrift: draft.origin === 'harness' && draft.version !== null
        && harnessVersion !== null && draft.version !== harnessVersion,
      duplicate: duplicates.has(draft.name),
    }))
    // Same-name copies sort adjacent, so a duplicate reads as a pair rather
    // than as two unrelated rows in a long list.
    .sort((left, right) =>
      order[left.origin] - order[right.origin]
      || left.name.localeCompare(right.name)
      || (left.path ?? '').localeCompare(right.path ?? ''))

  return { collectedAt: new Date().toISOString(), harness, packages, presets, warnings }
}
