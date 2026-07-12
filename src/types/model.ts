/**
 * Rule 与 Action 配置参数允许使用的基础类型。
 */
export type Primitive = string | number | boolean | null

/**
 * 使用 UTC ISO 8601 字符串表示的时间戳。
 */
export type Timestamp = string

/**
 * RunData 持有的可序列化 PRNG 状态。
 */
export interface RandomState {
	/** 创建 RunData 时确定的随机种子。 */
	seed: string
	/** 已提交的 PRNG 调用数量。 */
	cursor: number
}

/**
 * 引擎注入的伪随机数函数，每次返回 `[0, 1)` 内的数。
 */
export type Random = () => number

/**
 * 将对象、数组及其嵌套成员递归转换为只读类型。
 */
export type DeepReadonly<T> = T extends (...args: infer TArgs) => infer TResult
	? (...args: TArgs) => TResult
	: T extends readonly (infer TItem)[]
		? readonly DeepReadonly<TItem>[]
		: T extends object
			? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
			: T

/**
 * Config 中的一次 Rule 调用。
 */
export interface Rule {
	/** Rule 实现的注册名称。 */
	key: string
	/** 传递给 Rule 实现的基础类型参数。 */
	args: Primitive[]
}

/**
 * Config 中的一次 Action 调用。
 */
export interface Action {
	/** Action 实现的注册名称。 */
	key: string
	/** 传递给 Action 实现的基础类型参数。 */
	args: Primitive[]
}

/**
 * Reaction 直接观察的运行时字段引用。
 */
export interface ValueRef {
	/** self 表示声明 Reaction 的对象；其余值表示对应的解析 State 根。 */
	source: 'self' | 'profileState' | 'runState' | 'turnState'
	/** 相对 source 的非空字段路径。 */
	path: [string, ...string[]]
}

/**
 * Reaction 可以观察的字段引用或 Rule 调用。
 */
export type ReactionSource = ValueRef | Rule

/**
 * 自动观察运行时值并调度 Action 的配置。
 */
export interface Reaction {
	/** 被持续观察的字段或 Rule。 */
	watch: ReactionSource
	/** 可选的变化前值过滤条件。 */
	from?: Primitive
	/** 可选的变化后值过滤条件。 */
	to?: Primitive
	/** 满足变化条件时执行的 Action。 */
	action: Action
}

/**
 * 游戏内容包的元信息与存档策略。
 */
export interface ConfigMeta {
	/** 游戏内容包的稳定标识符。 */
	id: string
	/** 游戏名称。 */
	name: string
	/** 用于内容迁移的版本号。 */
	version: string
	/** 游戏背景介绍。 */
	background: string
	/** 每个 RunData 默认保留的 TurnData 数量。 */
	maxTurnCountPerRun: number
}

/**
 * 所有可引用 Config 对象共享的字段。
 */
export interface CommonConfig {
	/** 所属集合内稳定且唯一的标识符。 */
	id: string
	/** 面向玩家的展示名称。 */
	displayName: string
	/** 用于筛选、检索和规则归类的标签。 */
	tags: string[]
	/** 面向玩家的可选说明文本。 */
	description?: string
	/** 随机判定、UI 展示与跨对象 Reaction 注册的稳定顺序。 */
	order: number
	/** `[0, 1)` 的独立判定概率，或 `[1, 10]` 的相对权重基础值。 */
	weightValue: number
	/** 根据 State 基础值计算有效权重的 Rule。 */
	weight: Rule
	/** 是否在界面中展示。 */
	visible: boolean
	/** 解锁状态基础值。 */
	unlockedValue: boolean
	/** 根据 State 基础值计算有效解锁状态的 Rule。 */
	unlocked: Rule
	/** 启用状态基础值。 */
	enabledValue: boolean
	/** 根据 State 基础值计算有效启用状态的 Rule。 */
	enabled: Rule
}

/**
 * AttributeConfig 的公共字段。
 */
export interface AttributeConfig extends CommonConfig {
	/** 属性的数据类型。 */
	type: 'number' | 'enum'
	/** 属性的初始数值；枚举属性使用从零开始的下标。 */
	value: number
}

/**
 * 数值属性配置。
 */
export interface NumberAttributeConfig extends AttributeConfig {
	/** 数值属性判别字段。 */
	type: 'number'
	/** 可选的最小值。 */
	min?: number
	/** 可选的最大值。 */
	max?: number
}

/**
 * 枚举属性配置。
 */
export interface EnumAttributeConfig extends AttributeConfig {
	/** 枚举属性判别字段。 */
	type: 'enum'
	/** 枚举下标对应的展示文本。 */
	valueDisplay: string[]
}

/**
 * 可被角色持有的属性配置。
 */
export type AnyAttributeConfig = NumberAttributeConfig | EnumAttributeConfig

/**
 * 角色或抽象属性载体的配置。
 */
export interface CharacterConfig extends CommonConfig {
	/** 以 AttributeConfig id 为 key 的属性对象。 */
	attributes: Record<string, AnyAttributeConfig>
}

/**
 * Effect 配置。
 */
export interface EffectConfig extends CommonConfig {
	/** 是否已经获得的基础值。 */
	acquiredValue: boolean
	/** 根据 State 基础值计算获得状态的 Rule。 */
	acquired: Rule
	/** 是否已经激活的基础值。 */
	activedValue: boolean
	/** 根据 State 基础值计算激活状态的 Rule。 */
	actived: Rule
	/** 是否允许玩家在事件处理阶段手动激活。 */
	manuallyActivatable: boolean
	/** 可选的绑定 CharacterConfig id。 */
	bindCharacterId?: string
	/** Effect 持续观察的 Reaction 列表。 */
	reactionList: Reaction[]
}

/**
 * EventConfig 内局部节点的标识符。
 */
export type NodeId = string

/**
 * TextNode 共享的配置字段。
 */
export interface TextNodeBase extends CommonConfig {
	/** 节点展示的叙事内容。 */
	content: string
	/** 节点处于当前状态时注册的 Reaction。 */
	reactionList?: Reaction[]
	/** 未处理该节点时是否阻止进入下一回合的基础值。 */
	requiredValue?: boolean
	/** 根据 State 基础值计算回合门禁的 Rule。 */
	required?: Rule
}

/**
 * 单选节点中的一个选项。
 */
export interface SingleChoice extends CommonConfig {
	/** 玩家选择该选项后立即执行的 Action。 */
	action: Action
}

/**
 * 多选节点中的一个可计数选项。
 */
export interface MultipleChoice extends CommonConfig {
	/** 提交选择时提供给 Action 的配置值。 */
	value: Primitive
	/** 单次允许选择的最大数量基础值。 */
	maxCountValue?: number
	/** 根据 State 基础值计算最大数量的 Rule。 */
	maxCount?: Rule
}

/**
 * 多选节点提交、取消或退出时使用的命令。
 */
export interface NodeCommand extends CommonConfig {
	/** 执行命令时调用的 Action。 */
	action: Action
}

/**
 * 选择后立即执行 Action 的单选叙事节点。
 */
export interface SingleTextNode extends TextNodeBase {
	/** 单选节点判别字段。 */
	type: 'single'
	/** 以 SingleChoice id 为 key 的选项基础定义。 */
	choicesValue: Record<string, SingleChoice>
	/** 根据 State/Config 基础定义计算有效选项的 Rule。 */
	choices: Rule
}

/**
 * 允许选择多种、每种多个选项的叙事节点。
 */
export interface MultipleTextNode extends TextNodeBase {
	/** 多选节点判别字段。 */
	type: 'multiple'
	/** 以 MultipleChoice id 为 key 的选项基础定义。 */
	choicesValue: Record<string, MultipleChoice>
	/** 根据 State/Config 基础定义计算有效选项的 Rule。 */
	choices: Rule
	/** 以 NodeCommand id 为 key 的命令对象。 */
	commands: Record<string, NodeCommand>
}

/**
 * 所有叙事节点的联合类型。
 */
export type TextNode = SingleTextNode | MultipleTextNode

/**
 * 进入后执行检查 Action 的规则检查节点。
 */
export interface CheckNode extends CommonConfig {
	/** 检查节点判别字段。 */
	type: 'check'
	/** 以候选节点 id 为 key 的可达节点集合。 */
	candidateNodes: Record<NodeId, true>
	/** 进入节点时执行的检查 Action。 */
	check: Action
}

/**
 * EventConfig 可以包含的节点类型。
 */
export type EventNode = SingleTextNode | MultipleTextNode | CheckNode

/**
 * 由节点图组成的事件配置。
 */
export interface EventConfig extends CommonConfig {
	/** 事件实例创建后进入的首个节点 id。 */
	entryNodeId: NodeId
	/** 以 EventNode id 为 key 的事件节点对象。 */
	nodes: Record<NodeId, EventNode>
	/** EventConfig 级别持续注册的 Reaction。 */
	reactionList?: Reaction[]
}

/**
 * 一份完整的策划内容配置。
 */
export interface GameConfig {
	/** 游戏内容包元信息。 */
	meta: ConfigMeta
	/** 以 CharacterConfig id 为 key 的角色对象。 */
	characters: Record<string, CharacterConfig>
	/** 以 EffectConfig id 为 key 的 Effect 对象。 */
	effects: Record<string, EffectConfig>
	/** 以 EventConfig id 为 key 的 Event 对象。 */
	events: Record<string, EventConfig>
}

/**
 * 一次事件运行实例。
 */
export interface EventInstance {
	/** 所属 RunData 内唯一的实例 id。 */
	instanceId: string
	/** 对应 EventConfig 的 id。 */
	eventId: string
	/** 事件实例当前状态。 */
	status: 'active' | 'completed' | 'abandoned'
	/** 当前所在节点 id。 */
	currentNodeId: NodeId
	/** 实际访问过的节点路径。 */
	nodePath: NodeId[]
	/** 创建该实例时的逻辑回合数。 */
	startedTurn: number
	/** 实例完成或放弃时的逻辑回合数。 */
	endedTurn?: number
}

/**
 * 多选节点中一个 Choice 的本回合选择结果。
 */
export interface ChoiceSelection {
	/** 对应 Choice Config 的 id。 */
	id: string
	/** Choice Config 提供的提交值。 */
	value: Primitive
	/** 本次选择的数量。 */
	count: number
}

/**
 * 某个 EventInstance 在一个节点上的本回合选择结果。
 */
export interface NodeSelection {
	/** 对应的 EventInstance id。 */
	eventInstanceId: string
	/** 以 Choice id 为 key 的选择结果对象。 */
	choices: Record<string, ChoiceSelection>
}

/**
 * Config 对象 State 共享的基础字段。
 *
 * `xxxValue` 在新 Run 初始化时由 Config 物化到 RunState；ProfileState
 * 与 TurnState 仍可按既有层级规则覆盖对应字段。
 */
export interface CommonState {
	/** 对应同层 Config 对象的 id。 */
	id: string
	/** 对 weight 基础值的 State 值。 */
	weightValue?: number
	/** 对 visible 字面默认值的可选覆盖。 */
	visible?: boolean
	/** 对 unlocked 基础值的 State 值。 */
	unlockedValue?: boolean
	/** 对 enabled 基础值的 State 值。 */
	enabledValue?: boolean
}

/**
 * AttributeConfig 的稀疏状态。
 */
export interface AttributeState extends CommonState {
	/** 属性的当前值。 */
	value?: number
}

/**
 * CharacterConfig 的稀疏状态。
 */
export interface CharacterState extends CommonState {
	/** 与 CharacterConfig.attributes 同构的属性状态对象。 */
	attributes?: Record<string, AttributeState>
}

/**
 * EffectConfig 的稀疏状态及运行时字段。
 */
export interface EffectState extends CommonState {
	/** Effect 是否已获得的基础 State 值。 */
	acquiredValue?: boolean
	/** Effect 是否已激活的基础 State 值。 */
	activedValue?: boolean
	/** Effect 当前绑定的 CharacterConfig id。 */
	bindCharacterId?: string
	/** Effect 最近一次获得时的逻辑回合数。 */
	acquiredTurn?: number
	/** Effect 最近一次激活时的逻辑回合数。 */
	activedTurn?: number
}

/**
 * Choice Config 的稀疏状态。
 */
export interface ChoiceState extends CommonState {
	/** MultipleChoice 当前允许选择的最大数量基础值。 */
	maxCountValue?: number
}

/**
 * NodeCommand Config 的稀疏状态。
 */
export type NodeCommandState = CommonState

/**
 * EventNode Config 的稀疏状态及回合选择字段。
 */
export interface EventNodeState extends CommonState {
	/** TextNode 当前是否阻止进入下一回合的基础值。 */
	requiredValue?: boolean
	/** 与 TextNode.choicesValue 同构的 Choice 基础状态对象。 */
	choicesValue?: Record<string, ChoiceState>
	/** 与 MultipleTextNode.commands 同构的命令状态对象。 */
	commands?: Record<string, NodeCommandState>
	/** 仅 TurnState 使用、以 EventInstance id 为 key 的多选结果。 */
	selections?: Record<string, NodeSelection>
}

/**
 * EventConfig 的稀疏状态及事件实例对象。
 */
export interface EventState extends CommonState {
	/** 与 EventConfig.nodes 同构的节点状态对象。 */
	nodes?: Record<string, EventNodeState>
	/** 仅 RunState 使用、以 EventInstance id 为 key 的事件实例对象。 */
	instances?: Record<string, EventInstance>
	/** 仅 RunState 使用、引擎维护的当前活动 EventInstance id；无活动实例时省略。 */
	activeInstanceId?: string
}

/**
 * 与 GameConfig 对象树同构的稀疏状态。
 */
export interface GameState {
	/** 以 CharacterConfig id 为 key 的稀疏角色状态。 */
	characters: Record<string, CharacterState>
	/** 以 EffectConfig id 为 key 的稀疏 Effect 状态。 */
	effects: Record<string, EffectState>
	/** 以 EventConfig id 为 key 的稀疏 Event 状态。 */
	events: Record<string, EventState>
}

/**
 * 跨 RunData 保存的稀疏状态。
 */
export type ProfileState = GameState

/**
 * 当前 RunData 保存的稀疏状态。
 */
export type RunState = GameState

/**
 * TurnState 当前所处的阶段。
 */
export type TurnPhase = 'initializing' | 'turn_start' | 'event_handle' | 'turn_end'

/**
 * 当前回合保存的稀疏状态及回合字段。
 */
export interface TurnState extends GameState {
	/** 当前时间线的逻辑回合数。 */
	turnNumber: number
	/** 当前回合阶段。 */
	phase: TurnPhase
}

/**
 * CommonConfig 在运行时解析后的完整字段。
 */
export interface CommonRuntime {
	/** Config 对象 id。 */
	id: string
	/** 展示名称。 */
	displayName: string
	/** 分类标签。 */
	tags: string[]
	/** 可选说明文本。 */
	description?: string
	/** 随机判定、UI 展示与跨对象 Reaction 注册的稳定顺序。 */
	order: number
	/** 当前有效值所使用的 weight 基础值。 */
	weightValue: number
	/** 当前有效的随机判定权重或独立概率。 */
	weight: number
	/** 当前是否展示。 */
	visible: boolean
	/** 当前有效值所使用的解锁基础值。 */
	unlockedValue: boolean
	/** 当前有效的解锁状态。 */
	unlocked: boolean
	/** 当前有效值所使用的启用基础值。 */
	enabledValue: boolean
	/** 当前有效的启用状态。 */
	enabled: boolean
}

/**
 * 数值属性的完整运行时视图。
 */
export interface NumberAttributeRuntime extends CommonRuntime {
	/** 数值属性判别字段。 */
	type: 'number'
	/** 当前属性值。 */
	value: number
	/** 可选最小值。 */
	min?: number
	/** 可选最大值。 */
	max?: number
}

/**
 * 枚举属性的完整运行时视图。
 */
export interface EnumAttributeRuntime extends CommonRuntime {
	/** 枚举属性判别字段。 */
	type: 'enum'
	/** 当前枚举下标。 */
	value: number
	/** 枚举下标对应的展示文本。 */
	valueDisplay: string[]
}

/**
 * 所有属性运行时视图的联合类型。
 */
export type AttributeRuntime = NumberAttributeRuntime | EnumAttributeRuntime

/**
 * CharacterConfig 合并 State 后的完整运行时视图。
 */
export interface CharacterRuntime extends CommonRuntime {
	/** 以 AttributeConfig id 为 key 的属性运行时视图。 */
	attributes: Record<string, AttributeRuntime>
}

/**
 * EffectConfig 合并 State 后的完整运行时视图。
 */
export interface EffectRuntime extends CommonRuntime {
	/** 当前有效值所使用的获得基础值。 */
	acquiredValue: boolean
	/** 当前是否已获得。 */
	acquired: boolean
	/** 当前有效值所使用的激活基础值。 */
	activedValue: boolean
	/** 当前是否已激活。 */
	actived: boolean
	/** 是否允许玩家手动激活。 */
	manuallyActivatable: boolean
	/** 当前绑定的 CharacterConfig id。 */
	bindCharacterId?: string
	/** Effect 配置的 Reaction 列表。 */
	reactionList: Reaction[]
	/** 最近一次获得时的逻辑回合数。 */
	acquiredTurn?: number
	/** 最近一次激活时的逻辑回合数。 */
	activedTurn?: number
}

/**
 * SingleChoice 合并 State 后的完整运行时视图。
 */
export interface SingleChoiceRuntime extends CommonRuntime {
	/** 选择后执行的 Action。 */
	action: Action
}

/**
 * MultipleChoice 合并 State 后的完整运行时视图。
 */
export interface MultipleChoiceRuntime extends CommonRuntime {
	/** 提交给 Action 的配置值。 */
	value: Primitive
	/** 当前有效值所使用的最大数量基础值。 */
	maxCountValue?: number
	/** 当前允许选择的最大数量。 */
	maxCount?: number
}

/**
 * NodeCommand 合并 State 后的完整运行时视图。
 */
export interface NodeCommandRuntime extends CommonRuntime {
	/** 执行命令时调用的 Action。 */
	action: Action
}

/**
 * TextNode 的完整运行时公共字段。
 */
export interface TextNodeRuntimeBase extends CommonRuntime {
	/** 叙事内容。 */
	content: string
	/** 节点 Reaction 列表。 */
	reactionList?: Reaction[]
	/** 当前有效值所使用的回合门禁基础值。 */
	requiredValue?: boolean
	/** 当前是否阻止进入下一回合。 */
	required?: boolean
	/** 本回合以 EventInstance id 为 key 的多选结果。 */
	selections?: Record<string, NodeSelection>
}

/**
 * 单选 TextNode 的完整运行时视图。
 */
export interface SingleTextNodeRuntime extends TextNodeRuntimeBase {
	/** 单选节点判别字段。 */
	type: 'single'
	/** 当前有效选项使用的基础定义。 */
	choicesValue: Readonly<Record<string, SingleChoice>>
	/** 以 SingleChoice id 为 key 的当前有效选项。 */
	choices: Record<string, SingleChoiceRuntime>
}

/**
 * 多选 TextNode 的完整运行时视图。
 */
export interface MultipleTextNodeRuntime extends TextNodeRuntimeBase {
	/** 多选节点判别字段。 */
	type: 'multiple'
	/** 当前有效选项使用的基础定义。 */
	choicesValue: Readonly<Record<string, MultipleChoice>>
	/** 以 MultipleChoice id 为 key 的当前有效选项。 */
	choices: Record<string, MultipleChoiceRuntime>
	/** 以 NodeCommand id 为 key 的当前有效命令。 */
	commands: Record<string, NodeCommandRuntime>
}

/**
 * CheckNode 的完整运行时视图。
 */
export interface CheckNodeRuntime extends CommonRuntime {
	/** 检查节点判别字段。 */
	type: 'check'
	/** 以候选节点 id 为 key 的可达节点集合。 */
	candidateNodes: Record<NodeId, true>
	/** 进入节点时执行的 Action。 */
	check: Action
}

/**
 * EventNode 的完整运行时联合类型。
 */
export type EventNodeRuntime = SingleTextNodeRuntime | MultipleTextNodeRuntime | CheckNodeRuntime

/**
 * EventConfig 合并 State 后的完整运行时视图。
 */
export interface EventRuntime extends CommonRuntime {
	/** 事件入口节点 id。 */
	entryNodeId: NodeId
	/** 以 EventNode id 为 key 的当前有效节点。 */
	nodes: Record<NodeId, EventNodeRuntime>
	/** EventConfig 级 Reaction 列表。 */
	reactionList?: Reaction[]
	/** 以 EventInstance id 为 key 的当前事件实例。 */
	instances: Record<string, EventInstance>
	/** 当前活动 EventInstance id；无活动实例时省略。 */
	activeInstanceId?: string
}

/**
 * Config 与 State 合并后的完整游戏对象树。
 */
export interface GameRuntime {
	/** 游戏内容包元信息。 */
	meta: ConfigMeta
	/** 以 CharacterConfig id 为 key 的角色运行时视图。 */
	characters: Record<string, CharacterRuntime>
	/** 以 EffectConfig id 为 key 的 Effect 运行时视图。 */
	effects: Record<string, EffectRuntime>
	/** 以 EventConfig id 为 key 的 Event 运行时视图。 */
	events: Record<string, EventRuntime>
}

/**
 * 合并到 ProfileState 层级的运行时视图。
 */
export type ProfileRuntime = GameRuntime

/**
 * 合并到 RunState 层级的运行时视图。
 */
export type RunRuntime = GameRuntime

/**
 * 合并到 TurnState 层级的运行时视图。
 */
export interface TurnRuntime extends GameRuntime {
	/** 当前时间线的逻辑回合数。 */
	turnNumber: number
	/** 当前回合阶段。 */
	phase: TurnPhase
}

/**
 * Action 中可写的 CommonState 字段；Config 静态字段保持只读。
 */
export interface ActionCommonRuntime {
	readonly id: string
	readonly displayName: string
	readonly tags: readonly string[]
	readonly description?: string
	readonly order: number
	weightValue: number
	readonly weight: number
	visible: boolean
	unlockedValue: boolean
	readonly unlocked: boolean
	enabledValue: boolean
	readonly enabled: boolean
}

export interface ActionNumberAttributeRuntime extends ActionCommonRuntime {
	readonly type: 'number'
	value: number
	readonly min?: number
	readonly max?: number
}

export interface ActionEnumAttributeRuntime extends ActionCommonRuntime {
	readonly type: 'enum'
	value: number
	readonly valueDisplay: readonly string[]
}

export type ActionAttributeRuntime = ActionNumberAttributeRuntime | ActionEnumAttributeRuntime

export interface ActionCharacterRuntime extends ActionCommonRuntime {
	readonly attributes: Readonly<Record<string, ActionAttributeRuntime>>
}

export interface ActionEffectRuntime extends ActionCommonRuntime {
	acquiredValue: boolean
	readonly acquired: boolean
	activedValue: boolean
	readonly actived: boolean
	readonly manuallyActivatable: boolean
	bindCharacterId?: string
	readonly reactionList: DeepReadonly<Reaction[]>
	readonly acquiredTurn?: number
	readonly activedTurn?: number
}

export interface ActionSingleChoiceRuntime extends ActionCommonRuntime {
	readonly action: DeepReadonly<Action>
}

export interface ActionMultipleChoiceRuntime extends ActionCommonRuntime {
	readonly value: Primitive
	maxCountValue?: number
	readonly maxCount?: number
}

export interface ActionNodeCommandRuntime extends ActionCommonRuntime {
	readonly action: DeepReadonly<Action>
}

export interface ActionTextNodeRuntimeBase extends ActionCommonRuntime {
	readonly content: string
	readonly reactionList?: DeepReadonly<Reaction[]>
	requiredValue?: boolean
	readonly required?: boolean
	readonly selections?: DeepReadonly<Record<string, NodeSelection>>
}

export interface ActionSingleTextNodeRuntime extends ActionTextNodeRuntimeBase {
	readonly type: 'single'
	readonly choicesValue: Readonly<Record<string, SingleChoice>>
	readonly choices: Readonly<Record<string, ActionSingleChoiceRuntime>>
}

export interface ActionMultipleTextNodeRuntime extends ActionTextNodeRuntimeBase {
	readonly type: 'multiple'
	readonly choicesValue: Readonly<Record<string, MultipleChoice>>
	readonly choices: Readonly<Record<string, ActionMultipleChoiceRuntime>>
	readonly commands: Readonly<Record<string, ActionNodeCommandRuntime>>
}

export interface ActionCheckNodeRuntime extends ActionCommonRuntime {
	readonly type: 'check'
	readonly candidateNodes: Readonly<Record<NodeId, true>>
	readonly check: DeepReadonly<Action>
}

export type ActionEventNodeRuntime =
	| ActionSingleTextNodeRuntime
	| ActionMultipleTextNodeRuntime
	| ActionCheckNodeRuntime

/**
 * Action 可写的 EventInstance 视图。导航与终止状态可写，派生的历史和时间字段由引擎维护。
 */
export interface ActionEventInstanceRuntime {
	readonly instanceId: string
	readonly eventId: string
	status: EventInstance['status']
	currentNodeId: NodeId
	readonly nodePath: readonly NodeId[]
	readonly startedTurn: number
	readonly endedTurn?: number
}

export interface ActionEventRuntime extends ActionCommonRuntime {
	readonly entryNodeId: NodeId
	readonly nodes: Readonly<Record<NodeId, ActionEventNodeRuntime>>
	readonly reactionList?: DeepReadonly<Reaction[]>
	/** 以 EventInstance id 为 key 的只读事件实例。 */
	readonly instances: DeepReadonly<Record<string, EventInstance>>
	/** 引擎维护的当前活动 EventInstance id。 */
	readonly activeInstanceId?: string
}

/**
 * Action 经 RunState 使用的 EventRuntime；实例导航与终止状态可写。
 */
export interface ActionRunEventRuntime extends ActionEventRuntime {
	readonly instances: Readonly<Record<string, ActionEventInstanceRuntime>>
}

/**
 * Action 可写的游戏内容视图。集合结构、Config 字段和引擎派生字段只读。
 */
export interface ActionGameRuntime<
	TEventRuntime extends ActionEventRuntime = ActionEventRuntime,
> {
	readonly meta: DeepReadonly<ConfigMeta>
	readonly characters: Readonly<Record<string, ActionCharacterRuntime>>
	readonly effects: Readonly<Record<string, ActionEffectRuntime>>
	readonly events: Readonly<Record<string, TEventRuntime>>
}

export type ActionProfileRuntime = ActionGameRuntime
export type ActionRunRuntime = ActionGameRuntime<ActionRunEventRuntime>

/**
 * Action 使用的回合运行时视图。游戏内容字段可写，回合编号和阶段由引擎拥有。
 */
export interface ActionTurnRuntime extends ActionGameRuntime {
	readonly turnNumber: number
	readonly phase: TurnPhase
}

/**
 * Profile 中一个可恢复 TurnData 的引用。
 */
export interface TurnRef {
	/** 所属 RunData id。 */
	runId: string
	/** 所属 RunData 中的 TurnData id。 */
	turnId: string
}

/**
 * 一份用户存档容器。
 */
export interface Profile {
	/** 存档 id。 */
	profileId: string
	/** 玩家设置的可选存档显示名。 */
	label?: string
	/** 存档数据结构版本。 */
	stateVersion: number
	/** 对应 ConfigMeta.id。 */
	configId: string
	/** 对应 ConfigMeta.version。 */
	configVersion: string
	/** 存档创建时间。 */
	createdAt: Timestamp
	/** 存档最后更新时间。 */
	updatedAt: Timestamp
	/** 当前恢复游标对应的 ProfileState 工作状态。 */
	state: ProfileState
	/** 该存档包含的全部 RunData。 */
	runDatas: Record<string, RunData>
	/** 最后提交或由玩家选择继续的检查点。 */
	current: TurnRef
}

/**
 * RunData 生命周期状态。
 */
export type RunStatus = 'active' | 'ended' | 'abandoned'

/**
 * 新 RunData 的来源类型。
 */
export type RunOriginKind = 'branch' | 'restart'

/**
 * 新 RunData 的历史来源记录。
 */
export interface RunOrigin {
	/** 分支继续或重新开始。 */
	kind: RunOriginKind
	/** 来源检查点；branch 可来自 initial 或 turn_end，允许目标随后被删除。 */
	source: TurnRef
}

/**
 * 一条独立的局内时间线。
 */
export interface RunData {
	/** Profile 内唯一的 RunData id。 */
	runId: string
	/** 可选的时间线来源。 */
	origin?: RunOrigin
	/** 当前时间线状态。 */
	status: RunStatus
	/** 时间线创建时间。 */
	createdAt: Timestamp
	/** 时间线最后更新时间。 */
	updatedAt: Timestamp
	/** 时间线结束时间。 */
	endedAt?: Timestamp
	/** 当前 RunData 允许自动保留的 TurnData 数量。 */
	maxTurnCount: number
	/** 基于 currentTurnId 检查点创建的 PRNG 工作状态。 */
	randomState: RandomState
	/** 基于 currentTurnId 检查点创建的 RunState 工作状态。 */
	state: RunState
	/** 基于 currentTurnId 检查点创建的 TurnState 工作状态。 */
	turnState: TurnState
	/** 当前检查点 id。 */
	currentTurnId: string
	/** 按提交顺序排列的 TurnData id。 */
	turnOrder: string[]
	/** 通过 id 定位本时间线中的 TurnData。 */
	turnDatas: Record<string, TurnData>
}

/**
 * 一个 TurnData 保存的完整逻辑 State 与 PRNG 快照。
 */
export interface StateSnapshot {
	/** 检查点对应的 ProfileState。 */
	profileState: ProfileState
	/** 检查点对应的 RunState。 */
	runState: RunState
	/** 检查点对应的 TurnState。 */
	turnState: TurnState
	/** 检查点对应的 PRNG 状态。 */
	randomState: RandomState
}

/**
 * TurnData 检查点类型。
 */
export type CheckpointKind = 'initial' | 'turn_end' | 'terminal' | 'abandoned'

interface TurnDataBase {
	/** 所属 RunData 内唯一的检查点 id。 */
	turnId: string
	/** 检查点提交时间。 */
	createdAt: Timestamp
	/** 是否排除在自动清理之外。 */
	pinned: boolean
	/** 该检查点保存的完整逻辑 State 与 PRNG 状态。 */
	snapshot: StateSnapshot
}

/**
 * 稳定边界上的检查点。
 */
export type TurnData = TurnDataBase &
	(
		| {
				kind: Extract<CheckpointKind, 'terminal'>
				/** 首次 endRun 请求有关联节点时记录其 EventInstance id。 */
				endingEventInstanceId?: string
		  }
		| {
				kind: Exclude<CheckpointKind, 'terminal'>
				endingEventInstanceId?: never
		  }
	)

/**
 * 由注册名称索引的 Action 调用集合。
 */
export type ActionFunctions = Readonly<Record<string, (...args: Primitive[]) => void>>

/**
 * 由注册名称索引的 Rule 调用集合。
 */
export type RuleFunctions = Readonly<
	Record<string, <TResult = unknown>(...args: Primitive[]) => TResult>
>

/**
 * 引擎注入 Rule 的只读脚本上下文。
 */
export interface RuleContext {
	/** 只读的原始内容配置。 */
	readonly config: DeepReadonly<GameConfig>
	/** 合并到 ProfileState 的只读运行时视图。 */
	readonly profileState: DeepReadonly<ProfileRuntime>
	/** 合并到 RunState 的只读运行时视图。 */
	readonly runState: DeepReadonly<RunRuntime>
	/** 合并到 TurnState 的只读运行时视图。 */
	readonly turnState: DeepReadonly<TurnRuntime>
	/** 可供当前 Rule 调用的所有 Rule。 */
	readonly rule: RuleFunctions
}

/**
 * 引擎注入 Action 的事务脚本上下文。
 */
export interface ActionContext {
	/** 只读的原始内容配置。 */
	readonly config: DeepReadonly<GameConfig>
	/** 合并到 ProfileState 的事务内可写运行时视图。 */
	readonly profileState: ActionProfileRuntime
	/** 合并到 RunState 的事务内可写运行时视图。 */
	readonly runState: ActionRunRuntime
	/** 合并到 TurnState 的事务内视图；回合编号与阶段只读。 */
	readonly turnState: ActionTurnRuntime
	/** 绑定当前 RunData RandomState 的 PRNG 函数。 */
	readonly random: Random
	/** 可供当前 Action 调用的所有 Action。 */
	readonly action: ActionFunctions
	/** 可供当前 Action 调用的所有 Rule。 */
	readonly rule: RuleFunctions
	/** 请求在当前处理单元稳定后结束 RunData。 */
	readonly endRun: () => void
}

/**
 * Rule JavaScript 实现的纯计算函数。
 *
 * @template TResult Rule 返回值类型。
 */
export type RuleCalc<TResult = unknown> = (context: RuleContext, ...args: Primitive[]) => TResult

/**
 * 一个可注册的 Rule JavaScript 实现。
 *
 * @template TResult Rule 返回值类型。
 */
export interface RuleImplementation<TResult = unknown> {
	/** Rule 注册名称。 */
	key: string
	/** Rule 的只读计算函数。 */
	calc: RuleCalc<TResult>
}

/**
 * Rule 名称到只读 JavaScript 实现的注册表。
 */
export type RuleRegistry = Readonly<Record<string, RuleImplementation>>

/**
 * Action JavaScript 实现的执行函数；可以修改 State 或请求结束当前 RunData。
 */
export type ActionExec = (context: ActionContext, ...args: Primitive[]) => void

/**
 * 一个可注册的 Action JavaScript 实现。
 */
export interface ActionImplementation {
	/** Action 注册名称。 */
	key: string
	/** 修改 State 的执行函数。 */
	exec: ActionExec
}

/**
 * Action 名称到只读 JavaScript 实现的注册表。
 */
export type ActionRegistry = Readonly<Record<string, ActionImplementation>>
