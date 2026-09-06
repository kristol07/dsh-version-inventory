/**
 * Integration tests for the host collector, run against the built artifact and
 * a real Cordis Loader. Entries are created disabled: a disabled entry is never
 * imported, so these exercise specifier resolution and manifest reading without
 * starting any plugin.
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { collect } from '../lib/index.js'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BASE_URL = pathToFileURL(PACKAGE_ROOT).href + '/'

/** Contexts to tear down after the run, so a failing assertion cannot leak a fiber. */
const contexts = []

after(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/**
 * Build a context with a real Loader rooted at this package.
 * @returns the context, with `loader` active.
 */
async function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader, { baseUrl: BASE_URL })
  ctx.loader.builtins.demo = () => {}
  return ctx
}

/**
 * Find one package row by name.
 * @param inventory - a collected inventory.
 * @param name - the manifest name to look for.
 * @returns the row.
 */
function pkg(inventory, name) {
  const row = inventory.packages.find(candidate => candidate.name === name)
  assert.ok(row, `expected a package row for ${name}, got ${inventory.packages.map(p => p.name).join(', ')}`)
  return row
}

describe('global plane', () => {
  it('reads each entry back to the version of the package that owns its module', async () => {
    const ctx = await harness()
    await ctx.loader.create({ name: '@deepseek-ai/dsh-host-webserver', disabled: true })

    const inventory = await collect(ctx)
    const row = pkg(inventory, '@deepseek-ai/dsh-host-webserver')
    assert.equal(row.version, '0.1.2-rc.1')
    assert.equal(row.origin, 'harness')
    assert.equal(row.entries.length, 1)
    assert.deepEqual(row.entries[0].plane, { kind: 'global' })
    assert.equal(row.entries[0].enabled, false)
  })

  it('folds a subpath specifier onto the package that owns it', async () => {
    const ctx = await harness()
    await ctx.loader.create({ name: '@deepseek-ai/dsh-client-ui-settings/client', disabled: true })

    const row = pkg(await collect(ctx), '@deepseek-ai/dsh-client-ui-settings')
    assert.equal(row.entries[0].specifier, '@deepseek-ai/dsh-client-ui-settings/client')
    assert.equal(row.version, '0.1.2-rc.1')
  })

  it('resolves a file: specifier through the manifest beside it', async () => {
    const ctx = await harness()
    await ctx.loader.create({
      name: pathToFileURL(join(PACKAGE_ROOT, 'lib/index.js')).href,
      disabled: true,
    })

    const row = pkg(await collect(ctx), 'dsh-version-inventory')
    assert.equal(row.origin, 'third-party')
    assert.equal(row.hasClientHalf, true)
    assert.equal(row.isBundle, true)
    assert.equal(row.path, PACKAGE_ROOT)
  })

  it('reports a cordis builtin without inventing a version for it', async () => {
    const ctx = await harness()
    await ctx.loader.create({ name: 'cordis:demo' })

    const row = pkg(await collect(ctx), 'cordis:demo')
    assert.equal(row.origin, 'builtin')
    assert.equal(row.version, null)
    assert.equal(row.path, null)
    assert.equal(row.entries[0].fiberPhase, 'active')
  })

  it('skips group entries, which mount no plugin of their own', async () => {
    const ctx = await harness()
    await ctx.loader.create({ name: 'cordis:demo', group: true })

    assert.equal((await collect(ctx)).packages.length, 0)
  })

  it('warns instead of guessing when a specifier resolves to nothing', async () => {
    const ctx = await harness()
    await ctx.loader.create({ name: 'no-such-package-anywhere', disabled: true })

    const inventory = await collect(ctx)
    assert.equal(pkg(inventory, 'no-such-package-anywhere').version, null)
    assert.equal(inventory.warnings.length, 2, inventory.warnings.join(' / '))
    assert.ok(inventory.warnings.some(warning => warning.includes('无法解析到 package.json')))
  })

  it('does not resolve a relative specifier that points at no file', async () => {
    const ctx = await harness()
    await ctx.loader.create({ name: './does-not-exist.js', disabled: true })

    // Walking up from a non-existent path would otherwise reach this package's
    // own manifest and report it as the owner.
    const inventory = await collect(ctx)
    assert.equal(inventory.packages.length, 1)
    assert.equal(inventory.packages[0].name, './does-not-exist.js')
    assert.equal(inventory.packages[0].version, null)
  })
})

describe('duplicate copies', () => {
  /** A `file:` entry for one fixture copy. */
  const copy = name => pathToFileURL(join(PACKAGE_ROOT, 'test/fixtures', name, 'index.js')).href

  it('keeps both copies of one name instead of folding the second away', async () => {
    const ctx = await harness()
    await ctx.loader.create({ name: copy('copy-a'), disabled: true })
    await ctx.loader.create({ name: copy('copy-b'), disabled: true })

    const inventory = await collect(ctx)
    const rows = inventory.packages.filter(row => row.name === 'duplicated-fixture')
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map(row => row.version), ['1.0.0', '2.0.0'])
    assert.equal(rows.every(row => row.duplicate), true)
    assert.notEqual(rows[0].path, rows[1].path)
  })

  it('names the duplicated packages in a warning', async () => {
    const ctx = await harness()
    await ctx.loader.create({ name: copy('copy-a'), disabled: true })
    await ctx.loader.create({ name: copy('copy-b'), disabled: true })

    const { warnings } = await collect(ctx)
    assert.ok(warnings.some(warning => warning.includes('duplicated-fixture')), warnings.join(' / '))
  })

  it('still merges two specifiers that reach the same directory', async () => {
    const ctx = await harness()
    await ctx.loader.create({ name: '@deepseek-ai/dsh-client-ui-settings', disabled: true })
    await ctx.loader.create({ name: '@deepseek-ai/dsh-client-ui-settings/client', disabled: true })

    const row = pkg(await collect(ctx), '@deepseek-ai/dsh-client-ui-settings')
    assert.equal(row.entries.length, 2)
    assert.equal(row.duplicate, false)
  })

  it('does not call one package a duplicate of itself across both planes', async () => {
    const ctx = await harness()
    await ctx.loader.create({ name: copy('copy-a'), disabled: true })
    ctx.provide('agentPresets', {
      list: async () => [],
      compositionInventory: async () => [{
        id: 'standard',
        trust: 'system',
        isDefault: true,
        rows: [{ entryId: 'fixture', moduleName: copy('copy-a'), enabled: true }],
      }],
    })

    const row = pkg(await collect(ctx), 'duplicated-fixture')
    assert.equal(row.duplicate, false)
    assert.equal(row.entries.length, 2)
  })

  it('keeps two unresolvable specifiers apart', async () => {
    const ctx = await harness()
    await ctx.loader.create({ name: 'missing-one', disabled: true })
    await ctx.loader.create({ name: 'missing-two', disabled: true })

    const inventory = await collect(ctx)
    assert.equal(inventory.packages.length, 2)
    assert.equal(inventory.packages.every(row => !row.duplicate), true)
  })
})

describe('harness version', () => {
  it('marks the answer inferred when no @deepseek-ai/dsh install is reachable', async () => {
    const ctx = await harness()
    await ctx.loader.create({ name: '@deepseek-ai/dsh-host-webserver', disabled: true })
    await ctx.loader.create({ name: '@deepseek-ai/dsh-client-ui-slots', disabled: true })

    const { harness: row, warnings } = await collect(ctx)
    assert.equal(row.source, 'inferred')
    assert.equal(row.version, '0.1.2-rc.1')
    assert.equal(row.path, null)
    assert.ok(warnings.some(warning => warning.includes('无法定位')))
    assert.equal(row.node, process.version)
  })

  it('reports no drift when every harness package matches the inferred version', async () => {
    const ctx = await harness()
    await ctx.loader.create({ name: '@deepseek-ai/dsh-host-webserver', disabled: true })

    const inventory = await collect(ctx)
    assert.equal(inventory.packages.every(row => !row.versionDrift), true)
  })
})

describe('preset plane', () => {
  /** A roster stub shaped exactly like the two AgentPresets methods the collector calls. */
  function roster(compositions, presets = []) {
    return {
      list: async () => presets,
      compositionInventory: async () => compositions,
    }
  }

  it('contributes rows no global Loader entry carries', async () => {
    const ctx = await harness()
    ctx.provide('agentPresets', roster([{
      id: 'cordis',
      trust: 'system',
      name: '创造模式',
      isDefault: false,
      rows: [{
        entryId: 'tool-webserver',
        moduleName: '@deepseek-ai/dsh-host-webserver',
        enabled: true,
        fiberState: 2,
      }],
    }]))

    const inventory = await collect(ctx)
    const row = pkg(inventory, '@deepseek-ai/dsh-host-webserver')
    assert.equal(row.version, '0.1.2-rc.1')
    assert.deepEqual(row.entries[0].plane, {
      kind: 'preset',
      presetId: 'cordis',
      presetName: '创造模式',
      isDefault: false,
    })
    assert.equal(row.entries[0].fiberPhase, 'active')
    assert.deepEqual(inventory.presets, [{
      id: 'cordis',
      name: '创造模式',
      isDefault: false,
      trust: 'system',
      broken: null,
      rowCount: 1,
    }])
  })

  it('lists both planes under one package when it is mounted on each', async () => {
    const ctx = await harness()
    await ctx.loader.create({ name: '@deepseek-ai/dsh-host-webserver', disabled: true })
    ctx.provide('agentPresets', roster([{
      id: 'standard',
      trust: 'system',
      isDefault: true,
      rows: [{ entryId: 'webserver', moduleName: '@deepseek-ai/dsh-host-webserver', enabled: true }],
    }]))

    const row = pkg(await collect(ctx), '@deepseek-ai/dsh-host-webserver')
    assert.equal(row.entries.length, 2)
    assert.deepEqual(row.entries.map(entry => entry.plane.kind), ['global', 'preset'])
    assert.equal(row.entries[1].plane.presetName, null)
    assert.equal(row.entries[1].fiberPhase, null)
  })

  it('keeps a conditional gate distinct from a plainly disabled row', async () => {
    const ctx = await harness()
    ctx.provide('agentPresets', roster([{
      id: 'cordis',
      trust: 'system',
      isDefault: false,
      rows: [{
        entryId: 'tool-subagent-codex',
        moduleName: '@deepseek-ai/dsh-host-webserver',
        enabled: 'conditional',
        condition: 'process.env.DSH_CODEX === undefined',
      }],
    }]))

    const entry = pkg(await collect(ctx), '@deepseek-ai/dsh-host-webserver').entries[0]
    assert.equal(entry.enabled, 'conditional')
    assert.equal(entry.condition, 'process.env.DSH_CODEX === undefined')
  })

  it('reports a broken preset on the roster instead of dropping it', async () => {
    const ctx = await harness()
    ctx.provide('agentPresets', roster([{
      id: 'mine',
      trust: 'user',
      isDefault: false,
      broken: 'agent.mine.yml is not a list',
      rows: [],
    }]))

    const inventory = await collect(ctx)
    assert.equal(inventory.presets[0].broken, 'agent.mine.yml is not a list')
    assert.equal(inventory.presets[0].trust, 'user')
    assert.equal(inventory.packages.length, 0)
  })

  it('degrades to the global plane when the roster read throws', async () => {
    const ctx = await harness()
    ctx.provide('agentPresets', {
      list: async () => [],
      compositionInventory: async () => { throw new Error('roster root vanished') },
    })

    const inventory = await collect(ctx)
    assert.deepEqual(inventory.presets, [])
    assert.ok(inventory.warnings.some(warning => warning.includes('roster root vanished')))
  })

  it('composes an empty roster when the deployment mounts no preset service', async () => {
    const inventory = await collect(await harness())
    assert.deepEqual(inventory.presets, [])
  })
})
