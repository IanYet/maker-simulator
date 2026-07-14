# 开发文档

本文面向维护 Maker Simulator、编写游戏包和排查运行时问题的开发者。设计语义以 `docs/game-design/` 与 `docs/technical-spec.md` 为准；本文集中说明如何把这些约定落到本地代码、游戏包和验证流程中。

## 1. 开发环境

项目是 Vite + React + TypeScript 应用，使用 pnpm 管理依赖。当前 Vite 版本要求 Node.js `20.19+` 或 `22.12+`。

```bash
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm run build   # TypeScript 检查并生成生产构建
pnpm run format  # 显式格式化全部代码；忽略文档、游戏内容和生成脚本
pnpm run lint    # ESLint 检查 TypeScript/TSX
pnpm run test    # Vitest 非 UI 回归测试
pnpm run preview # 预览 dist 中的生产构建
```

安装依赖时 Husky 会注册仓库内的 `pre-commit` hook。提交时 `lint-staged` 只把已暂存的代码文件交给 Prettier，不扫描文档、游戏包、Frostbound 生成脚本或锁文件。仓库的 VS Code 设置使用同一份 Prettier 配置，并把保存时格式化限制在 Git 标记的修改行，避免保存旧文件时重排整个文件。

提交前至少运行 `pnpm run test`、`pnpm run build`、`pnpm run lint` 和 `git diff --check`。如果修改了 Frostbound authoring 源，还要重新生成游戏包：

```bash
node scripts/build-frostbound-package.mjs
```

该脚本会生成 `public/games/frostbound/1.0.0/config.json`，并检查 Effect/Event/结局数量、事件节点可达性以及跨事件 Effect 前置依赖。

## 2. 代码结构

```text
src/
  types/          Config、State、RuntimeSnapshot、Action/Rule 上下文类型
  package-loader/ catalog/manifest/config/脚本加载、schema 校验与静态 linking
  runtime/        State 视图、事务、回合状态机、Action/Rule/Reaction、监控
  persistence/    IndexedDB、稳定存档校验、并发控制、检查点/分支/截断操作
  session/        面向 UI 的命令门面、busy 状态与存档控制器
  app/            服务组合、路由和全局依赖注入
  ui/             页面、可复用组件和 CSS Modules
public/games/     外部游戏包；不把游戏内容硬编码进引擎
scripts/          游戏包 authoring 生成与静态审计脚本
docs/             技术规格、游戏设计和开发文档
```

核心依赖方向如下：

```text
React UI → AppServices read models / GameSession
AppServices → GamePackageLoader / SaveRepository / GameplayRuntimeImpl
GameSessionImpl → GameplayRuntimeImpl → SaveRepository
                                      ↓
                            LoadedGamePackage
GamePackageLoader → schema → linker → Rule/Action registry
```

UI 只读取页面专用 read model 或不可变 `SessionView`/`RuntimeSnapshot`，不取得 Profile、RunData、Repository、游戏包或具体 Runtime。游戏脚本通过 `ActionContext` 和 `RuleContext` 访问运行时视图；持久化边界由 Runtime 与 Persistence 共同维护。

## 3. 本地启动与页面流程

开发服务器启动后，从 `/games` 进入游戏列表。应用路由如下：

| 路径 | 用途 |
| --- | --- |
| `/games` | 读取 catalog，展示可用游戏包 |
| `/games/:gameId` | 游戏菜单、最近存档和存档入口 |
| `/games/:gameId/new` | 创建 Profile、初始 RunData 和初始检查点 |
| `/games/:gameId/saves` | 浏览检查点、继续、分支、截断、pin 和分层手动删除 |
| `/play/:profileId` | 从稳定检查点恢复并游玩 |
| `/result/:profileId/:runId/:turnId` | 查看终局/放弃检查点并重新开始 |

`AppServices` 是应用层组合根，创建包加载器、IndexedDB Repository、RuntimeMonitor，并将服务门面注入 React Context。列表、菜单、存档和结果页只调用查询方法取得各自的 read model；游玩页只持有 `GameSession` 接口。页面不自行创建数据库连接、加载游戏包或取得具体 Runtime。

## 4. 游戏包开发

### 4.1 包布局

一个可加载的版本化游戏包至少包含：

```text
public/games/your-game/1.0.0/
  manifest.json
  config.json
  rules.js
  actions.js
  assets/
```

`catalog.json` 注册包的 `id`、`version`、名称、manifest 路径和默认版本。`manifest.json` 的身份必须与 catalog、Config 的 `id`、`version`、`name` 一致。存档按 `(configId, configVersion)` 精确加载；当前开发阶段不迁移到其它内容版本，所需精确包不可用时该存档不可继续。

### 4.2 Config、Rule 与 Action

`config.json` 只保存可序列化的对象和调用描述。Rule/Action 的函数实现分别从 `rules.js`、`actions.js` 导出：

```js
export const rules = {
  'resource.at-least': {
    key: 'resource.at-least',
    calc: (context, characterId, attributeId, minimum) =>
      context.runState.characters[characterId].attributes[attributeId].value >= minimum,
  },
}

export const actions = {
  'state.change': {
    key: 'state.change',
    exec: (context, characterId, attributeId, amount) => {
      context.runState.characters[characterId].attributes[attributeId].value += amount
    },
  },
}
```

注意事项：

- `key` 必须和 registry 对象的 key 相同；Config 中的调用只能引用已注册的 key。
- Action 只能通过 `context.profileState`、`context.runState`、`context.turnState` 的可写视图修改内容，不能直接修改 Profile、RunData 容器或阶段字段。
- Rule 应保持纯计算，不应写 State、推进随机游标或调用外部副作用。
- 随机判定必须使用 `context.random()`，不要直接调用 `Math.random()`，这样才能随检查点和 seed 恢复确定性。
- 游戏包 JavaScript 被视为可信代码；加载器会校验结构和引用，但不提供安全沙箱。

### 4.3 Effect、Event 与 Reaction 约定

- Effect 表示持续物品、条件、增益、减益或世界状态；玩家能在效果面板看到已获得 Effect 的名称和说明。
- `manuallyActivatable` 为 `true` 的已获得未激活 Effect 会在待激活区域提供按钮；点击后由 `GameSession` 发送 `activate-effect`，Runtime 写入 `activedValue` 并稳定 Effect Reaction。
- 不需要玩家点击事件卡、会在回合或状态变化时自动执行的 Reaction，按策划默认约定放在 Effect 上，并在 `description` 解释影响。
- Event 用于叙事内容和玩家分支；EventConfig Reaction 主要响应事件内容自身的持续状态，TextNode Reaction 只在节点处于 active 时注册。
- `required` 是回合门禁：待处理事件入口或当前 active 节点链上存在 required 节点时，`advance-turn` 会被阻止；不能只依赖玩家先点击事件后再判断。
- 新增内容后应检查所有 Event 节点、Effect 前置条件和结局是否可达。Frostbound 的生成器审计可作为模板。

## 5. Runtime 生命周期

一次新游戏或恢复流程大致经过以下步骤：

1. `GamePackageLoader` 读取 catalog/manifest/config 和可信脚本模块。
2. Zod schema 校验外部 JSON；linker 检查身份、对象 key/id、order、Rule/Action 引用、ValueRef、Reaction 和节点目标。
3. `createProfile()` 创建稳定存档、首个 RunData 和 `initial` 检查点；配置中直接为 `true` 的 Effect 会进入初始 RunState。
4. `GameplayRuntimeImpl` 建立 Rule 依赖图、Effect 生命周期 observer 和 Reaction baseline，从检查点自动进入 `turn_start`，稳定后进入 `event_handle`。
5. 每条 RuntimeCommand 创建一个 Immer draft 和依赖图副本。Action、Rule、Reaction、CheckNode、随机游标和终局请求共享这个处理单元。
6. 处理单元先完成脚本与状态稳定、生成候选存档和候选 RuntimeSnapshot；需要持久化时，必须等待 IndexedDB 事务完成，随后才一次性替换 Runtime 状态、依赖图、revision 与 snapshot 并通知 Session。任意前置步骤失败都保留旧状态。
7. `advance-turn` 先检查 required blocker，再持久化 `turn_end` 检查点，然后自动开始下一回合。下一回合启动失败时，已经提交的 `turn_end` 会成为当前可见状态，同一命令可以从该边界重试。

EffectConfig 与 EventConfig Reaction 在 Runtime 构造时注册，TextNode Reaction 随 active 节点精确注册和注销；首次进入作用域只建立 baseline。State 写入通过依赖图只重算 dirty observer，同时匹配多个 Reaction 时仍按 EffectConfig、EventConfig、active TextNode 的 canonical ordinal 入队。新增自动规则时，先确认声明层级、实际 State 依赖和可能形成的循环。

## 6. 存档与 IndexedDB

IndexedDB 数据库名为 `maker-simulator`。`profiles` 保存 `StoredProfile`，只包含稳定检查点历史和恢复游标；`app-metadata` 保存最近访问的存档 id。

存档校验分为两个边界：Repository 使用 `validateStoredProfile()` 检查未知输入的结构和容器不变量；精确游戏包加载后使用 `validateProfileAgainstConfig()` 检查 Config 领域关系。新建、打开、结果投影、继续、分支、截断、restart 和 Runtime 检查点写入都必须经过第二层。手动删除只收缩已经通过结构校验的容器，可以在精确游戏包不可用时执行，写回后仍须通过第一层校验。

- `turnOrder` 与 `turnDatas` 必须一一对应；
- `currentTurnId` 必须是该时间线最后一个保留检查点，存档当前游标必须与对应 RunData 一致；
- ended/abandoned RunData 必须以对应终态检查点结束；
- 每个 snapshot 的随机游标必须是非负安全整数；
- State 的 Character、Attribute、Effect、Event、Node、Choice 与 Command key/id 必须属于精确 Config；
- EventInstance 节点、路径、active 指针、回合范围、选择、Effect 绑定与终局引用必须能够解析；
- ProfileState、RunState、TurnState 只能保存各自拥有的生命周期字段；
- 写入前先 `structuredClone`，避免把外部引用或 Immer draft 交给 Repository。

Repository 写入前复制并校验完整 StoredProfile，在单个读写事务中完成一次 `put` 或 `delete` 并等待事务结束。运行时只在事务成功后发布候选状态；失败时保留提交前状态。

项目仍处于开发阶段，不维护旧存档结构迁移。修改持久化结构时递增 `src/persistence/database.ts` 的 `DATABASE_VERSION`；upgrade 会保留对象仓库与索引定义，但清空旧结构的存档和应用元数据。需要保留的调试数据应在升级前自行导出。

## 7. 运行监控与问题排查

开发环境默认启用 RuntimeMonitor；生产构建可通过查询参数启用：

```text
?runtimeMonitor=1       命令、Action、Reaction、事务和持久化
?runtimeMonitor=verbose 额外输出 Rule 统计
```

日志重点字段：

```text
trace=command-7 command-start choose-single eventInstanceId=... nodeId=... choiceId=... actionKey=...
trace=trace-42 parent=command-7 action state.change actionKey=state.change args=["survivor","food",-1]
trace=trace-43 parent=command-7 reaction ... action=world.turn-start args=[]
trace=trace-44 parent=command-7 command-end choose-single ... ok
```

排查顺序建议：

1. 先看 package loader 报错阶段：`catalog`、`manifest`、`config`、`module-import`、`schema-validation`、`registry-validation` 或 `linking`。
2. 再按 command-start 的 `traceId` 筛选相同 `parentId`，查看 transition → action/reaction → transaction → command-end 链，确认具体 id、参数和回滚原因。
3. 如果 UI 不更新，检查 Runtime 是否发布了新的 snapshot，以及 Session 是否仍处于 busy 状态。
4. 如果 `advance-turn` 被拒绝，读取 `advanceTurnBlockers`，确认 required 事件卡、active 节点和终局请求。
5. 如果出现 IndexedDB object store/index 错误，检查数据库升级版本和 `upgrade` 分支是否覆盖旧 schema。

监控只写浏览器控制台，不写存档，也不会输出完整 State 或 Config。Action/Rule 脚本中的业务错误应抛出带有玩家可理解信息的 Error，Runtime 会回滚当前处理单元并把错误传给 Session/UI。

## 8. 注释与提交规范

公开的类、函数、接口和关键状态转换使用中文 JSDoc：说明职责、参数、返回值、异常和生命周期边界。复杂私有函数只注释“为什么”以及不可从代码直接看出的不变量，避免逐行翻译实现。

提交前检查：

```bash
node scripts/build-frostbound-package.mjs
pnpm run test
pnpm run build
pnpm run lint
git diff --check
```

`pnpm run test` 只运行 Runtime、持久化、包边界和纯应用操作的非 UI 自动测试；页面布局、键盘、焦点、触控目标和完整玩家流程继续按人工清单验收。

同时人工验收：创建新游戏、处理 required 事件、推进回合、获得/失去 Effect、创建分支和截断、查看终局，以及在控制台确认 Action/Reaction 参数完整。
