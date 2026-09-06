/**
 * The model-facing tool.
 *
 * The panel answers a version question for whoever is looking at the screen.
 * This answers it for the agent in the session, which is the reader that
 * actually needs it while debugging: an agent that can read the running
 * composition does not have to ask its user to open a settings tab, copy a
 * report, and paste it back.
 *
 * Three things about the shape are deliberate.
 *
 * The canonical value is {@link SharedInventory} — the same projection the copy
 * control uses. A tool result is not a private reading: it enters the
 * transcript, goes to the model provider on every following turn, and may be
 * exported later, which is the same threat model as a pasted report and the
 * opposite of the one the read route is fenced for. Reusing the projection
 * means the model reader cannot drift wider than the human one. It also drops
 * package `description`s for a second reason: a description is text a
 * third-party package author wrote, and this is the one path that feeds it to a
 * model.
 *
 * The value is structured and the prose lives in `render`, per the tool
 * authoring contract: a caller in PTC mode gets fields to read rather than
 * sentences to parse, while a native call sees the same English report a person
 * would copy.
 *
 * Nothing here imports the tools package at runtime. `ToolDefinition` is a
 * type, `register` takes a plain object, and `defineTool` is only a typed
 * builder — so this package keeps its property that every capability arrives
 * through `ctx` and no `@deepseek-ai/*` module is a runtime dependency. The
 * cost is that a raw definition owns its own argument validation, which for one
 * optional string is cheaper than the dependency would be.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonSchemaNode, ToolDefinition } from '@deepseek-ai/dsh-tools'
import { collect } from './inventory.js'
import { englishReport, shareableInventory, type SharedInventory } from './report.js'

/** Model-facing tool name, namespaced by the package that owns it. */
export const TOOL_NAME = 'dsh_version_inventory'

/**
 * What the model reads before deciding to call.
 *
 * The limits are stated here rather than only in the result, because a
 * description is what shapes whether the tool is reached for at all — and the
 * conclusion worth preventing ("the versions match, so the environments match")
 * is one the model would otherwise draw before ever seeing the footer.
 */
const DESCRIPTION = [
  'Read the version of the running DeepSeek Harness (dsh) and of every plugin package it has',
  'mounted, from the live process rather than from memory or a manifest on disk.',
  '',
  'Use it when an answer depends on what is actually installed: which version of a plugin is',
  'running, whether the install is mixed (a harness package at a different version from the',
  'harness itself), or whether one package is loaded as two copies — the failure that makes',
  'Cordis services, branded types, and instanceof mismatch silently.',
  '',
  'The result is a fingerprint, not a lockfile. It names the packages the harness mounted and',
  'their versions; it does not carry transitive dependencies, patch-layer contents, or which',
  'agent preset a session composed. Two matching results mean the mounted versions match, not',
  'that two environments do. It reports no filesystem paths, no DSH_HOME, and no plugin config.',
].join('\n')

/** A field that is a string or explicitly absent, which is a fact worth keeping. */
const NULLABLE_STRING: JsonSchemaNode = { oneOf: [{ type: 'string' }, { type: 'null' }] }

/**
 * The canonical output declaration.
 *
 * Written out rather than inferred because a raw definition's value is
 * validated against this schema on every call: a field added to
 * {@link SharedInventory} without a branch here fails the call rather than
 * silently going unannounced to a PTC caller.
 */
const OUTPUT_SCHEMA: JsonSchemaNode = {
  type: 'object',
  properties: {
    collectedAt: { type: 'string', description: 'ISO-8601 UTC timestamp of the reading.' },
    harness: {
      type: 'object',
      properties: {
        version: NULLABLE_STRING,
        source: {
          type: 'string',
          enum: ['install', 'resolved', 'inferred', 'unknown'],
          description:
            'How confident the version is. "inferred" is the modal version among loaded '
            + '@deepseek-ai/* packages, not a reading of the harness manifest.',
        },
        node: { type: 'string' },
        platform: { type: 'string' },
      },
      required: ['version', 'source', 'node', 'platform'],
    },
    packages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: NULLABLE_STRING,
          origin: { type: 'string', enum: ['third-party', 'harness', 'builtin'] },
          planes: {
            type: 'array',
            description:
              'Where the package is mounted: the profile Loader tree ("global") or an agent '
              + 'preset. A user-authored preset reports as "user-preset" without its name.',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['global', 'preset', 'user-preset'] },
                id: { type: 'string' },
              },
              required: ['kind'],
            },
          },
          mounts: { type: 'integer', description: 'How many times this package is mounted.' },
          duplicate: {
            type: 'boolean',
            description: 'True when another loaded directory claims the same package name.',
          },
          location: {
            ...NULLABLE_STRING,
            description:
              'For a duplicate copy, the path segments that tell it from the other copies, '
              + 'with the shared root removed. Null for everything else.',
          },
        },
        required: ['name', 'version', 'origin', 'planes', 'mounts', 'duplicate', 'location'],
      },
    },
    warnings: {
      type: 'array',
      description:
        'Non-fatal collection problems, as structured facts. A warning means the reading is '
        + 'incomplete in the way it names.',
      items: { type: 'object', properties: { kind: { type: 'string' } }, required: ['kind'] },
    },
    filter: { ...NULLABLE_STRING, description: 'The name filter this reading was taken through.' },
  },
  required: ['collectedAt', 'harness', 'packages', 'warnings', 'filter'],
}

/**
 * Build the tool definition bound to one context.
 * @param ctx - a scope injecting both `loader` and `tools`.
 * @returns the definition to register.
 */
export function versionInventoryTool(ctx: Context): ToolDefinition {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        package: {
          type: 'string',
          description:
            'Case-insensitive substring of a package name. Omit for the whole install; pass it '
            + 'to answer a question about one plugin without reading every row.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [
        { type: 'text', text: englishReport(value as unknown as SharedInventory) },
      ],
    },
    // Read-only and stateless: every call re-reads the Loader tree and the
    // preset compositions, and nothing here touches parent-owned state.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      // A raw definition owns its own argument validation. The schema is
      // advisory here, so a non-string `package` is refused rather than
      // coerced into a filter that quietly matches nothing.
      const requested = (args as { package?: unknown }).package
      if (requested !== undefined && typeof requested !== 'string') {
        throw new TypeError('package must be a string when given.')
      }
      const inventory = await collect(ctx)
      exec.signal.throwIfAborted()
      return shareableInventory(inventory, requested ?? null)
    },
  }
}

/**
 * Register the tool for as long as this plugin's fiber lives.
 * @param ctx - a scope injecting both `loader` and `tools`.
 */
export function registerTool(ctx: Context): void {
  ctx.effect(() => ctx.tools.register(versionInventoryTool(ctx)), 'version-inventory: tool')
}
