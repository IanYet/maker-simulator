# Vision
此文档描述了一个游戏的基本框架与结构。

## 概述
- 我想创建一个网状叙事的事件驱动的构建rougelike游戏。类似《密教模拟器》或者没有卡牌战斗的《杀戮尖塔》没有战斗的《哈迪斯》。
- 游戏通过json配置保存数据与存档，通过js脚本定义规则与动作，通过引擎执行游戏。
- 非开发人员可以通过编写json与js脚本就可以完成游戏换皮与数值调整。
- 游戏包含：属性，效果，事件，规则，动作。第一点说的构建，是指效果与事件的构建。其中，属性，效果，事件是通过json定义，规则与动作用js脚本编写。
- 效果与事件会去触发规则与动作，规则与动作反过来会修改属性，效果，事件的某些值。

# 数据

游戏数据包含属性、效果、事件、规则与动作等内容定义，以及游玩过程中产生的状态。数据分为四层：

| 数据层 | 职责 | 生命周期 |
| --- | --- | --- |
| Config | 游戏策划编写的内容、脚本调用和默认值；游玩期间只读 | 随游戏版本发布 |
| Profile | 一份用户存档，保存局外成长、存档索引及其中的所有 RunData | 从新游戏开始，持续跨越多局游戏 |
| RunData | 一条独立的局内时间线，保存本局状态、事件实例和回合检查点 | 从一局开始到成功、失败、放弃或重开 |
| TurnData | 一条时间线在稳定边界上的可恢复检查点 | 在 RunData 初始化、回合提交、终局或废弃提交时创建 |

Config 是只读内容源。Profile、RunData 与 TurnData 共同组成可保存的 State，并通过稳定 id 引用 Config 中的角色、属性、效果、事件和节点；Rule、Action 与 Reaction 的定义保留在 Config 中。

## 默认值与有效值

Config 中所有可变字段都是初始化默认值。State 没有保存对应值时使用 Config 默认值；ProfileState、RunState 与 TurnState 依次覆盖更低层的同名字段。

字面值形式的 `ReactiveValue` 按 TurnState、RunState、ProfileState、Config 默认值的顺序读取。配置了 Rule 的 `ReactiveValue` 始终使用 `calc` 的返回值作为有效值，该字段不能被直接写入；Action 通过修改 Rule 读取的基础事实改变结果。Rule 计算结果只由响应式系统缓存。

Action 写入哪个参数，就决定结果的生命周期：写入 `profile` 的值跨 RunData 保留；写入 `runData` 的值只属于当前时间线；写入 `turnData` 的值只服务于当前回合。局外成长写入 Profile，本局属性、Effect 与 EventInstance 等事实写入 RunData，阶段和多选节点的临时选择写入 TurnData。

## 生命周期

1. 选择新游戏时，引擎根据 Config 默认值创建新的 Profile，并在其中创建首个 active RunData。
2. 创建 RunData 时，引擎同时创建 `initial` TurnData。新游戏与 restart 的初始 `turnNumber` 为 `0`、`phase` 为 `initializing`；branch 的初始检查点复制来源 snapshot。
3. 选择继续游戏时，引擎恢复 `Profile.current` 指向的检查点。该字段只作为恢复游标，浏览历史检查点不会修改它；指向 `terminal` 或 `abandoned` 时只恢复结果界面，不能开始回合。
4. 回合结束时，引擎提交本回合事务，创建 `turn_end` TurnData，并原子更新 RunData 的当前位置和 Profile 的当前位置。
5. 本局成功或失败时，引擎提交终局事务，原子写入终局状态、`endedAt` 与 `terminal` TurnData。玩家重新开始时，在同一 Profile 内创建新的 RunData；Profile 状态继续保留，RunData 与 TurnData 根据 Config 和当前 Profile 重新初始化。
6. 放弃本局或主动重开时，引擎将当前 RunData 记为 `abandoned` 并提交 `abandoned` TurnData。主动重开随后在当前 Profile 中创建新的 RunData。

## 恢复与分支

TurnData 在逻辑上保存该时刻的 ProfileState、RunState 与 TurnState 完整快照，因此可以精确查看当时的局外、局内和回合状态。`initial` 与 `turn_end` TurnData 可以作为继续游戏的起点；`terminal` 与 `abandoned` TurnData 只保存终局或废弃结果，不能作为开始回合。

从 active RunData 的最新可用 TurnData 继续时，引擎以该 snapshot 创建工作副本，后续检查点追加到当前 RunData。从同一 RunData 中不是最新项的可用 TurnData 继续时，玩家选择是否保留该检查点之后的回合数据：

- 选择保留时，引擎根据所选 snapshot 创建新的 branch RunData，并在 `origin` 中记录来源；原 RunData 的 `state`、`currentTurnId` 与全部检查点保持不变。新 RunData 的首个 TurnData 保存复制后的 snapshot，随后 `Profile.current` 指向这个新检查点。
- 选择删除时，引擎从原 RunData 的 `turnOrder` 与 `turnDataMap` 中删除所选检查点之后的全部 TurnData，以所选 snapshot 重建工作状态，并把 `currentTurnId` 与 `Profile.current` 指向所选检查点。若原 RunData 已结束，同时把 status 恢复为 `active` 并清除 `endedAt`，后续回合继续写入该 RunData。

删除后续回合数据是用户明确执行的截断操作，会删除其中已 pin 的 TurnData。截断事务必须原子完成；失败时保留原 RunData 的全部数据和状态。

读取或预览历史 TurnData 只访问其 snapshot。时间线选择等界面状态由 UI 管理，不写入 Profile 的恢复游标。每个 RunData 保存一条线性时间线，分支关系由新 RunData 的 `origin` 表达。

完整快照是数据语义。存档实现可以使用结构共享、增量快照或周期性全量快照降低空间占用；清理某个增量快照的基底前，必须先让依赖它的保留检查点能够独立恢复。

## TurnData 保留策略

每个 RunData 在创建时记录 `maxTurnCount`。`turnOrder` 中保存的 TurnData 数量超过上限后，引擎按 `turnOrder` 从旧到新清理未受保护的 TurnData。每个 RunData 的 `currentTurnId` 以及被用户 pin 的检查点始终保留；当受保护的检查点已经达到上限时，允许暂时超过上限并向用户提示。

`RunOrigin.source` 只记录新 RunData 的来源，不保护源 TurnData。源 TurnData 被自动清理或主动删除后，已经创建的 RunData 仍通过自己的 `initial` snapshot 独立恢复，`origin` 保留为可能无法解析的历史引用。

清理 TurnData 只删除检查点，不改变其所属 RunData 的终局状态、统计结果或其他 RunData。使用增量存储时，引擎必须先压实仍依赖待清理检查点的数据。

## 保存边界与兼容

Profile、RunData 与 TurnData 只保存可 JSON 序列化的状态事实和 Action 执行结果，不复制 Config 中的展示文本、tag、节点图、Rule/Action 函数或 Reaction 配置。Rule 计算结果、依赖图、计算缓存、Reaction 基准值、Proxy、事务 draft 和执行队列也不写入存档，载入后由引擎重新构建。

所有内容引用使用稳定 Config id，时间使用 UTC ISO 8601 字符串。Profile 同时保存 State schema 版本以及 Config id 与版本；任一版本不匹配时必须先执行对应的存档迁移，没有迁移路径时停止载入并报告版本错误。

---

# Config

Config 中所有可变字段均表示默认值。运行中的实际值及其保存方式在 `State` 章节定义。

## Meta

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
    characterMap: Record<string, CharacterConfig>;
    effectMap: Record<string, EffectConfig>;
    eventMap: Record<string, EventConfig>;
}
```

每个 object 的 key 是其 value 的 `id`，两者必须相同。State 使用相同的 key 和所属层级定位对象。

拥有稳定 id、需要按 id 查询的对象集合统一使用可直接 JSON 序列化的 `Record<string, T>`，不使用 JavaScript `Map`。`tags`、`valueDisplay` 和 Reaction 执行顺序等基础值序列继续使用数组。

## 通用字段
所有可被引用的 Config 对象（角色、属性、效果、事件、事件节点和选项等）使用以下字段。具体对象可以在此基础上增加自己的字段。

```ts
interface CommonConfig {
    /** Config 内的稳定标识符；不得因展示文案或翻译而改变。 */
    id: string;
    displayName: string;
    /** 用于筛选、检索和规则归类的标签。 */
    tags: string[];
    description?: string;
    /** 默认展示顺序；数值较小的对象排在前面。 */
    order?: number;
    /** 仅控制 UI 是否展示，不影响规则、动作或数据读取。 */
    visible: boolean;

    /** 是否解锁或其计算规则。 */
    unlocked: ReactiveValue<boolean>;

    /** 是否启用或其计算规则。 */
    enabled: ReactiveValue<boolean>;
}
```

`id` 必须与所属 object 的 key 相同，非空，并且只由字母、数字、`-`、`_` 与 `.` 组成；`__proto__`、`prototype` 与 `constructor` 不得作为 id。`displayName` 与 `description` 是面向玩家的文本；程序逻辑不得用它们作引用。`tags` 可为空，单个对象内不得重复；标签只承担分类作用，不自动产生游戏效果。需要稳定展示顺序时按 `order` 升序排列，未配置的 `order` 视为 `0`，相同值按 id 排列。

`visible` 控制对象是否在 UI 中显示。`unlocked` 控制对象是否可以从 Profile 进入 RunData，`enabled` 控制对象是否在游戏流程中可用。

## 属性 Attribute
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
    attributeMap: Record<string, NumberAttributeConfig | EnumAttributeConfig>;
}

```

`characterMap` 使用 CharacterConfig.id 作为 key；每个 CharacterConfig 的 `attributeMap` 使用 AttributeConfig.id 作为 key。属性 id 只要求在所属角色内唯一，因此不同角色可以各自拥有同名的 `health` 属性。

数值属性的 `min` 与 `max` 均为可选有限数字，且 `min <= max`；其初始值和任何后续写入都必须落在该闭区间内。引擎在写入时将超出范围的值截断到边界，以保证动作、规则与存档读取到的值始终有效。

枚举属性的 `valueDisplay` 必须至少包含一个选项，`value` 是从 `0` 开始的整数下标。写入枚举属性时必须写入有效下标；无效值是配置或动作错误，不自动猜测或截断。UI 显示 `valueDisplay[value]`，而规则和动作使用数值 `value` 比较与赋值。

## 效果 Effect

效果表示可由 action 改变 state、但不包含叙事内容的对象。效果可以绑定到一个 character，也可以不绑定任何 character。

```ts
interface EffectConfig extends CommonConfig {
    /** 是否已获得或其计算规则。 */
    acquired: ReactiveValue<boolean>;
    /** 是否已生效或其计算规则。 */
    actived: ReactiveValue<boolean>;
    /** 绑定目标的 character id。 */
    bindCharacterId?: string;
    reactionList: Reaction[];
}
```

`acquired` 表示效果是否已经获得，`actived` 表示效果是否已生效。`reactionList` 响应效果字段或其他派生值的变化，例如获得、激活、失效以及激活后的每回合开始。`bindCharacterId` 存在时必须指向 Config 中的 character。

效果获得与激活的直接状态值和发生回合保存在 RunState 的 `effectMap` 对应 EffectState 中。所有 EffectConfig 的 Reaction 在创建、载入、分支或截断恢复 RunData 时注册，无需等待 EffectState 出现；注册时只建立基准值。依赖图、已解析值和上次值属于引擎内部运行时缓存，可由 State 重新构建。

## 事件 Event
事件是叙事的对象。一个事件是一张有向图：节点负责展示叙事、执行动作或检查规则；边由动作或规则决定。

```ts
interface EventConfig extends CommonConfig {
    entryNodeId: NodeId;
    nodeMap: Record<NodeId, EventNode>;
    reactionList?: Reaction[];
}
```

`nodeMap` 使用 EventNode.id 作为 key，`entryNodeId` 必须指向其中一个节点。

`enabled` 表示事件当前是否可以启动。启动事件统一执行 `start_event` Action；该 Action 检查事件的有效 `enabled` 值与现有 active 实例，然后创建 EventInstance 并进入 `entryNodeId`。动作或检查节点设置下一个节点后，当前 EventInstance 自动进入该节点。

`EventConfig.reactionList` 用于自动启动事件。在创建、载入、分支或截断恢复 RunData 时，引擎为所有 EventConfig 注册配置级 Reaction，此时不需要 EventInstance。Reaction 初次注册只计算基准值。新游戏与 restart 创建的 RunData 以 `turnData.phase = 'initializing'` 完成注册，再进入 `turn_start`；载入、branch 与截断恢复直接以恢复的 snapshot 建立基准。建立基准时不执行 Reaction Action，结束 RunData 时统一注销这些 Reaction。

一次性事件可以让 `enabled.rule` 判断该事件的完成次数是否为 `0`，并由其他 Choice 或 Action 执行 `start_event`。常态性事件可以保持 `enabled` 为 `true`，通过 Reaction 在满足回合条件时执行 `start_event`。已有 active 实例时，`start_event` 不重复创建；实例结束后，下一次满足条件时可以创建新的实例。

每次成功执行 `start_event` 都会创建独立的 EventInstance。实例字段、节点路径和保存位置在 `State` 章节定义。EventConfig 可以被多次实例化；跨回合事件继续使用已有 active 实例，重复性事件在上一个实例结束后创建新实例。

### 叙事节点 TextNode

叙事节点用于呈现普通文本、角色与选项等叙事内容。单选节点在选择后立即执行选项 Action；多选节点先收集选择，再通过明确的 Command 提交或取消。

```ts
interface TextNodeBase extends CommonConfig {
    content: string;
    /** 节点出现机会及其计算规则。 */
    chance: ReactiveValue<number>;
    reactionList?: Reaction[];
    /** 未处理时，是否阻止进入下一回合。 */
    required?: ReactiveValue<boolean>;
}

interface SingleTextNode extends TextNodeBase {
    type: 'single';
    choiceMap: ReactiveValue<Record<string, SingleChoice>>;
}

interface SingleChoice extends CommonConfig {
    action: Action;
}

interface MultipleTextNode extends TextNodeBase {
    type: 'multiple';
    choiceMap: ReactiveValue<Record<string, MultipleChoice>>;
    commandMap: Record<string, NodeCommand>;
}

interface MultipleChoice extends CommonConfig {
    /** 写入本次选择结果的数据，例如商品 id。 */
    value: Primitive;
    maxCount?: ReactiveValue<number>;
}

interface NodeCommand extends CommonConfig {
    action: Action;
}

type TextNode = SingleTextNode | MultipleTextNode;
```

TextNode 可以配置 `reactionList`。节点成为当前节点后，引擎观察其中的 Reaction；例如观察“当前节点且 `turnData.phase` 为 `turn_start`”这一 Rule，在结果进入 `true` 时执行每回合 Action。

单选节点中，玩家选择一个 `SingleChoice` 后立即执行其 `action`。多选节点中，增减 `MultipleChoice` 数量只更新 TurnData 中的临时选择，不执行 Action；选择结果以 Choice id 为 key，并包含 `value` 与 `count`。

多选节点通过 `commandMap` 提供购买、确认、取消或退出等操作。Command Action 一次性读取完整选择结果；事务失败时不提交任何选择效果。退出 Command 可以清空临时选择并离开节点。`maxCount` 存在时限制对应 choice 的最大选择数量，省略时不设置引擎级单项上限。`required` 为 `true` 时，节点尚未处理完成则不能进入下一回合；`chance` 表示该 TextNode 出现的机会。

### 规则检查节点 CheckNode

规则检查节点不承载叙事。节点被进入时触发 `check` 动作，由该动作执行具体检查规则并决定事件的下一个节点。

```ts
interface CheckNode extends CommonConfig {
    type: 'check';
    candidateNodeMap: Record<NodeId, true>;
    check: Action;
}
```

`candidateNodeMap` 的 key 列出该检查节点可指向的节点，value 固定为 `true`；所有 key 都必须指向本事件内存在的节点。计算下一个节点时，使用候选 TextNode 已解析的 `chance`。检查规则和目标节点选择的具体配置在 `check` 动作中定义。

```ts
type EventNode = SingleTextNode | MultipleTextNode | CheckNode;
type NodeId = string;
```

## Rule

Rule 是用于计算字段值的纯函数，类似 object getter。Rule 只读取 state 并返回值，不修改 state、不执行 Action，也不依赖随机数或真实时间。

```ts
{
    [ruleName]: {
        key: ruleName,
        calc: (config, profile, runData, turnData, ...args) => {}
    }
}
```

Config 中的 Rule 表示对规则实现的一次调用：`key` 是规则名，也是实现中的函数名；引擎将 `config`、`profile`、`runData`、`turnData` 依次作为 `calc` 的前四个参数传入，随后展开 Config 中的 `args`。`config` 是只读、不可变且不参与依赖追踪的数据；其余三个参数是只读、可追踪的 state 访问对象。

```ts
type Primitive = string | number | boolean | null;

interface Rule {
    key: string;
    args: Primitive[];
}

type ReactiveValue<T> = T | {
    value: T;
    rule: Rule;
};
```

`args` 中只能使用基础数据类型。`ReactiveValue<T>` 可以直接配置写死值，也可以配置默认 `value` 与计算它的 `rule`。存在 `rule` 时，Rule 返回值必须是 `T`，并作为字段的有效值；Action 改写的是该 Rule 读取的基础 state，而不是 Rule 的有效值。

## Action 与 Reaction

Action 是改变 state 的函数。Action 的 JavaScript 实现由 action 名索引，`exec` 不返回值。

```ts
{
    [actionName]: {
        key: actionName,
        exec: (config, profile, runData, turnData, ...args) => {}
    }
}
```

Config 中的 Action 表示对 action 实现的一次调用：`key` 是 action 名，也是实现中的函数名；引擎将 `config`、`profile`、`runData`、`turnData` 依次作为 `exec` 的前四个参数传入，随后展开 Config 中的 `args`。`config` 只读且不参与写入事务；玩家操作与 Reaction 都通过同一个 Action 执行器运行 Action。

```ts
interface Action {
    key: string;
    args: Primitive[];
}

interface ValueRef {
    /** self、profile、runData、turnData 或 Config 对象 id。 */
    source: string;
    field: string;
}

type ReactionSource = ValueRef | Rule;

interface Reaction {
    watch: ReactionSource;
    from?: Primitive;
    to?: Primitive;
    action: Action;
}
```

Reaction 用于自动执行 Action。`watch` 可以直接引用一个已解析字段，也可以执行一个 Rule 并观察其返回值。观察结果发生变化且符合 `from`、`to` 时，引擎执行 `action`；未填写 `from` 或 `to` 表示匹配任意旧值或新值。Reaction 初次注册时只建立基准值，不执行 Action。`ValueRef.source` 为 `self` 时，引用 Reaction 所属对象的运行时字段。

例如 Effect 的激活 Reaction 可以观察所属对象的 `actived`，匹配 `false` 到 `true`；每回合开始的效果可以观察一个 Rule，该 Rule 返回“Effect 已激活并且 `turnData.phase` 为 `turn_start`”的布尔值，并匹配 `false` 到 `true`。Reaction 复用已解析的 `actived`，不会重复黑暗事件数量等业务条件。

---

# State

State 是 Config 在一次具体游玩中的状态结果。Profile 是存档容器，RunData 是一条局内时间线，TurnData 是可恢复检查点。

Config、State 与脚本访问的运行时视图保持相同的对象层级。State 只保存 Config 对象的 id、实际写入的字段和该对象的运行时字段，不复制展示文本、Rule、Action 等静态字段。

## 结构与运行时视图

Config 与 State 使用相同的 object 字段名：顶层都是 `characterMap`、`effectMap` 与 `eventMap`；Character 下都是 `attributeMap`；Event 下都是 `nodeMap`，TextNode 下都是 `choiceMap`。State 中缺少某个 key 或字段时，引擎继续读取下一层 State 或 Config 默认值。

引擎通过 object key 合并同一层级中的对象。Profile 运行时视图由 Config 与 ProfileState 合并，Run 运行时视图再叠加 RunState，Turn 运行时视图继续叠加 TurnState。Rule 与 Action 因而使用相同路径读取默认值和实际值：

```ts
config.characterMap[characterId]?.attributeMap[attributeId]?.value;
runData.characterMap[characterId]?.attributeMap[attributeId]?.value;
```

Rule 与 Action 参数中的 `profile`、`runData`、`turnData` 都是合并到对应层级的运行时 Proxy。Rule 只能读取；Action 对某个参数的写入由 Proxy 记录到对应的稀疏 State。id、历史索引、时间戳和存档版本等容器元数据由引擎维护。

## 状态值

```ts
type Timestamp = string;
type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };

interface CommonState {
    id: string;
    order?: number;
    visible?: boolean;
    unlocked?: boolean;
    enabled?: boolean;
}

interface AttributeState extends CommonState {
    value?: number;
}

interface CharacterState extends CommonState {
    attributeMap?: Record<string, AttributeState>;
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
    chance?: number;
    required?: boolean;
    choiceMap?: Record<string, ChoiceState>;
    commandMap?: Record<string, NodeCommandState>;
    /** 仅 TurnState 使用的多选结果。 */
    selectionMap?: Record<string, NodeSelection>;
}

interface EventState extends CommonState {
    nodeMap?: Record<string, EventNodeState>;
    instanceMap?: Record<string, EventInstance>;
}

interface GameState {
    characterMap: Record<string, CharacterState>;
    effectMap: Record<string, EffectState>;
    eventMap: Record<string, EventState>;
    /** 剧本自定义且可 JSON 序列化的事实。 */
    valueMap: Record<string, JsonValue>;
}

type ProfileState = GameState;
type RunState = GameState;
```

State 中的每一项通过 object key 与同层 Config 对象对应，value 的 `id` 必须等于 key。未发生任何写入的对象可以从 State 中省略；已经存在的 State 对象只保存发生过写入的可选字段。三个顶层 object 和 `valueMap` 始终存在，没有数据时使用空对象。

`CommonState` 对应 CommonConfig 中允许产生直接状态的字段。AttributeState 位于 `characterMap[characterId].attributeMap[attributeId]`，其 `value` 对应 AttributeConfig.value。EffectState 位于 `effectMap[effectId]`，获得、激活和绑定字段与 EffectConfig 同名，获得与激活回合是同一对象上的运行时字段。EventState 位于 `eventMap[eventId]`，节点状态继续保存在 `nodeMap[nodeId]`，事件实例作为对应 Event 的 `instanceMap[instanceId]` 运行时字段。

Config 对应的 State object 只能使用 Config 中已经存在的 key。动态产生的对象必须写入明确的运行时字段，例如 EventState.instanceMap、EventNodeState.selectionMap 或 `valueMap`，不能伪装成新的 Character、Attribute、Effect、Event、Node 或 Choice。

配置了 Rule 的 ReactiveValue 字段不能保存同名 State 值，Action 必须改写该 Rule 依赖的 ProfileState、RunState 或 TurnState 基础事实。字面值形式的 ReactiveValue 才能由同名 State 字段覆盖。

`valueMap` 保存没有对应 Config 对象的剧本自定义事实，key 必须由内容包自行保证稳定且唯一。

Rule 派生字段的有效值不写入 State。Rule 读取的基础事实保存在对应 State 中，载入后重新计算有效值。Config 对象、函数、Proxy、缓存以及不能 JSON 序列化的对象都不能写入 `GameState`。

新游戏与 restart 初始化 RunState 时，初始有效值为 `true` 的 `acquired` 或 `actived` 使用当前的 `turnNumber = 0` 初始化对应 EffectState 的回合字段，表示该 Effect 在本 Run 开始时已经获得或激活。Reaction 注册仍只建立基准值，因此不会把初始 `true` 当作状态转换执行一次性 Action；需要在开局执行的 Action 应通过观察 `initializing` 到 `turn_start` 的 Reaction 表达。

初始化之后任一字段从 `false` 变为 `true` 时，引擎写入当前回合数；`actived` 再次进入 `true` 时更新 `activedTurn`。载入、branch 与截断恢复保留 snapshot 中的 EffectState，也不会重复执行已经发生过的生命周期 Action。

## 事件状态

每次成功执行 `start_event` 都创建一个 EventInstance，并存入当前 RunState 对应 EventState 的 `instanceMap[instanceId]`：

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

`instanceId` 在所属 RunData 内唯一，并且必须与 `instanceMap` 的 key 相同；`eventId` 引用 EventConfig，并与所属 EventState.id 相同。每个实例独立记录当前节点和实际访问路径；进入节点时把 node id 追加到 `nodePath`。实例完成或放弃时写入 `status` 与 `endedTurn`，并保留在 `instanceMap` 中，Rule 可以据此结合 Config 中的 event tag 计算完成次数等派生值。

跨回合事件继续使用同一个 active EventInstance。`start_event` 检查同一 EventConfig 的 active 实例，存在时不创建新实例；实例结束后可以创建新的实例。

## 回合状态

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
    choiceMap: Record<string, ChoiceSelection>;
}

interface TurnState extends GameState {
    /** 当前时间线的逻辑回合数。 */
    turnNumber: number;
    phase: TurnPhase;
}
```

`phase` 是 TurnState 中可观察的普通值。新游戏与 restart 从 `initializing` 开始；引擎注册配置级 Reaction 并建立基准后，将 `turnNumber` 从 `0` 增加到 `1` 并进入 `turn_start`。载入、branch 与截断恢复直接用 snapshot 中的 phase 建立 Reaction 基准，开始下一个回合时增加 `turnNumber` 并进入 `turn_start`。随后正常经历 `event_handle` 与 `turn_end`。

阶段切换通过引擎事务写入 `phase`，依赖该字段的 Rule 与 Reaction 按普通状态变化处理。创建 branch、执行截断和建立 Reaction 基准不会额外执行阶段 Action；真正进入下一回合时，`turn_start` 的状态变化才会触发对应 Reaction。

多选 TextNode 将临时选择写入 `turnData.eventMap[eventId].nodeMap[nodeId].selectionMap[eventInstanceId].choiceMap[choiceId]`。每层 object 的 key 都是对应对象的 id。`count` 必须是正整数；对应 MultipleChoice 配置了 `maxCount` 时，还不能超过其已解析值。同一 EventInstance、节点和 choice 组合只保留一条记录。Command Action 成功提交、退出节点或事件结束时清除对应记录。新回合初始化时清理上一回合未继续使用的临时选择。

## 存档容器

```ts
interface TurnRef {
    runId: string;
    turnId: string;
}

interface Profile {
    profileId: string;
    /** 存档数据结构版本。 */
    stateVersion: number;
    configId: string;
    configVersion: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;

    /** 基于 current 检查点创建的局外工作状态。 */
    state: ProfileState;

    runDataMap: Record<string, RunData>;
    current: TurnRef;
}

type RunStatus = 'active' | 'succeeded' | 'failed' | 'abandoned';

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

    /** 基于 currentTurnId 检查点创建的局内与回合工作状态。 */
    state: RunState;
    turnState: TurnState;

    currentTurnId: string;
    turnOrder: string[];
    turnDataMap: Record<string, TurnData>;
}

interface StateSnapshot {
    profileState: ProfileState;
    runState: RunState;
    turnState: TurnState;
}

type CheckpointKind =
    | 'initial'
    | 'turn_end'
    | 'terminal'
    | 'abandoned';

interface TurnData {
    turnId: string;
    kind: CheckpointKind;
    createdAt: Timestamp;
    /** 为 true 时不参与自动清理。 */
    pinned: boolean;
    snapshot: StateSnapshot;
}
```

### Profile

`profileId` 是存档 id。`stateVersion` 确定存档结构的迁移逻辑，`configId` 与 `configVersion` 确定该存档所需的内容包及内容迁移逻辑。`state` 是基于恢复游标创建的局外工作状态；`runDataMap` 保存该 Profile 的所有时间线；`current` 指向最后提交或由玩家选择继续的检查点。该检查点为 `terminal` 或 `abandoned` 时只能恢复结果界面。

`createdAt` 在新游戏时写入，`updatedAt` 在提交回合、结束 RunData、创建分支、修改 pin 或迁移存档后更新。`current` 必须指向 `runDataMap` 中存在的 RunData 与 TurnData。查看历史记录、展开分支或在界面中选中检查点不会修改 `current`。

### RunData

`runId` 在 Profile 内唯一。首个 RunData 的 `origin` 为空；保留历史检查点之后的回合数据并创建分支时使用 `branch`，结束一局或主动重开后创建新局时使用 `restart`。

branch 会把可用来源的 snapshot 复制到新 RunData 的 `initial`。restart 根据当前 ProfileState 与 Config 重新初始化 RunState 和 TurnState，`terminal` 或 `abandoned` 来源只记录上一局位置，不作为新回合状态。两种 origin 的 `source` 都只承担历史追溯作用，允许指向已被清理或删除的 TurnData。

创建 RunData 时同时创建 `initial` TurnData：新游戏和 restart 使用 `turnNumber = 0`、`phase = 'initializing'` 的初始状态，branch 复制来源 snapshot 并继承其中的逻辑回合数与 phase。

`status` 在运行期间为 `active`。成功或失败的终局事务将 phase 推进到 `turn_end`，完成状态写入与 Reaction 队列，再原子创建 `terminal` TurnData、把 status 改为 `succeeded` 或 `failed` 并写入 `endedAt`。放弃或主动重开创建 `abandoned` TurnData，把 status 改为 `abandoned` 并写入 `endedAt`。

从已结束 RunData 的历史可用 TurnData 继续时，保留后续回合会创建 branch RunData；删除后续回合会截断当前 RunData，将 status 恢复为 `active` 并清除 `endedAt`。

`createdAt` 在创建时间线时写入，`updatedAt` 在提交检查点、结束时间线或修改其中的 pin 时更新，`endedAt` 只在终局时写入。`maxTurnCount` 必须是正整数。

`state` 与 `turnState` 是从 `currentTurnId` 对应 snapshot 克隆出的可变工作副本。Action 只修改事务 draft；检查点提交成功后，新的稳定状态才写入 snapshot 并成为新的 current。运行过程中发生崩溃时，从最后一个 current snapshot 恢复。

`turnOrder` 按提交顺序保存 turn id，`turnDataMap` 用于按 id 定位检查点，二者必须包含相同的 turn id 集合。新 RunData 的首个检查点创建成功后，才会被加入 Profile。

### TurnData

TurnData 是稳定状态的检查点。`initial` 在创建 RunData 时生成，`turn_end` 在正常回合结束时生成，`terminal` 在本局成功或失败时生成，`abandoned` 在放弃本局或主动重开时生成。只有 `initial` 与 `turn_end` 可以作为开始回合；`terminal` 与 `abandoned` 只用于恢复结果界面和历史记录。

`turnId` 在所属 RunData 内唯一，`createdAt` 是该检查点的提交时间。`snapshot` 在创建后保持只读，`pinned` 是可以单独修改的存档元数据；同一 RunData 中检查点的先后关系由 `turnOrder` 表达。

恢复 `Profile.current` 时，引擎用其 `snapshot.profileState`、`snapshot.runState` 与 `snapshot.turnState` 创建当前时间线的工作副本。`terminal` 与 `abandoned` snapshot 不得进入 `turn_start`。

从非最新的 `initial` 或 `turn_end` 继续并保留后续数据时，引擎用 snapshot 创建 branch RunData 及其 `initial` 检查点，源 RunData 保持不变。从该检查点继续并删除后续数据时，引擎原子删除 `turnOrder` 中位于它之后的 id 及 `turnDataMap` 对应记录，再用 snapshot 替换原 RunData 的工作状态、恢复 active 状态，并更新恢复游标、RunData.updatedAt 与 Profile.updatedAt。

提交新 TurnData 时，引擎先完成 Action 与 Reaction 队列，再从稳定状态创建 snapshot，随后原子更新 `RunData.currentTurnId`、`Profile.current`、各级工作状态和时间戳。持久化边界上，工作状态必须与 current snapshot 一致。

逻辑上每个 snapshot 都能够独立恢复。物理实现采用增量或结构共享时，序列化层负责重建完整 snapshot，不能让该优化改变 Rule、Action 或存档迁移看到的数据结构。

## 状态约束

- `Profile.current.turnId` 必须等于对应 RunData 的 `currentTurnId`；`currentTurnId` 必须等于 `turnOrder` 的最后一项；`turnOrder` 与 `turnDataMap` 必须包含相同的 turn id 集合。
- 创建 RunData 时，`turnOrder` 的第一项是 `initial`。该检查点之后可以按保留策略删除，保留列表的第一项因此可以是后续检查点。新游戏和 restart 的 initial snapshot 使用 `turnNumber = 0`；branch 的 initial snapshot 继承来源回合数。`turnNumber` 只在进入新的 `turn_start` 时增加，因此后续检查点按 `turnOrder` 单调不减，同一逻辑回合的 `turn_end`、`terminal` 或 `abandoned` 可以使用相同回合数。
- status 为 `succeeded` 或 `failed` 时，最后一个检查点必须是 `terminal`；status 为 `abandoned` 时，最后一个检查点必须是 `abandoned`。这些状态下 `endedAt` 必须存在。
- `terminal` 与 `abandoned` 检查点不能作为 branch 或截断恢复的起点。
- branch 的 `RunOrigin.source` 必须在创建分支时指向 `initial` 或 `turn_end`；restart 可以记录上一局的 `terminal` 或 `abandoned`，但不读取它的 RunState 或 TurnState 初始化新局。
- `Profile.current` 与 `RunOrigin.source` 使用不同的引用约束：`Profile.current` 必须能够解析，`RunOrigin.source` 允许指向已删除的 TurnData。
- EventInstance 只保存在 RunState 的 `eventMap[eventId].instanceMap`，Effect 的获得与激活回合只保存在 RunState 的 `effectMap[effectId]`；属性值位于 ProfileState 或 RunState 的 `characterMap[characterId].attributeMap[attributeId]`，写入层级决定其跨局生命周期。
- 所有 id、必须可解析的引用、枚举、数值范围与 JSON 类型在事务提交和存档载入时校验。`RunOrigin.source` 只校验引用格式，允许目标不存在。校验失败时丢弃当前事务；存档载入失败时保留原始存档并报告具体路径。
- Action 事务、TurnData snapshot 和存档文件分别以原子方式提交，任何一层失败都不能留下部分写入。

## 响应式状态系统 Reactive State

响应式状态系统包含四个概念：state 是可观察的事实；Rule 是由 state 派生的值；Action 在事务中修改 state；Reaction 观察一个值并在其变化时执行 Action。

引擎使用依赖图连接这四个概念。Rule 执行时，读取 state 的字段、集合及集合成员都会被记录为依赖；例如 Rule 筛选已完成的黑暗事件时，会依赖已完成事件集合。

Action 在一次受控事务中执行。Action 接收到的 `profile`、`runData` 与 `turnData` 是可写、可追踪的 state 访问对象；所有字段写入、集合增删和成员修改都会记录为本事务的写入。`config` 仅用于查询角色、事件、效果、tag 等静态定义。Action 不得绕过引擎直接修改原始 JavaScript 对象。

事务提交后，引擎按以下顺序工作：

1. 标记依赖本次写入的 Rule 失效；
2. 重算被 Reaction、生命周期或 UI 观察的失效 Rule；
3. 比较 Reaction 观察结果的新旧值；
4. 对匹配变化条件的 Reaction 调度其 Action；
5. Reaction 执行的 Action 产生新事务，重复上述过程，直到状态稳定。

每次 Rule 重算都会替换其依赖集合，以支持条件分支和动态查询。依赖图只重算受影响字段；没有被观察的字段可以在下次读取时惰性重算。Reaction 会被持续观察。引擎为自动 Action 链维护队列并检测循环或超出执行上限的情况。

因此，完成一个黑暗事件的 Action 只需写入事件完成记录。若某个 Effect 的 `actived.rule` 读取该集合，引擎会自动使该字段失效、重算并检测其是否发生状态转换，无需 Action 发布专用 signal 或重复 Rule 中的条件。

### 引擎实现概览

ProfileState、RunState 与 TurnState 的底层数据保持为可 JSON 序列化的稀疏对象树。引擎按同层 id 合并 Config 与各层 State，并在合并视图外创建 Proxy：Rule 使用只读 Proxy，Action 使用事务内的可写 Proxy。Proxy 的读取返回当前层级的有效对象，写入生成对应层级的稀疏 State 变更，不改变公开结构或存档格式。

Config 直接以只读对象注入；由于一局游戏中 Config 不可变，对它的读取不登记依赖。Config、State 与运行时视图本身已经通过 object key 提供稳定定位，引擎直接使用所属路径和 key 进行合并、查询与依赖定位。

依赖图维护两组关系：某个 state 字段被哪些 Rule 依赖，以及某个 Rule 当前依赖哪些 state 字段。引擎执行 Rule 前设置当前依赖收集器；Proxy 的 `get` 记录读取路径。Rule 执行完成后，用本次读取结果替换其旧依赖。数组和集合除了成员路径，还需要记录 `length` 或迭代依赖；因此新增一条已完成事件时，所有遍历该集合的 Rule 都会失效。

每个带 Rule 的 `ReactiveValue` 在运行时对应一个计算节点。计算节点保存已解析值、是否失效、依赖集合和观察者。未失效时直接返回缓存；失效后在被 UI、生命周期或 Reaction 读取时重新计算。

Action 通过统一执行器运行。执行器为本次 Action 创建写入事务，推荐使用 copy-on-write draft：Action 成功时提交变更并生成写入路径集合，抛出异常时丢弃 draft。提交产生的写入路径用于使依赖图中的计算节点失效。

Reaction 在注册时将 `watch` 编译成一个被持续观察的计算节点，并保存初始结果作为基准。事务提交后，引擎重算受到影响的 Reaction；使用 `Object.is` 比较新旧结果，再根据 `from`、`to` 决定是否将 Action 放入执行队列。用于 Reaction 的 Rule 应返回基础类型或其他稳定值。

Reaction 的注册范围由声明位置决定：所有 EventConfig 与 EffectConfig 的 Reaction 在创建、载入、分支或截断恢复 RunData 时注册；TextNode 的 Reaction 在 EventInstance 进入该节点时注册，并在离开节点时注销。载入、分支或截断恢复时，引擎还会为每个 active EventInstance 的当前 TextNode 恢复 Reaction。恢复过程只建立基准值，不执行 Reaction Action。

执行队列按 Config 中的注册顺序先进先出处理。Reaction Action 产生的新写入会开启下一次事务和重算，直至队列为空。引擎需要设置单次处理的最大 Action 数或最大重算轮数；超过限制时终止本次处理，并输出完整的 Rule、Reaction 与 Action 调用链，便于定位循环依赖。

引擎应统计每个 Rule 的执行次数、执行耗时与依赖扇出，并提供对应的调试信息，用于定位频繁执行、计算缓慢或影响范围过大的 Rule。

依赖图、计算缓存和 Reaction 基准值都是可重建的运行时数据，不写入存档。从 Profile、RunData 或 TurnData 恢复游戏时，引擎重新创建 Proxy 和依赖图，计算所有持续观察的 Reaction 基准值，此时不执行 Reaction Action。
