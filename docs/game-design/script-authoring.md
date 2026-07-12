# 游戏脚本编写指南

本文面向游戏策划，说明如何使用 JSON 编写 Config，并使用 JavaScript 编写 Rule 与 Action。JSON 与 JavaScript 的外部包结构见[外部游戏包与加载](./game-package.md)，完整 TypeScript 声明见 [model.ts](../../src/types/model.ts)，存档、状态合并和响应式引擎实现见[运行时系统设计](./runtime-system.md)。

## 脚本运行时参数

Rule 与 Action 都先接收一个 `context` 对象，随后才是 Config 中配置的参数。Rule 是可缓存、可重复计算的纯函数，因此只能读取 State 视图和调用其他 Rule。Action 可以写入 State、使用受管随机数、调用其他 Action，并请求终局。

- `context.config` 是只读的原始 GameConfig。
- `context.profileState` 是 Config 与 ProfileState 合并后的解析 State 视图。
- `context.runState` 在 `profileState` 上继续叠加当前 RunState。
- `context.turnState` 在 `runState` 上继续叠加当前 TurnState，并提供 `turnNumber` 与 `phase`。
- `context.rule` 由两种 Context 提供，是所有已注册 Rule 的函数集合。
- `context.random()` 仅由 ActionContext 提供；每次返回一个 `[0, 1)` 区间内的数，并在当前事务 draft 中推进 RunData 的随机状态。
- `context.action` 仅由 ActionContext 提供，是所有已注册 Action 的函数集合；嵌套调用共享当前处理单元的 State 与 PRNG draft。
- `context.endRun()` 仅由 ActionContext 提供，用于请求在当前 Action 与 Reaction 队列稳定后结束 RunData。

这三个字段都是对应层级的 State 视图，不是 `Profile`、`RunData` 或 `TurnData` 持久化容器。Context 不暴露容器 id、检查点列表、恢复游标、时间戳等元数据。

```ts
interface RuleContext {
    readonly config: DeepReadonly<GameConfig>;
    readonly profileState: DeepReadonly<ProfileRuntime>;
    readonly runState: DeepReadonly<RunRuntime>;
    readonly turnState: DeepReadonly<TurnRuntime>;
    readonly rule: RuleFunctions;
}

interface ActionContext {
    readonly config: DeepReadonly<GameConfig>;
    readonly profileState: ActionProfileRuntime;
    readonly runState: ActionRunRuntime;
    /** 游戏内容字段可写；turnNumber 与 phase 只读。 */
    readonly turnState: ActionTurnRuntime;
    readonly random: () => number;
    readonly action: ActionFunctions;
    readonly rule: RuleFunctions;
    readonly endRun: () => void;
}
```

Config 与三个运行时视图使用相同的对象路径：

```ts
context.config.characters[characterId]?.attributes[attributeId]?.value;
context.runState.characters[characterId]?.attributes[attributeId]?.value;
```

Action 写入哪个 State 视图，就决定状态的保存范围：写入 `context.profileState` 的结果跨 Run 保留，写入 `context.runState` 的结果只属于当前时间线，写入 `context.turnState` 的结果只属于当前回合。具体结局也由游戏包写入 `context.runState` 的普通字段，引擎不规定字段名称或取值。`turnNumber`、`phase` 和检查点元数据由引擎拥有，Action 只能读取；EventInstance 的可写字段与引擎派生行为见下文，阶段推进由宿主命令触发。

## Config

Config 中的 `xxxValue` 字段是创建 State 时使用的基础初始值，`xxx` 字段始终是根据 State 基础值计算有效值的 Rule。运行中的实际值、存档范围和合并方式由[运行时系统设计](./runtime-system.md#state)定义。

### Meta

```ts
interface ConfigMeta {
    /** 游戏内容包的稳定 id。 */
    id: string;
    name: string;
    version: string;
    background: string;
    /** 每个 RunData 默认保留的 TurnData 数量。 */
    maxTurnCountPerRun: number;
}
```

`version` 用于选择存档迁移逻辑。`maxTurnCountPerRun` 必须是正整数，创建 RunData 时复制为该 RunData 的 `maxTurnCount`。

Config、ProfileState、RunState 与运行时视图使用相同的顶层集合名称和对象层级：

```ts
interface GameConfig {
    meta: ConfigMeta;
    characters: Record<string, CharacterConfig>;
    effects: Record<string, EffectConfig>;
    events: Record<string, EventConfig>;
}
```

每个 object 的 key 是其 value 的 `id`，两者必须相同。State 使用相同的 key 和所属层级定位对象。

拥有稳定 id、需要按 id 查询的对象集合统一使用可直接 JSON 序列化的 `Record<string, T>`，不使用 JavaScript `Map`。`tags`、`valueDisplay` 和 Reaction 执行顺序等基础值序列继续使用数组。

### 通用字段
所有可被引用的 Config 对象（角色、属性、效果、事件、事件节点和选项等）使用以下字段。具体对象可以在此基础上增加自己的字段。

```ts
interface CommonConfig {
    /** Config 内的稳定标识符；不得因展示文案或翻译而改变。 */
    id: string;
    displayName: string;
    /** 用于筛选、检索和规则归类的标签。 */
    tags: string[];
    description?: string;
    /** 随机判定、UI 展示与跨对象 Reaction 注册的稳定顺序。 */
    order: number;
    /** 创建 State 时物化的随机判定权重基础值。 */
    weightValue: number;
    /** 根据 State 基础值计算有效权重。 */
    weight: Rule;
    /** 仅控制 UI 是否展示，不影响规则、动作或数据读取。 */
    visible: boolean;

    /** 创建 State 时物化的解锁基础值。 */
    unlockedValue: boolean;
    /** 根据 State 基础值计算有效解锁状态。 */
    unlocked: Rule;

    /** 创建 State 时物化的启用基础值。 */
    enabledValue: boolean;
    /** 根据 State 基础值计算有效启用状态。 */
    enabled: Rule;
}
```

`id` 必须与所属 object 的 key 相同，非空，并且只由字母、数字、`-`、`_` 与 `.` 组成；`__proto__`、`prototype` 与 `constructor` 不得作为 id。`displayName` 与 `description` 是面向玩家的文本；程序逻辑不得用它们作引用。`tags` 可为空，单个对象内不得重复；标签只承担分类作用，不自动产生游戏效果。

`order` 是随机判定、UI 展示和跨对象 Reaction 注册的稳定顺序。同一所属集合内的同一具体类型不得使用相同的 `order`；不同具体类型之间可以重复。Action 对候选对象执行多次随机判定时必须先按 `order` 升序；修改 `order` 也可能改变多个 Reaction 同时匹配时的执行次序。

`weightValue` 必须在 `[0, 10]` 内，`weight` Rule 返回的有效值也必须满足同一范围。当 `0 <= weight < 1` 时，该值是一次独立随机判定的概率，Action 使用 `context.random() < weight` 判定是否通过；`weight = 0` 永不通过。当 `1 <= weight <= 10` 时，该值是同一候选集合中的相对权重，选中概率为自身权重除以候选集合的总权重。具体候选集合、是否执行独立判定以及选中后的行为由相应 Action 定义；Rule 只计算有效值，不执行随机判定。

`visible` 控制对象是否在 UI 中显示。`unlocked` 控制对象是否可以从 Profile 进入 RunData，`enabled` 控制对象是否在游戏流程中可用。

写入 ProfileState 的 `unlockedValue` 会跨 RunData 保留。玩家从历史检查点创建分支或截断恢复时，ProfileState 与其他 State 一样恢复为该检查点的 snapshot；此后创建的新 RunData 继承恢复游标对应的 ProfileState。

### 属性 Attribute
属性没有独立叙事或动作，是依托于 character 的状态。character 可以是具体人物，也可以是抽象对象，例如“玩家”“城镇”“世界”或“本局”。属性不能脱离其 character 单独存在。

Config 定义角色、属性的初始值和显示方式。动作和规则通过 `(characterId, attributeId)` 定位属性，而不直接依赖显示名称。

```ts
interface AttributeConfig extends CommonConfig {
    type: 'number' | 'enum';
    /** 属性的初始值。 */
    value: number;
}

interface NumberAttributeConfig extends AttributeConfig {
    type: 'number';
    min?: number;
    max?: number;
}

interface EnumAttributeConfig extends AttributeConfig {
    type: 'enum';
    /** 枚举项的展示文本；value 是其下标。 */
    valueDisplay: string[];
}

interface CharacterConfig extends CommonConfig {
    attributes: Record<string, NumberAttributeConfig | EnumAttributeConfig>;
}

```

`characters` 使用 CharacterConfig.id 作为 key；每个 CharacterConfig 的 `attributes` 使用 AttributeConfig.id 作为 key。属性 id 只要求在所属角色内唯一，因此不同角色可以各自拥有同名的 `health` 属性。

数值属性的 `min` 与 `max` 均为可选有限数字，且 `min <= max`；其初始值和任何后续写入都必须落在该闭区间内。引擎在写入时将超出范围的值截断到边界，以保证动作、规则与存档读取到的值始终有效。

枚举属性的 `valueDisplay` 必须至少包含一个选项，`value` 是从 `0` 开始的整数下标。写入枚举属性时必须写入有效下标；无效值是配置或动作错误，不自动猜测或截断。UI 显示 `valueDisplay[value]`，而规则和动作使用数值 `value` 比较与赋值。

### 效果 Effect

效果表示可由 action 改变 state、但不包含叙事内容的对象。效果可以绑定到一个 character，也可以不绑定任何 character。可以是一次性物品，持续性物品，buff/debuff，功法，效果，奖励等等所有可以改变state的抽象。

```ts
interface EffectConfig extends CommonConfig {
    /** 创建 State 时物化的获得基础值。 */
    acquiredValue: boolean;
    /** 根据 State 基础值计算获得状态。 */
    acquired: Rule;
    /** 创建 State 时物化的激活基础值。 */
    activedValue: boolean;
    /** 根据 State 基础值计算激活状态。 */
    actived: Rule;
    /** 是否允许玩家在事件处理阶段手动激活。 */
    manuallyActivatable: boolean;
    /** 绑定目标的 character id。 */
    bindCharacterId?: string;
    reactionList: Reaction[];
}
```

`acquired` 表示效果是否已经获得，`actived` 表示效果是否已生效。`manuallyActivatable` 为 `true` 时，已获得且尚未激活的 Effect 会在事件处理阶段提供手动激活入口。`reactionList` 响应效果字段或其他派生值的变化，例如获得、激活、失效以及激活后的每回合开始。`bindCharacterId` 存在时必须指向 Config 中的 character。

手动激活由宿主发送 `activate-effect` RuntimeCommand，Runtime 在事务中把 `activedValue` 写为 `true`，随后按正常流程稳定该 Effect 的 Reaction。Effect 的激活副作用、资源消耗和提示 Action 应声明在观察 `self.actived` 从 `false` 到 `true` 的 Reaction 中；Reaction Action 抛错时，基础值和同一处理单元中的其它写入一起回滚。

策划默认约定：不需要玩家点击事件卡、会在回合或状态变化时自动执行的 Reaction，优先声明在 Effect 上；Effect 的 `displayName` 与 `description` 应说明持续规则及其影响，让玩家能在效果面板看到这些规则。EventConfig Reaction 主要用于事件内容自身的持续响应。

效果的 `acquiredValue`、`activedValue` 基础值和发生回合保存在 RunState 的 `effects` 对应 EffectState 中。所有 EffectConfig 的 Reaction 在创建、载入、分支或截断恢复 RunData 时注册，无需等待 EffectState 出现；注册时只建立基准值。依赖图、已解析值和上次值属于引擎内部运行时缓存，可由 State 重新构建。

### 事件 Event
事件是叙事的对象。一个事件是一张有向图：节点负责展示叙事、执行动作或检查规则；边由动作或规则决定。事件可以是事件，区域，商店，科技树等等所有有剧情有分支节点的抽象

```ts
interface EventConfig extends CommonConfig {
    entryNodeId: NodeId;
    nodes: Record<NodeId, EventNode>;
    reactionList?: Reaction[];
}
```

`nodes` 使用 EventNode.id 作为 key，`entryNodeId` 必须指向其中一个节点。

`enabled` 表示事件当前是否可由玩家启动。在 `event_handle` 阶段，宿主根据事件的有效 `visible`、`unlocked` 与 `enabled` 值生成事件卡片；玩家点击卡片会向引擎发送 `StartEvent` RuntimeCommand。该命令重新校验状态、确认同一 EventConfig 没有 active 实例，然后创建 EventInstance 并进入 `entryNodeId`。`StartEvent` 属于宿主命令，不在 ActionRegistry 中，也不能由 `context.action` 或 Reaction 调用。

`EventConfig.reactionList` 用于持续响应内容状态变化，例如改变属性、Effect、事件可用条件或请求终局。在创建、载入、分支或截断恢复 RunData 时，引擎为所有 EventConfig 注册配置级 Reaction，此时不需要 EventInstance。Reaction 初次注册只计算基准值。新游戏与 restart 创建的 RunData 在 phase 为 `initializing` 时完成注册，再由引擎进入 `turn_start`；载入、branch 与截断恢复直接以 snapshot 建立基准。`terminal` 或 `abandoned` 提交后统一注销这些 Reaction。

一次性事件可以让 `enabled.rule` 判断完成次数是否为 `0`；常态性事件可以保持 `enabled` 为 `true`。每次成功的 `StartEvent` 命令都会创建独立 EventInstance。跨回合事件继续使用已有 active 实例；active 实例即使后来变为不可见或不可用，UI 仍提供“进行中”入口。MVP 的固定门禁是同一 EventConfig 每个逻辑回合最多创建一个实例，实例完成后要到下一回合且仍然 enabled 才能再次启动。

#### 叙事节点 TextNode

叙事节点用于呈现普通文本、角色与选项等叙事内容。单选节点在选择后立即执行选项 Action；多选节点先收集选择，再通过明确的 Command 提交或取消。

```ts
interface TextNodeBase extends CommonConfig {
    content: string;
    reactionList?: Reaction[];
    /** 未处理时，是否阻止进入下一回合。 */
    requiredValue?: boolean;
    required?: Rule;
}

interface SingleTextNode extends TextNodeBase {
    type: 'single';
    choicesValue: Record<string, SingleChoice>;
    choices: Rule;
}

interface SingleChoice extends CommonConfig {
    action: Action;
}

interface MultipleTextNode extends TextNodeBase {
    type: 'multiple';
    choicesValue: Record<string, MultipleChoice>;
    choices: Rule;
    commands: Record<string, NodeCommand>;
}

interface MultipleChoice extends CommonConfig {
    /** 写入本次选择结果的数据，例如商品 id。 */
    value: Primitive;
    maxCountValue?: number;
    maxCount?: Rule;
}

interface NodeCommand extends CommonConfig {
    action: Action;
}

type TextNode = SingleTextNode | MultipleTextNode;
```

TextNode 可以配置 `reactionList`。节点成为当前节点后，引擎观察其中的 Reaction；例如观察“当前节点且 `context.turnState.phase` 为 `turn_start`”这一 Rule，在结果进入 `true` 时执行每回合 Action。

单选节点中，玩家选择一个 `SingleChoice` 后，宿主发送 `ChooseSingle` 命令，引擎再通过统一执行器执行其 `action`。多选节点中，增减 `MultipleChoice` 数量由 `SetMultipleChoice` 命令更新 TurnData 中的临时选择，不执行 Action；选择结果以 Choice id 为 key，并包含 `value` 与 `count`。

多选节点通过 `commands` 提供购买、确认、取消或退出等操作。玩家点击后发送 `ExecuteNodeCommand`，Command Action 一次性读取完整选择结果；处理单元失败时不提交任何选择效果。`maxCount` 存在时限制对应 choice 的最大选择数量，省略时不设置引擎级单项上限。`required` 为 `true` 时，节点尚未处理完成则不能执行 `AdvanceTurn`。

Choice、Command、Check 与节点 Reaction Action 通过 `context.runState` 直接修改当前 EventInstance。每个 EventState 的 `activeInstanceId` 指向该 EventConfig 唯一的 active 实例，因此脚本不需要遍历历史实例：

```js
function goToNode(context, eventId, nextNodeId) {
    const eventState = context.runState.events[eventId];
    const instanceId = eventState.activeInstanceId;
    if (instanceId === undefined) {
        throw new Error(`Event ${eventId} has no active instance`);
    }
    eventState.instances[instanceId].currentNodeId = nextNodeId;
}
```

Action 可以写 active EventInstance 的 `currentNodeId`，也可以把其 `status` 从 `active` 写为 `completed` 或 `abandoned`。`activeInstanceId`、`instanceId`、`eventId`、`nodePath`、`startedTurn` 与 `endedTurn` 由引擎维护，Action 只能读取；终态实例的 `currentNodeId` 与 `status` 也不可再修改。

每个 Action 调用帧最多执行一次事件生命周期写入：一次节点跳转，或者一次结束状态写入。重复写 `currentNodeId`、同时写 `currentNodeId` 与 `status`、或重复写 `status` 都会使处理单元失败。嵌套 `context.action` 使用同一 State draft，但各自拥有独立调用帧。Action 返回后，引擎验证并落实该帧的写入：节点目标必须属于当前 EventConfig；合法跳转会把目标追加到 `nodePath`、注销旧节点 Reaction、清理旧节点的临时选择，并为新节点 Reaction 建立基准。写入结束状态时，引擎设置 `endedTurn`、清除 `activeInstanceId`，并注销节点 Reaction 与临时选择。所有派生写入都与 Action 的其他 State 写入一起提交或回滚。

Action 同时调用 `context.endRun()` 时，引擎先落实 EventInstance 写入并运行由此产生的 Reaction 链；队列稳定后再创建 terminal snapshot，因此其中保存的是最终事件状态。

#### 规则检查节点 CheckNode

规则检查节点不承载叙事。节点被进入时触发 `check` 动作，由该动作执行具体检查规则并决定事件的下一个节点。

```ts
interface CheckNode extends CommonConfig {
    type: 'check';
    candidateNodes: Record<NodeId, true>;
    check: Action;
}
```

`candidateNodes` 的 key 列出该检查节点可指向的节点，value 固定为 `true`；所有 key 都必须指向本事件内存在的节点。进入 CheckNode 后，引擎自动执行 `check` Action；该 Action 可以按候选节点已解析的 `order` 与 `weight` 调用 `context.random()` 判定目标，再把当前实例的 `currentNodeId` 写为目标节点。目标必须属于 `candidateNodes`，否则整个处理单元失败并回滚。

```ts
type EventNode = SingleTextNode | MultipleTextNode | CheckNode;
type NodeId = string;
```

### Rule

Rule 是用于计算字段值的纯函数，类似 object getter。它可以通过 `context.rule['ruleName'](...args)` 调用其他 Rule；同一 Config、State 与参数必须得到相同结果。

```ts
{
    [ruleName]: {
        key: ruleName,
        calc: (context, ...args) => {}
    }
}
```

Config 中的 Rule 表示对规则实现的一次调用：`key` 是规则名，也是实现中的函数名；引擎将只读 `RuleContext` 作为 `calc` 的第一个参数，随后展开 Config 中的 `args`。`context.config` 只读、不可变且不参与依赖追踪；`context.profileState`、`context.runState` 与 `context.turnState` 是只读、可追踪的解析 State 视图；`context.rule` 提供按注册名调用其他 Rule 的函数。

RuleContext 不提供 `action` 或 `random`。Rule 不得写 State、请求事件/终局、读取真实时间、调用 `Math.random()`、执行 I/O 或产生其他外部副作用。随机判定由 Action 执行并把结果写入 State，Rule 再从 State 派生值。Rule 间循环调用属于脚本错误。

```ts
type Primitive = string | number | boolean | null;

interface Rule {
    key: string;
    args: Primitive[];
}
```

`args` 中只能使用基础数据类型。Config 的 `xxxValue` 是创建 State 时物化的基础值，`xxx` 始终是 Rule。Rule 返回值必须是字段的有效类型；Action 改写对应 State 中的 `xxxValue`，而不是 Rule 的有效值。

字面基础值通常使用游戏包自己的 `state.value` Rule 读取当前 State 路径：

```js
export const rules = {
  'state.value': {
    key: 'state.value',
    calc: (context, ...path) => {
      let cursor = context.turnState
      for (const segment of path) cursor = cursor?.[segment]
      return cursor
    },
  },
}
```

例如 `weightValue: 5` 对应 `weight: { key: 'state.value', args: ['events', 'crossroads', 'weightValue'] }`。复杂条件 Rule 可以读取同一对象的 `xxxValue`，再与其它 State 条件组合。

### Action 与 Reaction

#### Action

Action 是改变 state 的函数，也是游戏脚本请求结束当前 RunData 的唯一执行边界。Action 的 JavaScript 实现由 action 名索引，`exec` 不返回值。

```ts
{
    [actionName]: {
        key: actionName,
        exec: (context, ...args) => {}
    }
}
```

Config 中的 Action 表示对 action 实现的一次调用：`key` 是 action 名，也是实现中的函数名；引擎将 `ActionContext` 作为 `exec` 的第一个参数，随后展开 Config 中的 `args`。`context.config` 只读；`context.profileState`、`context.runState` 与 `context.turnState` 的可写字段记录到处理单元 draft；`context.action` 与 `context.rule` 分别调用其他 Action 与 Rule。`context.random()` 的 PRNG 推进、State 写入与 `context.endRun()` 的终局请求一起提交或回滚。

UI 命令或生命周期变化的引擎写入、由此执行的 root Action、嵌套 `context.action` 以及匹配的 Reaction Action 共用一个处理单元。队列稳定且校验成功后才提交；任一脚本异常、非法写入或循环上限错误都会回滚整个处理单元。`turnNumber`、`phase`、EventInstance 的引擎维护字段和 RunData 容器元数据不可由普通字段赋值修改。

```ts
interface Action {
    key: string;
    args: Primitive[];
}
```

#### 请求终局

Action 通过无参数的 `context.endRun()` 请求终局。调用只记录当前处理单元的待处理请求，不会立即中断 Action 函数；任一 Action 抛出异常时，该请求与整个 State、PRNG draft 一起丢弃。引擎在 draft 上继续执行匹配的 Reaction Action，队列稳定后创建 `terminal` TurnData 并将 RunData 生命周期标记为 `ended`。终局可以在任意 phase 请求，terminal snapshot 保留当时的 phase。

Action 应先把结局写入普通 RunState，再请求终局。例如，游戏包可以在代表“本局”的抽象 Character 上定义一个枚举 Attribute：

```js
function reachEnding(context, endingValue) {
    context.runState.characters.run.attributes.ending.value = endingValue;
    context.endRun();
}
```

`run`、`ending` 与具体枚举值都是游戏包自己的 Config，不是引擎保留名称。引擎不会读取这个字段来决定是否结束，也不会把结局解释为固定的成功或失败。完整的提交、恢复与分支语义见[终局与结局](./endings.md)。

#### Reaction

```ts
interface ValueRef {
    /** self 表示 Reaction 所属对象；其余值表示对应的解析 State 根。 */
    source: 'self' | 'profileState' | 'runState' | 'turnState';
    /** 相对 source 的非空字段路径。 */
    path: [string, ...string[]];
}

type ReactionSource = ValueRef | Rule;

interface Reaction {
    watch: ReactionSource;
    from?: Primitive;
    to?: Primitive;
    action: Action;
}
```

Reaction 用于自动执行 Action。`watch` 可以直接引用一个已解析字段，也可以执行一个 Rule 并观察其返回值。观察结果发生变化且符合 `from`、`to` 时，引擎执行 `action`；该 Action 也可以调用 `context.endRun()`。未填写 `from` 或 `to` 表示匹配任意旧值或新值。Reaction 初次注册时只建立基准值，不执行 Action。

`ValueRef.path` 逐段定位字段，不能使用点分隔字符串代替路径数组。`source = 'self'` 时路径相对声明 Reaction 的 Effect、EventConfig 或 TextNode 运行时对象；其余 source 从对应解析 State 视图的根开始。例如 `{ "source": "runState", "path": ["characters", "player", "attributes", "health", "value"] }` 观察本局生命值。路径必须定位到 Primitive 或返回 Primitive 的派生字段；静态无效路径是 linking 错误，派生字段的返回类型在运行时继续校验。Rule 形式的 watch 也必须在运行时返回 Primitive，否则处理单元失败。

例如 Effect 的激活 Reaction 可以观察所属对象的 `actived`，匹配 `false` 到 `true`；每回合开始的效果可以观察一个 Rule，该 Rule 返回“Effect 已激活并且 `context.turnState.phase` 为 `turn_start`”的布尔值，并匹配 `false` 到 `true`。Reaction 复用已解析的 `actived`，不会重复黑暗事件数量等业务条件。
