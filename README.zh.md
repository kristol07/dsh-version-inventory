# dsh-version-inventory

[English](README.md) | 中文

在 dsh Web 界面里显示**当前 Harness 版本**和**每个已挂载插件的包版本**。

设置 → 插件 → **版本** 标签页，就在官方的「插件列表」标签旁边。官方那个标签只显示模块名、启用状态和 fiber 状态，不显示版本号；这个插件补上版本这一列，并额外给出安装位置、Node 版本、`DSH_HOME`、重复副本告警，以及官方包与当前 Harness 版本不一致时的提示。每一行都能复制成 `name@version`，表头则复制一份可安全外发的整体环境报告。同一份读数还注册成了 `dsh_version_inventory` tool，会话里的 agent 可以直接读取。

界面跟随客户端的语言设置，内置英文和简体中文。

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

按目录而不是按包名归并是有意的：**同一个包同时存在两份不同版本**是最该被发现的情况 —— Cordis 服务、品牌类型和 `instanceof` 全都按运行时身份匹配，两份副本会静默失配 —— 而按包名归并恰好会把第二份折叠掉、连版本都丢了。现在两份副本各占一行、并排排序，各自带「副本」标记，顶部还有一条提示点名。

**解析基址的顺序不是随意的**：preset 行的包名要用 **profile 的基址**解析，preset 自己的目录只作为相对路径的兜底。这跟名册自己的做法一致 —— 用户自建的 preset 放在 harness home 下，Node 向上找 `node_modules` 永远走不到 harness 的依赖，所以 preset 目录是解析包名的错误基址。路径型说明符还会先 `existsSync` 校验，否则一个不存在的相对路径会向上撞到某个无关的 `package.json` 并被当成答案。

Harness 自身的版本来自 `process.argv[1]` 向上找到的 `@deepseek-ai/dsh` 的 `package.json` —— 也就是**正在运行的那个 bin**，无论它是源码检出里的 `apps/cli/src/bin.ts` 还是安装出来的 `node_modules/@deepseek-ai/dsh/lib/bin.js`。找不到时退化为「已加载的 `@deepseek-ai/*` 包里出现次数最多的版本」，并在界面上标明这是推断值，不会假装是确定答案。

`cordis:` 内置条目没有包也没有版本，界面如实显示为「Cordis 内置」而不是编一个版本出来。

## 复制版本信息

两个控件，对应两个会被问到的问题：*这一个插件我用的是哪个版本*，以及*这套安装整体长什么样*。

- 每一行包都可以复制成 `name@version` —— 一个整体，粘到消息里、终端里、搜索框里都一样能用。
- 表头复制一份简短的环境报告：Harness 版本及这个答案的来源、Node 与平台、UTC 采集时间、每个第三方插件的版本与所在平面、官方包（版本一致时折成一行）、内置数量，以及采集过程中的告警。

报告永远是整份清单，不是当前筛选出来的视图。搜索框和平面下拉决定的是某一个人此刻在看什么；如果报告继承了它们，就会在不做任何说明的情况下少报一套安装。

**报告里没有文件系统路径、没有 `DSH_HOME`、没有用户自己写的 preset 名称、也没有任何 config 值。** 这是格式本身，不是一个开关。读取路由之所以被围在同源 loopback 里，正是因为快照会点名宿主路径和 config 键；而复制控件存在的意义就是把文本带离这台机器，恰好把那道围栏反了过来。所以报告只用快照里可以交给别人的那一半。唯一的例外是重复副本：几份副本如果没有区分依据就没有意义，那里会去掉最长公共目录前缀，只保留真正不同的片段（`…/node_modules/dup` 对 `…/plugins/a/node_modules/dup`）。

面板里的每一处保留说法都会跟着一起复制。推断出来的 Harness 版本仍然带着「由已加载包推断」，没有清单版本的包写成 `name@unknown`，采集告警原样带上 —— 复制时丢掉的限定词，正是把这个面板的推断变成读者眼里事实的那一步。

正文是纯文本，一行一条事实、以 `- ` 开头：在聊天窗口或文件里直接读就是这个样子，被当作 Markdown 渲染时也不会丢掉换行。语言跟随面板，写入走 Harness 自己的 `writeClipboard` —— 在没有异步 Clipboard API 的非安全上下文里回退到 `execCommand`，被拒绝时返回失败而不是抛错。和 dsh 所有复制控件一样，被拒绝时保持沉默：按钮文案不会变。

## 在会话里让 AI 直接读

同一份读数还注册成了一个模型可见的 tool：`dsh_version_inventory`。dsh 会话里的 agent 可以自己回答版本问题，而不必让用户去打开设置页、复制一份报告再粘回来。这恰恰是最需要它的读者 —— 「这个插件跑的是哪个版本」通常出现在排查过程中间，它是下一步的前提，而不是对话本身的目的。

一个可选参数 `package`，接受包名的大小写不敏感子串。不传就报告整套安装；传了就只报告匹配的包。对最常见的那个问题来说，这是二十五行和五行的区别。

**它返回的就是复制控件用的同一份投影**，这是刻意的，不是省事。tool 的结果不是一次私下的读取：它会进入对话记录，在之后每一轮都发给模型提供方，还可能被导出 —— 暴露面和一份被粘贴出去的报告相同，正好和读取路由所围栏的那个方向相反。共用同一份投影，就意味着模型这个读者不可能悄悄变得比人类读者更宽。它同样会丢掉每个包的 `description`，而且这里比在面板里更要紧：description 是第三方包作者写的文本，而这是唯一一条把它喂给模型的路径。

canonical value 是结构化的，句子留给 renderer —— 这也是 tool 编写契约要求的形状：PTC 调用方读字段，而不是去解析散文；native 调用看到的则是和人复制出来的同一份报告。告警在那里同样保持结构化，遵循宿主半边一贯的那条规则：事实过线，句子由读者来写。

渲染出来的文本一律是英文，与面板语言无关。Harness 的 locale 是浏览器侧的偏好，宿主没有 locale 服务，所以 tool 直接按 `en` 渲染 —— 它是词典键的真相来源，也是 Harness 自己的回退语言 —— 而不是去猜一个没人声明过语言的读者。

tool 这条路径在运行时不 import tools 包。`ToolDefinition` 是类型，`ctx.tools.register` 收的是普通对象，`defineTool` 只是同一形状之上带类型的构造器 —— 所以 `@deepseek-ai/dsh-tools` 仍然只是 `devDependency`，本包也保住了「所有能力都经由 `ctx` 到达」这条性质。代价是 raw definition 要自己校验参数，对一个可选字符串来说，这比多一个依赖便宜。

## 结构

| 文件 | 作用 |
|---|---|
| `src/index.ts` | 宿主插件入口；`inject: ['loader']`，路由和 tool 各自在嵌套注入下注册 |
| `src/inventory.ts` | 采集逻辑：两个平面的挂载 → 包清单 |
| `src/web.ts` | `GET /dsh-version-inventory/api/list`，同源 + loopback + 自定义头的信任围栏 |
| `src/client/index.tsx` | 通过 `ctx.slots.inject('settings.plugins.tab', …)` 贡献标签页，并注册词典 |
| `src/client/panel.tsx` | 面板本体 |
| `src/report.ts` | 可外发的投影及其渲染 —— 面板、复制控件和 tool 共用 |
| `src/tool.ts` | `dsh_version_inventory` tool：schema、canonical value 和英文渲染 |
| `src/locales.ts` | `en` / `zh` 词典，`en` 是键的真相来源 |
| `src/types.ts` | 两半共用的 wire 类型（浏览器侧只做 type-only import） |

宿主半边不持有任何状态：每次请求都重新读一遍。Loader 已经维护着 `Entry.fiber` 和 `Fiber.state`，preset 名册也刻意在每次调用时重读根目录，再加一份缓存只会多出一个需要同步的真相来源。

`webServer` 和 `tools` 都是**嵌套依赖**（`ctx.inject(['webServer'], …)`）而不是声明依赖，所以同一个包在 Harness 跑的任何地方都能加载：headless / ACP profile 拿到 tool、没有面板；不组合任何 agent 的部署拿到面板、没有 tool；两种情况都不会为一个永远不会到来的服务把整棵树挂在 pending 上。

告警在 wire 上是**结构化的事实**，不是句子：宿主不知道读者用什么语言，所以它只报 `{ kind: 'duplicate-packages', names: [...] }`，句子由面板来写。路由的失败遵循同一条规则 —— 返回 `{ error: { kind: 'forbidden' } }`，而不是一句「碰巧用作者当时在敲的那门语言」写成的拒绝理由；遇到 bundle 不认识的 `kind`，退化成原文而不是编一句出来。这也让路由返回的 JSON 对其他读取方同样可用。

## 兼容性

| 项 | 要求 |
|---|---|
| Node | `^22.19.0 \|\| >=24.0.0` |
| DSH | `>= 0.1.2-rc.1`。面板需要 `web` profile（`webServer` + `settings.plugins.tab`），tool 需要 `tools`。只具备其中一个也是可用的安装 |
| 运行时依赖 | **无** |

**这个包没有 `dependencies`，也没有 `peerDependencies`，这是刻意的。** 它在运行时不 import 任何 harness 模块 —— 宿主半边只 import Node 内建模块，浏览器半边只 `require` 平台种子模块，其余能力全部通过 `ctx.*` 服务获得。所有 `@deepseek-ai/*` 都只在 `devDependencies` 里，只用于类型和测试。

之所以不写成 peerDependencies：dsh 目前整个家族都在预发布版本上（`0.1.2-rc.1`、`0.1.3-alpha.1`），而 semver 的预发布匹配规则要求区间里存在同 `[major.minor.patch]` 的比较符，所以 `>=0.1.2-rc.1` **不匹配** `0.1.3-alpha.1`。任何写死的区间都会对正常安装报假警告。等 dsh 发出正式版本后可以再加回来。

服务缺席时的降级都是明确的：没有 `webServer` 就不注册路由（headless / ACP profile 照样能加载这个包，也照样注册 tool），没有 `tools` 就不注册 tool，没有 `agentPresets` 就 preset 平面为空，没有 `settings.plugins.tab` 声明就不贡献标签页。

## 构建与测试

```bash
npm install && npm test
```

`npm test` 先构建，再跑 `test/` 下的六个套件：

- `inventory.test.mjs` —— 真实的 Cordis Loader + 真实的 `package.json` 解析，preset 名册用一个只实现 `list()` / `compositionInventory()` 的替身。条目一律以 `disabled: true` 创建：停用的条目永远不会被 import，所以测试只走解析和清单读取，不启动任何插件。同名不同版本的副本用 `test/fixtures/` 下两个真实的包目录构造。
- `client-bundle.test.mjs` —— 用 npm 上真实的 `@deepseek-ai/dsh-client-modules` 扫描器跑一遍：断言本包进了 boot graph、`/plugins` 路由能取到构建产物、factory id 与包名一致，以及**bundle 只 `require` 平台种子模块**。最后这条是最有价值的一条 —— 浏览器插件最常见的坏法就是多出一个模块表答不上来的 `require`，那会在 materialize 时直接抛。
- `locales.test.mjs` —— 每个语言的键集合和 `{placeholder}` 集合都必须一致。键的一致性 TypeScript 已经保证了；漏掉一个占位符才是它看不见的。
- `web.test.mjs` —— 同源 loopback 围栏，以及路由拒绝时答复的形状。最后一条断言是回归守卫：路由不许自己写文案，因为在宿主进程里写下的句子，对某一类读者一定是写错了语言的。
- `report.test.mjs` —— 投影本身，以及它用真实 `en` 词典渲染出的文本。真正重要的断言是**不允许**出现什么：一旦某次改动开始携带路径、`DSH_HOME`、config 值、包的 description 或用户自己写的 preset 名称，必须先在这里失败，而不是在别人已经粘出去的消息里、或者一段模型对话记录里。
- `tool.test.mjs` —— 用注册表自己的 `assertSupportedJsonSchema` 和 `validateJsonSchemaValue` 检查 tool 定义。注册 raw definition（而不是 `defineTool` 的产物）把这两道检查从构造器上挪走了；没有它们，一个描述不了自身取值的 schema 会在挂载时或第一次调用时才失败 —— 也就是在真实会话里。它同时钉住接线方式：`inject` 只写 loader，两个界面都走嵌套注入。

`npm run verify:pack` 跑 `publint` 和 `@arethetypeswrong/cli`（`--profile node16`）。两处已知的例外：

- publint 会报 `exports["./client"]` 是「CJS 却被当作 ESM」。`lib/client.js` 从来不经过 Node 解析 —— 它由页面的模块系统当作 classic script 执行。harness 自己对同名文件做了完全一样的豁免（`scripts/publint-all.ts` 里的 `isBrowserBundleFormatFalsePositive`）。
- attw 的 `cjs-resolves-to-esm` 被显式忽略：这是个纯 ESM 包，CJS `require()` 不是目标。

发布前跑 `npm run release:check`，它把测试和打包检查一起跑一遍。打包检查刻意没放进 `prepublishOnly`：attw 的 `--pack` 会去调 `npm pack`，而 `npm pack` 会继承 `npm publish --dry-run` 传下来的 `npm_config_dry_run`，于是根本不产出 tarball —— 放在那里会让发布预演跑不起来。CI 每次推送都会跑这两项。

产物是 `lib/index.js`（ESM，宿主半边）和 `lib/client.js`（CJS，浏览器半边，带 `window.__ModuleLoader__.load({ id, factory })` 外壳）。`id` 必须与 `package.json` 的 `name` 一致，否则浏览器模块表取不到这个 factory。

浏览器 bundle 只允许 `require()` 平台种子模块（`react`、`react/jsx-runtime`、`react-dom`、`@deepseek-ai/cordis`、`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`）。其他一切都必须内联进 bundle —— 模块表答不上来的 `require` 在 materialize 时直接抛错。因此 `@deepseek-ai/dsh-client-ui-settings` / `-renderer` / `-locale` 只做 type-only 引入（拿 `SlotMap`、`Context.slots` 和 `Context.locale` 的声明合并），运行时不碰。

类型由 `tsc` 统一发到 `lib/types/`，两半各有一份入口声明（`.` → `lib/types/index.d.ts`，`./client` → `lib/types/client/index.d.ts`）。浏览器 bundle 不能用 tsdown 的 dts —— 它会把 `__ModuleLoader__` 的 banner/footer 一起裹进 `.d.cts`，那是解析不了的。

## 安装

### 从 npm 安装

```bash
dsh plugin --profile web add dsh-version-inventory
```

`package.json` 声明了 `dsh.bundle.patch`，所以 `dsh plugin` 装完会自动把它加进 `dsh.profile.bundles` 层叠，由本包的 `cordis.patch.yml` 用裸包名插入条目。启动前可以先验证这一层：

```bash
dsh --profile web --dump-config
```

### 从 GitHub 安装

```bash
dsh plugin --profile web add github:kristol07/dsh-version-inventory
```

git 安装拿到的是**源码而不是构建产物**，所以 pnpm 必须运行本包的 `prepare` 脚本 —— 而 pnpm ≥10 在你明确允许前会拒绝。第一次 `add` 会失败并打印出确切的包键，把它写进 profile 的 `pnpm-workspace.yaml` 再重跑：

```yaml
allowBuilds:
  dsh-version-inventory: true
```

这个允许等于**授权在安装时在你机器上执行本包的代码**，且不在 agent 的任何沙箱内。请固定到某个 commit（`github:kristol07/dsh-version-inventory#<sha>`），免得之后的推送悄悄改变会执行的东西 —— 或者走 npm / tarball，那两条路都不需要构建授权。

### 从 tarball 安装

```bash
npm pack
dsh plugin --profile web add ./dsh-version-inventory-0.2.0.tgz
```

### 从本地检出安装（开发用）

```bash
dsh plugin --profile web add link:/path/to/dsh-version-inventory
```

`link:` 建的是符号链接，改完代码 `npm run build` 就能生效，不用重装。

也可以完全不安装，直接用 patch 层指向构建产物。在 `~/.dsh/profiles/web/cordis.patch.yml` 里：

```yaml
- insert:
    - id: dsh-version-inventory
      name: ../../plugins/dsh-version-inventory/lib/index.js
```

相对路径会以该 patch 文件所在目录为基准锚定成 `file://` URL；client-modules 扫描再从这个文件向上找到本包的 `package.json`，读到 `dsh.client` 和 `exports["./client"]`。web profile 是 `patchReload: live`，改 patch 不用重启。

这几种方式**不要同时用**，否则会插入重复条目。

## 已知限制

- **报告是指纹，不是清单**：它给出的是 Harness 挂载了哪些包、版本各是多少。它不是 lockfile，也无法据此重建一套环境 —— 传递依赖、patch 层的具体内容、某个会话实际组合了哪个 preset，都不在其中。两份报告一致，说明挂载的版本一致，不等于两套环境一致。
- **一次读取一份快照**：面板挂载时读一次，之后靠「刷新」按钮，不订阅 Loader 变化。
- **只读**：不提供启用/停用开关。
- **版本来自磁盘上的 `package.json`**：一个热更新过、但 `package.json` 未随之改动的包，显示的仍是磁盘上的版本号。
- **副本检测只看解析结果**：两份副本必须都被某个挂载引用才会被发现。装在磁盘上但没有任何条目引用的第二份副本，面板看不到。
- **preset 行的 fiber 状态取决于是否已挂载**：一个还没有会话挂载过的 preset，其行只有启用状态，没有运行状态；`conditional` 表示 `!!js` 门只有真正挂载时才能判定。
- **config 摘要只到顶层**：嵌套结构只显示形状，要看完整值请查 `cordis.patch.yml` 或 preset 的 composition 文件。
- **路由只对本地同源开放**：清单会暴露宿主文件路径和 config 键名，所以 `/dsh-version-inventory/api/list` 要求 loopback host、同源 Origin，以及 `X-DSH-Version-Inventory: 1` 头。

## 发布

推一个 `v*` tag 就会发布，合并到 main 不会发布任何东西。没有任何 npm secret：workflow
使用 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)，由 GitHub
Actions 通过 OIDC 换取短期发布凭据。

```bash
npm run release:check
npm version patch          # 或 minor / major / 明确的 x.y.z
git push origin main --follow-tags
```

一次性的 GitHub / npm 配置和完整流程见 `docs/publishing.zh.md`，其中两个坑值得在第一次
打 tag 之前知道：仅声明 `environment: npm` 并不会要求人工审批；以及该环境的部署规则必须
允许 **tag**，只允许分支会直接卡住发布。

## 许可

MIT © Joel Liu
