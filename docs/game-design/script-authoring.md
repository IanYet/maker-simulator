# 游戏脚本编写指南

本文面向游戏策划，说明如何使用 JSON 编写 Config，并使用 JavaScript 编写 Rule 与 Action。完整 TypeScript 声明见 [model.ts](../../src/types/model.ts)；存档、状态合并和响应式引擎实现见[运行时系统设计](./runtime-system.md)。

## 脚本运行时参数

Rule 与 Action 都先接收一个 `context` 对象，随后才是 Config 中配置的参数。`context` 统一包含 `config`、`profile`、`runData`、`turnData`、`random`、`action` 和 `rule`。

- `context.config` 是只读的原始 GameConfig。
- `context.profile` 是 Config 与 ProfileState 合并后的运行时视图。
- `context.runData` 继续叠加当前 RunState。
- `context.turnData` 继续叠加当前 TurnState，并提供 `turnNumber` 与 `phase`。
- `context.random()` 调用引擎 PRNG，每次返回一个 `[0, 1)` 区间内的数并推进当前 RunData 的随机状态。
- `context.action` 是所有已注册 Action 的函数集合，可通过 `context.action['actionName'](...args)` 调用。
- `context.rule` 是所有已注册 Rule 的函数集合，可通过 `context.rule['ruleName'](...args)` 调用并获得结果。

```ts
interface RuleContext {
    readonly config: DeepReadonly<GameConfig>;
    readonly profile: DeepReadonly<ProfileRuntime>;
    readonly runData: DeepReadonly<RunRuntime>;
    readonly turnData: DeepReadonly<TurnRuntime>;
    readonly random: () => number;
    readonly action: ActionFunctions;
    readonly rule: RuleFunctions;
}

interface ActionContext {
    readonly config: DeepReadonly<GameConfig>;
    readonly profile: ProfileRuntime;
    readonly runData: RunRuntime;
    readonly turnData: TurnRuntime;
    readonly random: () => number;
    readonly action: ActionFunctions;
    readonly rule: RuleFunctions;
}
```

Config 与三个运行时视图使用相同的对象路径：

```ts
context.config.characters[characterId]?.attributes[attributeId]?.value;
context.runData.characters[characterId]?.attributes[attributeId]?.value;
```

Action 写入哪个运行时视图，就决定状态的保存范围：写入 `context.profile` 的结果跨 Run 保留，写入 `context.runData` 的结果只属于当前时间线，写入 `context.turnData` 的结果只属于当前回合。

## Config

Config 中所有可变字段均表示默认值。运行中的实际值、存档范围和合并方式由[运行时系统设计](./runtime-system.md#state)定义。

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
    /** 同类对象的随机判定顺序。 */
    order: number;
    /** 随机判定权重或独立判定概率。 */
    weight: ReactiveValue<number>;
    /** 仅控制 UI 是否展示，不影响规则、动作或数据读取。 */
    visible: boolean;

    /** 是否解锁或其计算规则。 */
    unlocked: ReactiveValue<boolean>;

    /** 是否启用或其计算规则。 */
    enabled: ReactiveValue<boolean>;
}
```

`id` 必须与所属 object 的 key 相同，非空，并且只由字母、数字、`-`、`_` 与 `.` 组成；`__proto__`、`prototype` 与 `constructor` 不得作为 id。`displayName` 与 `description` 是面向玩家的文本；程序逻辑不得用它们作引用。`tags` 可为空，单个对象内不得重复；标签只承担分类作用，不自动产生游戏效果。

`order` 是随机判定的稳定顺序。同一所属集合内的同一具体类型不得使用相同的 `order`；不同具体类型之间可以重复。Rule 或 Action 对候选对象执行多次随机判定时，必须先按 `order` 升序处理。

`weight` 的有效值必须在 `[0, 10]` 内，初始默认值为 `5`，游戏中可由 State 覆盖或 Rule 计算。当 `0 <= weight < 1` 时，该值是一次独立随机判定的概率，`context.random() < weight` 表示通过；`weight = 0` 永不通过。当 `1 <= weight <= 10` 时，该值是同一候选集合中的相对权重，选中概率为自身权重除以候选集合的总权重。具体候选集合、是否执行独立判定以及选中后的行为由相应 Rule 或 Action 定义。

`visible` 控制对象是否在 UI 中显示。`unlocked` 控制对象是否可以从 Profile 进入 RunData，`enabled` 控制对象是否在游戏流程中可用。

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

效果获得与激活的直接状态值和发生回合保存在 RunState 的 `effects` 对应 EffectState 中。所有 EffectConfig 的 Reaction 在创建、载入、分支或截断恢复 RunData 时注册，无需等待 EffectState 出现；注册时只建立基准值。依赖图、已解析值和上次值属于引擎内部运行时缓存，可由 State 重新构建。

### 事件 Event
事件是叙事的对象。一个事件是一张有向图：节点负责展示叙事、执行动作或检查规则；边由动作或规则决定。

```ts
interface EventConfig extends CommonConfig {
    entryNodeId: NodeId;
    nodes: Record<NodeId, EventNode>;
    reactionList?: Reaction[];
}
```

`nodes` 使用 EventNode.id 作为 key，`entryNodeId` 必须指向其中一个节点。

`enabled` 表示事件当前是否可以启动。启动事件统一执行 `start_event` Action；该 Action 检查事件的有效 `enabled` 值与现有 active 实例，然后创建 EventInstance 并进入 `entryNodeId`。动作或检查节点设置下一个节点后，当前 EventInstance 自动进入该节点。

`EventConfig.reactionList` 用于自动启动事件。在创建、载入、分支或截断恢复 RunData 时，引擎为所有 EventConfig 注册配置级 Reaction，此时不需要 EventInstance。Reaction 初次注册只计算基准值。新游戏与 restart 创建的 RunData 以 `context.turnData.phase = 'initializing'` 完成注册，再进入 `turn_start`；载入、branch 与截断恢复直接以恢复的 snapshot 建立基准。建立基准时不执行 Reaction Action，结束 RunData 时统一注销这些 Reaction。

一次性事件可以让 `enabled.rule` 判断该事件的完成次数是否为 `0`，并由其他 Choice 或 Action 执行 `start_event`。常态性事件可以保持 `enabled` 为 `true`，通过 Reaction 在满足回合条件时执行 `start_event`。已有 active 实例时，`start_event` 不重复创建；实例结束后，下一次满足条件时可以创建新的实例。

每次成功执行 `start_event` 都会创建独立的 EventInstance。实例字段、节点路径和保存位置在 `State` 章节定义。EventConfig 可以被多次实例化；跨回合事件继续使用已有 active 实例，重复性事件在上一个实例结束后创建新实例。

#### 叙事节点 TextNode

叙事节点用于呈现普通文本、角色与选项等叙事内容。单选节点在选择后立即执行选项 Action；多选节点先收集选择，再通过明确的 Command 提交或取消。

```ts
interface TextNodeBase extends CommonConfig {
    content: string;
    reactionList?: Reaction[];
    /** 未处理时，是否阻止进入下一回合。 */
    required?: ReactiveValue<boolean>;
}

interface SingleTextNode extends TextNodeBase {
    type: 'single';
    choices: ReactiveValue<Record<string, SingleChoice>>;
}

interface SingleChoice extends CommonConfig {
    action: Action;
}

interface MultipleTextNode extends TextNodeBase {
    type: 'multiple';
    choices: ReactiveValue<Record<string, MultipleChoice>>;
    commands: Record<string, NodeCommand>;
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

TextNode 可以配置 `reactionList`。节点成为当前节点后，引擎观察其中的 Reaction；例如观察“当前节点且 `context.turnData.phase` 为 `turn_start`”这一 Rule，在结果进入 `true` 时执行每回合 Action。

单选节点中，玩家选择一个 `SingleChoice` 后立即执行其 `action`。多选节点中，增减 `MultipleChoice` 数量只更新 TurnData 中的临时选择，不执行 Action；选择结果以 Choice id 为 key，并包含 `value` 与 `count`。

多选节点通过 `commands` 提供购买、确认、取消或退出等操作。Command Action 一次性读取完整选择结果；事务失败时不提交任何选择效果。退出 Command 可以清空临时选择并离开节点。`maxCount` 存在时限制对应 choice 的最大选择数量，省略时不设置引擎级单项上限。`required` 为 `true` 时，节点尚未处理完成则不能进入下一回合。

#### 规则检查节点 CheckNode

规则检查节点不承载叙事。节点被进入时触发 `check` 动作，由该动作执行具体检查规则并决定事件的下一个节点。

```ts
interface CheckNode extends CommonConfig {
    type: 'check';
    candidateNodes: Record<NodeId, true>;
    check: Action;
}
```

`candidateNodes` 的 key 列出该检查节点可指向的节点，value 固定为 `true`；所有 key 都必须指向本事件内存在的节点。计算下一个节点时，`check` Action 可以按候选节点已解析的 `order` 与 `weight` 调用 `context.random()` 判定目标节点。检查规则和目标节点选择的具体配置在 `check` 动作中定义。

```ts
type EventNode = SingleTextNode | MultipleTextNode | CheckNode;
type NodeId = string;
```

### Rule

Rule 是用于计算字段值的函数，类似 object getter。Rule 可以通过 `context.action['actionName'](...args)` 与 `context.rule['ruleName'](...args)` 调用其他 Action 或 Rule，也可以通过 `context.random()` 执行随机判定，但不得使用 `Math.random()` 或真实时间。

```ts
{
    [ruleName]: {
        key: ruleName,
        calc: (context, ...args) => {}
    }
}
```

Config 中的 Rule 表示对规则实现的一次调用：`key` 是规则名，也是实现中的函数名；引擎将只读 `RuleContext` 作为 `calc` 的第一个参数，随后展开 Config 中的 `args`。`context.config` 只读、不可变且不参与依赖追踪；`context.profile`、`context.runData` 与 `context.turnData` 是只读、可追踪的 state 访问对象。`context.action` 与 `context.rule` 由引擎注入，分别提供按注册名调用其他 Action 与 Rule 的函数；`context.random()` 由引擎注入。

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

### Action 与 Reaction

Action 是改变 state 的函数。Action 的 JavaScript 实现由 action 名索引，`exec` 不返回值。

```ts
{
    [actionName]: {
        key: actionName,
        exec: (context, ...args) => {}
    }
}
```

Config 中的 Action 表示对 action 实现的一次调用：`key` 是 action 名，也是实现中的函数名；引擎将 `ActionContext` 作为 `exec` 的第一个参数，随后展开 Config 中的 `args`。`context.config` 只读；`context.profile`、`context.runData` 与 `context.turnData` 是事务内可写的运行时视图；`context.action` 与 `context.rule` 由引擎注入，分别提供按注册名调用其他 Action 与 Rule 的函数；`context.random()` 的 PRNG 推进与 Action State 写入使用同一事务提交或回滚。玩家操作与 Reaction 都通过同一个 Action 执行器运行 Action。

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

例如 Effect 的激活 Reaction 可以观察所属对象的 `actived`，匹配 `false` 到 `true`；每回合开始的效果可以观察一个 Rule，该 Rule 返回“Effect 已激活并且 `context.turnData.phase` 为 `turn_start`”的布尔值，并匹配 `false` 到 `true`。Reaction 复用已解析的 `actived`，不会重复黑暗事件数量等业务条件。
