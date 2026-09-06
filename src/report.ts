/**
 * The shareable projection of a snapshot, and its rendering.
 *
 * The panel, the copy control, and the model-facing tool render the same
 * snapshot for three different readers, and the differences between them are
 * the whole design here. The panel's reader owns the machine: absolute paths,
 * `DSH_HOME`, and each mount's config are useful on screen, and the read route
 * is fenced to same-origin loopback precisely because they are. The other two
 * readers are not on the machine — a copied report is pasted wherever its
 * author wants it, and a tool result enters a transcript that goes to the model
 * provider on every following turn and may be exported later. Both invert the
 * fence the route is built on.
 *
 * So {@link shareableInventory} is the seam: it projects the snapshot down to
 * the half that is safe to hand to someone else, and nothing downstream can
 * widen it again. It carries no filesystem path, no `DSH_HOME`, no
 * user-authored preset name, no config value, and no package description —
 * that last one because a `description` is text a third-party package author
 * wrote, and the tool feeds its output to a model.
 *
 * What survives the projection is every hedge the panel shows. An inferred
 * harness version, an unresolved mount, a package with no version: dropping the
 * qualifier is what turns the panel's inference into the reader's fact.
 *
 * The split between projection and rendering follows the rule the host half
 * already follows for warnings — facts cross the boundary, and the reader
 * writes the sentence. {@link shareableInventory} yields facts, so the tool's
 * canonical value is a programmatic API rather than prose to be parsed;
 * {@link formatReport} writes the sentences in one reader's language.
 */

import type {
  InventoryWarning,
  PackageOrigin,
  PackageRow,
  PresetSummary,
  VersionInventory,
} from './types.js'
import { en, type VersionInventoryLocaleKey } from './locales.js'

/**
 * The translate seat a report needs.
 *
 * Structurally the panel's own `t` narrowed to this dictionary. Identifiers —
 * package names, versions, preset ids — stay language-neutral, so two reports
 * written in two languages still diff on the facts.
 */
export type ReportTranslate =
  (key: VersionInventoryLocaleKey, params?: Record<string, unknown>) => string

/**
 * Version placeholder in a rendered line.
 *
 * Deliberately not translated: it sits inside `name@version`, which is read as
 * one token and pasted into messages, terminals, and search boxes.
 */
const UNKNOWN_VERSION = 'unknown'

/**
 * Where a mount sits, reduced to what may leave the machine.
 *
 * A system preset is named — its id ships with the deployment, so it means the
 * same thing to the reader as it does here. A user preset is not: its id and
 * its name are things this user wrote.
 */
export type SharedPlane =
  | { readonly kind: 'global' }
  | { readonly kind: 'preset', readonly id: string }
  | { readonly kind: 'user-preset' }

/** One package, reduced to its identity and where it is mounted. */
export interface SharedPackage {
  readonly name: string
  /** Manifest version; null when none could be read. */
  readonly version: string | null
  readonly origin: PackageOrigin
  readonly planes: readonly SharedPlane[]
  /** How many times this package is mounted. */
  readonly mounts: number
  /** True when another loaded directory claims the same package name. */
  readonly duplicate: boolean
  /**
   * For a duplicate, the path segments that tell this copy from the others;
   * null for everything else. See {@link distinguishingLocations}.
   */
  readonly location: string | null
}

/** The running harness, reduced: no install path and no `DSH_HOME`. */
export interface SharedHarness {
  readonly version: string | null
  readonly source: VersionInventory['harness']['source']
  readonly node: string
  readonly platform: string
}

/** A snapshot reduced to what may leave the machine. */
export interface SharedInventory {
  readonly collectedAt: string
  readonly harness: SharedHarness
  readonly packages: readonly SharedPackage[]
  /** Still facts, not sentences: the renderer writes them in its own language. */
  readonly warnings: readonly InventoryWarning[]
  /** The name filter this projection was taken through, or null for the whole install. */
  readonly filter: string | null
}

/** Locale keys for the harness version's provenance, kept in step with the panel. */
const SOURCE_KEYS = {
  install: 'sourceInstall',
  resolved: 'sourceResolved',
  inferred: 'sourceInferred',
  unknown: 'sourceUnknown',
} satisfies Record<VersionInventory['harness']['source'], VersionInventoryLocaleKey>

/** Section headings, reusing the panel's own group names. */
const GROUP_KEYS = {
  'third-party': 'groupThirdParty',
  harness: 'groupHarness',
  builtin: 'groupBuiltin',
} satisfies Record<PackageOrigin, VersionInventoryLocaleKey>

/**
 * A translate seat over one shipped dictionary.
 *
 * The browser gets its `t` from the harness's locale service, which is a
 * browser-side preference; a host-side reader — the model-facing tool — has no
 * such service, so it renders through the dictionary directly. `en` is the key
 * source of truth and the harness's own fallback locale, which makes it the
 * honest default for a reader whose language nobody knows.
 * @param dict - a shipped dictionary.
 * @returns a translate seat over it.
 */
export function dictionaryTranslate(
  dict: Record<VersionInventoryLocaleKey, string>,
): ReportTranslate {
  return (key, params = {}) => dict[key].replaceAll(
    /\{(\w+)\}/g,
    (whole: string, name: string) => (name in params ? String(params[name]) : whole),
  )
}

/**
 * Render one structured collection warning in the reader's language.
 *
 * The host reports warnings as facts rather than sentences because it cannot
 * know the reader's language; this is where those facts become sentences, and a
 * report needs them for the same reason the panel does — a snapshot that
 * silently omits what it could not read invites a wrong conclusion.
 * @param warning - the structured warning.
 * @param t - the reader's translate seat.
 * @returns the sentence.
 */
export function warningText(warning: InventoryWarning, t: ReportTranslate): string {
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

/**
 * One package's identity line — what you paste when someone asks which version
 * of a single plugin you are running.
 * @param row - the package, in either shape.
 * @returns `name@version`, with an explicit `unknown` when the manifest gave none.
 */
export function packageLine(row: { name: string, version: string | null }): string {
  return row.name + '@' + (row.version ?? UNKNOWN_VERSION)
}

/** Split a host path on either separator, dropping the empty parts a root or a trailing slash leaves. */
function segments(path: string): readonly string[] {
  return path.split(/[/\\]+/).filter(part => part !== '')
}

/**
 * Locations for one duplicate group, reduced to what actually differs.
 *
 * Two copies of a package share a root — the same home, the same profile — and
 * that shared root is the part that names the host's user. What tells the
 * copies apart is always deeper (`node_modules/…` against
 * `plugins/x/node_modules/…`), so dropping the longest common directory prefix
 * keeps the whole diagnostic value and sheds the identifying half.
 * @param paths - absolute package roots of one duplicate group.
 * @returns one relative location per input, in input order.
 */
export function distinguishingLocations(paths: readonly string[]): readonly string[] {
  const split = paths.map(segments)
  // The prefix may not eat a whole path: two copies where one nests inside the
  // other's tree would leave that one empty and unnameable.
  const shortest = Math.min(...split.map(parts => parts.length))
  let common = 0
  while (
    common < shortest - 1
    && split.every(parts => parts[common] === split[0]?.[common])
  ) common += 1
  return split.map(parts => '…/' + parts.slice(common).join('/'))
}

/** The planes one package is mounted on, with user-authored preset identity dropped. */
function sharedPlanes(
  row: PackageRow,
  trust: ReadonlyMap<string, PresetSummary['trust']>,
): readonly SharedPlane[] {
  const planes: SharedPlane[] = []
  const seen = new Set<string>()
  for (const entry of row.entries) {
    const plane: SharedPlane = entry.plane.kind === 'global'
      ? { kind: 'global' }
      : trust.get(entry.plane.presetId) === 'system'
        ? { kind: 'preset', id: entry.plane.presetId }
        : { kind: 'user-preset' }
    const key = plane.kind === 'preset' ? 'preset:' + plane.id : plane.kind
    if (seen.has(key)) continue
    seen.add(key)
    planes.push(plane)
  }
  return planes
}

/**
 * Project a snapshot onto the half that may leave the machine.
 *
 * This is the only place the reduction happens. Everything downstream — the
 * copied report, the tool's canonical value, the tool's rendered text — reads
 * from the projection, so widening what is shared is one edit here and trips
 * the tests that guard it, rather than something a renderer can do quietly.
 * @param inventory - the full snapshot.
 * @param filter - case-insensitive package-name substring, or null for all.
 * @returns the shareable projection.
 */
export function shareableInventory(
  inventory: VersionInventory,
  filter: string | null = null,
): SharedInventory {
  const trust = new Map(inventory.presets.map(preset => [preset.id, preset.trust] as const))
  const needle = filter?.trim().toLowerCase() ?? ''
  // Locations are folded per duplicate group before the filter runs, so the
  // fold still sees every copy when the filter would have shown only one.
  const groups = new Map<string, readonly string[]>()
  for (const row of inventory.packages) {
    if (!row.duplicate || groups.has(row.name)) continue
    const paths = inventory.packages.filter(other => other.name === row.name).map(other => other.path)
    if (paths.every((path): path is string => path !== null)) {
      groups.set(row.name, distinguishingLocations(paths))
    }
  }
  const indexInGroup = new Map<string, number>()

  const packages: SharedPackage[] = []
  for (const row of inventory.packages) {
    let location: string | null = null
    if (row.duplicate) {
      const index = indexInGroup.get(row.name) ?? 0
      indexInGroup.set(row.name, index + 1)
      location = groups.get(row.name)?.[index] ?? null
    }
    if (needle !== '' && !row.name.toLowerCase().includes(needle)) continue
    packages.push({
      name: row.name,
      version: row.version,
      origin: row.origin,
      planes: sharedPlanes(row, trust),
      mounts: row.entries.length,
      duplicate: row.duplicate,
      location,
    })
  }

  return {
    collectedAt: inventory.collectedAt,
    harness: {
      version: inventory.harness.version,
      source: inventory.harness.source,
      node: inventory.harness.node,
      platform: inventory.harness.platform,
    },
    packages,
    warnings: inventory.warnings,
    filter: needle === '' ? null : needle,
  }
}

/** One plane's display text. */
function planeText(plane: SharedPlane, t: ReportTranslate): string {
  if (plane.kind === 'global') return t('planeGlobal')
  return plane.kind === 'preset' ? plane.id : t('sharePresetUser')
}

/** One package's line: identity, planes, and a mount count when it has more than one. */
function packageEntry(row: SharedPackage, t: ReportTranslate): string {
  const fields = {
    package: packageLine(row),
    planes: row.planes.map(plane => planeText(plane, t)).join(' + '),
  }
  return '- ' + (row.mounts > 1
    ? t('sharePackageMounts', { ...fields, mounts: t('shareMounts', { count: row.mounts }) })
    : t('sharePackage', fields))
}

/**
 * The harness-package section.
 *
 * The uniform case is the common one and compresses to a single line: forty
 * rows all reading the same version is noise wherever this lands, and the dsh
 * family releases in lockstep. A version that differs is the opposite — it is
 * the finding — so those are named one by one.
 * @param rows - harness-origin packages.
 * @param harnessVersion - the running harness version, or null when unknown.
 * @param t - the reader's translate seat.
 * @returns the section's lines.
 */
function harnessLines(
  rows: readonly SharedPackage[],
  harnessVersion: string | null,
  t: ReportTranslate,
): readonly string[] {
  if (rows.length === 0) return ['- ' + t('shareNone')]
  if (harnessVersion === null) {
    const versions = [...new Set(rows.map(row => row.version ?? UNKNOWN_VERSION))]
    return ['- ' + t('shareHarnessMixed', { count: rows.length, versions: versions.join(', ') })]
  }
  const drifted = rows.filter(row => row.version !== harnessVersion)
  if (drifted.length === 0) {
    return ['- ' + t('shareHarnessUniform', { count: rows.length, version: harnessVersion })]
  }
  return [
    '- ' + t('shareHarnessDrift', {
      count: rows.length - drifted.length,
      version: harnessVersion,
      drift: drifted.length,
    }),
    ...drifted.map(row => '  - ' + packageLine(row)),
  ]
}

/**
 * Notes: the collection's own warnings, plus the duplicate copies spelled out.
 *
 * A duplicate is the condition this plugin exists to surface — Cordis matches
 * services, branded types, and `instanceof` on runtime identity, so two copies
 * mismatch without saying so — and it is worth carrying into the report with
 * enough location to be actionable.
 * @param shared - the shareable projection.
 * @param t - the reader's translate seat.
 * @returns the note lines, empty when there is nothing to say.
 */
function noteLines(shared: SharedInventory, t: ReportTranslate): readonly string[] {
  const lines = shared.warnings.map(warning => '- ' + warningText(warning, t))
  const names = [...new Set(shared.packages.filter(row => row.duplicate).map(row => row.name))]
  for (const name of names) {
    const copies = shared.packages.filter(row => row.name === name)
    // Without a location for every copy the fold had nothing to fold, so the
    // versions are what is left to tell them apart.
    const where = copies.every(row => row.location !== null)
      ? copies.map(row => row.location).join(', ')
      : copies.map(row => row.version ?? UNKNOWN_VERSION).join(', ')
    lines.push('- ' + t('shareDuplicate', { name, locations: where }))
  }
  return lines
}

/**
 * Render a shareable projection as text.
 *
 * Plain text, one fact to a `- ` line. Nothing here assumes a renderer — no
 * wrapper element, no emphasis marks, no code fences — because the same text
 * lands in chat windows, terminals, plain files, issue bodies, and model
 * transcripts. The `- ` prefix is the one concession: it reads as an ordinary
 * list unrendered and keeps its line breaks when something does render it as
 * Markdown.
 * @param shared - the projection to render.
 * @param t - the reader's translate seat.
 * @returns the report text.
 */
export function formatReport(shared: SharedInventory, t: ReportTranslate): string {
  const { harness, packages, collectedAt, filter } = shared
  const byOrigin = (origin: PackageOrigin): readonly SharedPackage[] =>
    packages.filter(row => row.origin === origin)
  const notes = noteLines(shared, t)

  const lines: string[] = [
    t('shareTitle'),
    '',
    '- ' + t('shareFactDsh', {
      version: harness.version ?? UNKNOWN_VERSION,
      source: t(SOURCE_KEYS[harness.source]),
    }),
    '- ' + t('shareFactNode', { node: harness.node, platform: harness.platform }),
    // UTC, not a localized clock: two reports are compared far more often than
    // one is read, and a local time makes that comparison lie.
    '- ' + t('shareFactCollected', { time: collectedAt }),
    '',
  ]

  if (filter === null) {
    const thirdParty = byOrigin('third-party')
    const builtins = byOrigin('builtin')
    lines.push(
      t('shareSectionCount', { section: t(GROUP_KEYS['third-party']), count: thirdParty.length }),
      '',
      ...(thirdParty.length === 0
        ? ['- ' + t('shareNone')]
        : thirdParty.map(row => packageEntry(row, t))),
      '',
      t('shareSectionCount', { section: t(GROUP_KEYS.harness), count: byOrigin('harness').length }),
      '',
      ...harnessLines(byOrigin('harness'), harness.version, t),
    )
    if (builtins.length > 0) {
      lines.push(
        '',
        t('shareSectionCount', { section: t(GROUP_KEYS.builtin), count: builtins.length }),
        '',
        '- ' + t('shareBuiltinsNote'),
      )
    }
  } else {
    // A filtered projection has no honest "they all match" line to fold onto,
    // so every match is named and the heading repeats what was asked for.
    lines.push(
      t('shareSectionCount', { section: t('shareMatching', { filter }), count: packages.length }),
      '',
      ...(packages.length === 0
        ? ['- ' + t('shareNoMatch', { filter })]
        : packages.map(row => packageEntry(row, t))),
    )
  }

  if (notes.length > 0) lines.push('', t('shareNotes'), '', ...notes)
  lines.push('', t('shareFooter'))
  return lines.join('\n')
}

/**
 * Project a snapshot and render it in one step — what the panel's copy control
 * needs, and the shape most tests read.
 *
 * Always the whole inventory unless a filter is given, never the panel's
 * filtered view: the search box and the plane selector shape what one person is
 * reading, and a report that inherited them would under-report an install
 * without saying so.
 * @param inventory - the snapshot to report.
 * @param t - the reader's translate seat.
 * @param filter - case-insensitive package-name substring, or null for all.
 * @returns the report text, ready to paste.
 */
export function buildReport(
  inventory: VersionInventory,
  t: ReportTranslate,
  filter: string | null = null,
): string {
  return formatReport(shareableInventory(inventory, filter), t)
}

/**
 * Render a projection in English.
 *
 * The model-facing tool's reader has no locale service and no stated language,
 * so it gets the dictionary's key source of truth rather than a guess.
 * @param shared - the projection to render.
 * @returns the English report text.
 */
export function englishReport(shared: SharedInventory): string {
  return formatReport(shared, dictionaryTranslate(en))
}
