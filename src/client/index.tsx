/**
 * Browser half of `dsh-version-inventory`: one read-only tab in
 * Settings → Plugins, beside the shipped plugin list.
 *
 * `ctx.slots.inject` is what makes the tab safe to contribute from outside the
 * shipped web bundle — the callback runs for each lifetime of the Plugins
 * section's declaration, so this package never imports the section owner and
 * never races its activation.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: `ctx.locale` and `ctx.slots` are merged onto Context by the locale
// and renderer packages, and the Settings slot keys by the settings domain
// base. None is imported as a value.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { fetchInventory } from './api.js'
import { en, zh, type VersionInventoryLocaleKey } from './locales.js'
import { VersionInventoryTab, type VersionInventoryInjected } from './panel.js'

export type { VersionInventoryInjected, VersionInventoryTabProps } from './panel.js'
export type { VersionInventoryLocaleKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Version inventory tab copy. */
    'settings.versionInventory': VersionInventoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.versionInventory'

/** The registry and the dictionaries; the data itself comes over HTTP. */
export const inject = ['slots', 'locale']

/**
 * Contribute the version tab to the Plugins settings section.
 * @param ctx - the browser plugin's own context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'version-inventory: dictionaries')

  // The tab label lives outside the component tree, so it reads the active
  // locale through a bound translate rather than the synthesized `t` seat. The
  // thunk is re-resolved on a locale change, and the ledger bump re-renders
  // the tab strip.
  const t = ctx.locale.bind(NS)
  const injected = (): VersionInventoryInjected => ({
    load: fetchInventory,
    // A function, not a value: the face is built once per registration while
    // the active locale changes underneath it.
    activeLocale: () => ctx.locale.getSnapshot().active,
  })
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'versions',
    // After the shipped `configurable` (0) and `all` (10) tabs.
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, VersionInventoryTab))
}
