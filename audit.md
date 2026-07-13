# Maker Simulator 仓库代码与文档审计

> 审计日期：2026-07-13  
> 审计对象：当前工作树中的通用引擎、应用层、持久化、包加载器、UI、类型与项目文档  
> 报告性质：临时审计与重构复核结论；已同步记录本轮代码和设计文档调整

## 1. 范围与方法

本次审计包含：

- `src/types`、`src/runtime`、`src/persistence`、`src/package-loader`、`src/session`、`src/app`、`src/ui`；
- `README.md`、`AGENTS.md`、`todo.md`、`docs/development.md`、`docs/technical-spec.md` 与 `docs/game-design` 中的通用设计契约；
- 构建、Lint、持久化边界、Runtime 事务顺序、Session/UI 分层与文档交叉一致性。

按要求明确排除：

- `public/games/**` 中已经写好的游戏包；
- 游戏剧情、数值、事件图、结局可达性和现有游戏脚本质量；
- `scripts/build-frostbound-package.mjs` 及其生成结果的内容审计。

审计方式包括静态交叉检查、构建与 Lint，以及使用纯内存仓库和合成最小配置复现核心 Runtime 边界。合成配置只用于验证通用引擎，不读取或评价现有游戏包。

严重度定义：

- **P0**：已复现的数据一致性或事务语义错误，应先于功能开发处理；
- **P1**：高风险正确性、持久化或架构边界问题；
- **P2**：中风险设计缺口、文档不一致、可维护性或性能问题；
- **P3**：低风险文档、可访问性和部署细节。

## 2. 重构复核摘要

本轮先重构初次审计归纳出的三个关联架构根因，再按手动调整后的推荐顺序完成其余正确性、文档、测试、监控与 UI 清理项。当前状态如下：

| 架构根因 | 状态 | 覆盖的原审计项 | 当前设计 |
| --- | --- | --- | --- |
| 提交、持久化、发布没有显式阶段 | 已完成 | P0-01、P0-02 | candidate snapshot 在写入前生成；Repository 成功后才统一替换 Runtime 状态并通知；跨回合部分提交用 `committed` 表达并可重试 |
| 同一 Profile 同时承担稳定存档、工作副本与预览对象 | 已完成 | P1-03、P1-05、P1-06、P1-07、P2-06 | `StoredProfile` 只保存稳定检查点；Runtime 单独持有唯一 `StateSnapshot` 工作状态；结果页使用无 Repository 的只读投影；`storageRevision` 提供 CAS |
| 页面直接取得底层领域对象与基础设施 | 已完成 | P1-04；部分覆盖 P2-02 | AppServices 私有持有 loader/repository/runtime 实现，页面只消费专用 read model、`GameSession` 接口和应用命令 |

开发期存档策略也已简化：移除存档结构版本、旧字段兼容和迁移链；IndexedDB 结构升级时清空旧存档与应用元数据。游戏包仍按 `(configId, configVersion)` 精确加载，不做跨内容版本升级。

初次审计项的当前统计：

| 级别 | 已解决 | 部分解决 | 保留 |
| --- | ---: | ---: | ---: |
| P0 | 2 | 0 | 0 |
| P1 | 7 | 0 | 0 |
| P2 | 9 | 0 | 0 |
| P3 | 8 | 0 | 0 |

初次审计列出的 P0 至 P3 项均已处理。现有自动测试只覆盖非 UI 边界；页面交互、视觉与浏览器集成仍按项目约定人工验收。

下文保留初次审计的原因与证据，已解决条目标明重构后的实现；其中“原审计记录”描述的是重构前状态，不再代表当前代码。

## 3. P0：事务一致性错误（本轮已解决）

### P0-01 `[已解决]` `runUnit` 在可失败的 selector 之前提交，形成“假回滚”

**重构后状态**

`runUnit` 现在先完成 draft、稳定队列并用 candidate 生成下一份 RuntimeSnapshot；需要持久化时等待 `SaveRepository.put()` 返回已写入对象，随后才同步替换 `#state`、baseline、revision 与 snapshot。订阅者和监控异常被隔离，不能再把已经写入的事务转成失败或 rollback。以下为原审计记录。

**结论**

`runUnit` 先完成 draft、按需写入存档、替换 `#profile`、更新 baseline 并增加 revision，随后才调用 `selectSnapshot()`。如果 selector 中执行的 Rule 抛错，控制流进入 `catch` 并记录 `rollback`，但内存状态和已写入的 Profile 都不会恢复。

**证据**

- `src/runtime/GameplayRuntimeImpl.ts:647-721`：`saves.put(candidate)` 位于 `selectSnapshot()` 之前；`#profile`、`#baselines`、`#revision` 在 `selectSnapshot()` 前已经修改；catch 只结束 draft 和记日志。
- `docs/technical-spec.md:338-340`、`docs/development.md:135-139`：约定完整验证成功后才提交和发布，任一步骤失败都丢弃 draft。
- `docs/technical-spec.md:599-604`、`docs/technical-spec.md:684-690`：约定 runtime 错误保留旧 snapshot，脚本异常不能留下部分 State。

使用内存 SaveRepository 和合成 Rule/Action 复现：Action 修改属性并请求终局，随后 selector Rule 抛错。观察结果为：

```text
dispatch result     ok=false, code=script-error, revision=3
published snapshot  revision=2, runStatus=active
runtime profile     runStatus=ended, attribute=1
persisted profile   runStatus=ended, attribute=1
```

这不是日志措辞问题，而是权威状态、持久化状态和 UI 状态三者已经分叉。

**影响**

- 用户看到失败并可能重试，但第一次操作其实已经永久提交；
- terminal、属性、随机游标或检查点可能重复或与 UI 不一致；
- 监控显示 rollback，实际却已持久化，排障信息失真；
- 任意派生 Rule 的异常都可能触发，不限于终局。

**建议**

将提交过程重构为明确的 staging 流程：

1. 完成 candidate draft；
2. 对 candidate 做结构与领域完整校验；
3. 使用 candidate、candidate baseline 和下一 revision 纯计算下一份 snapshot，期间不得修改 Runtime 权威字段；
4. 需要持久化时写入 candidate；
5. 持久化成功后，以不可失败的同步步骤一次替换 `#profile`、`#baselines`、`#revision`、`#snapshot`；
6. listener 通知与监控异常不得再被解释为事务回滚。

修复前先加入回归测试，断言 Rule/selector、存储和 subscriber 分别抛错时，返回结果、内存 Profile、持久化 Profile、revision 和 snapshot 始终一致。

### P0-02 `[已解决]` `advance-turn` 第二处理单元失败后，Session 永久停留在旧视图

**重构后状态**

`turn_end` 仍是独立持久化边界；下一回合启动失败时 Runtime 发布已提交的 `turn_end`，失败结果返回 `committed: true`，再次执行 `advance-turn` 会从该阶段重试。GameSession 在每个命令 settle 后主动刷新 RuntimeSnapshot，不再依赖通知是否发生。以下为原审计记录。

**结论**

`advance-turn` 有意把 `turn_end` 和下一次 `turn_start` 分成两个持久化单元，但第一个单元以 `publish=false` 提交。若第二个单元失败，第一个单元已持久化且 Runtime snapshot 已更新，却没有通知 Session；Session 的命令 finally 只关闭 busy，不主动重新读取 Runtime。因此页面仍显示旧的 `event_handle`，而 Runtime 已位于 `turn_end`，同一会话也没有公开的恢复/重试命令。

**证据**

- `src/runtime/GameplayRuntimeImpl.ts:541-582`：`turn-end` 单元传入 `publish=false`，随后才执行 `beginNextTurn()`。
- `src/runtime/GameplayRuntimeImpl.ts:697-701`：即使 `publish=false` 也会替换 Runtime snapshot，只是不通知订阅者。
- `src/session/GameSessionImpl.ts:179-223`：命令结束只调用 `setBusy(false)`；`refreshRuntime()` 仅由 Runtime 订阅通知触发。
- `src/runtime/GameplayRuntimeImpl.ts:190-212`：新游戏也先保存 initial、恢复时也可能先写 materialization，之后才运行 `beginFromCheckpoint()`；失败时调用方没有得到可恢复 Runtime。
- `docs/game-design/gameplay-runtime-flow.md:67-69`：约定下一 `turn_start` 失败时，已完成的 `turn_end` 保持有效，Session 报错并从该检查点重试。

合成 phase Reaction 在下一 `turn_start` 抛错后，观察结果为：

```text
dispatch result      script-error, revision=2
Session snapshot     revision=1, turn=1, phase=event_handle
Runtime snapshot     revision=2, turn=1, phase=turn_end
persisted checkpoint phase=turn_end
```

**影响**

- UI 仍允许展示上一回合操作，但 Runtime 会以 `invalid-phase` 拒绝它们；
- 用户无法在当前 Session 中重试进入下一回合，只能重新打开页面；
- 错误结果没有表达“前半段已提交”，调用方无法正确决定提示和恢复动作。
- 新游戏首回合初始化失败时也可能留下调用方拿不到 id 的 initial Profile；打开流程失败时会跳过 Runtime 的 dispose/monitor finish 生命周期。

**建议**

- 为跨持久化边界的命令定义显式结果，例如 `committed: true`、`recoveryRequired: true` 或独立的 partial-commit 判别项；
- 第二单元失败时发布已提交的 `turn_end` snapshot，并让 Session 在每个命令 settle 后至少与 `runtime.getSnapshot()` 对齐；
- 增加可幂等的 `resume-from-checkpoint`/`begin-next-turn` 宿主入口，或由 `advance-turn` 的恢复分支从已提交检查点继续；
- `create`/`open` 的失败结果也应携带已提交检查点的恢复信息，并确保未交付的 Runtime 被 dispose；
- 测试 turn-end Reaction、持久化、turn-start Reaction 和 selector 分别失败时的重试语义。

## 4. P1：高风险正确性与架构问题

### P1-01 `[已解决]` 存档校验只有结构与部分容器不变量，缺少 Config 感知的领域校验

**修复后状态**

存档校验现分为两个边界：`validateStoredProfile()` 负责 schema、游标、检查点集合和 RunData 生命周期；`validateProfileAgainstConfig()` 负责精确 Config 身份、全部 State key/id、属性范围、State 层级、EventInstance、节点路径、选择、Effect 绑定、终局引用、来源类型和回合单调性。应用层在标记存档可用性和执行继续/分支/截断/restart 前校验，Runtime 在打开、只读投影和候选检查点写入前校验；错误保留稳定 JSON Pointer。以下为原审计记录。

**结论**

`validateProfile(input)` 不接收 `LoadedGamePackage` 或 Config。它能检查 schema、游标、turnOrder 集合、当前 snapshot 和部分 status，但不能验证 State key、对象 id、EventInstance、绑定关系和结局引用是否属于当前精确版本的 Config。

**证据**

- `src/persistence/validation.ts:103-149`：校验入口只有 `input`，未接收 Config。
- `src/package-loader/schemas.ts:294-325`：Record key 只满足通用 id schema，不验证是否存在于对应 Config。
- `src/runtime/state-view.ts:106-122`：运行时把 Config key 与 State 独有 key 合并，坏档中的“幽灵对象”会变成脚本可见状态。
- `docs/game-design/runtime-system.md:426-439`：要求校验 Config 对应 key、可解析引用、EventInstance 唯一 active、`endingEventInstanceId`、回合单调性、origin 类型和全部数值范围。

当前缺失项至少包括：

- Character、Attribute、Effect、Event、Node、Choice、Command 的 key/id 与 Config 对应关系；
- 每个 EventState 最多一个 active instance，且 `activeInstanceId` 指向它；
- `currentNodeId`、`nodePath`、`endingEventInstanceId` 和 Effect bind id 的可解析性；
- checkpoint kind 与 `endingEventInstanceId`、origin kind/source kind 的组合约束；
- 回合号随 `turnOrder` 单调不减，以及各 State 层允许出现的运行时字段。

**影响**

结构合法但领域损坏的 StoredProfile 仍可以写入并进入 Runtime，之后在 selector、Action 或 Reaction 中以难定位的脚本错误暴露。staged commit 已能避免这类错误造成持久化与 UI 分叉，但不能替代领域校验。

**建议**

拆成两层：`validateStoredProfile(unknown)` 负责当前结构与容器不变量，`validateProfileAgainstConfig(profile, config)` 负责完整领域不变量。精确版本加载后、Runtime 打开前、每次 candidate 提交前都执行第二层；错误携带稳定 JSON Pointer。存档浏览列表可以只做结构校验，但“继续/分支/截断”前必须完成精确版本领域校验。

### P1-02 `[已解决]` 派生 Rule 返回值没有按字段契约验证

**修复后状态**

State view 在 Rule 返回处按派生路径校验：布尔字段必须返回 boolean，`weight` 必须是 `[0, 10]` 内的有限数，`maxCount` 必须是非负整数，`choices` 只能由所属 `choicesValue` 的 key 和同 id 对象组成；Reaction watch 的 number 也必须有限。错误包含 Rule key、字段路径、期望类型和实际值摘要，并由现有 staged commit 回滚。以下为原审计记录。

**结论**

Rule executor 返回 `unknown`；state view 在派生路径上直接使用该值。Action 写入有布尔、权重、maxCount 和属性范围校验，Rule 派生结果没有等价检查。只有 Reaction watch 单独要求 Primitive。

**证据**

- `src/runtime/GameplayRuntimeImpl.ts:793-824`：`evaluateRule()` 原样返回 `implementation.calc()` 的值。
- `src/runtime/state-view.ts:54-70`、`src/runtime/state-view.ts:93-103`：派生字段直接返回 `evaluateRule()` 结果。
- `src/runtime/state-view.ts:178-204`：约束只应用于 Action 写入路径。
- `src/runtime/GameplayRuntimeImpl.ts:1043-1061`：Reaction watch 有 Primitive 检查，反衬其他派生路径没有类型检查。
- `docs/technical-spec.md:344-354`：明确要求验证 `xxxValue`/Rule 字段和 Reaction watch 的返回类型。

**影响**

字符串形式的 `enabled` 会被当作 truthy；非法 weight/maxCount 会破坏随机与选择逻辑；错误 choices 结构可能延迟到 selector 才抛错。错误发生位置仍离 Rule 调用点很远；staged commit 只能保证它不会留下部分提交。

**建议**

为每类派生路径建立返回描述符，在 Rule 边界立即验证：布尔字段、有限且位于 `[0, 10]` 的 weight、非负整数 maxCount、choices Record 的 key/对象身份与所属基础集合。错误应包含 Rule key、字段路径、期望类型和实际值摘要。

### P1-03 `[已解决]` 一个损坏 Profile 会使整个游戏的存档列表不可用 

`SaveRepository.listByConfigId()` 现在逐条验证并返回 `{ profiles, invalid }`；应用查询只用有效存档构造 read model，并向存档页报告隔离数量。以下为原审计记录。

**结论**

`listByConfigId()` 对查询结果直接 `map(validateProfile)`；任一记录抛错会拒绝整个 Promise。游戏菜单读取存档数量也在包加载错误隔离之外，因此一个坏档可以使菜单和存档浏览器同时失败。

**证据**

- `src/persistence/SaveRepository.ts:15-20`：列表采用全有或全无的 map。
- `src/app/services.ts:43-68`：saveCount 查询发生在包加载 try/catch 之外。
- `docs/game-design/player-flow-and-ui.md:120-145`：要求损坏或不兼容 Profile 保留、禁用并显示原因，其他有效 Profile 不受影响。

**建议**

Repository 或应用查询层返回逐条结果，例如 `ValidProfileSummary | CorruptProfileSummary`，保留 profileId、原始 config/version、可定位错误和禁用原因。列表、计数和最近存档解析都必须隔离单条失败；只有实际打开该 Profile 时才拒绝操作。

### P1-04 `[已解决]` UI 绕过 Session/read model，直接持有 Profile、Repository、包脚本和具体 Runtime 

AppServices 的 loader、Repository、metadata 与 monitor 均已私有化。游戏列表、菜单、存档和结果页分别消费专用 read model；游玩页只持有 `GameSession`，不再导入或下钻到 `*Impl`。以下为原审计记录。

**结论**

当前页面层没有遵守项目明确的架构边界。`AppServices` 公共暴露 `saves`、`metadata`、`packages`，列表 read model 甚至包含完整 `LoadedGamePackage`；页面随后直接读取 Profile/RunData、调用 repository，并访问 `GameSessionImpl.runtime` 和 `GameplayRuntimeImpl.game`。

**证据**

- `AGENTS.md:12-18`、`README.md:126-138`、`docs/technical-spec.md:61-83`：UI 只通过 GameSession/SessionView 或应用 controller/read model。
- `src/app/services.ts:17-33`：`GameListItem.package` 暴露完整包，基础设施仓库为 public readonly。
- `src/ui/pages/GameMenuPage.tsx:1-38`：页面持有 `LoadedGamePackage`、`Profile`、`TurnData`，直接调用 saves/metadata。
- `src/ui/pages/SavesPage.tsx:1-74`：页面读取并操作原始 Profile/RunData。
- `src/ui/pages/PlayPage.tsx:163-176`：页面访问具体 Session 的 `runtime.getSnapshot()` 和 `runtime.getProfile()`。
- `src/ui/pages/ResultPage.tsx:1-12`、`src/ui/pages/ResultPage.tsx:57-71`：页面持有具体 Runtime，并读取 `runtime.game.config`。

**影响**

- 页面获得本不需要的持久化写能力和可信 JS registry 能力；
- UI 与存档结构、Runtime 实现和持久化细节强耦合；
- 兼容性、错误隔离、导航和事务规则被分散到页面，难以集中验证。

**建议**

将基础设施字段改为 AppServices 私有成员，只公开窄接口：`GameMenuView`、`SaveBrowserView`、`ResultView` 及对应 controller。GameSession 应直接提供命令后的新 SessionView、结果导航信息和 profileId，不让 UI 下钻到具体 Runtime。页面依赖公开接口而非 `*Impl` 类型；任何 UI read model 都不得含 Rule/Action registry。

### P1-05 `[已解决]` Profile 与“最近存档”采用两次事务，后一步失败会把成功操作报告为失败 

最近存档 metadata 明确为 best-effort 后置副作用；所有写入调用都吞掉其独立失败，不再推翻已经成功的存档、分支、restart 或 Runtime 打开结果。以下为原审计记录。

**结论**

新游戏、restart、存档分支/截断和 Session 打开都先完成 Profile 写入或 Runtime 打开，再独立写 `app-metadata`。metadata 写入失败时，上层收到失败，但领域操作已经提交。

**证据**

- `src/app/services.ts:83-101`：新 Profile 已保存后才写 recent；打开 Runtime 后才写 recent。
- `src/app/services.ts:123-131`、`src/session/GameSessionImpl.ts:150-168`：restart 先保存 Profile，后写 recent。
- `src/session/SaveBrowserControllerImpl.ts:34-58`：分支/截断先 `saves.put(next)`，metadata 失败却统一返回 `persistence-error`。

**影响**

- 用户重试“失败”的新游戏或 restart 时会创建重复时间线；
- 分支/截断已经生效，页面却提示未成功；
- `openSession` 在 metadata 失败时丢失已创建 Runtime 的引用，未调用 dispose。

**建议**

“最近访问”只是便利元数据时，应作为 best-effort 后置操作，失败只记录诊断，不能推翻 Profile 命令的成功结果；打开流程需用 `try/finally` 回收未交付 Runtime。若产品要求两者严格一致，则由同一 persistence unit-of-work 在包含 `profiles` 与 `app-metadata` 的单个 IndexedDB transaction 中提交，并让命令具备幂等键。

### P1-06 `[已解决]` 标为只读的结果预览复用了可写 Runtime

结果查询现在调用 `GameplayRuntimeImpl.projectCheckpoint()` 构造一次性 RuntimeSnapshot；该实例没有 SaveRepository，不启动回合状态机，AppServices 只向页面返回 `ResultView`。存档兼容写回路径已删除，因此预览无法改变真实恢复游标。

### P1-07 `[已解决]` 完整 Profile 的读改写没有并发版本控制，多标签页会静默覆盖

StoredProfile 增加 `storageRevision`。Repository 在单个 readwrite transaction 中读取当前记录、比较 revision、写入递增后的对象并等待 `transaction.done`；过期调用会得到 `SaveConflictError`。以下为原审计记录。

**结论**

IndexedDB transaction 保证一次 `put` 原子，但不能防止两个 Session/标签页先后基于同一旧 Profile 修改后覆盖。当前 Profile 没有 storage revision/ETag，Repository `put` 也没有 compare-and-swap。

**证据**

- `src/persistence/SaveRepository.ts:23-37`：get/put 之间没有版本条件。
- `src/session/SaveBrowserControllerImpl.ts:35-49`：典型的独立 get → 修改 → put。
- Runtime 长时间持有自己的 `#profile` 工作副本，Session 之间没有 BroadcastChannel、Web Locks 或冲突检测。

**影响**

一个标签页推进回合后，另一个旧标签页执行 pin、branch、restart 或退出保存，可能把新检查点整个覆盖，且用户看不到冲突。

**建议**

给 Profile 增加独立于 Runtime snapshot revision 的持久化 revision。`put(expectedRevision, next)` 在同一个 readwrite transaction 内读取并比较，冲突返回专用错误并要求重新加载。可选再用 BroadcastChannel 通知其他页面、Web Locks 降低并发写入，但不能用它们代替持久化层的冲突检测。

## 5. P2：设计、文档与实现缺口

### P2-01 `[已解决]` 文档把依赖图和缓存定义为核心机制，实现却是全量重复计算

**修复后状态**

Runtime 已实现可随处理单元提交或回滚的双向依赖图。State Proxy 的字段读取、`ownKeys`、集合成员和嵌套 Rule 调用会登记动态依赖；成功重算替换旧依赖，基础类型结果缓存，异常结果不缓存。Action 与引擎内部 State 写入只使反向可达的计算节点失效，Effect 生命周期和 Reaction 只处理 dirty observer，不再重建或计算全部 watch。

EffectConfig 与 EventConfig Reaction 在构造时注册一次；TextNode Reaction 随 EventInstance 进入、跳转和结束精确注册/注销。受影响 Reaction 仍按 canonical ordinal 进入 FIFO，失活队列项执行前通过注册表跳过。RuntimeMonitor 的 Rule 汇总包含依赖数量和反向扇出，4096 统一表示单处理单元的 Rule 重算上限。自动回归覆盖缓存命中、集合路径依赖、嵌套失效传播、动态分支依赖替换、异常不缓存、事务图回滚、无关 observer 不重算和 TextNode observer 生命周期。以下为原审计记录。

**结论**

实现有递归栈、执行计数和耗时统计，但没有 Rule 计算节点、依赖收集、失效标记或结果缓存。Reaction 每轮都重建所有定义并重新计算全部 watch；队列处理前还会再次重建定义。

**证据**

- `docs/game-design/runtime-system.md:441-488`、`docs/technical-spec.md:344-356`：详细规定双向依赖图、惰性重算、缓存、动态依赖替换和依赖扇出统计。
- `src/runtime/GameplayRuntimeImpl.ts:793-824`：每次读取直接执行 Rule。
- `src/runtime/state-view.ts:54-70`、`src/runtime/state-view.ts:93-103`：Proxy 没有依赖收集 hook。
- `src/runtime/GameplayRuntimeImpl.ts:984-1110`：每次 scan 全量计算 Reaction；处理每个队列项前再次构造 definitions。

**影响**

功能在小规模配置上可工作，但复杂度接近“每次写入 × 全部 Reaction × Rule 调用链”；4096 上限统计的是执行次数，不是文档所说的失效重算，较大配置会更早触顶。调试文档中的缓存命中和扇出也无法实现。

**建议**

尽快做一次明确决策：若当前目标是 eager MVP，统一把文档改为“无缓存全量扫描”并给出规模上限；若依赖图仍是正式契约，则按 `rule node → state dependencies → observers` 拆出 executor，并先用行为测试锁定 Reaction ordinal、动态分支依赖和异常不缓存语义。

### P2-02 `[已解决]` 存档浏览器未实现文档定义的兼容状态、预览和时间线关系

应用层现已提供 `SaveBrowserView`，集中计算精确版本与领域存档可用性、允许操作、截断数量、当前标记、结果路由和坏档隔离；页面不再读取 StoredProfile。检查点通过独立按需查询投影属性、Effect、待处理/active 事件和终局节点，不修改恢复游标。Run read model 明确携带来源引用与解析状态；UI 提供可跳转到真实来源检查点的关系链接，并将来源已清理的时间线独立分组。以下为原审计记录。

**结论**

页面能列出 Profile、Run 和检查点并执行 continue/branch/truncate/pin，但没有逐档精确版本兼容检查、损坏状态卡、检查点 snapshot 预览、真正的来源连线或“来源已清理”分组。

**证据**

- `docs/game-design/player-flow-and-ui.md:120-162`：定义 Profile 兼容状态、分支树、来源缺失降级和任意检查点预览。
- `src/ui/pages/SavesPage.tsx:31-90`：直接读取原始 Profile，页面文案声称预览不会修改游标，但没有预览选择/read model。
- `src/ui/pages/SavesPage.tsx:95-151`：Run 仅按创建时间分组；origin 只显示截断后的 id 文本。
- `src/ui/pages/GameMenuPage.tsx:24-65`：最近 Profile 未先判断精确包版本是否可用就生成继续链接。

**建议**

由应用层继续扩展 `SaveBrowserView`：每个 Profile 带 `ready | incompatible | corrupt` 状态；每个 checkpoint 带只读 snapshot 摘要、允许操作和来源解析结果；UI 只渲染树和发命令。把兼容判断集中到精确游戏包加载流程。

### P2-03 `[已解决]` `required` 门禁在两份流程文档中与实现及项目规范冲突

两份流程文档现统一说明：普通 pending 事件不阻塞；入口 TextNode required 或入口 CheckNode 候选链可达 required TextNode 的 pending 事件阻塞；active 事件按当前节点 required 判定。Runtime read model 同时以结构化 blocker 和 `EventCardView.required` 暴露结果。以下为原审计记录。

**结论**

项目规范和实现都认为：尚未启动的 enabled 事件，如果入口节点或 CheckNode 候选链存在 required 内容，也会阻止推进。两份流程文档则写成只有已启动且当前节点 required 的实例会阻止推进。

**证据**

- `AGENTS.md:21-28`：待处理事件入口、CheckNode 候选链或 active 节点链上的 required 都是门禁。
- `src/runtime/GameplayRuntimeImpl.ts:1341-1358`、`src/runtime/GameplayRuntimeImpl.ts:1401-1413`：对 pending event 递归检查 required，并加入 blocker。
- `docs/game-design/player-flow-and-ui.md:291-304`：写明尚未点击的 enabled 事件不阻止，只有已经启动的 required 实例阻止。
- `docs/game-design/gameplay-runtime-flow.md:298-305`：同样只描述 active 当前节点 required。

**建议**

以当前项目规范和实现为准时，直接更新两份流程文档，明确“普通非 required pending 事件不阻塞；入口或 CheckNode 候选链可达 required 的 pending 事件阻塞”。同时为 pending、active、候选链三种情况加入 Runtime 门禁测试。

### P2-04 `[已解决]` `runtime-system.md` 的 State 类型代码块仍使用旧字段名

State 示例已替换为当前 `weightValue`、`unlockedValue`、`enabledValue`、`acquiredValue`、`activedValue`、`requiredValue`、`choicesValue` 与 `maxCountValue` 字段，并补齐 TurnState 的阶段字段。以下为原审计记录。

**结论**

同一文档先后给出两套 State API。代码块使用 `weight`、`unlocked`、`enabled`、`acquired`、`actived`、`required`、`choices`、`maxCount`；紧随其后的文字和实际类型使用 `xxxValue`。

**证据**

- `docs/game-design/runtime-system.md:147-205`：旧字段名代码块。
- `docs/game-design/runtime-system.md:207-213`：说明 State 应使用 `weightValue` 等基础字段。
- `src/types/model.ts:360-447`：实际公开 State 类型使用 `xxxValue`。

**影响**

这是脚本 API 的核心参考，照代码块编写的 Action 会访问错误字段。旧字段兼容代码虽已删除，但该独立示例文档问题本轮未处理。

**建议**

直接用当前 `src/types/model.ts` 对应定义替换该代码块，并在文档生成或 CI 中增加 API 片段编译检查，避免再次漂移。

### P2-05 `[已解决]` 包加载和 Runtime 错误没有达到文档承诺的定位上下文

包错误现分离 `resourceLocation` 与 `jsonPointer`，Zod issue 映射到 Pointer，registry/linker 复用 id schema 并由加载边界补齐包 id/version；错误保留 cause 和可复制 `errorId`。Runtime/Session 的所有失败结果均携带 errorId；Rule、Action、Reaction 包装会保留调用 frame，command monitor 记录 errorId、code、调用链和可用的存档 JSON Pointer。`persistence-error` 与 `committed` 语义继续保留。以下为原审计记录。

**结论**

fetch/schema 阶段会补 package id/version，但 registry/linker 调用没有统一包裹；这些内部抛出的 `GamePackageLoadError` 通常只含局部 path。Zod 错误的结构化 `path` 字段被资源 URL 占用，JSON issue path 只留在 message。Runtime 返回值也只有 code/message/revision，没有稳定错误编号、Rule/Action 调用链或 JSON path；Runtime 内部的 IndexedDB 失败还会被误分类为 `script-error`。

**证据**

- `src/package-loader/GamePackageLoader.ts:91-113`：registry validation 和 linking 位于错误 enrichment 之外。
- `src/package-loader/linker.ts:251-289`：registry 错误没有 package identity，registry key 本身也未复用 `idSchema` 校验。
- `src/package-loader/errors.ts:34-45`：已有 `GamePackageLoadError` 会原样返回，无法补齐调用点上下文。
- `src/runtime/GameplayRuntimeImpl.ts:293-353`、`src/types/runtime.ts:35-72`：脚本错误压缩成消息字符串。
- `src/runtime/GameplayRuntimeImpl.ts:670-695`：checkpoint 保存失败被重新包装成普通 `Error`，随后由 command 边界映射为 `script-error`。
- `docs/technical-spec.md:595-608`：要求 package/profile/run/turn、command、Action/Rule key、调用链、JSON path、cause 和可复制错误编号。

**建议**

建立边界统一 enrichment：内部错误保留 cause，同时补齐缺失的 package/profile/run/turn 和 call frames；把 `resourceLocation` 与 `jsonPointer` 分成两个字段；将 Zod issues 映射为稳定 Pointer；为 Runtime 持久化失败保留独立错误码；Runtime 对 UI 返回稳定 errorId 和安全摘要，完整诊断交给 monitor。

### P2-06 `[已解决]` Profile 类型、持久化 schema 与工作状态建模不一致 

公开类型与 schema 现在只有一个 `StoredProfile` 结构；旧字段兼容、结构版本、materialization 和迁移流程均已删除。结构变化通过开发期数据库清理处理，`storageRevision` 只承担并发控制。

### P2-07 `[已解决]` UI 依赖展示名称和中文 blocker 文案完成逻辑关联

属性面板现在以 `characterId` 分组并仅把 displayName 用作标签；pending 事件卡直接读取 `EventCardView.required`。Runtime 的 `advanceTurnBlockers` 已改为携带 kind、eventId、可选 eventInstanceId 和展示 message 的结构化联合类型，UI 不再反向解析中文文案。以下为原审计记录。

**结论**

属性分组以 `characterDisplayName` 为 key，相同展示名会合并；pending required 标识则解析 `advanceTurnBlockers` 的中文句子，再用 event displayName 匹配。展示名称不是稳定 id，文案也不是机器协议。

**证据**

- `src/ui/pages/PlayPage.tsx:152-159`：按 character displayName 分组。
- `src/ui/pages/PlayPage.tsx:186-214`：解析“待处理事件……”字符串并按 displayName 关联卡片。
- `src/types/runtime.ts:99-104`：`EventCardView` 没有 required 字段。
- `src/types/runtime.ts:177-189`：blocker 仅暴露字符串数组。

**影响**

重复展示名称会合并错误；调整中文标点、国际化或错误文案后 required 标识会静默失效。

**建议**

按 `characterId` 分组，仅把 displayName 当标签。把 blocker 改成结构化联合类型，例如 `{ kind: 'pending-required-event', eventId, message }`；或者至少在 `EventCardView` 直接提供 `required`。UI 只展示 message，不反向解析它。

### P2-08 `[已解决]` 核心 Runtime 过度集中，且项目没有自动回归测试

Runtime 已将 UI snapshot 投影、Reaction canonical 定义收集和结构化执行错误分别拆到 `selectors.ts`、`reactions.ts` 与 `errors.ts`；`GameplayRuntimeImpl.ts` 从本轮修改前的 1718 行降至约 1390 行，事务/回合编排仍保留在权威类中，没有继续拆出多层抽象。项目接入 Vitest 与 `fake-indexeddb`，当前 15 个非 UI 用例覆盖领域坏档、Rule 契约、Reaction 顺序/循环、required、selector 与持久化失败回滚、跨回合部分提交、branch/truncate、历史检查点投影、PRNG、脚本调用链、构造失败监控回收、IndexedDB 清理、CAS、坏记录隔离和监控因果链；按用户要求不编写 UI 自动测试。以下为原审计记录。

**结论**

`GameplayRuntimeImpl.ts` 当前共 1630 行，同时负责命令调度、事务、持久化、State Proxy 接入、Rule/Action/Reaction、事件图、回合状态机、selector 和监控。技术规格原本规划了分层目录，也要求单文件单一职责，但实现仍集中在一个类。项目没有 test script，也没有测试文件；技术规格还明确选择只做人工验收。

**证据**

- `src/runtime/GameplayRuntimeImpl.ts`：1630 行，多项权威职责集中。
- `docs/technical-spec.md:115-157`：规划 transaction、executors、reactions、dependency graph、events、turns、selectors、monitoring 分层，并要求单文件主要职责唯一。
- `package.json:6-10`：只有 dev/build/lint/preview。
- `docs/technical-spec.md:667-704`：明确本轮不写单元、集成或 E2E 测试。

**影响**

P0-01 和 P0-02 都能通过 build/lint，说明人工清单不足以保护事务边界。继续在单类中修复会增加提交顺序、回滚域和跨单元状态的隐式耦合。

**建议**

先建立无需浏览器的内存仓库测试夹具，再拆模块。最低测试集应覆盖：事务每个失败点、持久化失败、selector 失败、advance-turn 两单元恢复、Reaction ordinal/循环、Rule 返回校验、坏档隔离、branch/truncate、CAS 和确定性 PRNG。随后再增加 IndexedDB 集成测试和关键 UI E2E。模块拆分优先从纯 transaction/staging、selector、reaction scheduler 和 turn coordinator 开始。

### P2-09 `[已解决]` RuntimeMonitor 的关联模型和内存策略不适合长会话

**修复后状态**

每个 RuntimeCommand 现在先生成 `command-start` 和稳定 traceId；命令内的 transition、Action、Reaction、transaction、persistence 与 `command-end` 均通过 parentId 关联。阶段记录补齐 `turn_end`、`terminal` 与 `abandoned`。Console monitor 改为在线计数和分类累计耗时，只保留固定五条最慢记录；仅 verbose 模式保留最多 200 条近期明细。非 UI 测试验证了一个 `advance-turn` 跨两个处理单元时仍共享同一父命令，并覆盖完整阶段序列。以下为原审计记录。

**结论**

command trace 在整个命令完成后的 finally 才输出，且没有 parent command id；`advance-turn` 的两个 unit 与最终 command 只能依赖当时的 unit 计数猜测关联。transition 只显式记录 `turn_start`/`event_handle`。Console monitor 会把整局所有 trace 保存在数组中，结束时再过滤和排序，长会话没有上限。

**证据**

- `src/runtime/GameplayRuntimeImpl.ts:293-353`：command trace 在命令结束后生成。
- `src/runtime/GameplayRuntimeImpl.ts:541-582`：`turn_end` 没有对应 transition trace，advance 横跨两个 unit。
- `src/runtime/GameplayRuntimeImpl.ts:1515-1536`：无 unit 参数的 command 取当前 unit counter。
- `src/runtime/monitor.ts:83-141`：`#records` 无界增长，finish 时对全量记录过滤、复制、排序。

**建议**

引入 command span id，开始时记录 command-start，每个 unit/action/reaction 带 parent id，结束时记录 command-end；补齐 turn_end、terminal、abandoned transition。汇总采用在线计数、分类型累计耗时、固定大小 top-N 和可选 ring buffer，verbose 才保留有限明细。

## 6. P3：低风险清理项

以下问题可以合并为一次文档与 UI polish：

1. `[已解决]` `docs/technical-spec.md` 与实现均已更新为当前 database version 3，并明确开发期升级清空旧记录。
2. `[已解决]` 动效媒体查询统一为 `prefers-reduced-motion`。
3. `[已解决]` `todo.md` 移除对已删除审计文件的断链，不关联本临时报告。
4. `[已解决]` README 与设计文档中的 `DSL`、`roguelike` 拼写已修正。
5. `[已解决]` PageChrome 通过 `import.meta.env.BASE_URL` 构造图标 sprite 地址，支持子路径部署。
6. `[已解决]` 小按钮和 Effect 操作按钮的最小高度统一为 44px。
7. `[已解决]` ConfirmDialog 使用 `DialogDescription`，异步确认期间设置 `aria-busy` 并禁用取消与确认按钮；调用方等待命令完成后再关闭。
8. `[已解决]` 节点标题聚焦 effect 只依赖 eventInstanceId 与 currentNodeId。
9. `[已解决]` 存档预览使用同一按钮展开和收起，收起时使在途请求失效，已加载结果可在当前页面会话内复用；按钮与面板通过 ARIA 关联。
10. `[已解决]` 页面、局部内容、按钮、卡片和对话框使用统一 CSS motion token；`prefers-reduced-motion` 下移除非必要空间动画。
11. `[已解决]` 检查点、时间线和存档均提供带影响范围说明的手动删除确认；pin 只参与自动保留，不阻止显式删除。删除当前项会原子修复恢复游标，空时间线和空 Profile 按层级级联删除，Profile 删除继续使用 `storageRevision` 防止并发误删。
12. `[已解决]` 应用根节点使用不创建滚动容器的 `overflow: clip` 裁剪路由入场位移产生的绘制溢出，避免 `100vh` 页面在动画期间短暂触发纵向滚动条，同时保留长页面的文档滚动。

## 7. 推荐修复顺序

1. `[已完成]` 统一 Runtime staged commit，定义 advance-turn partial commit 与重试协议。
2. `[已完成]` 拆分 StoredProfile、Runtime 工作状态和只读检查点投影；加入坏档逐条隔离与持久化 revision/CAS。
3. `[已完成]` 将页面收敛到 AppServices read model、应用命令和 GameSession 接口；recent metadata 不再推翻领域命令。
4. `[已完成]` **实现响应式依赖图**：Rule 计算节点缓存基础结果并替换动态依赖；State 写入只传播到反向可达的 Effect/Reaction observer。
5. `[已完成]` **补齐剩余正确性边界**：加入 Config 感知 StoredProfile 校验和 Rule 返回契约校验。
6. `[已完成]` **处理独立问题**：完成存档预览与分支关系、错误协议、required/State 示例文档、监控、非 UI 自动测试与 UI polish。

## 8. 已执行验证与限制

| 项目 | 结果 |
| --- | --- |
| `pnpm run test` | 通过；2 个测试文件、22 个非 UI 用例 |
| `pnpm run build` | 通过；Vite 8.1.3，主 JS 501.97 kB，gzip 153.97 kB |
| `pnpm run lint` | 通过 |
| `git diff --check` | 通过 |
| P0-01 回归 | selector 失败时 terminal candidate、revision、snapshot 与持久化均保持未提交 |
| P0-02 回归 | 下一回合失败时保留并发布已提交 `turn_end`，失败结果为 `committed: true` |
| IndexedDB 回归 | `fake-indexeddb` 下通过开发期清理、写入/删除 CAS 冲突和坏记录隔离 |
| UI 人工验收 | 待确认存档预览展开/收起、三层删除与级联提示、路由与节点过渡、Dialog 进出场及 reduced-motion 表现 |
| 现有游戏包生成器与剧情路线 | 未运行；按本次审计范围明确排除 |
| 浏览器 UI、真实 IndexedDB 升级和多标签页 | 未执行；仍需按人工清单确认 |

初始审计使用合成夹具复现了两个 P0；现在相应行为已转为自动回归测试。测试不读取现有游戏包，也没有编写 UI 测试。浏览器中的完整玩家流程、三层删除确认与游标回退、键盘与焦点、真实 IndexedDB upgrade、持久化失败注入和多标签页冲突提示仍需人工复核。
