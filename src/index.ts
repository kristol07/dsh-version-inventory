/**
 * Host half of `dsh-version-inventory`.
 *
 * The plugin owns no state: it reads the live Loader tree on demand and
 * publishes the reading over one local HTTP route that the browser half draws.
 * The `webServer` dependency is nested rather than declared, so the same
 * package stays loadable in a headless or ACP profile — there it simply
 * contributes nothing instead of holding the composition pending forever.
 *
 * @module dsh-version-inventory
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { registerWeb } from './web.js'

export { collect } from './inventory.js'
export { API_HEADER, API_PATH, trustedRequest } from './web.js'
export type * from './types.js'

/** Diagnostic label for this plugin's fiber. */
export const name = 'dsh-version-inventory'

/** The Loader tree is the one thing this plugin cannot work without. */
export const inject = ['loader']

/**
 * Mount the read route once a web surface exists.
 * @param ctx - the plugin's own context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['webServer'], scope => { registerWeb(scope) })
}
