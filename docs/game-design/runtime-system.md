# 运行时系统设计

本文面向引擎与系统开发者，定义 State、存档、回合快照、分支恢复和响应式执行机制。外部包的加载与 linking 见[外部游戏包与加载](./game-package.md)，RuntimeCommand 和单回合编排见[游戏运行时流程与 UI 绑定](./gameplay-runtime-flow.md)，策划 API 见[游戏脚本编写指南](./script-authoring.md)，领域类型见 [model.ts](../../src/types/model.ts)。

## 数据

游戏数据包含属性、效果、事件、规则与动作等内容定义，以及游玩过程中产生的状态。数据分为四层：

| 数据层 | 职责 | 生命周期 |
| --- | --- | --- |
| Config | 游戏策划编写的内容、脚本调用和默认值；游玩期间只读 | 随游戏版本发布 |
| StoredProfile | 一份稳定存档，保存恢复游标及其中的所有 RunData | 从新游戏开始，持续跨越多局游戏 |
| RunData | 一条独立的局内时间线，保存生命周期、来源和回合检查点索引 | 从一局开始到由 Action 结束、放弃或重开 |
| TurnData | 一条时间线在稳定边界上的可恢复检查点 | 在 RunData 初始化、回合提交、终局或废弃提交时创建 |

Config 是只读内容源。StoredProfile 与 RunData 只保存稳定时间线结构，TurnData 通过 snapshot 保存 ProfileState、RunState、TurnState 与 RandomState。Runtime 从当前 snapshot 克隆唯一一份未提交工作状态；这些 Data 对象和工作状态都不作为脚本 Context 直接传入。Rule/Action 只接收按层级解析后的 State 视图，并通过稳定 id 引用 Config 中的角色、属性、效果、事件和节点；调用描述与 Reaction 保留在 Config，JavaScript 实现保留在 LoadedGamePackage 的 registry。

### 基础值与有效值

Config 的 `xxxValue` 是创建新 Run 时物化到 RunState 的基础初始值；State 中的 `xxxValue` 是当前可持久化事实。ProfileState、RunState 与 TurnState 依次覆盖更低层的同名基础值。

Config 的 `xxx` 始终是 Rule，读取时执行 `calc` 并返回有效值。Rule 不能被直接写入；Action 和 RuntimeCommand 只能修改对应 State 视图中的 `xxxValue`。Rule 计算结果只存在于运行时视图和内部缓存，检查点只保存基础 State 与其它可序列化事实。

Action 写入 `context` 中的哪个 State 视图，就决定结果的生命周期：写入 `context.profileState` 的值跨 RunData 保留；写入 `context.runState` 的值只属于当前时间线；写入 `context.turnState` 的值只属于当前回合。局外成长写入 ProfileState，本局属性、Effect、EventInstance 与游戏包定义的结局写入 RunState，多选临时选择写入 TurnState。阶段和 EventInstance 的派生字段由引擎维护。

### 生命周期

1. 选择新游戏时，引擎根据 Config 的 `xxxValue` 基础值创建新的 Profile，并在其中创建首个 active RunData。
2. 创建 RunData 时，引擎同时创建 PRNG 状态和 `initial` TurnData。新游戏与 restart 生成新的随机种子，初始 `turnNumber` 为 `0`、`phase` 为 `initializing`；branch 的初始检查点复制来源 snapshot 及其 PRNG 状态。
3. 选择继续游戏时，引擎恢复 `StoredProfile.current` 指向的检查点。`initial` 与 `turn_end` 从下一回合开始；`terminal` 或 `abandoned` 只恢复结果/历史界面。浏览历史不会修改恢复游标。
4. 回合结束时，引擎提交本回合事务，创建 `turn_end` TurnData，并原子更新 RunData 的当前位置和 Profile 的当前位置。
5. 某个 Action 请求结束本局时，引擎在该 Action 及其引发的 Reaction 队列稳定后提交终局事务，原子创建 `terminal` TurnData、将 RunData 生命周期状态写为 `ended` 并记录 `endedAt`。结局内容已经由游戏脚本写入普通 RunState。玩家重新开始时，在同一 Profile 内创建新的 RunData；Profile 状态继续保留，RunData 与 TurnData 根据 Config 和当前 Profile 重新初始化。
6. 放弃 active Run 时，引擎将当前 RunData 记为 `abandoned` 并提交 `abandoned` TurnData。从 `terminal` 或 `abandoned` 结果选择再来一局时，在当前 Profile 中创建 restart RunData。
7. 玩家退出游戏界面或在游戏内打开存档浏览器时，引擎丢弃本回合初始化以来的全部未提交工作状态；`StoredProfile.current` 保持指向进入本回合前的 `initial` 或上一 `turn_end`。

### 终局与结局

终局是引擎管理的 RunData 生命周期事件，结局是游戏包管理的内容状态。游戏脚本只能在 Action 执行期间调用无参数的 `context.endRun()` 请求终局；在此之前，Action 将结局 id、枚举值或所需统计写入 `context.runState` 的普通字段。引擎不规定结局字段的名称、位置、取值或展示方式，也不根据它判定成功或失败。完整协议与脚本示例见[终局与结局](./endings.md)。

`endRun()`、当前处理单元的 State 写入和 PRNG 推进位于同一 draft。Action 抛出异常时全部回滚；root Action 完成后，引擎继续重算 Rule 并执行由变化引发的 Reaction Action。队列稳定后，若存在待处理终局请求，引擎停止接受新的玩家操作和阶段推进，原子创建 `terminal` TurnData、把 `RunData.status` 从 `active` 改为 `ended`、写入 `endedAt` 并更新恢复游标，随后注销当前 RunData 的 Reaction。重复请求按幂等处理。

终局请求可以由任意阶段中的 Action 发出。`terminal` snapshot 保留请求发生时已经稳定的 `turnNumber` 与 `phase`，不强制把 phase 推进到 `turn_end`。`RunData.status` 只区分 `active`、`ended` 与 `abandoned` 三种引擎生命周期；`abandoned` 表示玩家放弃本局，不要求存在游戏内容结局。

### 恢复与分支

TurnData 在逻辑上保存该时刻的 ProfileState、RunState、TurnState 与 RandomState 完整快照，因此可以精确查看当时的局外、局内、回合和 PRNG 状态。游戏脚本写入 RunState 的结局字段随 `terminal` snapshot 一起保存。`initial` 与 `turn_end` 可以继续游玩；`terminal` 与 `abandoned` 只保存终局或废弃结果。

从 active RunData 的最新可用 TurnData 继续时，引擎以该 snapshot 创建工作副本，后续检查点追加到当前 RunData。从同一 RunData 中不是最新项的可用 TurnData 继续时，玩家选择是否保留该检查点之后的回合数据：

- 选择保留时，引擎根据所选 snapshot 创建新的 branch RunData，并在 `origin` 中记录来源；原 RunData 的 `currentTurnId` 与全部检查点保持不变。新 RunData 的首个 TurnData 保存复制后的 snapshot，随后 `StoredProfile.current` 指向这个新检查点。
- 选择删除时，引擎从原 RunData 的 `turnOrder` 与 `turnDatas` 中删除所选检查点之后的全部 TurnData，并把 `currentTurnId` 与 `StoredProfile.current` 指向所选检查点。若原 RunData 已结束，同时把 status 恢复为 `active` 并清除 `endedAt`；Runtime 随后从所选 snapshot 重建包括结局字段在内的工作状态。

删除后续回合数据是用户明确执行的截断操作，会删除其中已 pin 的 TurnData。截断事务必须原子完成；失败时保留原 RunData 的全部数据和状态。

读取或预览历史 TurnData 只访问其 snapshot。时间线选择等界面状态由 UI 管理，不写入 Profile 的恢复游标。每个 RunData 保存一条线性时间线，分支关系由新 RunData 的 `origin` 表达。

完整快照是数据语义。存档实现可以使用结构共享、增量快照或周期性全量快照降低空间占用；清理某个增量快照的基底前，必须先让依赖它的保留检查点能够独立恢复。

### TurnData 保留策略

每个 RunData 在创建时记录 `maxTurnCount`。`turnOrder` 中保存的 TurnData 数量超过上限后，引擎按 `turnOrder` 从旧到新清理未受保护的 TurnData。每个 RunData 的 `currentTurnId` 以及被用户 pin 的检查点始终保留；当受保护的检查点已经达到上限时，允许暂时超过上限并向用户提示。

`RunOrigin.source` 只记录新 RunData 的来源，不保护源 TurnData。源 TurnData 被自动清理或主动删除后，已经创建的 RunData 仍通过自己的 `initial` snapshot 独立恢复，`origin` 保留为可能无法解析的历史引用。

清理 TurnData 只删除检查点，不改变其所属 RunData 的生命周期、当前 State 或其他 RunData。结局与统计都是普通 RunState，在保留的当前 snapshot 中按普通状态保存。使用增量存储时，引擎必须先压实仍依赖待清理检查点的数据。

### 保存边界与兼容

StoredProfile、RunData 与 TurnData 只保存可 JSON 序列化的稳定检查点、时间线元数据和恢复游标；游戏脚本写入的结局字段属于 snapshot 中的普通状态事实。存档不额外保存当前工作 State，也不复制 Config 中的展示文本、tag、节点图、Rule/Action 函数或 Reaction 配置。Rule 计算结果、依赖图、计算缓存、Reaction 基准值、Proxy、事务 draft、待处理的终局请求和执行队列也不写入存档，载入后由引擎重新构建。

所有内容引用使用稳定 Config id，时间使用 UTC ISO 8601 字符串。StoredProfile 保存精确的 Config id 与版本；恢复时必须取得完全匹配且已经链接的游戏包。项目处于开发阶段，存档结构或内容结构改变时直接清空或舍弃旧存档，不维护结构版本字段、迁移链或运行时兼容分支。

### 随机状态

引擎为每个 RunData 维护一份独立的伪随机数生成器状态：

```ts
interface RandomState {
    /** 创建 RunData 时确定的随机种子。 */
    seed: string;
    /** 已提交的 PRNG 调用数量。 */
    cursor: number;
}

type Random = () => number;
```

`context.random()` 是 Action 使用随机性的唯一入口。每次调用根据当前 `seed` 与 `cursor` 返回 `[0, 1)` 内的一个值，然后使事务 draft 中的 `cursor` 增加 `1`。RuleContext 不提供随机函数；游戏脚本不得调用 `Math.random()`、真实时间或其他未受引擎管理的随机源。

PRNG 推进是当前 Action 处理单元的一部分：整条 Action/Reaction 队列成功时提交新 `cursor`，任一执行失败时与其他写入一起回滚。引擎只提供原始随机值；候选对象的筛选、按 `order` 排序、将 `weight` 解释为独立概率或相对权重，以及对结果的处理都由 Action 完成。

RandomState 只存在于 Runtime 工作状态和每个 StateSnapshot 中，不在 RunData 上维护第二份副本。从检查点继续、载入、截断或创建 branch 时恢复该检查点的 RandomState，保证同一随机序列可重现。restart 会为新 RunData 创建新的 seed 并将 `cursor` 设为 `0`。

需要跨读档或重算保留的一次性随机结果必须由 Action 写入 State。Rule 是确定性的纯计算，不读取或推进 RandomState。

## 运行时构造

引擎接收已经由包加载器校验并链接完成的 `LoadedGamePackage`，不会在局级运行时中 fetch JSON 或 import JavaScript。Config、ActionRegistry 与 RuleRegistry 属于包级只读数据；每个 RunData 只创建与当前 State 绑定的执行器、Proxy、缓存和依赖图。外部入口与包级 linking 见[外部游戏包与加载](./game-package.md)。

### 新游戏与 restart

1. 根据 Config 创建 ProfileState、RunState 与 TurnState 顶层集合，生成 id、时间、PRNG seed，并设置 `turnNumber = 0`、`phase = 'initializing'`。Config 的 `xxxValue` 基础值物化到新 Run 的 RunState；静态展示字段、Rule 和 Action 不复制到 State。
2. 物化必须保存的回合 `0` 生命周期事实，例如初始 `acquired`、`actived` Effect 的发生回合。
3. 校验初始 State，构造 `initial` TurnData、RunData 与 StoredProfile，并持久化；这是创建新存档的成功边界。
4. 打开 GameplayRuntime，从 `initial` snapshot 克隆唯一工作状态，创建事务管理器、PRNG draft、Config/State 合并 Proxy 与绑定执行器。
5. 编译派生字段 Rule 的计算节点与依赖图；此时可以计算 Rule，不执行 Action。
6. 按确定顺序注册 EffectConfig、EventConfig 与当前节点 Reaction，只计算基准值；baseline 失败时关闭 Runtime，已保存的 `initial` 保持不变。
7. 引擎以 `initial` 为回滚边界，把 `turnNumber` 增加到 `1`，进入 `turn_start`，运行到 `event_handle` 稳定输入点后发布首个 UI snapshot。首回合脚本失败时同样保留完整 `initial`，报告错误并允许修复包后重试，不留下半提交的回合状态。

### 载入、branch 与截断恢复

1. 根据 `StoredProfile.configId` 与 `configVersion` 取得精确游戏包，并校验存档和所选 snapshot。
2. 从 snapshot 克隆 ProfileState、RunState、TurnState 与 RandomState 工作副本。
3. 按新游戏相同顺序创建事务、Proxy、Rule/Action executor、计算节点与依赖图。
4. 注册全部配置级 Reaction，并为每个 active EventInstance 的当前 TextNode 注册节点 Reaction；恢复过程只建立基准，不执行 Action。
5. `initial` 与 `turn_end` 恢复点由状态机开始下一回合；`terminal`、`abandoned` 只生成历史或结果视图。

branch RunData 的首个 `initial` snapshot 复制来源检查点状态，并由状态机进入下一回合。即使 `RunOrigin.source` 后续被清理，恢复方式仍可由新 RunData 自己的 snapshot 判定。

初始化的固定先后关系是：初始生命周期事实先于 `initial` snapshot，持久化的 `initial` 先于 Runtime baseline，registry executor 先于计算节点，baseline 先于首次 `turn_start`。初始结构构造失败不会创建存档；baseline 或首次回合处理失败只留下可独立恢复的 `initial`。

## State

State 是 Config 在一次具体游玩中的状态结果。Profile 是存档容器，RunData 是一条局内时间线，TurnData 是可恢复检查点。

Config、State 与脚本访问的运行时视图保持相同的对象层级。State 只保存 Config 对象的 id、实际写入的字段和该对象的运行时字段，不复制展示文本、Rule、Action 等静态字段。

### 结构与运行时视图

Config 与 State 使用相同的 object 字段名：顶层都是 `characters`、`effects` 与 `events`；Character 下都是 `attributes`；Event 下都是 `nodes`，TextNode 下都是 `choicesValue`。新 Run 的 RunState 会物化当前 Config 的基础字段；不完整或结构过期的存档在加载校验时直接拒绝。

引擎通过 object key 合并同一层级中的对象。Profile 运行时视图由 Config 与 ProfileState 合并，Run 运行时视图再叠加 RunState，Turn 运行时视图继续叠加 TurnState。Rule 与 Action 因而使用相同路径读取默认值和实际值：

```ts
context.config.characters[characterId]?.attributes[attributeId]?.value;
context.runState.characters[characterId]?.attributes[attributeId]?.value;
```

RuleContext 与 ActionContext 中的 `profileState`、`runState`、`turnState` 都是解析到对应层级的 State Proxy，不是 Profile、RunData 或 TurnData 容器。Rule 的三个 State 视图全部只读，只绑定 `context.rule`，不提供 Action 或随机能力。Action 对可写字段的赋值由 Proxy 记录到稀疏 State，并绑定 `action`、`rule`、当前 RunData 的 `random` 和无参数的 `endRun`。Context 不暴露容器 id、检查点列表、恢复游标、时间戳或存档版本。

`turnNumber` 与 `phase` 由状态机独占写入。EventInstance 的 `currentNodeId` 与 `status` 是 Action 可写的生命周期事实；`activeInstanceId`、实例集合结构、实例 id、访问路径和回合时间字段由引擎维护。Action Proxy 拒绝其他生命周期路径以及所有 Data 容器元数据写入。

### 状态值

```ts
type Timestamp = string;

interface CommonState {
    id: string;
    weight?: number;
    visible?: boolean;
    unlocked?: boolean;
    enabled?: boolean;
}

interface AttributeState extends CommonState {
    value?: number;
}

interface CharacterState extends CommonState {
    attributes?: Record<string, AttributeState>;
}

interface EffectState extends CommonState {
    acquired?: boolean;
    actived?: boolean;
    bindCharacterId?: string;
    acquiredTurn?: number;
    activedTurn?: number;
}

interface ChoiceState extends CommonState {
    maxCount?: number;
}

type NodeCommandState = CommonState;

interface EventNodeState extends CommonState {
    required?: boolean;
    choices?: Record<string, ChoiceState>;
    commands?: Record<string, NodeCommandState>;
    /** 仅 TurnState 使用的多选结果。 */
    selections?: Record<string, NodeSelection>;
}

interface EventState extends CommonState {
    nodes?: Record<string, EventNodeState>;
    /** 仅 RunState 使用；指向当前 active 实例。 */
    activeInstanceId?: string;
    instances?: Record<string, EventInstance>;
}

interface GameState {
    characters: Record<string, CharacterState>;
    effects: Record<string, EffectState>;
    events: Record<string, EventState>;
}

type ProfileState = GameState;
type RunState = GameState;
```

State 中的每一项通过 object key 与同层 Config 对象对应，value 的 `id` 必须等于 key。新 Run 的 RunState 会包含 Config 基础值对应的对象和 `xxxValue` 字段；未发生其它写入的字段仍可省略。三个顶层 object 始终存在，没有数据时使用空对象。

`CommonState` 对应 CommonConfig 中允许产生直接状态的 `xxxValue` 字段。`weightValue` 可在 ProfileState、RunState 或 TurnState 中覆盖基础初始值；`order` 是 Config 中的静态随机判定顺序，不写入 State。AttributeState 位于 `characters[characterId].attributes[attributeId]`，其 `value` 对应 AttributeConfig.value。EffectState 位于 `effects[effectId]`，`acquiredValue`、`activedValue` 和绑定字段与 EffectConfig 对应，获得与激活回合是同一对象上的运行时字段。EventState 位于 `events[eventId]`，节点状态继续保存在 `nodes[nodeId]`；`activeInstanceId` 与 `instances[instanceId]` 只保存在 RunState。

Config 对应的 State object 只能使用 Config 中已经存在的 key。`choicesValue` 在 State 中只保存 Choice 的基础字段，不复制展示文本、Action 或 Rule。**动态产生的对象必须写入明确的运行时字段**，例如 EventState.instances 或 EventNodeState.selections，不能伪装成新的 Character、Attribute、Effect、Event、Node 或 Choice。

Rule 字段不能保存同名 State 值，Action 必须改写对应的 `xxxValue` 基础字段。Rule 派生字段的有效值不写入 State；载入、branch 和截断恢复时恢复基础 State，再重新计算有效值。Config 中的 Rule、Action、Proxy、缓存以及不能 JSON 序列化的对象都不能写入 `GameState`。

新游戏与 restart 初始化 RunState 时，初始基础值为 `true` 的 `acquiredValue` 或 `activedValue` 使用当前的 `turnNumber = 0` 初始化对应 EffectState 的回合字段，表示该 Effect 在本 Run 开始时已经获得或激活。Reaction 注册仍只建立基准值，因此不会把初始有效值 `true` 当作状态转换执行一次性 Action；需要在开局执行的 Action 应通过观察 `initializing` 到 `turn_start` 的 Reaction 表达。

初始化之后任一字段从 `false` 变为 `true` 时，引擎写入当前回合数；`actived` 再次进入 `true` 时更新 `activedTurn`。载入、branch 与截断恢复保留 snapshot 中的 EffectState，也不会重复执行已经发生过的生命周期 Action。

`EffectConfig.manuallyActivatable` 是 Config 中的静态能力声明，不进入 EffectState。它为 `true` 且 Effect 已获得、尚未激活时，`activate-effect` RuntimeCommand 才能在 `event_handle` 阶段被接受。Runtime 在同一处理单元中校验 `visible`、`unlocked`、`enabled`、`acquired` 与 `actived`，通过可写 RunState 视图将 `activedValue` 设为 `true`，然后运行正常的 Reaction 稳定流程。手动激活不限制 `actived` Rule 的形式。

### 事件状态

每次成功执行宿主 `StartEvent` RuntimeCommand 都创建一个 EventInstance，并在同一个处理单元中把它存入当前 RunState 对应 EventState 的 `instances[instanceId]`，同时把 `activeInstanceId` 设为该 `instanceId`：

```ts
interface EventInstance {
    instanceId: string;
    eventId: string;
    status: 'active' | 'completed' | 'abandoned';
    currentNodeId: NodeId;
    nodePath: NodeId[];
    startedTurn: number;
    endedTurn?: number;
}
```

`instanceId` 在所属 RunData 内唯一，并且必须与 `instances` 的 key 相同；`eventId` 引用 EventConfig，并与所属 EventState.id 相同。省略 `activeInstanceId` 表示该 EventConfig 当前没有 active 实例；存在时必须解析到 `instances` 中唯一一个 `status = 'active'` 的实例。每个实例独立记录当前节点和实际访问路径；进入节点时把 node id 追加到 `nodePath`。实例完成或放弃后仍保留在 `instances` 中，Rule 可以据此结合 Config 中的 event tag 计算完成次数等派生值。

`StartEvent` 只在 `event_handle` 接受，重新校验 Event 的有效 `unlocked` 与 `enabled`，并在 `activeInstanceId` 已存在或本回合已成功创建过实例时拒绝启动。该命令属于 UI 到引擎的公开协议，不解析 ActionRegistry 中的特殊 key。跨回合事件继续使用 `activeInstanceId` 指向的同一个实例；UI 始终为该实例提供入口。实例结束后可以从下一逻辑回合起再次创建。

`ActivateEffect` 只在 `event_handle` 接受。它不调用游戏包 Action，而是执行通用的 Effect 生命周期写入；写入完成后，EffectConfig 的 Reaction 按普通 State 变化触发。激活命令和 Reaction 共用一个处理单元，退出当前游玩页时仍遵循普通事件操作的回合内存边界。

Choice、NodeCommand 与 CheckNode 的 Action 先通过 `context.runState.events[eventId].activeInstanceId` 定位当前实例，再直接写入该实例的生命周期字段：

```js
const eventState = context.runState.events[eventId];
const instanceId = eventState.activeInstanceId;
if (instanceId === undefined) {
    throw new Error(`Event ${eventId} has no active instance`);
}
eventState.instances[instanceId].currentNodeId = nextNodeId;
```

Action 可以把 active 实例的 `currentNodeId` 写为当前 EventConfig 中存在的节点，也可以把 `status` 从 `active` 写为 `completed` 或 `abandoned`。实例集合的增删与替换、`activeInstanceId`、`instanceId`、`eventId`、`nodePath`、`startedTurn` 和 `endedTurn` 都由引擎维护；Action 对这些字段的写入会使处理单元失败。终态实例不可再修改。

每个 Action 调用帧最多执行一次事件生命周期写入：一次 `currentNodeId` 赋值，或者一次 `status` 赋值。重复写同一字段或在同一帧组合跳转与结束属于脚本错误；嵌套 `context.action` 共享处理单元 draft，但各自拥有独立调用帧。Action 返回后，引擎按 Action FIFO 顺序验证并落实该帧写入。跳转时，引擎把目标追加到 `nodePath`，注销旧节点 Reaction，取消尚未开始的旧节点队列项，清理旧节点的 TurnState 选择，再为新节点 Reaction 建立基准；目标是 CheckNode 时，其 `check` 作为下一 Action 帧自动执行。CheckNode 只允许跳到 `candidateNodes` 中的目标。

实例结束时，引擎写入 `endedTurn`、清除所属 EventState 的 `activeInstanceId`、注销当前节点 Reaction，并清理该实例的临时选择。上述派生写入与 Action 的 State 写入在同一个处理单元中提交或回滚。

`context.endRun()` 只是处理单元标记，不中断 EventInstance 写入。当前 Action 的合法事件转换先落实，节点/Reaction 因果链稳定后才创建 `terminal`；因此 terminal snapshot 保存稳定后的 EventInstance。任一非法写入都会回滚整个处理单元。

### 回合状态

```ts
type TurnPhase =
    | 'initializing'
    | 'turn_start'
    | 'event_handle'
    | 'turn_end';

interface ChoiceSelection {
    id: string;
    value: Primitive;
    count: number;
}

interface NodeSelection {
    eventInstanceId: string;
    choices: Record<string, ChoiceSelection>;
}

interface TurnState extends GameState {
    /** 当前时间线的逻辑回合数。 */
    turnNumber: number;
    phase: TurnPhase;
}
```

`phase` 是 TurnState 中公开、可观察但由引擎独占写入的状态机字段。新游戏与 restart 从 `initializing` 开始；引擎注册配置级 Reaction 并建立基准后，将 `turnNumber` 从 `0` 增加到 `1` 并进入 `turn_start`。载入、branch 与截断恢复先用 snapshot 建立 Reaction 基准；`initial` 或 `turn_end` 恢复点开始下一回合。

玩家只通过 `AdvanceTurn` 表达结束当前回合的意图，UI 不发送 `SetPhase`。引擎状态机自动执行 `turn_start → event_handle`，并在 `AdvanceTurn` 通过 required 门禁后执行 `event_handle → turn_end → 下一 turn_start`。依赖 phase 的 Rule 与 Reaction 按普通状态变化处理；Action 可以读取 phase，但直接赋值会被拒绝。创建 branch、执行截断和建立 Reaction 基准不会额外执行阶段 Action。

`SetMultipleChoice` RuntimeCommand 将临时选择写入 `context.turnState.events[eventId].nodes[nodeId].selections[eventInstanceId].choices[choiceId]` 对应的 TurnState 路径。每层 object 的 key 都是对应对象的 id。`count` 必须是非负整数，`0` 表示删除记录；对应 MultipleChoice 配置了 `maxCount` 时不能超过其已解析值。同一 EventInstance、节点和 choice 组合只保留一条记录。Command Action 成功、退出节点或事件结束时由引擎清除对应记录。新回合初始化时清理上一回合未继续使用的临时选择。

### 存档容器

```ts
interface TurnRef {
    runId: string;
    turnId: string;
}

interface StoredProfile {
    profileId: string;
    /** 玩家设置的可选存档显示名。 */
    label?: string;
    /** 成功写入后递增，用于拒绝并发覆盖。 */
    storageRevision: number;
    configId: string;
    configVersion: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    runDatas: Record<string, RunData>;
    current: TurnRef;
}

type RunStatus = 'active' | 'ended' | 'abandoned';

interface RunOrigin {
    kind: 'branch' | 'restart';
    /** 来源记录；允许指向已经删除的 TurnData。 */
    source: TurnRef;
}

interface RunData {
    runId: string;
    origin?: RunOrigin;
    status: RunStatus;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    endedAt?: Timestamp;

    /** 创建时从 ConfigMeta.maxTurnCountPerRun 复制。 */
    maxTurnCount: number;

    currentTurnId: string;
    turnOrder: string[];
    turnDatas: Record<string, TurnData>;
}

/** 仅存在于 GameplayRuntime 内存中的当前工作对象。 */
interface RuntimeState {
    profile: StoredProfile;
    working: StateSnapshot;
}

interface StateSnapshot {
    profileState: ProfileState;
    runState: RunState;
    turnState: TurnState;
    randomState: RandomState;
}

type CheckpointKind =
    | 'initial'
    | 'turn_end'
    | 'terminal'
    | 'abandoned';

interface TurnDataBase {
    turnId: string;
    createdAt: Timestamp;
    /** 为 true 时不参与自动清理。 */
    pinned: boolean;
    snapshot: StateSnapshot;
}

type TurnData = TurnDataBase & (
    | {
          kind: 'terminal';
          /** 可选的终局事件实例来源。 */
          endingEventInstanceId?: string;
      }
    | {
          kind: 'initial' | 'turn_end' | 'abandoned';
          endingEventInstanceId?: never;
      }
);
```

#### StoredProfile

`profileId` 是存档 id，`label` 是玩家可修改的可选显示名。`configId` 与 `configVersion` 精确确定该存档所需的内容包；`runDatas` 保存该存档的所有时间线；`current` 指向最后提交或由玩家选择继续的检查点。该检查点为 `terminal` 或 `abandoned` 时只能恢复结果界面。

`storageRevision` 是持久化并发令牌。新对象从 `0` 开始；Repository 仅在它等于数据库当前值时接受写入，并把返回对象递增一位。它不表示存档结构或游戏内容版本。`createdAt` 在新游戏时写入，`updatedAt` 在修改 label、提交回合、结束 RunData、创建分支或修改 pin 后更新。`current` 必须指向 `runDatas` 中存在的 RunData 与 TurnData。查看历史记录、展开分支或在界面中选中检查点不会修改 `current`。

#### RunData

`runId` 在 Profile 内唯一。首个 RunData 的 `origin` 为空；保留历史检查点之后的回合数据并创建分支时使用 `branch`，结束一局或主动重开后创建新局时使用 `restart`。

branch 会把可用来源的 snapshot 连同 RandomState 复制到新 RunData 的 `initial`。restart 根据当前 ProfileState 与 Config 重新初始化 RunState 和 TurnState，并生成新的 RandomState；`terminal` 或 `abandoned` 来源只记录上一局位置，不作为新回合状态。两种 origin 的 `source` 都只承担历史追溯作用，允许指向已被清理或删除的 TurnData。

创建 RunData 时同时创建 `initial` TurnData：新游戏和 restart 使用 `turnNumber = 0`、`phase = 'initializing'` 的初始状态，branch 复制来源 snapshot 并继承其中的逻辑回合数与 phase。

`status` 在运行期间为 `active`。Action 调用 `context.endRun()` 后，引擎记录待处理终局请求；当前处理单元及其 Reaction 队列稳定后，原子创建 `terminal` TurnData、把 status 改为 `ended` 并写入 `endedAt`。终局保留 Action 请求发生时的 phase，不执行引擎级结局判定。放弃 active Run 时创建 `abandoned` TurnData，把 status 改为 `abandoned` 并写入 `endedAt`；之后可以从该记录创建 restart RunData。

从已结束 RunData 的历史可用 TurnData 继续时，保留后续回合会创建 branch RunData；删除后续回合会截断当前 RunData，将 status 恢复为 `active` 并清除 `endedAt`。

`createdAt` 在创建时间线时写入，`updatedAt` 在提交检查点、结束时间线或修改其中的 pin 时更新，`endedAt` 在 status 变为 `ended` 或 `abandoned` 时写入。`maxTurnCount` 必须是正整数。

RunData 不保存 `state`、`turnState` 或 `randomState` 工作副本。GameplayRuntime 从当前 snapshot 克隆一个 `StateSnapshot` 作为唯一工作状态；Action 只修改其事务 draft。检查点提交成功后，新的稳定状态写入新 snapshot 并成为 current。运行过程中发生崩溃时，从最后一个 current snapshot 恢复。

`turnOrder` 按提交顺序保存 turn id，`turnDatas` 用于按 id 定位检查点，二者必须包含相同的 turn id 集合。新 RunData 的首个检查点创建成功后，才会被加入 Profile。

#### TurnData

TurnData 是稳定状态的检查点。`initial` 在创建 RunData 时生成，`turn_end` 在正常回合结束时生成，`terminal` 在 Action 请求终局且执行队列稳定后生成，`abandoned` 在放弃本局时生成。`initial` 与 `turn_end` 从下一回合开始；`terminal` 与 `abandoned` 只用于结果和历史记录。常规游戏状态只在 `turn_end` 创建和持久化检查点。

若首次 `endRun()` 请求的执行来源关联到一个 EventInstance 的当前 TextNode，terminal TurnData 在 `endingEventInstanceId` 中记录该实例 id。重复终局请求保持幂等且不替换首次来源。该字段只用于从 terminal snapshot 重建可选的结局节点 read model，不参与 RunData 生命周期或游戏内容结局判断。

`turnId` 在所属 RunData 内唯一，`createdAt` 是该检查点的提交时间。`snapshot` 在创建后保持只读，`pinned` 是可以单独修改的存档元数据；同一 RunData 中检查点的先后关系由 `turnOrder` 表达。

恢复 `StoredProfile.current` 时，引擎克隆其完整 snapshot 作为 Runtime 当前时间线的唯一工作副本。`terminal` snapshot 中的结局仍按普通 RunState 字段读取，`terminal` 与 `abandoned` 不得进入状态机。

从非最新的 `initial` 或 `turn_end` 继续并保留后续数据时，引擎用 snapshot 创建 branch RunData 及其 `initial` 检查点，源 RunData 保持不变。从该检查点继续并删除后续数据时，引擎原子删除 `turnOrder` 中位于它之后的 id 及 `turnDatas` 对应记录、恢复 active 状态，并更新恢复游标、RunData.updatedAt 与 StoredProfile.updatedAt；下次打开 Runtime 时直接从该 snapshot 克隆工作状态。

提交新 TurnData 时，引擎先完成 Action 与 Reaction 队列，再从工作状态创建包含 RandomState 的 snapshot，随后更新 `RunData.currentTurnId`、`StoredProfile.current` 和时间戳，形成候选稳定存档。Repository 成功写入候选对象后，Runtime 才替换内存中的 StoredProfile、工作状态、revision 和 RuntimeSnapshot。

逻辑上每个 snapshot 都能够独立恢复。物理实现采用增量或结构共享时，序列化层负责重建完整 snapshot，不能让该优化改变 Rule、Action 或存档加载看到的数据结构。

### 状态约束

- `StoredProfile.current.turnId` 必须等于对应 RunData 的 `currentTurnId`；`currentTurnId` 必须等于 `turnOrder` 的最后一项；`turnOrder` 与 `turnDatas` 必须包含相同的 turn id 集合。
- 每个 snapshot 的 `randomState.cursor` 必须是非负安全整数，`seed` 必须是非空字符串；Runtime 工作副本可以随 `context.random()` 调用推进。
- 创建 RunData 时，`turnOrder` 的第一项是 `initial`。该检查点之后可以按保留策略删除，保留列表的第一项因此可以是后续检查点。新游戏和 restart 的 initial snapshot 使用 `turnNumber = 0`；branch 的 initial snapshot 继承来源回合数与 phase。`turnNumber` 只在进入新的 `turn_start` 时增加，因此后续检查点按 `turnOrder` 单调不减。`terminal` 保留终局请求发生时的 phase。
- status 为 `ended` 时，最后一个检查点必须是 `terminal`；status 为 `abandoned` 时，最后一个检查点必须是 `abandoned`。这些状态下 `endedAt` 必须存在。
- `endingEventInstanceId` 只能出现在 `terminal`，存在时必须指向该 snapshot RunState 中的 EventInstance；其他检查点必须省略。
- `terminal` 与 `abandoned` 不能作为 branch 或截断恢复的起点。
- branch 的 `RunOrigin.source` 必须在创建分支时指向 `initial` 或 `turn_end`；restart 可以记录上一局的 `terminal` 或 `abandoned`，但不读取它的 RunState 或 TurnState 初始化新局。
- `StoredProfile.current` 与 `RunOrigin.source` 使用不同的引用约束：`StoredProfile.current` 必须能够解析，`RunOrigin.source` 允许指向已删除的 TurnData。
- EventInstance 只保存在 RunState 的 `events[eventId].instances`；每个 EventState 至多有一个 `status = 'active'` 的实例，且 `activeInstanceId` 必须指向它；没有 active 实例时该字段必须省略。Effect 的获得与激活回合只保存在 RunState 的 `effects[effectId]`；属性值位于 ProfileState 或 RunState 的 `characters[characterId].attributes[attributeId]`，写入层级决定其跨局生命周期。
- 所有 id、必须可解析的引用、枚举、数值范围与 JSON 类型在事务提交和存档载入时校验。`RunOrigin.source` 只校验引用格式，允许目标不存在。校验失败时丢弃当前事务；存档载入失败时保留原始存档并报告具体路径。
- CommonConfig 的 `weightValue` 和 `weight` Rule 返回值都必须是 `[0, 10]` 内的有限数；超出范围时视为配置或事务错误，不自动截断。同一所属集合内同一具体类型的 CommonConfig `order` 必须互不相同。
- 一个运行时处理单元中的 State、PRNG、EventInstance 派生写入与终局请求先形成候选结果；检查点和 RunData 元数据需要保存时，Repository 成功后才统一发布候选 Runtime 状态。保存失败保留原存档和原内存状态。

### 响应式状态系统 Reactive State

响应式状态系统包含四个概念：state 是可观察的事实；Rule 是由 state 派生的值；Action 在事务中修改 state，并可请求结束当前 RunData；Reaction 观察一个值并在其变化时执行 Action。

引擎使用依赖图连接这四个概念。Rule 执行时，读取 state 的字段、集合及集合成员都会被记录为依赖；例如 Rule 筛选已完成的黑暗事件时，会依赖已完成事件集合。

Rule 只能读取只读 State/Config 并调用其他 Rule。同一输入必须得到同一结果；RuleContext 不提供 `action` 或 `random`，脚本契约也禁止真实时间、I/O 与外部副作用。

RuntimeCommand 或自动状态转换开启一个受控处理单元。命令/状态机写入、root Action、嵌套 Action 和由变化触发的 Reaction Action 共用 copy-on-write State、RandomState 与终局请求 draft。`context.config` 仅用于查询静态定义；`context.profileState`、`context.runState` 与 `context.turnState` 是解析后的 State 视图；`context.random()` 推进 PRNG draft；`context.endRun()` 记录无参数终局请求。Action 可以通过 `runState` 写 active EventInstance 的 `currentNodeId` 或结束 `status`，不能修改其派生字段、阶段或 RunData 容器元数据。

命令、internal transition 或 Action 每次写入当前 draft 后，引擎都在同一处理单元中按以下顺序工作：

1. Action 调用帧返回时，验证 EventInstance 生命周期写入并生成 `nodePath`、`activeInstanceId`、`endedTurn`、Reaction 注册与选择清理等派生写入；
2. 标记依赖本批写入的 Rule 失效；
3. 重算被 Reaction、生命周期或 UI 观察的失效 Rule；
4. 比较 Reaction 观察结果的新旧值；
5. 对匹配变化条件的 Reaction 调度其 Action；
6. Reaction Action 继续写同一 draft，重复上述过程，直到状态稳定；
7. 队列稳定后检查待处理终局请求，存在请求时把 `terminal` 与 `ended` 生命周期加入候选结果，否则形成普通候选结果或对应检查点；
8. 完成 draft、校验并生成候选 RuntimeSnapshot；若包含稳定检查点，则先等待 Repository 原子写入；
9. 写入成功后一次性替换 Runtime 状态、Reaction baseline、revision 与 RuntimeSnapshot，再通知订阅者；任一前置步骤失败时丢弃候选结果，UI 继续使用此前发布的稳定 snapshot。

每次 Rule 重算都会替换其依赖集合，以支持条件分支和动态查询。依赖图只重算受影响字段；没有被观察的字段可以在下次读取时惰性重算。Reaction 会被持续观察。引擎为自动 Action 链维护队列并检测循环或超出执行上限的情况。待处理的终局请求不会跳过已由本次状态变化触发的 Reaction 队列。

因此，完成一个黑暗事件的 Action 只需写入事件完成记录。若某个 Effect 的 `actived.rule` 读取该集合，引擎会自动使该字段失效、重算并检测其是否发生状态转换，无需 Action 发布专用 signal 或重复 Rule 中的条件。

#### 引擎实现概览

ProfileState、RunState 与 TurnState 的底层数据保持为可 JSON 序列化的稀疏对象树。引擎按同层 id 合并 Config 与各层 State，并在合并视图外创建 Proxy：Rule 使用只读 Proxy，Action 使用事务内的可写 Proxy。Proxy 的读取返回当前层级的有效对象，写入生成对应层级的稀疏 State 变更，不改变公开结构或存档格式。

Config 直接以只读对象放入 context；由于一局游戏中 Config 不可变，对它的读取不登记依赖。Config、State 与运行时视图本身已经通过 object key 提供稳定定位，引擎直接使用所属路径和 key 进行合并、查询与依赖定位。

依赖图维护两组关系：某个 state 字段被哪些 Rule 依赖，以及某个 Rule 当前依赖哪些 state 字段。引擎执行 Rule 前设置当前依赖收集器；Proxy 的 `get` 记录读取路径。Rule 执行完成后，用本次读取结果替换其旧依赖。数组和集合除了成员路径，还需要记录 `length` 或迭代依赖；因此新增一条已完成事件时，所有遍历该集合的 Rule 都会失效。

每个派生字段 Rule 在运行时对应一个计算节点。计算节点保存已解析值、是否失效、依赖集合和观察者。未失效时直接返回缓存；失效后在被 UI、生命周期或 Reaction 读取时重新计算。

Rule 与 Action 都通过统一执行器获得 context。处理单元创建一次 State/PRNG draft；嵌套 `context.action` 和 Reaction Action 复用该 draft，`context.rule` 在 Action 内读取包含当前未提交写入的视图。Action 写入路径使 draft 上的计算节点失效。终局请求不携带结局数据，同一处理单元中的重复请求合并为一个标记。

Reaction 在注册时将 `watch` 编译成一个被持续观察的计算节点，并保存初始结果作为基准。draft 写入后，引擎重算受到影响的 Reaction；使用 `Object.is` 比较新旧结果，再根据 `from`、`to` 决定是否将 Action 放入执行队列。用于 Reaction 的 Rule 应返回基础类型或其他稳定值。

Reaction 的注册范围由声明位置决定：所有 EventConfig 与 EffectConfig 的 Reaction 在创建、载入、分支或截断恢复 RunData 时注册；TextNode 的 Reaction 在 EventInstance 进入该节点时注册，并在离开节点时注销。载入、分支或截断恢复时，引擎还会为每个 active EventInstance 的当前 TextNode 恢复 Reaction。恢复过程只建立基准值，不执行 Reaction Action。`terminal` 或 `abandoned` 提交后统一注销所属 RunData 的全部 Reaction。

Reaction 不依赖 JSON Record 的插入顺序。引擎在 linking/恢复时按以下 canonical key 升序分配 ordinal：EffectConfig 使用 `[0, object.order, object.id, reactionIndex]`；EventConfig 使用 `[1, object.order, object.id, reactionIndex]`；active TextNode 使用 `[2, event.order, event.id, instance.startedTurn, instance.instanceId, node.order, node.id, reactionIndex]`。数字升序，字符串按 Unicode code point 升序。

一次写入使多个 Reaction 同时匹配时，按 ordinal 加入 FIFO；Reaction Action 引发的新匹配追加到队尾。存在终局请求时，引擎先处理完同一因果链，再提交终局；请求进入待处理状态后不再接受新的玩家操作或阶段推进。单个处理单元必须限制 Action 数、Rule 重算轮数和节点自动跳转数；超过限制时回滚并输出完整调用链。

引擎应统计每个 Rule 的执行次数、执行耗时与依赖扇出，并提供对应的调试信息，用于定位频繁执行、计算缓慢或影响范围过大的 Rule。

依赖图、计算缓存和 Reaction 基准值都是可重建的运行时数据，不写入存档。从 Profile、RunData 或 TurnData 恢复游戏时，引擎重新创建 Proxy 和依赖图，计算所有持续观察的 Reaction 基准值，此时不执行 Reaction Action。
