/**
 * Host half of `dsh-version-inventory`.
 *
 * The plugin owns no state: it reads the live Loader tree on demand and
 * publishes the reading to two readers — one local HTTP route the browser half
 * draws, and one model-facing tool the session's agent can call.
 *
 * Both dependencies are nested rather than declared, so the same package stays
 * loadable wherever the harness runs: a headless or ACP profile has no
 * `webServer` and contributes no panel, a deployment that composes no agents
 * has no `tools` and contributes no tool, and neither case holds the
 * composition pending forever waiting for a service that is never coming.
 *
 * @module dsh-version-inventory
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { registerTool } from './tool.js'
import { registerWeb } from './web.js'

export { collect } from './inventory.js'
export { API_HEADER, API_PATH, trustedRequest } from './web.js'
export { TOOL_NAME, versionInventoryTool } from './tool.js'
export {
  buildReport, dictionaryTranslate, distinguishingLocations, englishReport,
  formatReport, packageLine, shareableInventory, warningText,
} from './report.js'
export type { ReportTranslate, SharedInventory, SharedPackage, SharedPlane } from './report.js'
export type * from './types.js'

/** Diagnostic label for this plugin's fiber. */
export const name = 'dsh-version-inventory'

/** The Loader tree is the one thing this plugin cannot work without. */
export const inject = ['loader']

/**
 * Contribute to whichever surfaces this deployment actually has.
 * @param ctx - the plugin's own context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['webServer'], scope => { registerWeb(scope) })
  ctx.inject(['tools'], scope => { registerTool(scope) })
}
