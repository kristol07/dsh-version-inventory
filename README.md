# dsh-version-inventory

在 dsh Web 界面里显示**当前 Harness 版本**和**每个已加载插件的包版本**。

设置 → 插件 → **版本** 标签页，就在官方的「插件列表」标签旁边。官方那个标签只显示模块名、启用状态和 fiber 状态，不显示版本号；这个插件补上版本这一列，并额外给出安装位置、Node 版本、`DSH_HOME`，以及官方包之间的版本漂移告警。

## 两个平面

Harness 把插件挂在**两个平面**上，面板两边都读：

- **全局平面** —— profile 的 Loader 树：bundle patch 层叠加上你自己的 `cordis.patch.yml`。`ctx.loader.entries()` 走的就是这里。
- **preset 平面** —— 每个 agent preset 的 composition（`agent.<preset>.yml`），**按会话挂载**：某个会话选了哪个 preset，才挂那个 preset 的行。所以一个只存在于 preset 里的插件（比如创造模式的 `@deepseek-ai/dsh-tool-cordis`）在全局 Loader 树里根本查不到。

只读全局平面会漏掉后者。面板通过可选服务 `ctx.get('agentPresets')` 的 `compositionInventory()` 补上 —— 那是**读文件**，不是读活的树，所以没开会话也能列出来，而且读取本身不会提前挂载任何 preset。没有 preset 名册的部署是一种真实形态，不是故障，这种情况下 preset 平面为空。

每个挂载都带自己的平面标记，面板顶部可以按平面过滤；同一个包在两个平面各挂一次，会合并成一行、列出两个挂载。

## 「包」和「挂载」的区别

**包是代码，挂载是这份代码的一次装载**：一个 id、一份 config、一个 fiber。同一个包被挂多次是设计意图，不是重复项 —— 官方 `@deepseek-ai/dsh-tool-subagent` 在创造模式里就被挂了三次，靠 config 区分成 `subagent` / `subagent_fork` / `subagent_codex` 三个工具。

所以每个挂载都会显示自己的 config 摘要，这是唯一能把两次挂载分开的东西：

```
● tool-subagent       创造模式  运行中
  provider=spawn  toolName=subagent  backgroundMode=continuable
● tool-subagent-fork  创造模式  运行中
  provider=fork   toolName=subagent_fork
```

摘要不是 config 的转储：只取顶层字段，嵌套值折叠成形状（`{provider, toolName, …}`、`[3]`），长字符串截断到 60 字符，超过 8 个字段的部分只计数。**键名带 `key` / `token` / `secret` / `password` / `credential` / `auth` 的字段一律只显示 `***`** —— 宁可多挡，漏一个 token 的代价是轮换密钥，多挡一个无害字段的代价只是去看一眼配置文件。

preset composition 的清单本身不携带 config，所以 preset 行显示「config 不可见」，而不是显示成「无 config」。

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

## 兼容性

| 项 | 要求 |
|---|---|
| Node | `^22.19.0 \|\| >=24.0.0` |
| DSH | `>= 0.1.2-rc.1`，需要 `web` profile（`webServer` + `settings.plugins.tab`） |
| 运行时依赖 | **无** |

**这个包没有 `dependencies`，也没有 `peerDependencies`，这是刻意的。** 它在运行时不 import 任何 harness 模块 —— 宿主半边只 import Node 内建模块，浏览器半边只 `require` 平台种子模块，其余能力全部通过 `ctx.*` 服务获得。所有 `@deepseek-ai/*` 都只在 `devDependencies` 里，只用于类型和测试。

之所以不写成 peerDependencies：dsh 目前整个家族都在预发布版本上（`0.1.2-rc.1`、`0.1.3-alpha.1`），而 semver 的预发布匹配规则要求区间里存在同 `[major.minor.patch]` 的比较符，所以 `>=0.1.2-rc.1` **不匹配** `0.1.3-alpha.1`。任何写死的区间都会对正常安装报假警告。等 dsh 发出正式版本后可以再加回来。

服务缺席时的降级都是明确的：没有 `webServer` 就不注册路由（headless / ACP profile 照样能加载这个包），没有 `agentPresets` 就 preset 平面为空，没有 `settings.plugins.tab` 声明就不贡献标签页。

## 构建与测试

```bash
npm install && npm test
```

`npm test` 先构建，再用 `node --test` 跑 `test/` 下的集成测试：

- `inventory.test.mjs` —— 真实的 Cordis Loader + 真实的 `package.json` 解析，preset 名册用一个只实现 `list()` / `compositionInventory()` 的替身。条目一律以 `disabled: true` 创建：停用的条目永远不会被 import，所以测试只走解析和清单读取，不启动任何插件。同名不同版本的副本用 `test/fixtures/` 下两个真实的包目录构造。
- `client-bundle.test.mjs` —— 用 npm 上真实的 `@deepseek-ai/dsh-client-modules` 扫描器跑一遍：断言本包进了 boot graph、`/plugins` 路由能取到构建产物、factory id 与包名一致，以及**bundle 只 `require` 平台种子模块**。最后这条是最有价值的一条 —— 浏览器插件最常见的坏法就是多出一个模块表答不上来的 `require`，那会在 materialize 时直接抛。

`npm run verify:pack` 跑 `publint` 和 `@arethetypeswrong/cli`（`--profile node16`）。两处已知的例外：

- publint 会报 `exports["./client"]` 是「CJS 却被当作 ESM」。`lib/client.js` 从来不经过 Node 解析 —— 它由页面的模块系统当作 classic script 执行。harness 自己对同名文件做了完全一样的豁免（`scripts/publint-all.ts` 里的 `isBrowserBundleFormatFalsePositive`）。
- attw 的 `cjs-resolves-to-esm` 被显式忽略：这是个纯 ESM 包，CJS `require()` 不是目标。

产物是 `lib/index.js`（ESM，宿主半边）和 `lib/client.js`（CJS，浏览器半边，带 `window.__ModuleLoader__.load({ id, factory })` 外壳）。`id` 必须与 `package.json` 的 `name` 一致，否则浏览器模块表取不到这个 factory。

浏览器 bundle 只允许 `require()` 平台种子模块（`react`、`react/jsx-runtime`、`react-dom`、`@deepseek-ai/cordis`、`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`）。其他一切都必须内联进 bundle —— 模块表答不上来的 `require` 在 materialize 时直接抛错。因此 `@deepseek-ai/dsh-client-ui-settings` / `-renderer` 只做 type-only 引入（拿 `SlotMap` 和 `Context.slots` 的声明合并），运行时不碰。

类型由 `tsc` 统一发到 `lib/types/`，两半各有一份入口声明（`.` → `lib/types/index.d.ts`，`./client` → `lib/types/client/index.d.ts`）。浏览器 bundle 不能用 tsdown 的 dts —— 它会把 `__ModuleLoader__` 的 banner/footer 一起裹进 `.d.cts`，那是解析不了的。

## 装载

### 方式零：从 npm 安装（发布后）

```bash
dsh plugin --profile web add dsh-version-inventory
```

`package.json` 声明了 `dsh.bundle.patch`，所以 `dsh plugin` 装完会自动把它加进 `dsh.profile.bundles` 层叠，由本包的 `cordis.patch.yml` 用裸包名插入条目。

### 方式一：profile patch（本地开发，无需安装）

`~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-version-inventory
      name: ../../plugins/dsh-version-inventory/lib/index.js
```

相对路径会以该 patch 文件所在目录为基准锚定成 `file://` URL；client-modules 扫描再从这个文件向上找到本目录的 `package.json`，读到 `dsh.client` 和 `exports["./client"]`。web profile 是 `patchReload: live`，改 patch 不用重启。

### 方式二：从本地目录作为 bundle 安装

```bash
dsh plugin --profile web add link:C:/Users/joell/.dsh/plugins/dsh-version-inventory
```

`link:` 建的是符号链接，改完代码 `npm run build` 就能生效，不用重装。

三种方式**不要同时用**，否则会插入重复条目。

## 已知限制

- **一次读取一份快照**：面板挂载时读一次，之后靠「刷新」按钮，不订阅 Loader 变化。
- **只读**：不提供启用/停用开关。
- **版本来自磁盘上的 `package.json`**：一个热更新过、但 `package.json` 未随之改动的包，显示的仍是磁盘上的版本号。
- **副本检测只看解析结果**：两份副本必须都被某个挂载引用才会被发现。装在磁盘上但没有任何条目引用的第二份副本，面板看不到。
- **preset 行的 fiber 状态取决于是否已挂载**：一个还没有会话挂载过的 preset，其行只有启用状态，没有运行状态；`conditional` 表示 `!!js` 门只有真正挂载时才能判定。
- **config 摘要只到顶层**：嵌套结构只显示形状，要看完整值请查 `cordis.patch.yml` 或 preset 的 composition 文件。
- **路由只对本地同源开放**：清单会暴露宿主文件路径和 config 键名，所以 `/dsh-version-inventory/api/list` 要求 loopback host、同源 Origin，以及 `X-DSH-Version-Inventory: 1` 头。
