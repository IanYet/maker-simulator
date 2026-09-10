# UI / Gameplay 重构临时实施文档

状态：代码重构完成，自动验证通过；内置浏览器交互验收因环境阻塞待补。

本文独立记录本次方案、实施顺序和验收条件，不加入 README、其他文档、AGENTS.md 或文档目录的引用。重构完成后可以删除本文；长期规范应直接更新到各自的权威文档。

## 1. 目标

宏观上将项目划分为两层：

- **UI**：接收用户操作，调用 Gameplay 的接口函数；把 Gameplay 返回的事件、角色、属性、效果和存档信息组织成界面。
- **Gameplay**：执行游戏规则，维护游戏状态与生命周期，提供查询和命令，负责游戏包与存档。

本次成功的判断标准是：替换整个 React UI 时，Gameplay 不需要改变；UI 仅凭公共接口和返回的数据，就能实现目前全部玩家流程。

本次保持现有玩法、存档语义、路由、视觉和游戏包内容。删除不再承担独立职责的中间层，保留事务、依赖图、领域校验等必要机制。不引入状态库、事件总线、通用命令框架或依赖注入容器。

## 2. 当前问题与处理方向

| 当前实现 | 问题 | 本次处理 |
| --- | --- | --- |
| `src/session/GameSessionImpl.ts` | 合并 Runtime 数据与 busy、焦点、路由；大部分玩法方法只是转发 | 删除，交互状态归 UI，玩法方法直接由 Runtime 实现 |
| `src/session/SaveBrowserControllerImpl.ts` | 每次存档操作临时创建，和 AppServices 重复读取、校验、包装错误 | 删除，将单次存档用例集中到 Gameplay |
| `src/app/services.ts` | 同时承担包加载、存档用例、页面数据裁剪、按钮文案和 URL 拼接 | 领域用例归 Gameplay，展示转换与路由归 UI |
| `SessionView` | 为了组合 UI 瞬时状态而复制一层可订阅状态 | 删除，直接订阅 GameSnapshot，UI 状态由 React 管理 |
| `RuntimeSnapshot.attributes` | 扁平属性重复携带角色身份，UI 再按角色分组 | 改为角色包含属性的实体结构 |
| `GameplayRuntimeImpl.projectCheckpoint()` | 为读取历史构造完整 Runtime，初始化 Effect 与 Reaction observer | 抽取共享只读求值和投影，不创建 Runtime |
| AppServices 与 GamePackageLoader 的 catalog 管理 | 缓存位置分散，失败 Promise 可能一直被复用 | PackageLoader 统一缓存，失败移除缓存 |
| `xxxxImpl`、只用于内部跳转的 barrel | 命名和文件层次没有对应的独立职责 | 按职责命名，内部直接导入 |

Runtime 的原子提交、动态依赖图、增量 Reaction、State Proxy、PRNG 和两阶段存档校验继续保留。

## 3. 两层边界

```text
用户点击 / 输入 / 页面生命周期
                │
                ▼
UI：确认、pending、焦点、路由、展示转换
                │ 调用 Gameplay / Game 的具名方法
                ▼
Gameplay：查询、规则、状态变更、事务、存档
                │ 返回只读数据 / 命令结果；发布 GameSnapshot
                ▼
UI：渲染角色、属性、事件、效果、存档与结果
```

职责分配：

| 事项 | 所属层 | 约束 |
| --- | --- | --- |
| 按钮点击转成 `chooseSingle(...)` 等调用 | UI | 不查找或执行 Action registry |
| Dialog、事件焦点、预览选中项、页面展开 | UI | 不写 Gameplay State |
| DOM 焦点、键盘、动画、数值与日期格式 | UI | 不进入 Runtime |
| 导航地址、通用结果文案、按钮名称 | UI | Gameplay 返回身份与状态 |
| Config 编写的名称、描述、叙事、枚举标签 | Gameplay 数据 | UI 按需展示，保留作者内容 |
| visible、unlocked、enabled、required 和有效属性值 | Gameplay | UI 不重复计算规则 |
| canContinue、canBranch、canTruncate | Gameplay | 命令执行时仍重新校验条件 |
| 多选数量与已提交选择 | Gameplay | 参与 Rule/Action，继续保存在 TurnState |
| 未提交的输入文本等表单状态 | UI | 确认有效输入后调用 Gameplay |
| UI pending | UI | 防止重复交互并展示进度 |
| 游戏命令互斥、非法阶段拒绝 | Gameplay | 不依赖按钮禁用保证正确性 |
| 当前工作状态、检查点、随机游标 | Gameplay | UI 不直接读取或修改存储对象 |

Gameplay 不导入 React、React Router、UI 模块或 DOM；HTTP 与 IndexedDB 访问分别限制在内部 I/O 模块。浏览器 base URL 和监控选项由 UI 启动代码传入，Runtime 不读取 `window.location`。

## 4. 目标目录与命名

```text
src/
  main.tsx
  ui/
    app/
      App.tsx
      AppRouter.tsx
      GameLayout.tsx
      GameplayProvider.tsx
      gameplay-context.ts
      useGameplay.ts
      routes.ts
    pages/
    components/
    hooks/
      usePlay.ts
      useSaves.ts
    presentation.ts
    assets/
    styles/
  gameplay/
    index.ts
    gameplay.ts
    diagnostics.ts
    types/
      model.ts
      package.ts
      game.ts
      saves.ts
    runtime/
      Runtime.ts
      commands.ts
      rules.ts
      state-view.ts
      reactivity.ts
      reactions.ts
      snapshot.ts
      profile-factory.ts
      random.ts
      monitor.ts
      errors.ts
    package-loader/
      PackageLoader.ts
      HttpPackageSource.ts
      schemas.ts
      linker.ts
      errors.ts
    persistence/
      SaveRepository.ts
      database.ts
      profile-operations.ts
      validation.ts
```

目录按职责组织，不要求每个目录必须存在 `index.ts`。`gameplay/index.ts` 是 UI 使用的明确公共入口，显式导出名称，禁止用 `export *` 意外扩大边界。Gameplay 内部直接导入实际文件，避免反向导入公共入口造成循环。

命名规则：

- 具体运行对象叫 `Runtime`，加载器叫 `PackageLoader`，HTTP 数据源叫 `HttpPackageSource`。
- 不出现 `Impl` 后缀，不为单一实现额外建立一对 interface/class。
- 保留有实际替代实现的 I/O 协议，例如测试内存源与 HTTP 源共同实现的包来源协议、内存 Repository 与 IndexedDB Repository。
- `Game` 是 UI 与 Runtime 的能力边界，Runtime 直接实现它，不增加一个同名转发对象。
- `Gameplay` 是有实际跨局用例的组合服务，不再叠加 Manager、Controller 或 Service 门面。
- 展示函数有第二个真实使用方时才放入 `presentation.ts`；页面专用格式转换留在页面或对应 hook。

## 5. 公共 API

公共 API 只有两个主要对象：`Gameplay` 管理游戏与存档，`Game` 表示一局已打开的游戏。

### 5.1 身份引用

```ts
interface RunRef {
  readonly profileId: string
  readonly runId: string
}

interface CheckpointRef extends RunRef {
  readonly turnId: string
}
```

对 UI 的检查点引用始终包含 profileId，避免把来源对象和单独的 profileId 错配。现有持久化结构内部的 TurnRef 可以保留，只在边界转换；本次不因此改变存储格式。

### 5.2 Gameplay：目录、创建与存档用例

| 方法 | 返回内容 | 行为 |
| --- | --- | --- |
| `listGames()` | `GameInfo[]` | 包身份、作者描述、封面地址、存档数量与可用性 |
| `getGameInfo(gameId)` | `GameInfo` | 游戏信息及可选最近检查点引用、kind 和回合信息 |
| `createGame(gameId)` | 操作结果，成功携带 `CheckpointRef` | 保存新 Profile 的 initial 检查点 |
| `openGame(profileId, signal?)` | `Game` | 按精确包恢复、进入可交互状态、建立实例生命周期 |
| `listSaves(gameId)` | `SaveCollection` | Profile/Run/Checkpoint 摘要、可用性和操作条件 |
| `getCheckpoint(source)` | `GameSnapshot` | 只读投影指定检查点，供预览和结果页共同使用 |
| `continueGame(source)` | 操作结果，成功携带 `CheckpointRef` | 将恢复游标指向可继续的检查点 |
| `branchGame(source)` | 操作结果，成功携带新 `CheckpointRef` | 创建独立时间线，保留来源 |
| `truncateGame(source)` | 操作结果，成功携带 `CheckpointRef` | 删除后续检查点并恢复来源 |
| `restartGame(source)` | 操作结果，成功携带新 `CheckpointRef` | 从 terminal/abandoned 创建新的 Run |
| `setPinned(source, pinned)` | 操作结果 | 修改稳定检查点的 pin 元数据 |
| `deleteCheckpoint(source)` | 操作结果 | 删除检查点，按现有规则修复游标或级联删除 |
| `deleteRun(source)` | 操作结果 | source 为 RunRef，删除整条时间线 |
| `deleteProfile(profileId)` | 操作结果 | 删除整个存档 |

约束：

- 方法返回结构化数据，不返回 `recentLocation`、`resultLocation`、`recentLabel` 或导航回调。
- `GameInfo` 的最近存档信息是领域引用；“继续游戏”或“查看上次结局”的按钮与 URL 由 UI 生成。
- 存档摘要保留当前指针、来源关系、来源是否仍可解析、pin 和截断影响数量，供 UI 解释操作后果。
- `getCheckpoint()` 不更新最近存档、不修改恢复游标、不运行 Action、不启动新回合。
- 预览与结果页共用上述查询，不新增 `getResultPage()` 一类页面服务。
- 继续、分支、截断、重启成功后，由 UI 根据返回的 profileId 导航并打开游戏；不在这些方法中隐式创建 Runtime。
- 查询与打开失败通过有诊断信息的异常报告，取消打开使用 `AbortError`；写操作返回可判别的成功/失败结果。

### 5.3 Game：当前实例

```ts
interface Game {
  getSnapshot(): GameSnapshot
  subscribe(listener: () => void): () => void

  startEvent(eventId: string): Promise<CommandResult>
  activateEffect(effectId: string): Promise<CommandResult>
  chooseSingle(
    eventInstanceId: string,
    nodeId: string,
    choiceId: string,
  ): Promise<CommandResult>
  setChoiceCount(
    eventInstanceId: string,
    nodeId: string,
    choiceId: string,
    count: number,
  ): Promise<CommandResult>
  executeNodeCommand(
    eventInstanceId: string,
    nodeId: string,
    commandId: string,
  ): Promise<CommandResult>
  advanceTurn(): Promise<CommandResult>
  abandon(): Promise<CommandResult>
  close(): void
}
```

Runtime 直接实现这些方法，并共用命令互斥、错误转换和事务执行路径。`abandon()` 同样受命令锁保护，不能绕过锁与其他命令并发修改状态。

内部可保留命令标识与参数，用于执行分派和监控；不再把字符串 `dispatch` 与具名方法作为两套公共接口同时暴露给 UI。

`Game` 不提供 focus、navigate、openSaveBrowser、abandonAndExit、exitAndSave 或 restart 方法。放弃是游戏行为，确认和离开页面是 UI 行为；重启属于跨局的 Gameplay 用例。

### 5.4 命令结果与错误

- `CommandResult` 保留成功标志和 Runtime revision；失败包含 errorId、code、诊断 message，以及 `committed`。
- `committed: true` 表示本命令已提交稳定边界，后续阶段失败。UI 提示失败时仍展示最新发布的数据。
- 跨局操作结果按需携带新的身份引用，不伪造 `revision: 0`。
- 区分 busy、非法阶段、目标不存在、选项不可用、旧节点、required 阻塞、包/存档不兼容、脚本错误和持久化失败。
- Gameplay 保留定位所需的 id、阶段、资源地址和脚本调用链；UI 负责通用提示文案，不通过解析 message 字符串判断业务结果。
- 最近存档元数据写入失败不推翻已经成功的游戏或存档操作。

## 6. GameSnapshot 数据结构

GameSnapshot 是深度只读、不可变、已求值的普通数据。未发布新状态时，`getSnapshot()` 返回同一对象，适配 `useSyncExternalStore`。不泄漏可写对象、State Proxy、函数、registry 或原始 StoredProfile。

主要形状如下；实施时由公共类型补齐完整字段和判别联合：

```text
GameSnapshot
  game: { id, version, name }
  profile: { id, label? }
  runId
  checkpoint: { profileId, runId, turnId, kind }
  revision
  turnNumber
  phase
  status: active | ended | abandoned
  characters[]
    characterId, displayName
    attributes[]
      attributeId, displayName, type, value
      number: min?, max?
      enum: 当前值对应的作者标签
  effects[]
    effectId, displayName, description?
    actived, manuallyActivatable, canActivate
    bindCharacterId?, bindCharacterDisplayName?
  events
    available[]: eventId, displayName, description?, required
    active[]: eventId, eventInstanceId, displayName, currentNode
  canAdvanceTurn
  advanceTurnBlockers[]: kind, eventId, eventInstanceId?
  endedAt?
  endingEvent?
```

细节约束：

1. 角色和属性按实体关系嵌套，删除扁平列表里重复的角色名称。保留 Config 的 order 语义，不在 UI 重算领域顺序。
2. 数值保留 number，UI 负责数字格式、增减动画和进度条。枚举的作者标签属于游戏内容，应由 Gameplay 返回。
3. 节点包含已解析内容、单选选项、多选数量和命令可用性；UI 不查 Config 或脚本。
4. available/active 表达事件状态，删除 `eventCards` 这类控件命名；UI 可把同一数据做成卡片、列表或标签。
5. required 阻塞返回结构化原因；UI 可结合事件名称生成提示。门禁判断仍由 Gameplay 执行。
6. `status` 用判别联合约束 endedAt 与 endingEvent；abandoned 不冒充脚本结局。
7. `checkpoint` 永远引用最后稳定检查点；当前工作状态的 turnNumber 可能已经进入下一回合，不能把二者混为一谈。
8. 历史查询返回指定检查点的状态，不携带可写 Game 实例；UI 不因快照中的规则数据而把历史预览当成当前游戏。

## 7. UI 实施方式

### 7.1 启动与依赖

`main.tsx` 挂载 UI。UI 的 app 目录保留懒加载路由、GameLayout 和 Provider；Provider 持有稳定的 Gameplay 实例，并传入 base URL、开发环境监控开关与 URL 查询选项。保留 Arts 页面与游戏模块的懒加载边界。

UI 仅从 `gameplay/index.ts` 导入公共能力与只读类型。页面不导入 gameplay/runtime、persistence、package-loader 或原始 model 类型。

### 7.2 usePlay

按实际使用把游玩交互集中到 `usePlay`，组件负责布局与渲染：

1. 使用 AbortController 打开 Game；页面卸载或参数变化时取消尚未完成的打开，并关闭已取得的实例。
2. 通过 `useSyncExternalStore` 直接订阅 GameSnapshot。
3. 持有 pending、错误、事件焦点和确认状态；焦点对象消失时选择当前可用事件，DOM 聚焦由 UI 执行。
4. 用户动作调用 `game.startEvent()`、`game.chooseSingle()` 等具名方法。
5. UI 执行帮助函数接收 `() => Promise<CommandResult>`，先设置 pending 再发起调用，避免先创建 Promise 后才加 UI 锁。
6. 根据 snapshot 变化更新属性动画与界面，即使命令返回部分提交失败也要刷新。
7. 终局导航由 UI 根据身份和 status 完成；放弃操作有明确的成功导航目的地，避免终态订阅与放弃完成回调竞争导航。

不把旧 Session 原样改写为另一个 class 或 hook 中的手工 external store；订阅权威始终只有 GameSnapshot。

### 7.3 退出、切换存档与放弃

```text
退出 / 打开存档：
用户点击 → UI 确认 → game.close() → UI 导航

放弃：
用户点击 → UI 确认 → await game.abandon()
  成功 → game.close() → UI 导航
  失败 → 保持页面与实例，展示错误和当前 snapshot
```

close 幂等地停止接收新命令、清理监听与资源，不写入未提交工作状态。UI 在 pending 期间禁止主动退出/切换；卸载时仍须允许清理。

如果关闭发生在持久化已经开始之后，不把它描述为能够撤销已提交的 I/O：正在执行的处理单元按既定事务边界完成清理，关闭实例不再通知 UI，也不启动下一段工作。该时序纳入非 UI 回归，防止资源泄漏或悬挂 Promise。

### 7.4 存档与结果

- `useSaves` 管理查询、选中项、确认目标、pending 与请求过期保护；领域操作直接调用 Gameplay。
- 删除或截断成功后重新查询存档树，处理被删除的选中项和预览。
- 过期的预览结果不能覆盖后来选择的检查点。
- 结果页调用 `getCheckpoint(source)`，确认 kind 为 terminal/abandoned，再把内容转换为结果展示。
- 结果页通用标题、放弃说明、无叙事节点时的文案留在 UI。
- restart 成功后用返回的身份导航，不向 Gameplay 传 navigate。

## 8. Gameplay 内部拆分

### 8.1 gameplay.ts：跨局用例与组合

负责加载精确游戏包、获取稳定存档、执行纯存档变换、持久化、打开 Runtime 和维护最近访问记录。

一次存档变更顺序固定为：

```text
读取一次 Profile
  → 根据操作需要加载精确包并做 Config 感知校验
  → 执行纯变换，得到候选 Profile 或删除结果
  → 校验候选数据
  → 一次 Repository 写入或删除
  → 返回结果，按需更新最近访问元数据
```

保留 `profile-operations.ts` 的纯函数；不要把 I/O 和导航塞入这些函数。公共方法共享必要的读取/提交逻辑，不为每个操作创建 controller，也不建立通用用例注册系统。

结构有效的存档在精确包不可用时仍允许手动删除；继续、分支、截断、pin、restart 按现有语义要求精确 Config。坏记录继续由 Repository 隔离，不把异常强制断言成合法 Profile。

本次不扩展多标签页协同协议；单个 Game 内所有状态命令互斥，UI 离开游戏后再执行存档树操作。

### 8.2 Runtime：唯一的可写状态权威

保留状态机、Action、Reaction、CheckNode、PRNG、工作状态和检查点管理。公开具名方法共用一个内部执行入口，避免复制 busy/错误处理。

处理单元顺序：

```text
建立 candidate 状态与依赖图
  → 执行命令、Action 和稳定化
  → 校验候选稳定存档
  → 生成 candidate snapshot
  → 必要时等待 Repository 成功
  → 一次性替换状态、图、baseline、revision、snapshot
  → 通知订阅者
```

持久化、规则求值或 snapshot 投影失败时保留提交前状态。删除没有实际调用差异的参数，例如目前始终传 true 的 `allowHostTerminal`；保留有实际语义差异的发布控制。

### 8.3 rules / state-view / snapshot：共享只读计算

将 Runtime 当前绑定整个 Unit 的 Rule 求值，抽出只依赖以下内容的内部能力：

- 精确 Config 与 Rule registry；
- ProfileState、RunState、TurnState 的只读视图；
- 当前依赖图、Rule 调用栈、重算预算与统计回调。

共享能力继续负责嵌套 Rule、返回值约束、循环检测、动态依赖、基础值缓存与错误定位。写入、Action、随机数、Reaction 调度和持久化留在 Runtime。

运行中投影使用当前处理单元的候选依赖图；历史投影使用独立的临时求值上下文，两者共用数据投影函数。

历史投影必须：

1. 校验 Profile 与精确 Config；
2. 根据指定检查点重建生命周期视图，不能让时间线后来 ended/abandoned 的状态污染早期历史；
3. 只求值展示与门禁实际读取的 Rule，不注册 Effect 生命周期 observer 或 Reaction baseline；
4. 不创建 Immer 写入事务，不启动回合，不执行 Action，不消耗随机数；
5. 输出冻结数据，不修改输入、存档游标或监控实例生命周期。

不复制一套规则计算实现，不以“没有 Repository 的 Runtime”代替只读投影。

### 8.4 PackageLoader 与环境

- PackageLoader 统一拥有 catalog 与 `(id, version)` 包缓存；并发请求共用 Promise，成功结果复用，失败删除缓存以允许重试。
- default 版本和 exact 版本查找都走同一个 catalog；刷新页面建立新缓存生命周期，不额外增加缓存失效框架。
- HttpPackageSource 接收明确的资源 base URL 与缓存选项；继续校验同源 URL、HTTP 状态、MIME 与 JSON 语法。
- `readJson()` 返回 `Promise<unknown>`，具体类型由 schema 建立。
- 保留 module-import、schema、registry 和 linking 的诊断区分与 blob URL 回收。
- Runtime monitor 的启用判断由 UI 启动代码完成；监控记录本身留在 Gameplay，不依赖路由。

### 8.5 Persistence

保留结构校验、IndexedDB 原子写入与纯检查点操作。Runtime 不直接访问数据库；Repository 不执行脚本。

本次只迁移目录和调用边界，不改变 StoredProfile schema，不递增 DATABASE_VERSION。若实施中发现必须修改持久化结构，应先说明原因并更新权威类型与设计，按现有开发期清理规则处理，不能夹带兼容迁移。

## 9. 必须保持的不变量

- StoredProfile 只含稳定检查点；工作状态由当前 Runtime 单独持有。
- 普通事件操作不自动持久化；退出和切换丢弃未提交工作。
- `turn_end` 是独立持久化边界。下一回合启动失败时发布该边界，返回 `committed: true`；再次推进从该处重试。
- PRNG 与 State 一起提交或回滚，相同检查点和命令序列保持确定性。
- Rule 通过 get、ownKeys 和集合成员读取收集动态依赖，成功重算替换旧依赖，异常不缓存。
- State 写入只失效反向可达节点；Reaction 与 Effect 生命周期继续只处理 dirty observer。
- required 入口、CheckNode 候选链和 active 节点门禁保留。
- branch 保留来源，truncate 删除后续记录，pin 只保护自动清理，不阻止显式删除。
- ended/abandoned 可 restart；新 Run 按来源 ProfileState 物化初值，不继承上一 RunState。
- 删除来源检查点后，历史 origin 仍保留身份并显示无法解析，不伪造来源。
- 订阅者异常和监控异常不能改变领域提交结果。

## 10. 文件与 API 迁移表

| 原位置 / API | 目标 |
| --- | --- |
| `src/App.tsx`、`src/app` 的路由与 Provider | `src/ui/app` |
| `AppServices` | 用例迁至 `src/gameplay/gameplay.ts`，展示转换迁至 UI |
| `GameplayRuntimeImpl` | `src/gameplay/runtime/Runtime.ts` 中的 Runtime |
| `GameSessionImpl`、`GameSession`、`SessionView` | 删除；Game + UI hook 分担实际职责 |
| `SaveBrowserControllerImpl`、`SaveBrowserController` | 删除；合入 Gameplay 存档用例 |
| 公开 RuntimeCommand / dispatch | Game 具名方法；必要的内部标识不公开 |
| SessionCommandResult | Game 命令结果与跨局操作结果，删除未使用错误码 |
| RuntimeSnapshot | GameSnapshot |
| `selectors.ts` | `snapshot.ts`，同时支持运行中与历史只读投影 |
| `GamePackageLoader` | PackageLoader |
| `FetchGamePackageSource` | HttpPackageSource |
| `src/types` | `src/gameplay/types`；UI 专用类型留在 UI |
| `src/diagnostics.ts` | Gameplay 诊断内部能力；UI 通过公共错误读取诊断 |
| `recentLocation`、`resultLocation` | UI routes 函数 |
| `GameMenuView`、`ResultView`、SaveCheckpointPreview | Gameplay 返回通用数据，UI 按需创建本地展示模型 |
| `restartRun()` / `restart()` | Gameplay.restartGame(source) |
| `updateSelection()` | Game.setChoiceCount(...) |
| `exitAndSave()` / `openSaveBrowser()` | UI 确认、close、导航 |
| `src/assets` | UI 实际使用的资源迁至 ui/assets，确认无引用的模板资源删除 |
| 旧模块 barrel | 删除无使用价值的出口，保留明确公共边界 |

不保留旧名称别名、废弃目录转发文件或双实现过渡层。测试导入与文档路径一起迁移。

## 11. 分阶段实施

每个阶段完成一条可运行调用链，阶段完成条件同时满足后再进入下一阶段。实施过程中可编辑必要的相关文件，但最终提交只保留完成后的结构。

### 阶段 1：建立接口与目录边界

- [x] 定义 Game、GameSnapshot、身份引用、存档摘要与结果协议。
- [x] 明确更新技术规格与相关 game-design 的架构/API 约定，再改变实现边界。
- [x] 迁移 Gameplay 内部模块与 UI 启动模块，完成按职责命名。
- [x] 建立显式 Gameplay 公共入口，迁移内部导入。

完成条件：类型关系清晰，代码可以构建，核心测试仍可运行。

### 阶段 2：新建、打开与游玩

- [x] 完成 createGame 与 openGame，保留取消和构造失败清理。
- [x] Runtime 直接实现 Game 的全部玩法方法和共同命令锁。
- [x] usePlay.ts 中的 useOpenGame 与 usePlay 接管打开/关闭、pending、焦点、确认、展示与导航。
- [x] 页面消费角色嵌套属性和事件数据。
- [x] 删除 Session 实现、SessionView 与转发协议。

完成条件：新建、事件、Effect、单选、多选、Command、回合推进、退出均可通过新接口完成；Runtime 无 UI 状态。

### 阶段 3：存档、结果与重启

- [x] Gameplay 完成存档查询和全部具名操作，减少重复读取。
- [x] useSaves 和结果页迁移至公共接口。
- [x] 路由、recentLabel、通用结果内容全部移至 UI。
- [x] 删除 SaveBrowserController 和旧 AppServices。
- [x] 放弃/重启/删除失败时保留可恢复的 UI 状态。

完成条件：继续、分支、截断、pin、分层删除、结果查看、放弃和重启完整可用；返回值不携带页面路径。

### 阶段 4：只读投影与环境隔离

- [x] 抽取共享只读 Rule 求值上下文，保留动态依赖和监控统计。
- [x] 历史投影不创建 Runtime、不注册 observer、不执行 Action。
- [x] 统一 PackageLoader 缓存，失败可重试。
- [x] JSON 输入改为 unknown，base URL 与监控配置由启动代码传入。

完成条件：历史状态投影正确，读操作无写入和生命周期副作用；Gameplay 可在无 React/DOM 环境下被测试。

### 阶段 5：删除残留并落实约束

- [x] 删除废弃类型、路径、barrel、接口和无引用资源。
- [x] ESLint 限制 UI 仅从 Gameplay 公共入口导入，限制 Gameplay 对 UI/React/路由的反向依赖。
- [x] 保持 public/games 内容与存储 schema 不变。
- [x] 同步权威类型路径、架构说明和开发规范。
- [x] 搜索并清理旧名称、旧导入与失效文档链接。

完成条件：src 只保留 main.tsx 与 UI/Gameplay 两个业务目录；无旧实现或隐性越层访问。

### 阶段 6：验收与提交

- [x] 运行完整非 UI 回归，检查新增边界与失败时序。
- [x] 运行 build、lint、git diff --check。
- [x] 执行可运行的人工 UI 验收，记录结果或环境阻塞。
- [x] 审查 diff，确认不存在无关改动、构建产物或临时调试代码。
- [x] 更新本文实施记录。

第二笔重构 commit 包含代码、长期文档与本文。

## 12. 验证方案

### 非 UI 自动回归

在现有 23 项基线测试上按实际缺口补充行为测试，不为简单文件移动编写测试，不新增 UI 自动测试。

| 范围 | 必须证明的行为 |
| --- | --- |
| Gameplay 全流程 | 无 React 的创建、打开、玩法调用、保存、关闭、继续、分支/截断、结果、restart |
| 命令边界 | 具名方法实际执行规则，旧节点拒绝，包含 abandon 的命令互斥 |
| 原子发布 | selector/Rule/持久化失败保留旧状态、图、baseline、revision 与 snapshot |
| 部分提交 | turn_end 保存后下一回合失败，最新 snapshot 可见且同一命令可重试 |
| 生命周期 | 打开取消、构造失败、重复 close 和执行中 close 无资源泄漏或错误通知 |
| 历史投影 | 不写存档、不执行 Action、不注册持续 observer、不消耗随机数；历史生命周期独立于未来结局 |
| 存档用例 | 来源保留、截断计数、pin、删除游标修复、包不可用时仍可删除 |
| 包加载 | catalog/包并发复用，失败后重试，JSON 语法错误与 schema 错误可定位 |
| 订阅 | snapshot 引用稳定，成功提交后通知，失败未提交时不发布，订阅者异常不影响命令 |
| 可诊断性 | 错误编号、脚本链、命令参数与监控清理仍完整 |

### 人工 UI 验收

- [ ] 新游戏创建后进入首回合；角色、属性、Effect 和事件展示正确。
- [ ] required 事件阻止推进，完成后解除；单选、多选、CheckNode 与 Effect 激活正常。
- [ ] 操作中 pending 正确，失败有提示，部分提交失败仍显示稳定的新边界。
- [ ] 退出与切换存档丢弃未提交工作；取消确认保留当前状态。
- [ ] 存档预览、来源跳转、分支、截断、pin、三层删除和结果查看可用。
- [ ] 放弃失败留在当前页，成功按现有玩家流程离开；终局可查看并 restart。
- [ ] 键盘、Dialog 焦点恢复、事件节点焦点、屏幕阅读器通知和窄屏可用。
- [ ] 游戏页面与 Arts 路由懒加载正常，production preview 深链接可刷新。
- [ ] 开发环境和 runtimeMonitor 查询选项下监控开关与日志内容正确。

### 执行环境

所有项目命令在 WSL 的 `/home/tong/projects/maker-simulator` 执行：

```bash
pnpm run test
pnpm run build
pnpm run lint
git diff --check
```

Windows/PowerShell 调用形式：

```powershell
wsl.exe -d Ubuntu-24.04 --cd /home/tong/projects/maker-simulator bash -ic 'pnpm run test'
```

本次不改 Frostbound authoring，不运行生成器制造无关内容变化。人工检查受环境阻塞时据实记录，不能写为通过。

## 13. 长期文档同步范围

实施时直接修改对应的长期规范，不让它们引用本文：

- `src/gameplay/types`：公共协议和领域模型的权威声明。
- `docs/game-design/gameplay-runtime-flow.md`：Game 方法、快照、命令与事务语义。
- `docs/game-design/player-flow-and-ui.md`：UI 操作、导航、存档和结果数据消费。
- `docs/game-design/runtime-system.md`、`endings.md`、`game-package.md`：受影响的边界和类型链接。
- `docs/technical-spec.md`：两层架构、目录、依赖规则、只读求值和交付定义；修正与现有测试实践冲突的描述。
- `docs/development.md`、`README.md`：运行环境、入口、结构与验证方式。
- `AGENTS.md`：将旧 AppServices/Session 边界替换为 UI/Gameplay，保留已提交的 WSL 约束。
- 其他设计文档及 authoring skill 中确实受目录迁移影响的路径，按实际引用更新；不改剧情和策划规则。

## 14. 提交与验收记录

第一笔提交：`ea6629c docs: require WSL for project commands`。

- 已按要求撤销原先除 AGENTS.md 外的未提交变动。
- 第一笔提交只修改 AGENTS.md 的两条 WSL 运行规范。
- 重构前基线：23 项测试、build、lint、git diff --check 均通过。

本次按长期文档、代码、自动验证、项目启动和内置浏览器验证的顺序执行：

- 阶段 1—5 已完成。UI 与 Gameplay 分层、公共 API、只读历史投影及存档用例均已迁移；旧 Session、AppServices、Controller 和无用出口已删除。
- 非 UI 回归共 34 项通过，覆盖完整玩法及存档用例、失败回滚、部分提交后重试、关闭与取消时序、包加载缓存和只读投影。
- `pnpm run build`、`pnpm run lint`、`git diff --check` 通过。
- 回归中发现的完整检查点引用泄入存储字段，以及 turn_end 触发终局后未通知订阅者的问题已修复，并有对应回归覆盖。
- `public/games`、持久化 schema、数据库版本和依赖未改变。
- 在 WSL 中运行 `pnpm run dev --host 0.0.0.0 --port 5173 --strictPort`，服务地址为 `http://localhost:5173/games`。页面入口、catalog 与两个游戏包 manifest 的 HTTP 请求返回 200，JSON 资源可解析。
- 已请求在 Codex 内置浏览器打开上述地址，但浏览器控制工具在初始化时失败：`windows sandbox failed: helper_unknown_error: setup refresh had errors`。打开请求返回 queued，未取得页面状态或完成点击交互，不能视为人工 UI 验收通过。第 12 节的人工检查项保留待验收。

第二笔提交使用 `refactor: separate UI and gameplay`，包含本次重构及同步文档。本文继续独立保存，不由其他文档引用。
