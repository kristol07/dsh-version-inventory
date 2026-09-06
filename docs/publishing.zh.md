# 发布到 npm

[English](publishing.md) | 中文

本包使用 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)：
GitHub Actions 通过 OIDC 换取短期发布凭据，因此不需要 npm 密码，也不需要
`NPM_TOKEN` 或 `NODE_AUTH_TOKEN` secret。

`.github/workflows/publish.yml` 在推送 `v*` tag 时运行。它先核对 tag 与
`package.json`、`package-lock.json` 的版本是否一致，核对该 commit 是否属于
`main`，拒绝已经发布过的版本，跑测试和打包检查，打出 tarball —— 然后由第二个 job
发布**同一个 tarball**。发布被测过的那个产物，消除了「重新构建可能与测试对象不同」的
窗口；而且发布 tarball 完全不会执行任何 lifecycle 脚本。

正式版本进 `latest`，带预发布后缀的版本进 `next`，所以 beta 不会顶掉稳定线。

## 一次性配置 GitHub

1. 先把 workflow 推到 `main`：npm 是按 workflow **文件名**匹配的，它必须存在于默认分支上。
2. **Settings → Environments → New environment**，名称填 **`npm`**。这个名称必须与 npm 侧登记的、以及 workflow 里声明的一致。
3. 在 **Deployment branches and tags** 选 **Selected branches and tags**，添加 **Tag** 类型规则 `v*`。只允许分支会直接卡住这次运行，因为发布是从 tag 触发的。
4. 可选但值得做：在 **Required reviewers** 里加上自己，让发布变成两把钥匙。**Prevent self-review** 保持关闭，否则你无法批准自己推的 tag。

注意：仅在 workflow 里写 `environment: npm` **不会**自动要求人工确认 —— GitHub 会悄悄创建一个没有保护规则的同名环境。想要这道闸，必须在推 tag 之前到设置里配好。

## 一次性配置 npm

用拥有该包权限的 npm 账号登录，打开 **Packages → 该包 → Settings → Trusted
publishing → Add trusted publisher → GitHub Actions**：

| 字段 | 值 |
| --- | --- |
| Organization or user | `kristol07` |
| Repository | `dsh-version-inventory` |
| Workflow filename | `publish.yml`（只填文件名） |
| Environment name | `npm` |
| Allowed actions | 允许直接 **`npm publish`** |

最后一行很重要：新建的配置可能默认只允许 staged publishing，而本 workflow 是直接
`npm publish`。

Trusted publishing 是按包配置的，所以包必须先存在。首个版本手动发一次（见下），配好
trusted publisher，之后全部交给 CI。

## 发布流程

```bash
npm run release:check
npm version patch                 # 或 minor / major / 明确的 x.y.z
git push origin main --follow-tags
```

`npm version` 一步完成改清单、更新 lockfile、提交、打 tag，三者不可能对不上。打 tag
前先更新并提交 `CHANGELOG.md`。

然后看 **Actions → Publish to npm**。如果配了 required reviewers，先核对运行摘要
（里面有版本、commit、dist-tag），需要的话下载 `npm-package` artifact 检查内容，再
点 **Review deployments → npm → Approve and deploy**。

发布后确认：

```bash
npm view dsh-version-inventory@<version> version
npm view dsh-version-inventory dist-tags --json
```

已发布的版本不能覆盖，tag 也不要移动。如果只是配置问题导致失败，改完设置在 Actions
里重跑失败的 job；如果需要改代码或 workflow，换一个新版本和新 tag。

## 首次手动发布

Trusted publishing 需要一个已存在的包来挂载，所以第一个版本是手动的：

```bash
npm login --registry=https://registry.npmjs.org
npm run release:check
npm publish --access public
```

在 tag 指向的那个 commit 上执行，并且**不要**再对同一版本跑一次 workflow —— 一个版本只发一次。

## GitHub 仓库 topic

Harness 的 README 要求插件作者给仓库加上
[`dsh-plugin`](https://github.com/topics/dsh-plugin) topic，这是插件在 GitHub 上
被检索到的方式。配置一次即可：

```bash
gh repo edit kristol07/dsh-version-inventory \
  --add-topic dsh-plugin --add-topic deepseek-harness --add-topic dsh
```

对应的 npm keywords 已经写在 `package.json` 里；这是两套独立的索引，都值得配。
