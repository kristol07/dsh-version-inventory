/**
 * The browser-facing read route. One exact path, GET only, JSON only, and a
 * same-origin loopback fence — the inventory names filesystem paths, so it is
 * not something a page on another origin should be able to read.
 */

import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { collect } from './inventory.js'

/** Exact route the browser panel reads. */
export const API_PATH = '/dsh-version-inventory/api/list'

/** Custom header the panel sends; a cross-origin form post cannot set it. */
export const API_HEADER = 'x-dsh-version-inventory'

/**
 * Same-origin loopback check. The webserver carrier owns no Origin policy of
 * its own, so a feature route that discloses host paths states its own.
 * @param req - the incoming request (headers only).
 * @returns whether the request may read the inventory.
 */
export function trustedRequest(req: Pick<IncomingMessage, 'headers'>): boolean {
  try {
    const host = new URL('http://' + String(req.headers.host))
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return false
    if (req.headers[API_HEADER] !== '1') return false
    const origin = req.headers.origin
    if (origin !== undefined && origin !== '') {
      const parsed = new URL(origin)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== host.host) return false
    }
    const site = req.headers['sec-fetch-site']
    return site === undefined || ['same-origin', 'none'].includes(String(site))
  } catch {
    return false
  }
}

/**
 * Register the read route for as long as this plugin's fiber lives.
 * @param ctx - a scope injecting both `loader` and `webServer`.
 */
export function registerWeb(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: API_PATH,
    handler: async (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      const send = (status: number, value: unknown): void => {
        res.statusCode = status
        res.end(JSON.stringify(value))
      }
      if (!trustedRequest(req)) {
        send(403, { error: '版本清单只对同源的本地连接开放。' })
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(405, { error: 'GET required.' })
        return
      }
      try {
        send(200, await collect(ctx))
      } catch (error) {
        send(500, { error: error instanceof Error ? error.message : '采集版本清单失败。' })
      }
    },
  }), 'version-inventory: read route')
}
