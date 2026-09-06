/**
 * Host-side collection: read the live Cordis Loader tree, resolve every entry
 * back to the package manifest that owns its module, and report the versions.
 *
 * Nothing here is cached. The Loader already maintains `Entry.fiber` and
 * `Fiber.state`, so a second lifecycle truth would only be one more thing to
 * keep synchronized; the manifest reads are a few dozen `readFileSync` calls
 * behind a user gesture, not a hot path.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import type {
  EntryRow,
  FiberPhase,
  HarnessRow,
  HarnessVersionSource,
  PackageOrigin,
  PackageRow,
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

/**
 * Resolve one Loader specifier to the module URL the Loader itself would
 * import. Loader internals come first because they honor the process's active
 * ESM hooks (a source launch runs plugins through tsx); the `require` fallback
 * covers a runtime that exposes no internals.
 * @param loader - the live Loader service.
 * @param specifier - the entry's module specifier.
 * @param baseUrl - resolution base of the tree that owns the entry.
 * @returns the module URL, or undefined when the name resolves to nothing.
 */
function resolveModuleUrl(
  loader: { internal?: unknown },
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
    if (specifier.startsWith('file:')) return specifier
    if (isAbsolute(specifier)) return pathToFileURL(specifier).href
    if (specifier.startsWith('.')) return new URL(specifier, baseUrl).href
    return pathToFileURL(createRequire(baseUrl).resolve(specifier)).href
  } catch {
    return undefined
  }
}

/** Classify a package by its manifest name, never by where it sits on disk. */
function originOf(name: string): PackageOrigin {
  if (name.startsWith('cordis:')) return 'builtin'
  return name.startsWith(HARNESS_SCOPE) ? 'harness' : 'third-party'
}

/** Mutable accumulator for one package while its entries are being folded in. */
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
 * Take one reading of the running composition.
 * @param ctx - a context whose fiber injects `loader`.
 * @returns the inventory, with every degradation recorded in `warnings`.
 */
export function collect(ctx: Context): VersionInventory {
  const warnings: string[] = []
  const drafts = new Map<string, PackageDraft>()
  let observedBaseUrl: string | undefined
  let unresolved = 0

  for (const entry of ctx.loader.entries() as Iterable<Entry>) {
    // A group is a container for other entries, not a plugin of its own.
    if (entry.options.group === true) continue
    const specifier = entry.options.name
    const state = entry.fiber?.state
    const row: EntryRow = {
      entryId: entry.id,
      specifier,
      enabled: !entry.disabled,
      fiberPhase: state === undefined ? null : FIBER_PHASE[state] ?? null,
    }
    const baseUrl = entry.parent.tree.ctx.baseUrl
    observedBaseUrl ??= baseUrl

    // `cordis:` builtins are registered objects, not modules: they have no
    // package and no version, and saying otherwise would invent one.
    let located: LocatedPackage | undefined
    if (!specifier.startsWith('cordis:') && baseUrl !== undefined) {
      const moduleUrl = resolveModuleUrl(ctx.loader, specifier, baseUrl)
      if (moduleUrl !== undefined && moduleUrl.startsWith('file:')) {
        located = nearestPackage(dirname(fileURLToPath(moduleUrl)))
      }
    }
    if (located === undefined && !specifier.startsWith('cordis:')) unresolved += 1

    const name = stringField(located?.manifest.name) ?? specifier
    const existing = drafts.get(name)
    if (existing !== undefined) {
      existing.entries.push(row)
      continue
    }
    const manifest = located?.manifest
    drafts.set(name, {
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

  if (unresolved > 0) {
    warnings.push(unresolved + ' 个条目无法解析到 package.json，其版本显示为未知。')
  }

  const drafted = [...drafts.values()]
  const install = locateHarness(observedBaseUrl, warnings)
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
    }))
    .sort((left, right) =>
      order[left.origin] - order[right.origin] || left.name.localeCompare(right.name))

  return { collectedAt: new Date().toISOString(), harness, packages, warnings }
}
