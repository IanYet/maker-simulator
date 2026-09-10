import type {
	EventInstance,
	NodeId,
	Primitive,
	RunStatus,
	Timestamp,
	TurnPhase,
	CheckpointKind,
} from './model'
import type { CheckpointRef } from './saves'

/** RuntimeCommand 的拒绝原因。 */
export type CommandErrorCode =
	| 'busy'
	| 'invalid-phase'
	| 'not-found'
	| 'not-enabled'
	| 'stale-node'
	| 'blocked'
	| 'persistence-error'
	| 'script-error'

/** RuntimeCommand 的成功/失败结果及当前 Runtime revision。 */
export type CommandResult =
	| { ok: true; revision: number }
	| {
			ok: false
			errorId: string
			code: CommandErrorCode
			message: string
			revision: number
			/** 失败前是否已经提交了一个稳定检查点。 */
			committed: boolean
	  }

/** UI 属性面板使用的已解析属性。 */
export interface AttributeView {
	readonly attributeId: string
	readonly displayName: string
	readonly type: 'number' | 'enum'
	readonly value: number
	/** 枚举当前值对应的作者标签；数字格式由 UI 决定。 */
	readonly valueLabel?: string
	readonly min?: number
	readonly max?: number
}

/** 角色及其可见属性的只读数据。 */
export interface CharacterView {
	readonly characterId: string
	readonly displayName: string
	readonly attributes: readonly AttributeView[]
}

/** UI Effect 面板使用的已获得效果。 */
export interface EffectView {
	readonly effectId: string
	readonly displayName: string
	readonly description?: string
	readonly actived: boolean
	readonly manuallyActivatable: boolean
	readonly canActivate: boolean
	readonly bindCharacterId?: string
	readonly bindCharacterDisplayName?: string
}

/** UI 可启动事件卡片的最小视图。 */
export interface AvailableEvent {
	readonly eventId: string
	readonly displayName: string
	readonly description?: string
	/** 入口或 CheckNode 候选链可达 required TextNode 时为 true。 */
	readonly required: boolean
}

/** 阻止进入下一回合的结构化原因，由 UI 生成提示。 */
export type AdvanceTurnBlocker =
	| {
			readonly kind: 'pending-required-event'
			readonly eventId: string
	  }
	| {
			readonly kind: 'active-required-event'
			readonly eventId: string
			readonly eventInstanceId: string
	  }

/** active EventNode 的共同展示字段。 */
export interface EventNodeViewBase {
	readonly nodeId: NodeId
	readonly displayName: string
	readonly description?: string
	readonly content: string
	readonly required: boolean
}

/** 单选节点中的可用选项。 */
export interface SingleChoiceView {
	readonly choiceId: string
	readonly displayName: string
	readonly description?: string
	readonly enabled: boolean
}

/** 多选节点中的数量和值视图。 */
export interface MultipleChoiceView {
	readonly choiceId: string
	readonly displayName: string
	readonly description?: string
	readonly enabled: boolean
	readonly value: Primitive
	readonly count: number
	readonly maxCount?: number
}

/** 多选节点提交选择时可执行的命令。 */
export interface NodeCommandView {
	readonly commandId: string
	readonly displayName: string
	readonly description?: string
	readonly enabled: boolean
}

export interface SingleEventNodeView extends EventNodeViewBase {
	readonly type: 'single'
	readonly choices: readonly SingleChoiceView[]
}

export interface MultipleEventNodeView extends EventNodeViewBase {
	readonly type: 'multiple'
	readonly choices: readonly MultipleChoiceView[]
	readonly commands: readonly NodeCommandView[]
}

/** CheckNode 会在发布 snapshot 前自动处理，因此不会进入 UI read model。 */
export type EventNodeView = SingleEventNodeView | MultipleEventNodeView

/** 当前 Run 中仍处于 active 的事件实例。 */
export interface ActiveEventView {
	readonly eventId: string
	readonly eventInstanceId: string
	readonly displayName: string
	readonly status: Extract<EventInstance['status'], 'active'>
	readonly currentNodeId: NodeId
	readonly required: boolean
	readonly currentNode: Readonly<EventNodeView>
}

/** 终局请求有关联事件节点时保留的只读结果视图。 */
export interface EndingEventView {
	readonly eventId: string
	readonly eventInstanceId: string
	readonly displayName: string
	readonly status: EventInstance['status']
	readonly currentNodeId: NodeId
	readonly currentNode: Readonly<EventNodeView>
}

/** Runtime 只在稳定点发布的不可变 read model。 */
export interface GameSnapshotBase {
	readonly game: { readonly id: string; readonly version: string; readonly name: string }
	readonly profile: { readonly id: string; readonly label?: string }
	readonly checkpoint: CheckpointRef & { readonly kind: CheckpointKind }
	readonly revision: number
	readonly runId: string
	readonly turnNumber: number
	readonly phase: TurnPhase
	readonly characters: readonly CharacterView[]
	readonly effects: readonly EffectView[]
	readonly events: {
		readonly available: readonly AvailableEvent[]
		readonly active: readonly ActiveEventView[]
	}
	readonly canAdvanceTurn: boolean
	readonly advanceTurnBlockers: readonly AdvanceTurnBlocker[]
}

export type GameSnapshot = GameSnapshotBase &
	(
		| {
				readonly status: Extract<RunStatus, 'active'>
				readonly endedAt?: never
				readonly endingEvent?: never
		  }
		| {
				readonly status: Extract<RunStatus, 'ended'>
				readonly endedAt: Timestamp
				readonly endingEvent?: Readonly<EndingEventView>
		  }
		| {
				readonly status: Extract<RunStatus, 'abandoned'>
				readonly endedAt: Timestamp
				readonly endingEvent?: never
		  }
	)

/** 已打开游戏的公共能力；由 Runtime 直接实现，close 丢弃未提交工作。 */
export interface Game {
	/** 读取当前不可变快照；未发布时保持对象引用。 */
	getSnapshot(): GameSnapshot
	/** 订阅快照发布，返回取消订阅函数。 */
	subscribe(listener: () => void): () => void
	/** 启动可用事件。 */
	startEvent(eventId: string): Promise<CommandResult>
	/** 手动激活已获得效果。 */
	activateEffect(effectId: string): Promise<CommandResult>
	/** 执行当前节点的单选选项。 */
	chooseSingle(eventInstanceId: string, nodeId: string, choiceId: string): Promise<CommandResult>
	/** 更新参与规则计算的多选数量。 */
	setChoiceCount(
		eventInstanceId: string,
		nodeId: string,
		choiceId: string,
		count: number,
	): Promise<CommandResult>
	/** 执行当前多选节点命令。 */
	executeNodeCommand(
		eventInstanceId: string,
		nodeId: string,
		commandId: string,
	): Promise<CommandResult>
	/** 提交回合并运行到下一个输入点；部分提交失败可重试。 */
	advanceTurn(): Promise<CommandResult>
	/** 保存 abandoned 检查点并结束当前 Run。 */
	abandon(): Promise<CommandResult>
	/** 幂等关闭；已经开始的持久化单元完成后回收监控。 */
	close(): void
}
