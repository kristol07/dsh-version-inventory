/**
 * Contract tests for the browser half, run against the real `client-modules`
 * scanner from npm.
 *
 * The browser bundle is the part no runtime test in this package can exercise:
 * it is fetched over HTTP and evaluated by the page's module system, never
 * imported by Node. What CAN be checked here is everything that makes that
 * evaluation possible — that the manifest wiring puts the package in the boot
 * graph, that the served bytes are the built bundle, that the factory id
 * matches the module-table key, and that the bundle asks the module table for
 * nothing it cannot answer.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKAGE_NAME = 'dsh-version-inventory'
const HOST_HALF = pathToFileURL(join(PACKAGE_ROOT, 'lib/index.js')).href

/**
 * The module specifiers this bundle is allowed to ask the page's module table
 * for. Every one is a platform seed the shell installs; anything else must be
 * inlined at build time, because a `require` the table cannot answer throws
 * when the factory materializes. Asserting the exact set — not a subset — is
 * what catches a new import that tsdown left external.
 */
const ALLOWED_REQUIRES = [
  'react',
  'react/jsx-runtime',
  // The panel's copy controls write through the harness's own clipboard
  // helper rather than reimplementing the insecure-context fallback.
  '@deepseek-ai/dsh-client-ui-primitives',
]

let context
let route
let graph

before(() => {
  context = new Context()
  context.baseUrl = pathToFileURL(PACKAGE_ROOT).href + '/'
  context.provide('loader', {
    internal: undefined,
    *entries() {
      yield {
        options: { name: HOST_HALF },
        fiber: {},
        disabled: false,
        parent: { tree: { ctx: { baseUrl: context.baseUrl } } },
      }
    },
  })
  context.provide('webServer', {
    port: 0,
    register: candidate => {
      if (candidate.path === '/plugins') route = candidate
      return () => {}
    },
    tapIndex: () => () => {},
  })
  graph = new ClientModuleRegistry(context).graph()
})

after(async () => {
  await context?.fiber.dispose()
})

/**
 * The built browser bundle as text.
 * @returns the bundle source.
 */
function readBundle() {
  return readFileSync(join(PACKAGE_ROOT, 'lib/client.js'), 'utf8')
}

/**
 * Drop a trailing sourcemap reference, the whitespace around it, and the bare
 * `;` the combo endpoint writes between concatenated resources. The leading
 * `\n` is required: without it the optional `;` would eat the semicolon that
 * ends the bundle's own last statement.
 * @param source - bundle text.
 * @returns the text without its sourcemap comment.
 */
function withoutSourceMapRef(source) {
  return source.replace(/\n\s*;?\s*\/\/# sourceMappingURL=\S*\s*$/, '')
}

/**
 * Drive the registered plugin route and capture what it answered.
 * @param url - the route-relative URL to request.
 * @returns the status and body.
 */
async function serve(url) {
  let status = 0
  let body = Buffer.alloc(0)
  const response = {
    writeHead(next) {
      status = next
      return response
    },
    end(chunk) {
      body = chunk === undefined ? Buffer.alloc(0) : Buffer.from(chunk)
      return response
    },
  }
  await route.handler({ method: 'GET', url }, response)
  return { status, body }
}

describe('browser half', () => {
  it('joins the boot graph under its package name', () => {
    const row = graph.entries.find(entry => entry.id === PACKAGE_NAME)
    assert.ok(row, 'the scanner did not put this package in window.__DSH_BOOT__')
    assert.deepEqual(row.inject, [
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-settings',
    ])
  })

  it('serves the built bundle on the plugin route', async () => {
    const row = graph.entries.find(entry => entry.id === PACKAGE_NAME)
    const { status, body } = await serve(row.url)
    assert.equal(status, 200)
    // The combo endpoint rewrites the trailing sourcemap reference to the map
    // it serves itself, so the comparison is over everything before it.
    const served = body.toString('utf8')
    assert.equal(withoutSourceMapRef(served), withoutSourceMapRef(readBundle()))
    assert.match(served, /\/\/# sourceMappingURL=\/plugins\/\?\?dsh-version-inventory\/client\.js\.map/)
  })

  it('registers its factory under the id the module table keys on', () => {
    const bundle = readBundle()
    const id = /__ModuleLoader__\.load\(\{[\s\S]{0,80}?id: "([^"]+)"/.exec(bundle)?.[1]
    // A mismatch here loads the script and then never resolves the module.
    assert.equal(id, PACKAGE_NAME)
  })

  it('asks the module table for nothing beyond the platform seeds', () => {
    const bundle = readBundle()
    const requires = [...new Set(
      [...bundle.matchAll(/\brequire\("([^"]+)"\)/g)].map(match => match[1]),
    )].sort()
    assert.deepEqual(requires, [...ALLOWED_REQUIRES].sort())
  })

  it('inlines its stylesheet rather than importing one', () => {
    const bundle = readBundle()
    // A `.css` import would survive as an external the module table cannot answer.
    assert.equal(/require\("[^"]*\.css"\)/.test(bundle), false)
    assert.ok(bundle.includes('.dvi-head'), 'the panel stylesheet is missing from the bundle')
  })
})
