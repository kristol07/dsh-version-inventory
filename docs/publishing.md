# Publishing to npm

English | [中文](publishing.zh.md)

This package publishes through [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/):
GitHub Actions mints a short-lived credential over OIDC, so there is no npm
password, no `NPM_TOKEN`, and no `NODE_AUTH_TOKEN` secret anywhere.

`.github/workflows/publish.yml` runs on a pushed `v*` tag. It checks the tag
against `package.json` and `package-lock.json`, checks the commit is an ancestor
of `main`, refuses a version already on the registry, runs the tests and the
packaging checks, packs a tarball — and then a second job publishes **that
tarball**. Publishing the artifact that was tested removes the window where a
rebuild could differ from the one the tests passed against, and publishing a
tarball runs no lifecycle scripts at all.

Stable versions go to the `latest` dist-tag; a version with a prerelease suffix
goes to `next`, so a beta never displaces the stable line.

## One-time GitHub setup

1. Push the workflow to `main` first — npm matches the run against the workflow
   **filename**, so it has to exist on the default branch.
2. **Settings → Environments → New environment**, named **`npm`**. The name must
   match what npm has on file and what the workflow declares.
3. Under **Deployment branches and tags**, choose **Selected branches and tags**
   and add a **Tag** rule `v*`. A branches-only rule blocks the run, because the
   release runs from a tag.
4. Optional, and worth it: add yourself under **Required reviewers** to make the
   release a two-key operation. Leave **Prevent self-review** off, or as the
   sole maintainer you cannot approve your own tag.

Declaring `environment: npm` in the workflow does **not** by itself require
approval — GitHub silently creates an unprotected environment of that name. If
you want the gate, configure it in settings before pushing a tag.

## One-time npm setup

Sign in to the npm account that owns the package, then **Packages → the package
→ Settings → Trusted publishing → Add trusted publisher → GitHub Actions**:

| Field | Value |
| --- | --- |
| Organization or user | `kristol07` |
| Repository | `dsh-version-inventory` |
| Workflow filename | `publish.yml` (filename only) |
| Environment name | `npm` |
| Allowed actions | allow direct **`npm publish`** |

That last row matters: a new configuration may default to staged publishing
only, and this workflow publishes directly.

Trusted publishing configures per package, so the package must exist first. For
the very first release, publish once manually (see below), add the trusted
publisher, and let CI handle every release after that.

## Releasing

```bash
npm run release:check
npm version patch                 # or minor / major / an explicit x.y.z
git push origin main --follow-tags
```

`npm version` writes the manifest, updates the lockfile, commits, and tags in
one step, so the three cannot disagree. Update `CHANGELOG.md` and commit it
before tagging.

Then watch **Actions → Publish to npm**. If you configured required reviewers,
check the run summary — it names the version, the commit, and the dist-tag —
optionally download the `npm-package` artifact to inspect what will ship, then
**Review deployments → npm → Approve and deploy**.

Afterwards:

```bash
npm view dsh-version-inventory@<version> version
npm view dsh-version-inventory dist-tags --json
```

A published version cannot be overwritten and a tag should not be moved. If a
run fails on configuration, fix the setting and re-run the failed job; if the
code or the workflow has to change, cut a new version and a new tag.

## Manual first publish

Trusted publishing needs an existing package to attach to, so the first release
is manual:

```bash
npm login --registry=https://registry.npmjs.org
npm run release:check
npm publish --access public
```

Do this on the exact commit the tag points at, and do not also run the workflow
for that version — a version publishes once.

## GitHub repository topics

The harness README asks plugin authors to add the
[`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to their repository,
which is how plugins are found on GitHub. Set it once:

```bash
gh repo edit kristol07/dsh-version-inventory \
  --add-topic dsh-plugin --add-topic deepseek-harness --add-topic dsh
```

The matching npm keywords are already in `package.json`; the two indexes are
separate, so both are worth setting.
