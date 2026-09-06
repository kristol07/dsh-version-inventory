# Changelog

## 0.1.0 — 2026-09-06

- Adds a read-only **版本** tab to the dsh web Settings → Plugins section, beside the shipped plugin list: the running harness version with its provenance, Node and platform, `DSH_HOME`, the install root, and the version of every package the harness mounted.
- Reads both harness planes. The profile's own Loader tree comes from `ctx.loader.entries()`; every agent preset's composition comes from the optional `ctx.get('agentPresets').compositionInventory()`, which reads composition files, so a plugin that exists only inside a preset — `@deepseek-ai/dsh-tool-cordis` in the shipped `cordis` preset — is listed even when no session has mounted that preset. Each mount is tagged with its plane and the list filters by plane.
- Resolves each mount's specifier through the Loader's own resolver and reads the nearest `package.json`, bypassing the `exports` map so a package that does not publish `./package.json` still answers. Subpath specifiers fold onto their owning package. A path-like specifier is verified with `existsSync` first, so a missing relative path cannot walk up into an unrelated manifest.
- Groups packages by **directory**, not by name, so two copies of one package at two versions stay two rows. Duplicates are tagged, sorted adjacent, and named in a warning: Cordis matches services, branded types, and `instanceof` on runtime identity, so duplicate copies mismatch silently.
- Shows each mount's config summary, the only thing that tells two mounts of one package apart. Top-level fields only, nested values collapsed to their shape, strings truncated, and any key naming a credential withheld.
- Flags a harness package whose version differs from the running harness version. The dsh family releases in lockstep, so a difference means the install was mixed.
- Serves the snapshot from `GET /dsh-version-inventory/api/list`, fenced to same-origin loopback requests carrying `X-DSH-Version-Inventory: 1`, because the inventory names host filesystem paths.
- Builds against npm DSH `0.1.2-rc.1`; the interfaces it uses were read from local source `0.1.3-alpha.1`. No source build of the harness is required.
