/**
 * Wire types shared by the host collector and the browser panel. Plain JSON —
 * the client half imports them type-only, so nothing crosses the bundle
 * boundary at runtime.
 */

/** Public projection of a Cordis fiber state; null when the entry has no live root fiber. */
export type FiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

/** Where a package came from, decided by its manifest name, not by its path. */
export type PackageOrigin = 'harness' | 'third-party' | 'builtin'

/** One Loader entry, resolved back to the package that owns its module. */
export interface EntryRow {
  /** Loader-tree entry id. */
  readonly entryId: string
  /** Exact module specifier the Loader entry imports. */
  readonly specifier: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: FiberPhase
}

/** One package, with every Loader entry that resolved to it. */
export interface PackageRow {
  /** Manifest name, or the specifier when no manifest could be located. */
  readonly name: string
  /** Manifest version; null when the package could not be resolved or declares none. */
  readonly version: string | null
  readonly description: string | null
  readonly origin: PackageOrigin
  /** Absolute package root on the host filesystem; null when unresolved. */
  readonly path: string | null
  /** Whether this package declares a browser half (`dsh.client.platform: 'web'`). */
  readonly hasClientHalf: boolean
  /** Whether this package declares a profile patch layer (`dsh.bundle.patch`). */
  readonly isBundle: boolean
  /** True when a harness package's version differs from the running harness version. */
  readonly versionDrift: boolean
  readonly entries: readonly EntryRow[]
}

/** How confident the harness-version answer is. */
export type HarnessVersionSource =
  /** Read from the running `@deepseek-ai/dsh` install located from argv. */
  | 'install'
  /** Resolved as `@deepseek-ai/dsh` from the profile's own resolution base. */
  | 'resolved'
  /** No `@deepseek-ai/dsh` manifest found; the modal `@deepseek-ai/dsh-*` version instead. */
  | 'inferred'
  | 'unknown'

/** The running harness itself. */
export interface HarnessRow {
  readonly version: string | null
  readonly source: HarnessVersionSource
  /** Absolute install root of `@deepseek-ai/dsh`; null when it was not located. */
  readonly path: string | null
  readonly node: string
  readonly platform: string
  /** Resolved `$DSH_HOME`. */
  readonly home: string
}

/** One point-in-time reading of the running composition. */
export interface VersionInventory {
  /** ISO timestamp of the collection. */
  readonly collectedAt: string
  readonly harness: HarnessRow
  /** Packages sorted third-party first, then by name. */
  readonly packages: readonly PackageRow[]
  /** Non-fatal collection problems, written for a human reader. */
  readonly warnings: readonly string[]
}
