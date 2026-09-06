/**
 * The model-facing tool's contract, checked against the real registry helpers.
 *
 * This package registers a raw `ToolDefinition` rather than building one with
 * `defineTool`, which keeps `@deepseek-ai/dsh-tools` a type-only dependency —
 * and moves two checks the builder would have done onto this file. The registry
 * asserts the output schema at registration and validates every canonical value
 * against it before the result leaves the pipeline, so a schema that does not
 * describe the value fails at mount time or on the first call, in a session,
 * rather than here. Both assertions below run the registry's own functions.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import * as plugin from '../lib/index.js'
import { shareableInventory } from '../src/report.ts'

/** The definition never calls its context to be built, so a stub is enough here. */
const tool = plugin.versionInventoryTool({})

/** One mount on the profile's own Loader tree. */
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

/** One package row. */
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

/**
 * A snapshot exercising every branch the schema declares: a null version, a
 * duplicate with a location, a preset plane, and a warning.
 * @returns the snapshot.
 */
function richInventory() {
  return {
    collectedAt: '2026-09-06T08:12:03.123Z',
    harness: {
      version: '0.1.2-rc.1',
      source: 'inferred',
      path: 'C:\\Users\\alice\\.dsh\\node_modules\\@deepseek-ai\\dsh',
      node: 'v22.19.0',
      platform: 'win32',
      home: 'C:\\Users\\alice\\.dsh',
    },
    packages: [
      pkg(),
      pkg({
        name: 'dsh-preset-only',
        entries: [globalEntry({
          plane: { kind: 'preset', presetId: 'cordis', presetName: 'Creator mode', isDefault: true },
          config: null,
        })],
      }),
      pkg({ name: 'cordis:timer', version: null, origin: 'builtin' }),
      pkg({ name: 'dup', version: '1.0.0', duplicate: true, path: 'C:\\a\\node_modules\\dup' }),
      pkg({ name: 'dup', version: '2.0.0', duplicate: true, path: 'C:\\a\\vendor\\dup' }),
    ],
    presets: [
      { id: 'cordis', name: 'Creator mode', isDefault: true, trust: 'system', broken: null, rowCount: 4 },
    ],
    warnings: [{ kind: 'unresolved-mounts', count: 1 }],
  }
}

describe('the tool definition', () => {
  it('declares a schema the registry accepts', () => {
    // The registry runs exactly this at registration; a malformed node would
    // otherwise fail the mount rather than the build.
    assert.doesNotThrow(() => { assertSupportedJsonSchema(tool.output.schema) })
    assert.doesNotThrow(() => { assertSupportedJsonSchema(tool.parameters) })
  })

  it('is named and described for a model that has to decide whether to call it', () => {
    assert.equal(tool.name, plugin.TOOL_NAME)
    assert.match(tool.description, /fingerprint, not a lockfile/)
    assert.match(tool.description, /no filesystem paths, no DSH_HOME, and no plugin config/)
  })

  it('opts into parallel dispatch, because every call only reads', () => {
    assert.equal(tool.isConcurrencySafe(), true)
  })
})

describe('the canonical value', () => {
  it('validates against the declared output schema', () => {
    const value = shareableInventory(richInventory())
    assert.deepEqual(validateJsonSchemaValue(tool.output.schema, value, 'value'), [])
  })

  it('validates when filtered down to nothing', () => {
    const value = shareableInventory(richInventory(), 'no-such-package')
    assert.equal(value.packages.length, 0)
    assert.deepEqual(validateJsonSchemaValue(tool.output.schema, value, 'value'), [])
  })

  it('is lossless JSON, so the registry can snapshot it', () => {
    const value = shareableInventory(richInventory())
    assert.deepEqual(JSON.parse(JSON.stringify(value)), value)
  })
})

describe('the rendered result', () => {
  it('is the English report, whatever the panel language is', () => {
    const value = shareableInventory(richInventory())
    const content = tool.output.render({}, value)
    assert.equal(content.length, 1)
    assert.equal(content[0].type, 'text')
    assert.match(content[0].text, /DSH environment/)
    // The hedge has to reach the model too: this harness version was inferred.
    assert.match(content[0].text, /inferred from loaded packages/)
  })

  it('carries no host path into the transcript', () => {
    const content = tool.output.render({}, shareableInventory(richInventory()))
    assert.ok(!content[0].text.includes('alice'))
    assert.ok(!content[0].text.includes('C:\\Users'))
  })
})

describe('argument validation', () => {
  it('refuses a non-string package rather than filtering by a coercion', async () => {
    // A raw definition owns its own validation, so this is the only guard —
    // and it runs before the collection, so no context is needed to reach it.
    await assert.rejects(
      () => tool.execute({ package: 5 }, { signal: new AbortController().signal }),
      TypeError,
    )
  })
})

describe('the host half wiring', () => {
  it('declares only the loader, and nests both surfaces', () => {
    // Neither `webServer` nor `tools` may be a declared dependency: a headless
    // profile has no web server, a deployment that composes no agents has no
    // tool registry, and a declared injection would hold the whole composition
    // pending for a service that is never coming.
    assert.deepEqual(plugin.inject, ['loader'])
    const injected = []
    plugin.apply({ inject: (names) => { injected.push(names) } })
    assert.deepEqual(injected, [['webServer'], ['tools']])
  })

  it('registers through an effect, so disposal unregisters the tool', () => {
    let disposed = false
    const effects = []
    const scope = {
      effect: (start, label) => { effects.push(label); return start() },
      tools: { register: () => () => { disposed = true } },
    }
    const stop = scope.effect(
      () => scope.tools.register(plugin.versionInventoryTool(scope)),
      'version-inventory: tool',
    )
    assert.deepEqual(effects, ['version-inventory: tool'])
    assert.equal(typeof stop, 'function')
    stop()
    assert.equal(disposed, true)
  })
})
