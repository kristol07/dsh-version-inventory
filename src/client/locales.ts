/**
 * Copy for the version inventory tab.
 *
 * `en` is the key source of truth and the harness's fallback locale, so every
 * other dictionary is typed against it and cannot drift a key. `{name}`
 * placeholders are filled by the locale runtime at call time.
 */

/** English dictionary and key source of truth. */
export const en = {
  tab: 'Versions',

  loading: 'Reading the version inventory…',
  loadFailed: 'Could not read the version inventory: {message}',
  retry: 'Retry',
  refresh: 'Refresh',
  collectedAt: 'Collected at {time}',

  versionUnknown: 'version unknown',
  nodeLabel: 'Node',
  homeLabel: 'DSH_HOME',
  installLabel: 'Install path',

  sourceInstall: 'read from the install',
  sourceResolved: 'resolved from the profile',
  sourceInferred: 'inferred from loaded packages',
  sourceUnknown: 'not determined',

  metricPackages: 'packages loaded',
  metricMounts: 'mount points',
  metricThirdParty: 'third-party plugins',
  metricNotRunning: 'not running',

  noteDuplicates:
    '{count} package(s) exist as more than one copy in this process ({names}). '
    + 'Cordis matches services, branded types, and instanceof on runtime identity, so duplicate '
    + 'copies mismatch silently — expand them and compare their locations.',
  noteDrift:
    '{count} harness package(s) differ from the running harness version ({version}); '
    + 'they are marked in the list.',

  warnHarnessUnlocated:
    'Could not locate the {package} install; the version below is inferred from the loaded {scope}* packages.',
  warnUnresolved:
    '{count} mount(s) could not be resolved to a package.json; their versions show as unknown.',
  warnDuplicates:
    'More than one copy of: {names}. Cordis matches services, branded types, and instanceof on '
    + 'runtime identity, so duplicate copies mismatch silently.',
  warnPresetRoots:
    'Could not read the preset directories; preset rows resolve from the profile base only: {reason}',
  warnPresetInventory:
    'Could not read the preset compositions; this panel shows the global plane only: {reason}',

  filterPlaceholder: 'Filter by package, version, mount id, or preset',
  filterLabel: 'Filter the version inventory',
  planeLabel: 'Filter by plane',
  planeAll: 'Both planes',
  planeGlobalOnly: 'Global plane only',
  planePresetOnly: 'Preset plane only',
  emptyFiltered: 'No matching packages.',

  groupThirdParty: 'Third-party plugins',
  groupHarness: 'Harness packages',
  groupBuiltin: 'Cordis builtins',
  countPackages: '{count} packages',

  planeGlobal: 'global',
  planePresetCount: '{count} presets',

  tagDuplicate: 'duplicate',
  tagDuplicateTitle: 'This package exists as more than one copy in this process',
  driftTitle: 'Differs from the running harness version',

  detailDescription: 'Description',
  detailPath: 'Location',
  detailMounts: 'Mounts',
  pathUnresolved: 'no package.json resolved',
  entryNoId: '(no id declared)',
  conditionTitle: "This row's own !!js disabled expression",

  configHidden: 'config not visible',
  configHiddenTitle: 'A preset composition inventory carries no config',
  configNone: 'no config',

  phasePending: 'pending',
  phaseLoading: 'loading',
  phaseActive: 'running',
  phaseFailed: 'failed',
  phaseUnloading: 'unloading',
  phaseUnobserved: 'not observed',
  stateDisabled: 'disabled',
  stateConditional: 'conditional',

  rosterTitle: 'Agent preset roster',
  rosterCount: '{count} presets',
  presetDefault: 'default',
  presetSystem: 'built-in',
  presetUser: 'user',
  presetRows: '{count} rows',
  presetBroken: 'unreadable',
} satisfies Record<string, string>

/** Version inventory locale key union. */
export type VersionInventoryLocaleKey = keyof typeof en

/** Simplified Chinese dictionary. */
export const zh = {
  tab: '版本',

  loading: '正在读取版本清单…',
  loadFailed: '读取版本清单失败：{message}',
  retry: '重试',
  refresh: '刷新',
  collectedAt: '采集于 {time}',

  versionUnknown: '版本未知',
  nodeLabel: 'Node',
  homeLabel: 'DSH_HOME',
  installLabel: '安装位置',

  sourceInstall: '读自安装目录',
  sourceResolved: '解析自 profile',
  sourceInferred: '由已加载包推断',
  sourceUnknown: '未能确定',

  metricPackages: '已加载的包',
  metricMounts: '挂载点',
  metricThirdParty: '第三方插件',
  metricNotRunning: '未处于运行中',

  noteDuplicates:
    '有 {count} 个包在本进程里存在多份副本（{names}）。'
    + 'Cordis 服务、品牌类型和 instanceof 都按运行时身份匹配，重复副本会静默失配 —— '
    + '展开对比它们的「位置」找出多出来的那份。',
  noteDrift: '有 {count} 个官方包的版本与当前 Harness 版本（{version}）不一致，已在列表中标出。',

  warnHarnessUnlocated: '无法定位 {package} 的安装位置；下面的版本号由已加载的 {scope}* 包推断得出。',
  warnUnresolved: '{count} 个挂载无法解析到 package.json，其版本显示为未知。',
  warnDuplicates:
    '同一个包存在多份副本：{names}。'
    + 'Cordis 服务、品牌类型和 instanceof 都按运行时身份匹配，重复副本会静默失配。',
  warnPresetRoots: '读取 preset 目录失败，preset 行只按 profile 的解析基址查找：{reason}',
  warnPresetInventory: '读取 preset composition 失败，本面板只反映全局平面：{reason}',

  filterPlaceholder: '按包名、版本、挂载 id 或 preset 名过滤',
  filterLabel: '过滤版本清单',
  planeLabel: '按平面过滤',
  planeAll: '全部平面',
  planeGlobalOnly: '仅全局平面',
  planePresetOnly: '仅 preset 平面',
  emptyFiltered: '没有匹配的包。',

  groupThirdParty: '第三方插件',
  groupHarness: 'Harness 官方包',
  groupBuiltin: 'Cordis 内置',
  countPackages: '{count} 个包',

  planeGlobal: '全局',
  planePresetCount: '{count} 个 preset',

  tagDuplicate: '副本',
  tagDuplicateTitle: '同一个包在本进程里存在多份副本',
  driftTitle: '版本与当前 Harness 版本不一致',

  detailDescription: '说明',
  detailPath: '位置',
  detailMounts: '挂载',
  pathUnresolved: '未解析到 package.json',
  entryNoId: '（未声明 id）',
  conditionTitle: '该行自己的 !!js disabled 表达式',

  configHidden: 'config 不可见',
  configHiddenTitle: 'preset composition 的清单不携带 config',
  configNone: '无 config',

  phasePending: '等待中',
  phaseLoading: '加载中',
  phaseActive: '运行中',
  phaseFailed: '失败',
  phaseUnloading: '卸载中',
  phaseUnobserved: '未观测',
  stateDisabled: '已停用',
  stateConditional: '条件启用',

  rosterTitle: 'Agent Preset 名册',
  rosterCount: '{count} 个 preset',
  presetDefault: '默认',
  presetSystem: '内置',
  presetUser: '用户',
  presetRows: '{count} 行',
  presetBroken: '读取失败',
} satisfies Record<VersionInventoryLocaleKey, string>
