# dsh-version-inventory

在 dsh Web 界面里显示**当前 Harness 版本**和**每个已加载插件的包版本**。

设置 → 插件 → **版本** 标签页，就在官方的「插件列表」标签旁边。官方那个标签只显示模块名、启用状态和 fiber 状态，不显示版本号；这个插件补上版本这一列，并额外给出安装位置、Node 版本、`DSH_HOME`，以及官方包之间的版本漂移告警。

## 两个平面

Harness 把插件挂在**两个平面**上，面板两边都读：

- **全局平面** —— profile 的 Loader 树：bundle patch 层叠加上你自己的 `cordis.patch.yml`。`ctx.loader.entries()` 走的就是这里。
- **preset 平面** —— 每个 agent preset 的 composition（`agent.<preset>.yml`），**按会话挂载**：某个会话选了哪个 preset，才挂那个 preset 的行。所以一个只存在于 preset 里的插件（比如创造模式的 `@deepseek-ai/dsh-tool-cordis`）在全局 Loader 树里根本查不到。

只读全局平面会漏掉后者。面板通过可选服务 `ctx.get('agentPresets')` 的 `compositionInventory()` 补上 —— 那是**读文件**，不是读活的树，所以没开会话也能列出来，而且读取本身不会提前挂载任何 preset。没有 preset 名册的部署是一种真实形态，不是故障，这种情况下 preset 平面为空。

每个挂载都带自己的平面标记，面板顶部可以按平面过滤；同一个包在两个平面各挂一次，会合并成一行、列出两个挂载。

## 它怎么拿到版本号

两个平面给出的都只是**模块说明符**（`@deepseek-ai/dsh-tool-bash`、`file:///…/lib/index.js`），不记录版本。所以宿主半边做三件事：

1. 遍历全局条目（跳过 group）和每个 preset 的 composition 行；
2. 用 Loader 自己的解析器（`loader.internal.resolveSync`，退化时用 `createRequire(baseUrl).resolve`）把说明符解析成模块 URL，再从该文件向上找最近的 `package.json` —— 刻意绕开 `exports` 映射，因为不是每个包都导出 `./package.json`；
3. 读出 `name` / `version` / `description` / `dsh.bundle` / `dsh.client`，并**按包所在目录**把多个挂载合并（子路径条目 `@deepseek-ai/dsh-tool-subagent/model-selection-settings` 会归到 `@deepseek-ai/dsh-tool-subagent` 名下，因为两者解析到同一个目录）。

按目录而不是按包名归并是有意的：**同一个包同时存在两份不同版本**是最该被发现的情况 —— Cordis 服务、品牌类型和 `instanceof` 全都按运行时身份匹配，两份副本会静默失配 —— 而按包名归并恰好会把第二份折叠掉、连版本都丢了。现在两份副本各占一行、并排排序，各自带「副本」标记，顶部还有一条红色提示点名。

**解析基址的顺序不是随意的**：preset 行的包名要用 **profile 的基址**解析，preset 自己的目录只作为相对路径的兜底。这跟名册自己的做法一致 —— 用户自建的 preset 放在 harness home 下，Node 向上找 `node_modules` 永远走不到 harness 的依赖，所以 preset 目录是解析包名的错误基址。路径型说明符还会先 `existsSync` 校验，否则一个不存在的相对路径会向上撞到某个无关的 `package.json` 并被当成答案。

Harness 自身的版本来自 `process.argv[1]` 向上找到的 `@deepseek-ai/dsh` 的 `package.json` —— 也就是**正在运行的那个 bin**，无论它是源码检出里的 `apps/cli/src/bin.ts` 还是安装出来的 `node_modules/@deepseek-ai/dsh/lib/bin.js`。找不到时退化为「已加载的 `@deepseek-ai/*` 包里出现次数最多的版本」，并在界面上标明这是推断值，不会假装是确定答案。

`cordis:` 内置条目没有包也没有版本，界面如实显示为「Cordis 内置」而不是编一个版本出来。

## 结构

| 文件 | 作用 |
|---|---|
| `src/index.ts` | 宿主插件入口；`inject: ['loader']`，并在 `webServer` 出现后嵌套注册读取路由 |
| `src/inventory.ts` | 采集逻辑：两个平面的挂载 → 包清单 |
| `src/web.ts` | `GET /dsh-version-inventory/api/list`，同源 + loopback + 自定义头的信任围栏 |
| `src/client/index.tsx` | 通过 `ctx.slots.inject('settings.plugins.tab', …)` 贡献标签页 |
| `src/client/panel.tsx` | 面板本体 |
| `src/types.ts` | 两半共用的 wire 类型（浏览器侧只做 type-only import） |

宿主半边不持有任何状态：每次请求都重新读一遍。Loader 已经维护着 `Entry.fiber` 和 `Fiber.state`，preset 名册也刻意在每次调用时重读根目录，再加一份缓存只会多出一个需要同步的真相来源。

`webServer` 是**嵌套依赖**（`ctx.inject(['webServer'], …)`）而不是声明依赖，所以同一个包在 headless / ACP profile 里也能加载 —— 在那里它只是什么都不贡献，而不会让整棵树一直 pending。

## 构建与测试

```bash
npm install && npm test
```

`npm test` 先构建，再用 `node --test` 跑 `test/` 下的集成测试：真实的 Cordis Loader + 真实的 `package.json` 解析，preset 名册用一个只实现 `list()` / `compositionInventory()` 的替身。条目一律以 `disabled: true` 创建 —— 停用的条目永远不会被 import，所以测试只走解析和清单读取，不启动任何插件。

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
- **副本检测只看解析结果**：两份副本必须都被某个挂载引用才会被发现。装在磁盘上但没有任何条目引用的第二份副本，面板看不到。
- **preset 行的 fiber 状态取决于是否已挂载**：一个还没有会话挂载过的 preset，其行只有启用状态，没有运行状态；`conditional` 表示 `!!js` 门只有真正挂载时才能判定。
- **路由只对本地同源开放**：清单会暴露宿主文件路径，所以 `/dsh-version-inventory/api/list` 要求 loopback host、同源 Origin，以及 `X-DSH-Version-Inventory: 1` 头。
