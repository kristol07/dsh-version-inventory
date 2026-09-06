/**
 * The read route: its fence, and the shape of what it answers.
 *
 * The route is the one place this package writes a response body, and the rule
 * it has to keep is the same one the success body already keeps for collection
 * warnings — a failure crosses the wire as a fact, never as a sentence. The
 * host process does not know which language the person at the panel chose, so
 * a sentence written here is a sentence written in the wrong language for some
 * reader. These tests pin that, and the fence that decides who may read at all.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { registerWeb, trustedRequest } from '../src/web.ts'

/** Headers a same-origin loopback read carries. */
const TRUSTED = { host: 'localhost:5173', 'x-dsh-version-inventory': '1' }

/**
 * Register the route against a stub web server and hand back its handler.
 *
 * The stub context carries no `loader`, so a request that clears the fence
 * reaches a collection that throws — which is exactly the 500 branch under
 * test. The successful branch belongs to the collection suite.
 * @returns the registered handler and the route it was registered under.
 */
function mountRoute() {
  let route
  registerWeb({
    effect: start => start(),
    webServer: {
      register: (candidate) => {
        route = candidate
        return () => {}
      },
    },
  })
  assert.ok(route !== undefined, 'the route was never registered')
  return route
}

/**
 * Drive one request through the handler.
 * @param route - the registered route.
 * @param request - method and headers to send.
 * @returns the status and the parsed body.
 */
async function call(route, request = {}) {
  const written = []
  const res = {
    statusCode: 200,
    setHeader: () => {},
    end: (chunk) => { written.push(chunk) },
  }
  await route.handler({ method: 'GET', headers: TRUSTED, ...request }, res)
  const text = written.join('')
  return { status: res.statusCode, text, body: JSON.parse(text) }
}

describe('trustedRequest', () => {
  it('accepts a same-origin loopback read carrying the custom header', () => {
    assert.equal(trustedRequest({ headers: TRUSTED }), true)
    assert.equal(
      trustedRequest({ headers: { ...TRUSTED, origin: 'http://localhost:5173' } }),
      true,
    )
  })

  it('refuses a host that is not loopback', () => {
    assert.equal(trustedRequest({ headers: { ...TRUSTED, host: '192.168.1.5:5173' } }), false)
  })

  it('refuses a missing header, which a cross-origin form post cannot set', () => {
    assert.equal(trustedRequest({ headers: { host: 'localhost:5173' } }), false)
  })

  it('refuses another origin, and a cross-site fetch', () => {
    assert.equal(trustedRequest({ headers: { ...TRUSTED, origin: 'http://evil.test' } }), false)
    assert.equal(trustedRequest({ headers: { ...TRUSTED, 'sec-fetch-site': 'cross-site' } }), false)
  })
})

describe('the route answers failures as facts', () => {
  it('reports a refused read as a kind, not a sentence', async () => {
    const answer = await call(mountRoute(), { headers: { host: 'localhost:5173' } })
    assert.equal(answer.status, 403)
    assert.deepEqual(answer.body, { error: { kind: 'forbidden' } })
  })

  it('reports a wrong method as a kind', async () => {
    const answer = await call(mountRoute(), { method: 'POST' })
    assert.equal(answer.status, 405)
    assert.deepEqual(answer.body, { error: { kind: 'method' } })
  })

  it('reports a failed collection as a kind, keeping the underlying reason verbatim', async () => {
    const answer = await call(mountRoute())
    assert.equal(answer.status, 500)
    assert.equal(answer.body.error.kind, 'collect')
    // The reason is an error message from elsewhere and is interpolated as it
    // came, the same contract the collection warnings state for their reasons.
    assert.equal(typeof answer.body.error.reason, 'string')
    assert.ok(answer.body.error.reason.length > 0)
  })

  it('never writes copy of its own', async () => {
    const route = mountRoute()
    for (const request of [{ headers: { host: 'localhost:5173' } }, { method: 'POST' }]) {
      const answer = await call(route, request)
      const error = answer.body.error
      assert.equal(typeof error, 'object', 'the route answered a string instead of a fact')
      assert.equal(typeof error.kind, 'string')
      assert.deepEqual(Object.keys(error), ['kind'], 'a fact-only failure carried extra prose')
      // The regression this replaced: a Chinese sentence reaching an English
      // panel, and an English one reaching a Chinese panel.
      assert.doesNotMatch(answer.text, /[一-鿿]/, 'the route wrote a sentence')
    }
  })
})
