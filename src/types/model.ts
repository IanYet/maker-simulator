/** 模型数据支持的 JSON 基础值。 */
export type JsonPrimitive = string | number | boolean | null

/** 条件、动作等通用负载字段支持的 JSON 值。 */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/** 顶层模型数据的来源类型。 */
export type ModelDataKind = 'default' | 'save' | 'run'

/** 局内数据当前所处的运行阶段。 */
export type RuntimeStep =
  | 'turn_start'
  | 'combo_check'
  | 'event_appear'
  | 'event_start'
  | 'player_event'
  | 'event_node'
  | 'turn_end'
  | 'snapshot'
  | 'next_turn'

/** 内容配置中声明的效果类型标识。 */
export type EffectKind = string

/** 效果持续时间的类型。 */
export type DurationType = 'instant' | 'turns' | 'permanent'

/** 效果与效果组合可监听的触发时机。 */
export type TriggerTiming =
  | 'turn_start'
  | 'event_appear'
  | 'event_start'
  | 'event_node'
  | 'event_result'
  | 'turn_end'

/** 事件出现后的启动方式。 */
export type EventStartMode = 'auto' | 'manual'

/** 事件和节点的展示层级。 */
export type Visibility = 'foreground' | 'background'

/** 选择节点的选择模式。 */
export type ChoiceMode = 'single' | 'multiple' | 'quantity'

/** 事件内部按字段名保存的局部状态。 */
export type EventData = Record<string, JsonValue>

/** 有向事件图中的节点类型。 */
export type EventNodeType = 'text' | 'choice' | 'check' | 'action' | 'wait' | 'result'

/** 条件表达式支持的比较操作符。 */
export type ComparisonOperator =
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'not_contains'

/** 动作写入数据时使用的作用域。 */
export type ActionScope = 'run' | 'save' | 'default'

/** 动作修改字段时使用的写入模式。 */
export type ActionMode = 'set' | 'add' | 'multiply' | 'min' | 'max'

/** Selector 可查询的目标集合。 */
export type SelectorTarget = 'effect' | 'event'

/** 对 Selector 结果集合执行的聚合操作。 */
export type AggregateFunction = 'count' | 'sum' | 'min' | 'max' | 'average'

/** calculate 值表达式支持的算术操作。 */
export type CalculateOperator = 'add' | 'subtract' | 'multiply' | 'divide' | 'min' | 'max'

/** 条件判别联合的类型字段取值。 */
export type ConditionType =
  | 'attribute'
  | 'effect'
  | 'event'
  | 'turn'
  | 'aggregate'
  | 'and'
  | 'or'
  | 'not'

/** 动作判别联合的类型字段取值。 */
export type ActionType =
  | 'modify_attribute'
  | 'modify_effect'
  | 'modify_event'
  | 'draw_pool'
  | 'create_choice'

/** 默认数据、玩家存档和局内数据共用的完整模型结构。 */
export interface GameModelData {
  /** 数据元信息。 */
  meta: ModelMeta
  /** 当前角色数据。 */
  character: Character
  /** 内容配置中声明的效果类型列表。 */
  effectKinds: EffectKindDefinition[]
  /** 效果定义及其当前状态。 */
  effects: Effect[]
  /** 独立的效果组合规则。 */
  effectCombos: EffectCombo[]
  /** 可复用的效果或事件候选池。 */
  pools: Pool[]
  /** 事件定义及其当前状态。 */
  events: GameEvent[]
}

/** 默认数据、玩家存档或局内数据的元信息。 */
export interface ModelMeta {
  /** 数据标识。 */
  id: string
  /** 内容版本。 */
  version: string
  /** 当前回合数；默认数据和玩家存档通常为 0。 */
  turn: number
  /** 当前随机种子。 */
  seed: string | null
  /** 当前运行阶段；仅局内数据需要该字段。 */
  step?: RuntimeStep
  /** 已开始局数；仅玩家存档需要该字段。 */
  runs?: number
  /** 可选的顶层数据来源类型。 */
  kind?: ModelDataKind
}

/** 玩家控制的角色。 */
export interface Character {
  /** 角色标识。 */
  id: string
  /** 以属性 ID 为键的属性表。 */
  attributes: Record<string, Attribute>
}

/** 内容配置中声明的角色属性及其当前状态。 */
export interface Attribute {
  /** 展示名称。 */
  displayName: string
  /** 当前是否向玩家展示该属性。 */
  enabled: boolean
  /** 当前属性值。 */
  value: JsonPrimitive
  /** 数值属性的可选最小值。 */
  min?: number
  /** 数值属性的可选最大值。 */
  max?: number
}

/** 内容配置中声明的效果分类。 */
export interface EffectKindDefinition {
  /** 供 Effect.kind 与 Selector.kinds 使用的稳定分类标识。 */
  id: EffectKind
  /** 展示名称。 */
  displayName: string
}

/** 标签、计数器、建筑、增益或科技等非叙事状态。 */
export interface Effect {
  /** 效果标识。 */
  id: string
  /** 展示名称。 */
  name: string
  /** 效果内容描述。 */
  description: string
  /** 效果分类。 */
  kind: EffectKind
  /** 该效果是否已解锁，可作为奖励或候选项出现。 */
  unlocked: boolean
  /** 该效果当前是否已出现。 */
  appeared: boolean
  /** 玩家当前是否已获得该效果。 */
  acquired: boolean
  /** 效果等级。 */
  level: number
  /** 效果层数。 */
  stacks: number
  /** 用于计数、进度或强度的通用数值。 */
  value: number
  /** 用于筛选和条件判断的标签列表。 */
  tags: string[]
  /** 该效果作为候选、奖励或商品时使用的出现规则。 */
  appear: EffectAppear
  /** 效果持续时间；无需持续时间数据时为 null。 */
  duration?: Duration | null
  /** 基于时机触发的效果规则。 */
  triggers?: Trigger[]
}

/** 效果出现规则。 */
export type EffectAppear = EventAppear

/** 效果持续时间数据。 */
export interface Duration {
  /** 持续时间类型。 */
  type: DurationType
  /** 剩余回合数；非回合型持续时间为 null。 */
  remaining: number | null
}

/** 挂载在效果上的时机触发规则。 */
export interface Trigger {
  /** 触发时机。 */
  timing: TriggerTiming
  /** 执行动作前必须满足的条件。 */
  conditions: Condition[]
  /** 触发时执行的动作。 */
  actions: Action[]
}

/** 响应多个效果组合状态的独立规则。 */
export interface EffectCombo {
  /** 效果组合规则标识。 */
  id: string
  /** 展示名称。 */
  name: string
  /** 该效果组合当前是否已经出现。 */
  appeared: boolean
  /** 组合规则生效前必须满足的条件。 */
  conditions: Condition[]
  /** 检查该组合规则的触发时机。 */
  timing: TriggerTiming
  /** 组合条件满足时执行的动作。 */
  actions: Action[]
}

/** 面向效果或事件的纯候选筛选与随机抽取规则。 */
export interface Pool {
  /** 候选池标识。 */
  id: string
  /** 定义候选集合的 Selector。 */
  selector: Selector
  /** 默认抽取数量。 */
  count: ValueExpression
  /** 候选项在同一次抽取中是否最多出现一次。 */
  unique: boolean
  /** 在候选上下文中计算的权重，未声明时默认为 1。 */
  weight?: ValueExpression
}

/** 由有向节点图表示的叙事事件。 */
export interface GameEvent {
  /** 事件标识。 */
  id: string
  /** 展示名称。 */
  name: string
  /** 该事件是否已解锁。 */
  unlocked: boolean
  /** 该事件是否已经出现并进入当前事件流程。 */
  appeared: boolean
  /** 该事件显示在前台还是在后台运行。 */
  visibility: Visibility
  /** 事件出现后的启动方式。 */
  startMode: EventStartMode
  /** 事件是否可以重复发生。 */
  repeatable: boolean
  /** 该事件已经发生的次数。 */
  occurrences: number
  /** 该事件是否已经完成。 */
  completed: boolean
  /** 最近一次或最终事件结果。 */
  result: string | null
  /** 事件启动时进入的节点 ID。 */
  entryNode: string
  /** 当前节点 ID；事件未激活时为 null。 */
  currentNode: string | null
  /** 事件超时前剩余的回合数。 */
  remainingTurns: number
  /** 自动结束该事件的条件。 */
  endConditions: Condition[]
  /** 事件超时时进入的节点 ID。 */
  timeoutNode: string | null
  /** 商店库存、折扣和临时变量等事件局部状态。 */
  data: EventData
  /** 事件出现规则。 */
  appear: EventAppear
  /** 有向事件图节点列表。 */
  nodes: EventNode[]
}

/** 事件出现规则。 */
export interface EventAppear {
  /** 计算出现概率前必须满足的条件。 */
  conditions: Condition[]
  /** 0 到 1 之间的出现概率。 */
  chance: number
}

/** 有向事件图节点。 */
export type EventNode = TextNode | ChoiceNode | CheckNode | ActionNode | WaitNode | ResultNode

/** 所有事件节点共享的基础字段。 */
export interface BaseNode {
  /** 节点标识。 */
  id: string
  /** 节点类型。 */
  type: EventNodeType
  /** 节点显示在前台还是在后台运行。 */
  visibility: Visibility
  /** 节点展示文本。 */
  text?: string
  /** 处理该节点前必须满足的条件。 */
  conditions?: Condition[]
  /** 该节点执行的动作。 */
  actions?: Action[]
  /** 被 `check.nexts` 作为候选节点评估时使用的概率，未声明时默认为 1。 */
  chance?: number
  /** 下一个节点 ID；没有自动后续节点时为 null。 */
  next?: string | null
}

/** 叙事文本节点。 */
export interface TextNode extends BaseNode {
  /** 节点类型判别字段。 */
  type: 'text'
  /** 该节点展示的叙事文本。 */
  text: string
  /** 文本处理后进入的下一个节点 ID。 */
  next: string
}

/** 玩家选择节点。 */
export interface ChoiceNode extends BaseNode {
  /** 节点类型判别字段。 */
  type: 'choice'
  /** 选项选择模式。 */
  mode: ChoiceMode
  /** 提交前要求选择的最少选项数。 */
  minSelections?: number
  /** 提交前允许选择的最多选项数。 */
  maxSelections?: number
  /** 展示给玩家的选项列表。 */
  choices: Choice[]
  /** 多选或数量选择提交后进入的节点 ID。 */
  next?: string | null
}

/**
 * 事件路由节点。
 *
 * `check` 节点自身不承载叙事文本、条件或动作，只根据 `nexts` 中候选节点的
 * `conditions` 与 `chance` 选择实际进入的后续节点。
 */
export interface CheckNode extends BaseNode {
  /** 节点类型判别字段。 */
  type: 'check'
  /** 按顺序评估的候选节点 ID 列表。 */
  nexts: string[]
}

/** 仅执行动作的节点。 */
export interface ActionNode extends BaseNode {
  /** 节点类型判别字段。 */
  type: 'action'
  /** 该节点执行的动作。 */
  actions: Action[]
  /** 动作执行后进入的下一个节点 ID。 */
  next: string
}

/** 跨回合等待节点。 */
export interface WaitNode extends BaseNode {
  /** 节点类型判别字段。 */
  type: 'wait'
  /** 剩余等待回合数。 */
  remainingTurns: number
  /** 提前结束等待的条件。 */
  endConditions: Condition[]
  /** 等待超时时进入的节点 ID。 */
  timeoutNode: string
  /** 等待正常完成时进入的节点 ID。 */
  next: string
}

/** 事件结果节点。 */
export interface ResultNode extends BaseNode {
  /** 节点类型判别字段。 */
  type: 'result'
  /** 写入事件的结果值。 */
  result: string
  /** 该结果节点执行的动作。 */
  actions: Action[]
  /** 该结果是否会完成事件。 */
  completeEvent: boolean
}

/** 选择节点中可供玩家选择的选项。 */
export interface Choice {
  /** 选项标识。 */
  id: string
  /** 选项展示文本。 */
  text: string
  /** 该选项可用前必须满足的条件。 */
  conditions?: Condition[]
  /** 所属节点为数量模式时使用的数量配置。 */
  quantity?: ChoiceQuantity | null
  /** 选择该选项后立即执行的动作。 */
  actions?: Action[]
  /** 选择该选项后进入的节点 ID。 */
  next?: string | null
}

/** 从效果物化为具体选项时使用的模板。 */
export interface ChoiceTemplate {
  /** 选项标识；未声明时使用来源效果 ID。 */
  id?: string
  /** 选项展示文本；未声明时使用来源效果名称。 */
  text?: string
  /** 生成选项可用前必须满足的条件。 */
  conditions?: Condition[]
  /** 生成选项的数量配置。 */
  quantity?: ChoiceQuantity | null
  /** 选择生成选项后执行的动作。 */
  actions?: Action[]
  /** 选择生成选项后进入的节点 ID。 */
  next?: string | null
}

/** 可选择选项的数量控制配置。 */
export interface ChoiceQuantity {
  /** 可选择的最小数量。 */
  min: ValueExpression
  /** 可选择的最大数量。 */
  max: ValueExpression
  /** 数量步长。 */
  step?: ValueExpression
  /** 玩家输入前展示的默认数量。 */
  defaultValue?: ValueExpression
}

/** 模型支持的任意条件。 */
export type Condition =
  | AttributeCondition
  | EffectCondition
  | EventCondition
  | TurnCondition
  | AggregateCondition
  | AndCondition
  | OrCondition
  | NotCondition

/** 聚合条件和聚合值表达式使用的集合选择器。 */
export interface Selector {
  /** 要查询的目标集合。 */
  target: SelectorTarget
  /** 可选的 ID 白名单。 */
  ids?: string[]
  /** 必须包含的效果标签；仅 target 为 effect 时可用。 */
  tags?: string[]
  /** 必须匹配的效果分类；仅 target 为 effect 时可用。 */
  kinds?: EffectKind[]
  /** 字段级选择规则。 */
  fields?: FieldMatcher[]
}

/** Selector 内部的字段比较规则。 */
export interface FieldMatcher {
  /** 从候选对象读取的字段路径。 */
  field: string
  /** 比较操作符。 */
  operator: ComparisonOperator
  /** 用于比较的右侧值。 */
  value: ValueExpression
}

/** 角色属性条件。 */
export interface AttributeCondition {
  /** 条件类型判别字段。 */
  type: 'attribute'
  /** 要读取的属性 ID。 */
  attribute: string
  /** 比较操作符。 */
  operator: ComparisonOperator
  /** 用于比较的右侧值。 */
  value: ValueExpression
}

/** 效果字段条件。 */
export interface EffectCondition {
  /** 条件类型判别字段。 */
  type: 'effect'
  /** 要读取的效果 ID。 */
  effectId: string
  /** 要读取的效果字段路径。 */
  field: string
  /** 比较操作符。 */
  operator: ComparisonOperator
  /** 用于比较的右侧值。 */
  value: ValueExpression
}

/** 事件字段条件。 */
export interface EventCondition {
  /** 条件类型判别字段。 */
  type: 'event'
  /** 要读取的事件 ID。 */
  eventId: string
  /** 要读取的事件字段路径。 */
  field: string
  /** 比较操作符。 */
  operator: ComparisonOperator
  /** 用于比较的右侧值。 */
  value: ValueExpression
}

/** 当前回合条件。 */
export interface TurnCondition {
  /** 条件类型判别字段。 */
  type: 'turn'
  /** 比较操作符。 */
  operator: ComparisonOperator
  /** 用于比较的回合值。 */
  value: ValueExpression
}

/** 对选中效果或事件集合执行聚合后的条件。 */
export interface AggregateCondition {
  /** 条件类型判别字段。 */
  type: 'aggregate'
  /** 选择效果或事件的 Selector。 */
  selector: Selector
  /** 要计算的聚合操作。 */
  aggregate: AggregateFunction
  /** 非 count 聚合使用的字段路径。 */
  field?: string
  /** 比较操作符。 */
  operator: ComparisonOperator
  /** 用于比较聚合结果的右侧值。 */
  value: ValueExpression
}

/** 逻辑与条件。 */
export interface AndCondition {
  /** 条件类型判别字段。 */
  type: 'and'
  /** 子条件列表；全部通过时才成立。 */
  conditions: Condition[]
}

/** 逻辑或条件。 */
export interface OrCondition {
  /** 条件类型判别字段。 */
  type: 'or'
  /** 子条件列表；至少一个通过时成立。 */
  conditions: Condition[]
}

/** 逻辑非条件。 */
export interface NotCondition {
  /** 条件类型判别字段。 */
  type: 'not'
  /** 要取反的子条件列表。 */
  conditions: Condition[]
}

/** 模型支持的任意动作。 */
export type Action =
  | ModifyAttributeAction
  | ModifyEffectAction
  | ModifyEventAction
  | DrawPoolAction
  | CreateChoiceAction

/** 所有动作共享的基础字段。 */
export interface BaseAction {
  /** 该动作修改的数据作用域。 */
  scope?: ActionScope
  /** 动作类型。 */
  type: ActionType
}

/** 角色属性修改动作。 */
export interface ModifyAttributeAction extends BaseAction {
  /** 动作类型判别字段。 */
  type: 'modify_attribute'
  /** 要修改的属性 ID。 */
  attribute: string
  /** 要修改的属性状态字段；未声明时默认为 value。 */
  field?: 'value' | 'enabled'
  /** 修改模式。 */
  mode: ActionMode
  /** 修改模式使用的值。 */
  value: ValueExpression
}

/** 效果字段修改动作。 */
export interface ModifyEffectAction extends BaseAction {
  /** 动作类型判别字段。 */
  type: 'modify_effect'
  /** 要修改的效果 ID。 */
  effectId: string
  /** 要修改的效果字段路径。 */
  field: string
  /** 修改模式。 */
  mode: ActionMode
  /** 修改模式使用的值。 */
  value: ValueExpression
}

/** 事件字段修改动作。 */
export interface ModifyEventAction extends BaseAction {
  /** 动作类型判别字段。 */
  type: 'modify_event'
  /** 要修改的事件 ID。 */
  eventId: string
  /** 要修改的事件字段路径。 */
  field: string
  /** 修改模式。 */
  mode: ActionMode
  /** 修改模式使用的值。 */
  value: ValueExpression
}

/** 抽取候选池并处理抽中或空结果的动作。 */
export interface DrawPoolAction {
  /** 动作类型判别字段。 */
  type: 'draw_pool'
  /** 候选池标识。 */
  poolId: string
  /** 抽取数量覆盖值；未声明时使用候选池默认数量。 */
  count?: ValueExpression
  /** 每个抽中候选执行一次的动作，此时 `$drewId` 绑定为候选 ID。 */
  onDraw: Action[]
  /** 未抽中任何候选时执行一次的动作。 */
  onEmpty?: Action[]
}

/** 将效果物化为具体事件选项的动作。 */
export interface CreateChoiceAction {
  /** 动作类型判别字段。 */
  type: 'create_choice'
  /** 目标事件 ID；未声明时使用当前事件。 */
  eventId?: string
  /** 接收生成选项的选择节点 ID。 */
  nodeId: string
  /** 来源效果 ID；在候选池抽取上下文中支持 `$drewId`。 */
  effectId: string
  /** 构建生成选项时使用的模板。 */
  choice: ChoiceTemplate
}

/** 条件和动作使用的静态 JSON 值或运行时表达式。 */
export type ValueExpression =
  | JsonValue
  | FieldValueExpression
  | CalculateValueExpression
  | RandomValueExpression
  | AggregateValueExpression

/** 从模型数据或临时选择/候选上下文读取字段的值表达式。 */
export interface FieldValueExpression {
  /** 表达式类型判别字段。 */
  type: 'field'
  /** 要读取的数据作用域；未声明时默认读取局内数据。 */
  scope?: ActionScope
  /** 要读取的字段路径。 */
  path: string
}

/** 根据子值执行算术计算的值表达式。 */
export interface CalculateValueExpression {
  /** 表达式类型判别字段。 */
  type: 'calculate'
  /** 要执行的算术操作。 */
  operator: CalculateOperator
  /** 输入值列表。 */
  values: ValueExpression[]
}

/** 生成随机数的值表达式。 */
export interface RandomValueExpression {
  /** 表达式类型判别字段。 */
  type: 'random'
  /** 随机数最小值。 */
  min: number
  /** 随机数最大值。 */
  max: number
  /** 结果是否应为整数。 */
  integer?: boolean
}

/** 返回选中效果或事件集合聚合结果的值表达式。 */
export interface AggregateValueExpression {
  /** 表达式类型判别字段。 */
  type: 'aggregate_value'
  /** 选择效果或事件的 Selector。 */
  selector: Selector
  /** 要计算的聚合操作。 */
  aggregate: AggregateFunction
  /** 非 count 聚合使用的字段路径。 */
  field?: string
}

/** 每回合局内快照容器。 */
export interface RunSnapshotStore {
  /** 玩家存档标识。 */
  saveId: string
  /** 当前局内数据。 */
  currentRun: GameModelData
  /** 回合结束时保存的快照列表。 */
  turnSnapshots: TurnSnapshot[]
}

/** 回合结束时捕获的完整局内数据快照。 */
export interface TurnSnapshot {
  /** 快照对应的回合数。 */
  turn: number
  /** 回合结束时的完整局内数据。 */
  data: GameModelData
}
