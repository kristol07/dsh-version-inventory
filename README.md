# dsh-version-inventory

在 dsh Web 界面里显示**当前 Harness 版本**和**每个已加载插件的包版本**。

设置 → 插件 → **版本** 标签页，就在官方的「插件列表」标签旁边。官方那个标签只显示模块名、启用状态和 fiber 状态，不显示版本号；这个插件补上版本这一列，并额外给出安装位置、Node 版本、`DSH_HOME`，以及官方包之间的版本漂移告警。

## 它怎么拿到版本号

Loader 的条目只记录**模块说明符**（`@deepseek-ai/dsh-tool-bash`、`file:///…/lib/index.js`），不记录版本。所以宿主半边做三件事：

1. 遍历 `ctx.loader.entries()`，跳过 group 条目；
2. 用 Loader 自己的解析器（`loader.internal.resolveSync`，退化时用 `createRequire(baseUrl).resolve`）把说明符解析成模块 URL，再从该文件向上找最近的 `package.json` —— 刻意绕开 `exports` 映射，因为不是每个包都导出 `./package.json`；
3. 读出 `name` / `version` / `description` / `dsh.bundle` / `dsh.client`，并按包名把同一个包的多个条目合并（子路径条目 `@deepseek-ai/dsh-tool-subagent/model-selection-settings` 会归到 `@deepseek-ai/dsh-tool-subagent` 名下）。

Harness 自身的版本来自 `process.argv[1]` 向上找到的 `@deepseek-ai/dsh` 的 `package.json` —— 也就是**正在运行的那个 bin**，无论它是源码检出里的 `apps/cli/src/bin.ts` 还是安装出来的 `node_modules/@deepseek-ai/dsh/lib/bin.js`。找不到时退化为「已加载的 `@deepseek-ai/*` 包里出现次数最多的版本」，并在界面上标明这是推断值，不会假装是确定答案。

`cordis:` 内置条目没有包也没有版本，界面如实显示为「Cordis 内置」而不是编一个版本出来。

## 结构

| 文件 | 作用 |
|---|---|
| `src/index.ts` | 宿主插件入口；`inject: ['loader']`，并在 `webServer` 出现后嵌套注册读取路由 |
| `src/inventory.ts` | 采集逻辑：Loader 条目 → 包清单 |
| `src/web.ts` | `GET /dsh-version-inventory/api/list`，同源 + loopback + 自定义头的信任围栏 |
| `src/client/index.tsx` | 通过 `ctx.slots.inject('settings.plugins.tab', …)` 贡献标签页 |
| `src/client/panel.tsx` | 面板本体 |
| `src/types.ts` | 两半共用的 wire 类型（浏览器侧只做 type-only import） |

宿主半边不持有任何状态：每次请求都重新读一遍 Loader 树。Loader 已经维护着 `Entry.fiber` 和 `Fiber.state`，再加一份缓存只会多出一个需要同步的真相来源。

`webServer` 是**嵌套依赖**（`ctx.inject(['webServer'], …)`）而不是声明依赖，所以同一个包在 headless / ACP profile 里也能加载 —— 在那里它只是什么都不贡献，而不会让整棵树一直 pending。

## 构建

```bash
npm install && npm run build
```

产物是 `lib/index.js`（ESM，宿主半边）和 `lib/client.js`（CJS，浏览器半边，带 `window.__ModuleLoader__.load({ id, factory })` 外壳）。`id` 必须与 `package.json` 的 `name` 一致，否则浏览器模块表取不到这个 factory。

浏览器 bundle 只允许 `require()` 平台种子模块（`react`、`react/jsx-runtime`、`react-dom`、`@deepseek-ai/cordis`、`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`）。其他一切都必须内联进 bundle —— 模块表答不上来的 `require` 在 materialize 时直接抛错。因此 `@deepseek-ai/dsh-client-ui-settings` / `-renderer` 只做 type-only 引入（拿 `SlotMap` 和 `Context.slots` 的声明合并），运行时不碰。

## 装载

### 方式一：profile patch（当前采用，无需安装）

`~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-version-inventory
      name: ../../plugins/dsh-version-inventory/lib/index.js
```

相对路径会以该 patch 文件所在目录为基准锚定成 `file://` URL；client-modules 扫描再从这个文件向上找到本目录的 `package.json`，读到 `dsh.client` 和 `exports["./client"]`。web profile 是 `patchReload: live`，改 patch 不用重启。

### 方式二：作为 bundle 安装

```bash
dsh plugin --profile web add link:C:/Users/joell/.dsh/plugins/dsh-version-inventory
```

`package.json` 里声明了 `dsh.bundle.patch`，所以安装后它会自动进入 `dsh.profile.bundles` 层叠，由本目录的 `cordis.patch.yml` 用裸包名插入条目。

两种方式**不要同时用**，否则会插入两条重复条目。

## 已知限制

- **一次读取一份快照**：面板挂载时读一次，之后靠「刷新」按钮，不订阅 Loader 变化。
- **只读**：不提供启用/停用开关。
- **版本来自磁盘上的 `package.json`**：一个热更新过、但 `package.json` 未随之改动的包，显示的仍是磁盘上的版本号。
- **路由只对本地同源开放**：清单会暴露宿主文件路径，所以 `/dsh-version-inventory/api/list` 要求 loopback host、同源 Origin，以及 `X-DSH-Version-Inventory: 1` 头。
