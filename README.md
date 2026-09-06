# dsh-version-inventory

English | [中文](README.zh.md)

Shows the **running DeepSeek Harness version** and **the package version of every mounted plugin** inside the dsh web UI.

Settings → Plugins → **Versions**, beside the shipped plugin list. That list shows module names, enablement, and fiber state but no versions; this tab adds the version column, plus the install path, Node version, `DSH_HOME`, a duplicate-copy alarm, and a warning when a harness package drifts from the running harness version. Each row copies as `name@version`, and the header copies a share-safe report of the whole install. The same reading is registered as the `dsh_version_inventory` tool, so an agent in a session can read it directly.

The UI follows the client's language setting — English and Simplified Chinese ship in the box.

## The two planes

The harness mounts plugins on **two planes**, and the panel reads both:

- **The global plane** — the profile's Loader tree: the bundle patch layers under your own `cordis.patch.yml`. This is what `ctx.loader.entries()` walks.
- **The preset plane** — each agent preset's composition (`agent.<preset>.yml`), mounted **per session** when that preset is selected. A plugin that lives only in a preset — `@deepseek-ai/dsh-tool-cordis` in the shipped `cordis` (Creator mode) preset, say — never appears in the global Loader tree at all.

Reading only the global plane misses the second one. The panel fills it in through the optional `ctx.get('agentPresets')` service and its `compositionInventory()`, which reads composition **files** rather than the live tree: an unmounted preset still lists its plugins, and reading one cannot mount it early. A deployment that composes no roster is a real shape, not a failure — there the preset plane is simply empty.

Every mount carries its plane, the panel filters by plane, and a package mounted on both planes is one row listing both mounts.

## Packages and mounts

**A package is code; a mount is one loading of that code** — with its own id, its own config, and its own fiber. Mounting one package several times is the design, not duplication: the shipped `@deepseek-ai/dsh-tool-subagent` is mounted three times in Creator mode, and config alone turns it into the `subagent`, `subagent_fork`, and `subagent_codex` tools.

So each mount shows its config summary, the one thing that tells two mounts apart:

```
● tool-subagent       Creator mode  running
  provider=spawn  toolName=subagent  backgroundMode=continuable
● tool-subagent-fork  Creator mode  running
  provider=fork   toolName=subagent_fork
```

The summary is not a config dump: top-level fields only, nested values collapsed to their shape (`{provider, toolName, …}`, `[3]`), strings truncated at 60 characters, and anything past eight fields counted rather than listed. **A key containing `key`, `token`, `secret`, `password`, `credential`, or `auth` has its value withheld as `***`** — over-redaction is the safe direction, since withholding a benign value costs one look at the config file while printing a token costs a rotation.

A preset composition inventory carries no config, so preset rows read "config not visible" rather than "no config".

## How it gets the versions

Both planes hand out **module specifiers** (`@deepseek-ai/dsh-tool-bash`, `file:///…/lib/index.js`), never versions. So the host half does three things:

1. Walks the global entries (skipping groups) and every preset's composition rows.
2. Resolves each specifier through the Loader's own resolver (`loader.internal.resolveSync`, falling back to `createRequire(baseUrl).resolve`) and walks up from the resolved file to the nearest `package.json` — deliberately bypassing the `exports` map, because not every package publishes `./package.json`.
3. Reads `name` / `version` / `description` / `dsh.bundle` / `dsh.client`, and merges mounts **by the package's directory** (so the subpath entry `@deepseek-ai/dsh-tool-subagent/model-selection-settings` folds onto `@deepseek-ai/dsh-tool-subagent`, since both resolve into the same directory).

Merging by directory rather than by name is deliberate: **two copies of one package at two versions** is the condition most worth finding — Cordis matches services, branded types, and `instanceof` on runtime identity, so duplicate copies mismatch silently — and merging by name would fold the second copy away, version and all. Duplicates now take one row each, sorted adjacent, tagged, and named in a banner.

**The order of resolution bases is not arbitrary.** A preset row's package name resolves from the **profile's** base, with the preset's own directory only as the fallback for a relative path. That mirrors what the roster itself does: a user-authored preset lives under the harness home, where Node's upward `node_modules` walk never reaches the harness's dependencies, so the preset directory is the wrong base for a package name. Path-like specifiers are checked with `existsSync` first, because a relative path that resolves to nothing would otherwise walk up into some unrelated `package.json` and be reported as the owner.

The harness's own version comes from the `package.json` above `process.argv[1]` — **the bin that is actually running**, whether that is `apps/cli/src/bin.ts` in a source checkout or `node_modules/@deepseek-ai/dsh/lib/bin.js` from an install. When that is unreachable it degrades to the modal version among the loaded `@deepseek-ai/*` packages, and the panel marks the answer as inferred rather than presenting it as fact.

`cordis:` builtins have no package and no version; they are reported as Cordis builtins instead of being given an invented one.

## Copying versions

Two controls, because two questions come up: *what version of this one plugin am
I running*, and *what does this whole install look like*.

- Each package row copies `name@version` — one token, as pasteable into a
  terminal or a search box as into a message.
- The header copies a short environment report: the harness version and where
  that answer came from, Node and platform, the collection time in UTC, every
  third-party plugin with its version and planes, the harness packages folded to
  one line when they all match, the builtin count, and any collection warning.

The report is always the whole inventory, never the filtered view. The search
box and the plane selector shape what one person is reading; a report that
inherited them would under-report an install without saying so.

**It carries no filesystem path, no `DSH_HOME`, no user-authored preset name,
and no config value.** That is the format, not a toggle. The read route is
fenced to same-origin loopback precisely because the snapshot names host paths
and config keys — and a copy control exists to move text off the machine, which
inverts that fence. So the report is built from the half of the snapshot that is
safe to hand to someone else. The one exception is a duplicate group, where the
copies mean nothing without something to tell them apart: there the longest
common directory prefix is dropped and only the differing segments survive
(`…/node_modules/dup` against `…/plugins/a/node_modules/dup`).

Every hedge in the panel survives the copy. An inferred harness version still
says `(inferred from loaded packages)`, a package with no manifest version reads
`name@unknown`, and the collection warnings are carried whole — a qualifier
dropped in the copy is what turns this panel's inference into the reader's fact.

The text is plain, one fact to a `- ` line: it reads as written in a chat window
or a file, and keeps its line breaks when something does render it as Markdown.
It follows the panel's language, and writes through the harness's own
`writeClipboard`, which falls back to `execCommand` where an insecure context
has no async Clipboard API and reports a refusal rather than throwing. Like
every dsh copy control, a refused write is silent: the label just does not
change.

## Reading it from a session

The same reading is registered as a model-facing tool, `dsh_version_inventory`,
so the agent in a dsh session can answer a version question itself instead of
asking its user to open a settings tab and paste a report back. That is the
reader that needs it most: "which version of this plugin is running" is a
question that comes up in the middle of debugging, when the answer is a
prerequisite for the next step rather than the point of the conversation.

One optional parameter, `package`, takes a case-insensitive substring of a
package name. Omitted, the tool reports the whole install; given, it reports the
matching packages and nothing else, which is the difference between twenty-five
lines and five for the common question.

**Its result is the same projection the copy control produces**, and that is the
point rather than an economy. A tool result is not a private reading: it enters
the transcript, goes to the model provider on every following turn, and may be
exported later — the same exposure as a pasted report, and the opposite of the
one the read route is fenced for. Sharing the projection means the model reader
cannot quietly become wider than the human one. It also drops each package's
`description`, which matters more here than in the panel: a description is text
a third-party package author wrote, and this is the one path that feeds it to a
model.

The canonical value is structured and the prose lives in the renderer, which is
what the tool authoring contract asks for: a PTC caller reads fields rather than
parsing sentences, while a native call sees the same report a person would copy.
Warnings stay structured there too — the same "facts cross the boundary, the
reader writes the sentence" rule the host half already follows.

The rendered text is English regardless of the panel's language. The harness's
locale is a browser-side preference and the host has no locale service, so the
tool renders through `en` — the dictionary's key source of truth and the
harness's own fallback locale — rather than guessing at a reader whose language
nobody stated.

Nothing in the tool path imports the tools package at runtime. `ToolDefinition`
is a type, `ctx.tools.register` takes a plain object, and `defineTool` is only a
typed builder over the same shape — so `@deepseek-ai/dsh-tools` stays a
`devDependency` and this package keeps its property that every capability
arrives through `ctx`. The cost is that a raw definition owns its own argument
validation, which for one optional string is cheaper than the dependency would
be.

## Layout

| File | Role |
|---|---|
| `src/index.ts` | Host plugin entry; `inject: ['loader']`, with the route and the tool each registered under a nested injection |
| `src/inventory.ts` | Collection: mounts on both planes → package rows |
| `src/web.ts` | `GET /dsh-version-inventory/api/list`, fenced to same-origin loopback with a custom header |
| `src/client/index.tsx` | Contributes the tab through `ctx.slots.inject('settings.plugins.tab', …)` and registers the dictionaries |
| `src/client/panel.tsx` | The panel itself |
| `src/report.ts` | The share-safe projection, and its rendering — read by the panel, the copy control, and the tool |
| `src/tool.ts` | The `dsh_version_inventory` tool: schema, canonical value, and English rendering |
| `src/locales.ts` | `en` and `zh` dictionaries; `en` is the key source of truth |
| `src/types.ts` | Wire types shared by both halves (the browser side imports them type-only) |

The host half holds no state: every request re-reads. The Loader already maintains `Entry.fiber` and `Fiber.state`, and the preset roster deliberately re-reads its roots on every call, so a second cache would only add another lifecycle truth to keep synchronized.

`webServer` and `tools` are both **nested** dependencies (`ctx.inject(['webServer'], …)`) rather than declared ones, so the same package loads wherever the harness runs: a headless or ACP profile gets the tool and no panel, a deployment that composes no agents gets the panel and no tool, and neither holds the tree pending forever waiting for a service that is never coming.

Warnings cross the wire as **structured facts**, not sentences: the host cannot know the reader's language, so it reports `{ kind: 'duplicate-packages', names: [...] }` and the panel writes the sentence. The route's failures follow the same rule — `{ error: { kind: 'forbidden' } }`, not a refusal written in whichever language the author happened to be typing in — and an `error` whose `kind` the bundle does not recognize degrades to its raw text rather than to an invented sentence. That also makes the route's JSON useful to anything else that reads it.

## Compatibility

| | |
|---|---|
| Node | `^22.19.0 \|\| >=24.0.0` |
| DSH | `>= 0.1.2-rc.1`. The panel needs a `web` profile (`webServer` and `settings.plugins.tab`); the tool needs `tools`. Either alone is a working install |
| Runtime dependencies | **none** |

**This package declares no `dependencies` and no `peerDependencies`, deliberately.** It imports no harness module at runtime — the host half imports Node builtins only, the browser half requires platform seed modules only, and every capability arrives through `ctx`. Every `@deepseek-ai/*` package is a `devDependency`, used for types and tests.

Peer ranges are omitted because they would misfire today: the dsh family ships prereleases (`0.1.2-rc.1`, `0.1.3-alpha.1`), and semver only admits a prerelease when the range holds a comparator with the same `[major.minor.patch]`, so `>=0.1.2-rc.1` does **not** match `0.1.3-alpha.1`. Any pinned range would warn on a healthy install. They can come back once dsh ships stable versions.

Every missing service degrades explicitly: no `webServer` means no route (a headless or ACP profile still loads the package and still registers the tool), no `tools` means no tool, no `agentPresets` means an empty preset plane, and no `settings.plugins.tab` declaration means no tab.

## Build and test

```bash
npm install && npm test
```

`npm test` builds, then runs the suites under `test/`:

- `inventory.test.mjs` — a real Cordis Loader and real `package.json` resolution, with a roster stub implementing only `list()` and `compositionInventory()`. Entries are created `disabled: true`: a disabled entry is never imported, so the tests exercise resolution and manifest reading without starting any plugin. Two real package directories under `test/fixtures/` supply the same-name, different-version duplicate case.
- `client-bundle.test.mjs` — runs the real `@deepseek-ai/dsh-client-modules` scanner from npm: the package joins the boot graph, the `/plugins` route serves the built bundle, the factory id matches the module-table key, and **the bundle requires nothing beyond the platform seeds**. That last one is the most valuable check here — the commonest way a browser plugin breaks is one extra `require` the module table cannot answer, which throws when the factory materializes.
- `locales.test.mjs` — every locale ships the same keys and the same `{placeholder}` set. TypeScript already enforces key parity; a dropped placeholder is what it cannot see.
- `web.test.mjs` — the same-origin loopback fence, and the shape of what the route answers when it refuses. The last assertion is the regression guard: the route may not write copy of its own, because a sentence written in the host process is a sentence written in the wrong language for some reader.
- `report.test.mjs` — the projection and the text it renders to, through the real `en` dictionary. The assertions that matter are about what may **not** appear: a change that starts carrying a path, a `DSH_HOME`, a config value, a package description, or a user-authored preset name has to fail here rather than in someone's pasted message or a model transcript.
- `tool.test.mjs` — the tool definition against the registry's own `assertSupportedJsonSchema` and `validateJsonSchemaValue`. Registering a raw definition rather than a `defineTool` one moves both checks off the builder, and without them a schema that does not describe its value fails at mount time or on the first call, in a session. It also pins the wiring: `inject` names only the loader, and both surfaces are nested.

`npm run verify:pack` runs `publint` and `@arethetypeswrong/cli` (`--profile node16`). Two known exceptions:

- publint reports `exports["./client"]` as "CJS written as ESM". `lib/client.js` is never resolved by Node — the page's module system evaluates it as a classic script. The harness suppresses exactly this verdict for exactly this filename (`isBrowserBundleFormatFalsePositive` in `scripts/publint-all.ts`).
- attw's `cjs-resolves-to-esm` is ignored explicitly: this is an ESM-only package and a CJS `require()` of it is a non-goal.

`npm run release:check` runs the tests and the packaging checks together — run it before publishing. The packaging checks stay out of `prepublishOnly` on purpose: attw's `--pack` shells out to `npm pack`, which inherits `npm_config_dry_run` from `npm publish --dry-run` and then writes no tarball, so keeping them there would make the publish rehearsal unrunnable. CI runs them on every push.

The artifacts are `lib/index.js` (ESM, host half) and `lib/client.js` (CJS, browser half, wrapped in `window.__ModuleLoader__.load({ id, factory })`). The `id` must equal the `name` in `package.json`, or the browser module table never finds the factory.

The browser bundle may only `require()` platform seed modules (`react`, `react/jsx-runtime`, `react-dom`, `@deepseek-ai/cordis`, `dsh-client-store`, `dsh-client-ui-slots`, `dsh-client-ui-primitives`). Everything else must be inlined — a `require` the table cannot answer throws at materialization. That is why `@deepseek-ai/dsh-client-ui-settings`, `-renderer`, and `-locale` are type-only imports (for the `SlotMap`, `Context.slots`, and `Context.locale` merges) and never touched at runtime.

Declarations come from `tsc` into `lib/types/`, one entry per half (`.` → `lib/types/index.d.ts`, `./client` → `lib/types/client/index.d.ts`). The browser bundle cannot use tsdown's dts pass: it would wrap the `__ModuleLoader__` banner and footer into a `.d.cts` that does not parse.

## Install

### From npm

```bash
dsh plugin --profile web add dsh-version-inventory
```

`package.json` declares `dsh.bundle.patch`, so `dsh plugin` appends the package to `dsh.profile.bundles` after installing it, and this package's `cordis.patch.yml` inserts the plugin row by bare package name. Verify the layer before booting:

```bash
dsh --profile web --dump-config
```

### From GitHub

```bash
dsh plugin --profile web add github:kristol07/dsh-version-inventory
```

A git install fetches sources, not build output, so pnpm has to run this package's `prepare` script — and pnpm ≥10 refuses until you allow it. The first `add` fails and prints the exact key; put it in the profile's `pnpm-workspace.yaml` and re-run:

```yaml
allowBuilds:
  dsh-version-inventory: true
```

That allowance is **permission to execute this package's code on your machine at install time**, outside any sandbox the agent runs under. Pin a commit (`github:kristol07/dsh-version-inventory#<sha>`) so a later push cannot silently change what runs — or use the npm or tarball route, neither of which needs any build permission.

### From a tarball

```bash
npm pack
dsh plugin --profile web add ./dsh-version-inventory-0.2.0.tgz
```

### From a local checkout, for development

```bash
dsh plugin --profile web add link:/path/to/dsh-version-inventory
```

`link:` symlinks the checkout, so `npm run build` is enough to pick up a change — no reinstall.

Or skip installing entirely and point a patch layer at the build output. In `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-version-inventory
      name: ../../plugins/dsh-version-inventory/lib/index.js
```

A relative name is anchored to that patch file's directory and becomes a `file://` URL; the client-modules scan then walks up from it to this package's `package.json` and reads `dsh.client` and `exports["./client"]`. The `web` profile is `patchReload: live`, so editing the patch needs no restart.

Do **not** combine these routes — each inserts its own row.

## Known limitations

- **The report is a fingerprint, not a manifest.** It names the packages the harness mounted and their versions. It is not a lockfile and cannot rebuild an environment: transitive dependencies, patch-layer contents, and which preset a session composed are all outside it. Two matching reports mean the mounted versions match, not that the environments do.
- **One snapshot per mount.** The panel reads once when it mounts and then on the Refresh button; it does not subscribe to Loader changes.
- **Read-only.** No enable/disable controls.
- **Versions come from the `package.json` on disk.** A package that was hot-reloaded without its manifest changing still shows the on-disk version.
- **Duplicate detection follows resolution.** Both copies must be referenced by some mount. A second copy sitting on disk that nothing references is invisible here.
- **A preset row's fiber state depends on whether it has been mounted.** A preset no session has composed reports enablement but no runtime state, and `conditional` means a `!!js` gate only a real mount can decide.
- **The config summary stops at the top level.** Nested structures show their shape; read `cordis.patch.yml` or the preset's composition file for full values.
- **The route is local and same-origin only.** The inventory names host filesystem paths and config keys, so `/dsh-version-inventory/api/list` requires a loopback host, a same-origin `Origin`, and the `X-DSH-Version-Inventory: 1` header.

## Releasing

A pushed `v*` tag publishes; nothing publishes on a merge. There are no npm
secrets: the workflow uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/),
where GitHub Actions mints a short-lived credential over OIDC.

```bash
npm run release:check
npm version patch          # or minor / major / an explicit x.y.z
git push origin main --follow-tags
```

`docs/publishing.md` has the one-time GitHub and npm setup and the full flow —
including the two gotchas worth knowing before the first tag: declaring
`environment: npm` does not by itself require approval, and the environment's
deployment rule has to allow **tags**, not just branches.

## License

MIT © Joel Liu
