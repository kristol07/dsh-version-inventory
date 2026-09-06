/**
 * Wire types shared by the host collector and the browser panel. Plain JSON —
 * the client half imports them type-only, so nothing crosses the bundle
 * boundary at runtime.
 */

/** Public projection of a Cordis fiber state; null when the entry has no live root fiber. */
export type FiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

/** Where a package came from, decided by its manifest name, not by its path. */
export type PackageOrigin = 'harness' | 'third-party' | 'builtin'

/**
 * Effective enablement of one mount. `'conditional'` marks a `!!js` disabled
 * gate on a preset composition no session has mounted, which only a Loader
 * context can decide.
 */
export type Enablement = boolean | 'conditional'

/**
 * Which of the harness's two planes a mount sits on.
 *
 * `global` is the profile's own Loader tree — the bundle patch layers under the
 * user's `cordis.patch.yml`. `preset` is one agent preset's composition, which
 * mounts per session when that preset is selected, so a preset row can be real
 * and reachable without ever appearing in `ctx.loader.entries()`.
 */
export type EntryPlane =
  | { readonly kind: 'global' }
  | {
    readonly kind: 'preset'
    readonly presetId: string
    /** Display name the preset published; null falls back to the id. */
    readonly presetName: string | null
    /** Whether a session naming no preset composes this one. */
    readonly isDefault: boolean
  }

/** One mount of a package: a Loader entry, or one preset composition row. */
export interface EntryRow {
  /** Loader-tree entry id, the id a composition file declares, or null when it declares none. */
  readonly entryId: string | null
  /** Exact module specifier the mount names. */
  readonly specifier: string
  readonly plane: EntryPlane
  /** Effective enablement, including disabled ancestor groups. */
  readonly enabled: Enablement
  /** The row's own `!!js` disabled expression, when it carries one. */
  readonly condition: string | null
  /** Root-fiber phase when the mount is live; null when it is not observed. */
  readonly fiberPhase: FiberPhase
}

/** One package, with every mount that resolved to it. */
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

/** One agent preset on the roster, whether or not any session has mounted it. */
export interface PresetSummary {
  readonly id: string
  /** Display name the preset published; null falls back to the id. */
  readonly name: string | null
  readonly isDefault: boolean
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Why this preset's composition could not be read; null when it read fine. */
  readonly broken: string | null
  /** Composition rows this preset contributed to the package list. */
  readonly rowCount: number
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
  /**
   * The preset roster, in roster order. Empty when the deployment composes no
   * roster — a real deployment shape, not a failure.
   */
  readonly presets: readonly PresetSummary[]
  /** Non-fatal collection problems, written for a human reader. */
  readonly warnings: readonly string[]
}
