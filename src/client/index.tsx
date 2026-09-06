/**
 * Browser half of `dsh-version-inventory`: one read-only tab in
 * Settings → 插件, beside the shipped plugin list.
 *
 * `ctx.slots.inject` is what makes the tab safe to contribute from outside the
 * shipped web bundle — the callback runs for each lifetime of the Plugins
 * section's declaration, so this package never imports the section owner and
 * never races its activation.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: `ctx.slots` is merged onto Context by the renderer, and the
// Settings slot keys by the settings domain base. Neither is imported as a value.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { fetchInventory } from './api.js'
import { VersionInventoryTab, type VersionInventoryInjected } from './panel.js'

export type { VersionInventoryInjected, VersionInventoryTabProps } from './panel.js'

/** The registry is the only service this half needs; the data comes over HTTP. */
export const inject = ['slots']

/**
 * Contribute the version tab to the Plugins settings section.
 * @param ctx - the browser plugin's own context.
 */
export function apply(ctx: Context): void {
  const injected = (): VersionInventoryInjected => ({ load: fetchInventory })
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'versions',
    // After the shipped `configurable` (0) and `all` (10) tabs.
    order: 20,
    label: '版本',
    inject: injected,
  }, VersionInventoryTab))
}
