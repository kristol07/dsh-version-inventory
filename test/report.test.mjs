/**
 * The shareable report, checked against the sources under tsx.
 *
 * These are pure string builders, so the interesting assertions are not that
 * the text renders — they are about what the text is allowed to contain. The
 * report exists to leave the machine, which inverts the fence the read route
 * is built on, so the leak tests below are the point of this file: a future
 * change that starts printing a path, a `DSH_HOME`, or a config value has to
 * fail here rather than in someone's pasted message.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { en } from '../src/locales.ts'
import {
  buildReport, dictionaryTranslate, distinguishingLocations, packageLine, shareableInventory,
} from '../src/report.ts'

/**
 * The shipped English translate seat.
 *
 * The same one the model-facing tool renders through, so these assertions
 * exercise the real path: a report assembled from a key that does not exist
 * throws here, and one that leaves a `{placeholder}` unfilled shows the braces.
 */
const t = dictionaryTranslate(en)

/** A mount on the profile's own Loader tree. */
function globalEntry(overrides = {}) {
  return {
    entryId: 'entry',
    specifier: 'pkg',
    plane: { kind: 'global' },
    enabled: true,
    condition: null,
    fiberPhase: 'active',
    config: [],
    configOverflow: 0,
    ...overrides,
  }
}

/** A mount contributed by one agent preset's composition. */
function presetEntry(presetId, presetName) {
  return globalEntry({
    plane: { kind: 'preset', presetId, presetName, isDefault: false },
    config: null,
  })
}

/** One package row, defaulted to a healthy third-party plugin. */
function pkg(overrides = {}) {
  return {
    name: 'dsh-thing',
    version: '1.2.3',
    description: null,
    origin: 'third-party',
    path: 'C:\\Users\\alice\\.dsh\\node_modules\\dsh-thing',
    hasClientHalf: false,
    isBundle: false,
    versionDrift: false,
    duplicate: false,
    entries: [globalEntry()],
    ...overrides,
  }
}

/** A whole snapshot, defaulted to the ordinary healthy case. */
function inventory(overrides = {}) {
  return {
    collectedAt: '2026-09-06T08:12:03.123Z',
    harness: {
      version: '0.1.2-rc.1',
      source: 'install',
      path: 'C:\\Users\\alice\\.dsh\\node_modules\\@deepseek-ai\\dsh',
      node: 'v22.19.0',
      platform: 'win32',
      home: 'C:\\Users\\alice\\.dsh',
    },
    packages: [pkg()],
    presets: [],
    warnings: [],
    ...overrides,
  }
}

describe('packageLine', () => {
  it('is the name and version as one token', () => {
    assert.equal(packageLine(pkg()), 'dsh-thing@1.2.3')
  })

  it('says so rather than dropping the field when there is no version', () => {
    assert.equal(packageLine(pkg({ version: null })), 'dsh-thing@unknown')
  })
})

describe('distinguishingLocations', () => {
  it('drops the shared root and keeps what tells the copies apart', () => {
    const located = distinguishingLocations([
      '/home/u/.dsh/node_modules/@ds/foo',
      '/home/u/.dsh/plugins/x/node_modules/@ds/foo',
    ])
    assert.deepEqual(located, [
      '…/node_modules/@ds/foo',
      '…/plugins/x/node_modules/@ds/foo',
    ])
    // The identifying half is what the fold is for.
    for (const location of located) assert.ok(!location.includes('/home/u'))
  })

  it('reads either separator, so a Windows path folds like a POSIX one', () => {
    assert.deepEqual(
      distinguishingLocations([
        'C:\\Users\\alice\\.dsh\\node_modules\\foo',
        'C:\\Users\\alice\\.dsh\\vendor\\foo',
      ]),
      ['…/node_modules/foo', '…/vendor/foo'],
    )
  })

  it('leaves one segment when a copy nests inside the other copy tree', () => {
    // Folding the whole of the shorter path away would leave it unnameable.
    assert.deepEqual(
      distinguishingLocations(['/a/b/foo', '/a/b/foo/node_modules/dep/foo']),
      ['…/foo', '…/foo/node_modules/dep/foo'],
    )
  })
})

describe('buildReport', () => {
  it('carries no host path, no DSH_HOME, and no config value', () => {
    const report = buildReport(inventory({
      packages: [pkg({
        entries: [globalEntry({
          config: [
            { key: 'baseURL', value: 'https://internal.example.com', redacted: false },
            { key: 'apiKey', value: '***', redacted: true },
          ],
          configOverflow: 2,
        })],
      })],
    }), t)
    assert.ok(!report.includes('alice'), 'the report named the host user')
    assert.ok(!report.includes('C:\\Users'), 'the report carried an absolute path')
    assert.ok(!report.includes('.dsh'), 'the report carried DSH_HOME')
    assert.ok(!report.includes('internal.example.com'), 'the report carried a config value')
    assert.ok(!report.includes('baseURL'), 'the report carried a config key')
  })

  it('leaves no placeholder unfilled', () => {
    const report = buildReport(inventory({
      packages: [
        pkg(),
        pkg({ name: '@deepseek-ai/dsh-tool-bash', version: '0.1.2-rc.1', origin: 'harness' }),
        pkg({ name: 'cordis:timer', version: null, origin: 'builtin' }),
      ],
      warnings: [{ kind: 'unresolved-mounts', count: 2 }],
    }), t)
    assert.ok(!/\{\w+\}/.test(report), report)
  })

  it('keeps the version and its provenance together', () => {
    const report = buildReport(inventory({
      harness: { ...inventory().harness, source: 'inferred' },
    }), t)
    // An inferred version presented bare is the panel's hedge read as a fact.
    assert.match(report, /DSH: 0\.1\.2-rc\.1 \(inferred from loaded packages\)/)
  })

  it('collapses harness packages that all match the running version', () => {
    const harnessPkg = version =>
      pkg({ name: '@deepseek-ai/dsh-tool-' + version, version, origin: 'harness' })
    const report = buildReport(inventory({
      packages: [harnessPkg('0.1.2-rc.1'), harnessPkg('0.1.2-rc.1')],
    }), t)
    assert.match(report, /2 packages, all at 0\.1\.2-rc\.1/)
  })

  it('names the harness packages that differ, one by one', () => {
    const report = buildReport(inventory({
      packages: [
        pkg({ name: '@deepseek-ai/dsh-tool-bash', version: '0.1.2-rc.1', origin: 'harness' }),
        pkg({ name: '@deepseek-ai/dsh-tool-edit', version: '0.1.1', origin: 'harness', versionDrift: true }),
      ],
    }), t)
    assert.match(report, /1 packages at 0\.1\.2-rc\.1; 1 differ:/)
    assert.match(report, /@deepseek-ai\/dsh-tool-edit@0\.1\.1/)
  })

  it('names a shipped preset but not a user-authored one', () => {
    const report = buildReport(inventory({
      packages: [
        pkg({ name: 'dsh-shipped', entries: [presetEntry('cordis', 'Creator mode')] }),
        pkg({ name: 'dsh-mine', entries: [presetEntry('my-team', 'Internal Team Agent')] }),
      ],
      presets: [
        { id: 'cordis', name: 'Creator mode', isDefault: true, trust: 'system', broken: null, rowCount: 4 },
        { id: 'my-team', name: 'Internal Team Agent', isDefault: false, trust: 'user', broken: null, rowCount: 2 },
      ],
    }), t)
    assert.match(report, /dsh-shipped@1\.2\.3 — cordis/)
    assert.match(report, /dsh-mine@1\.2\.3 — user preset/)
    // A preset the user wrote names itself after their work, not the harness's.
    assert.ok(!report.includes('Internal Team Agent'), 'the report published a user preset name')
    assert.ok(!report.includes('my-team'), 'the report published a user preset id')
  })

  it('counts a package mounted more than once', () => {
    const report = buildReport(inventory({
      packages: [pkg({ entries: [globalEntry(), globalEntry({ entryId: 'second' })] })],
    }), t)
    assert.match(report, /dsh-thing@1\.2\.3 — global, 2 mounts/)
  })

  it('reports duplicate copies with only the segments they differ by', () => {
    const report = buildReport(inventory({
      packages: [
        pkg({ name: 'dup', version: '1.0.0', duplicate: true, path: 'C:\\Users\\alice\\.dsh\\node_modules\\dup' }),
        pkg({ name: 'dup', version: '2.0.0', duplicate: true, path: 'C:\\Users\\alice\\.dsh\\plugins\\a\\node_modules\\dup' }),
      ],
    }), t)
    assert.match(report, /More than one copy of dup is loaded/)
    assert.match(report, /…\/node_modules\/dup/)
    assert.match(report, /…\/plugins\/a\/node_modules\/dup/)
    assert.ok(!report.includes('alice'))
  })

  it('carries the collection warnings, so an incomplete read says it was incomplete', () => {
    const report = buildReport(inventory({
      warnings: [{ kind: 'preset-inventory-unreadable', reason: 'EACCES' }],
    }), t)
    assert.match(report, /Could not read the preset compositions/)
  })

  it('says the whole inventory is empty rather than printing an empty section', () => {
    const report = buildReport(inventory({ packages: [] }), t)
    assert.match(report, /Third-party plugins \(0\)/)
    assert.match(report, /- none/)
  })
})

describe('shareableInventory', () => {
  it('is the seam: nothing downstream can widen what leaves the machine', () => {
    const shared = shareableInventory(inventory({
      packages: [pkg({
        description: 'A plugin by someone else',
        entries: [globalEntry({
          config: [{ key: 'baseURL', value: 'https://internal.example.com', redacted: false }],
        })],
      })],
    }))
    const json = JSON.stringify(shared)
    assert.ok(!json.includes('alice'), 'the projection named the host user')
    assert.ok(!json.includes('C:\\Users'), 'the projection carried an absolute path')
    assert.ok(!json.includes('internal.example.com'), 'the projection carried a config value')
    // A description is text a third-party package author wrote, and the tool is
    // the one path that hands it to a model.
    assert.ok(!json.includes('A plugin by someone else'), 'the projection carried a description')
    assert.equal(shared.harness.version, '0.1.2-rc.1')
    assert.deepEqual(shared.packages[0].planes, [{ kind: 'global' }])
  })

  it('keeps warnings as facts for the reader to phrase', () => {
    const shared = shareableInventory(inventory({
      warnings: [{ kind: 'unresolved-mounts', count: 2 }],
    }))
    assert.deepEqual(shared.warnings, [{ kind: 'unresolved-mounts', count: 2 }])
  })

  it('folds duplicate locations before filtering, so one match still knows its copies', () => {
    const shared = shareableInventory(inventory({
      packages: [
        pkg({ name: 'dup', version: '1.0.0', duplicate: true, path: 'C:\\Users\\alice\\.dsh\\node_modules\\dup' }),
        pkg({ name: 'dup', version: '2.0.0', duplicate: true, path: 'C:\\Users\\alice\\.dsh\\plugins\\a\\node_modules\\dup' }),
        pkg({ name: 'other' }),
      ],
    }), 'dup')
    assert.equal(shared.packages.length, 2)
    assert.deepEqual(
      shared.packages.map(row => row.location),
      ['…/node_modules/dup', '…/plugins/a/node_modules/dup'],
    )
  })

  it('records the filter it was taken through', () => {
    assert.equal(shareableInventory(inventory(), '  THING  ').filter, 'thing')
    assert.equal(shareableInventory(inventory(), '   ').filter, null)
  })
})

describe('a filtered report', () => {
  it('names every match rather than folding them', () => {
    const report = buildReport(inventory({
      packages: [
        pkg({ name: '@deepseek-ai/dsh-tool-bash', version: '0.1.2-rc.1', origin: 'harness' }),
        pkg({ name: '@deepseek-ai/dsh-tool-edit', version: '0.1.2-rc.1', origin: 'harness' }),
      ],
    }), t, 'tool')
    assert.match(report, /Packages matching "tool" \(2\)/)
    assert.match(report, /@deepseek-ai\/dsh-tool-bash@0\.1\.2-rc\.1/)
    assert.match(report, /@deepseek-ai\/dsh-tool-edit@0\.1\.2-rc\.1/)
    // The "all at one version" fold has no honest meaning over a subset.
    assert.ok(!report.includes('all at'), report)
  })

  it('says the filter matched nothing instead of falling back to everything', () => {
    const report = buildReport(inventory(), t, 'nope')
    assert.match(report, /no package name contains "nope"/)
    assert.ok(!report.includes('dsh-thing'), report)
  })

  it('still carries the harness version, the pairing a version question needs', () => {
    assert.match(buildReport(inventory(), t, 'nope'), /DSH: 0\.1\.2-rc\.1/)
  })
})
