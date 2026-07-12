import type {
	EventInstance,
	NodeId,
	Primitive,
	RunStatus,
	Timestamp,
	TurnPhase,
	TurnRef,
} from './model'

/** UI 到 GameplayRuntime 的权威命令协议。 */
export type RuntimeCommand =
	| { type: 'start-event'; eventId: string }
	| { type: 'activate-effect'; effectId: string }
	| {
			type: 'choose-single'
			eventInstanceId: string
			nodeId: string
			choiceId: string
	  }
	| {
			type: 'set-multiple-choice'
			eventInstanceId: string
			nodeId: string
			choiceId: string
			count: number
	  }
	| {
			type: 'execute-node-command'
			eventInstanceId: string
			nodeId: string
			commandId: string
	  }
	| { type: 'advance-turn' }

/** RuntimeCommand 的拒绝原因。 */
export type RuntimeCommandErrorCode =
	| 'busy'
	| 'invalid-phase'
	| 'not-found'
	| 'not-enabled'
	| 'stale-node'
	| 'blocked'
	| 'script-error'

/** RuntimeCommand 的成功/失败结果及当前 Runtime revision。 */
export type RuntimeCommandResult =
	| { ok: true; revision: number }
	| {
			ok: false
			code: RuntimeCommandErrorCode
			message: string
			revision: number
	  }

/** Session 门面额外包装的应用层错误原因。 */
export type SessionCommandErrorCode =
	| RuntimeCommandErrorCode
	| 'persistence-error'
	| 'confirmation-required'
	| 'not-active'
	| 'incompatible-save'

/** Session 命令结果；revision 仅用于 UI 观察状态变化。 */
export type SessionCommandResult =
	| { ok: true; revision: number }
	| {
			ok: false
			code: SessionCommandErrorCode
			message: string
			revision: number
	  }

/** UI 属性面板使用的已解析属性。 */
export interface AttributeView {
	readonly characterId: string
	readonly characterDisplayName: string
	readonly attributeId: string
	readonly displayName: string
	readonly type: 'number' | 'enum'
	readonly value: number
	readonly displayValue: string
	readonly min?: number
	readonly max?: number
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
export interface EventCardView {
	readonly eventId: string
	readonly displayName: string
	readonly description?: string
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

/** GameplayRuntime 只在稳定点发布的不可变 read model。 */
export interface RuntimeSnapshotBase {
	readonly revision: number
	readonly runId: string
	readonly turnNumber: number
	readonly phase: TurnPhase
	readonly attributes: readonly AttributeView[]
	readonly effects: readonly EffectView[]
	readonly eventCards: readonly EventCardView[]
	readonly activeEvents: readonly ActiveEventView[]
	readonly canAdvanceTurn: boolean
	readonly advanceTurnBlockers: readonly string[]
}

export type RuntimeSnapshot = RuntimeSnapshotBase &
	(
		| {
				readonly runStatus: Extract<RunStatus, 'active'>
				readonly endedAt?: never
				readonly endingEvent?: never
		  }
		| {
				readonly runStatus: Extract<RunStatus, 'ended'>
				readonly endedAt: Timestamp
				readonly endingEvent?: Readonly<EndingEventView>
		  }
		| {
				readonly runStatus: Extract<RunStatus, 'abandoned'>
				readonly endedAt: Timestamp
				readonly endingEvent?: never
		  }
	)

/** Runtime 对外公开的状态、命令和生命周期接口。 */
export interface GameplayRuntime {
	/** 执行一条玩家或宿主命令。 */
	dispatch(command: RuntimeCommand): Promise<RuntimeCommandResult>
	/** 订阅稳定快照发布。 */
	subscribe(listener: () => void): () => void
	/** 读取当前不可变 UI read model。 */
	getSnapshot(): RuntimeSnapshot
}

/** GameSession 合并稳定运行时视图与应用级瞬时状态。 */
export interface SessionView {
	readonly gameId: string
	readonly gameVersion: string
	readonly gameName: string
	readonly profileId: string
	readonly profileLabel?: string
	readonly runtime: RuntimeSnapshot
	readonly busy: boolean
	readonly focusedEventInstanceId?: string
}

/** React/UI 使用的 facade；camelCase 方法只转换为 RuntimeCommand 或应用命令。 */
export interface GameSession {
	/** 订阅 SessionView。 */
	subscribe(listener: () => void): () => void
	/** 读取当前 SessionView。 */
	getView(): SessionView
	/** 只更新应用级 UI focus；省略参数表示清除聚焦。 */
	focusEvent(eventInstanceId?: string): void
	/** 启动事件卡片。 */
	startEvent(eventId: string): Promise<SessionCommandResult>
	/** 手动激活一个已获得的 Effect。 */
	activateEffect(effectId: string): Promise<SessionCommandResult>
	/** 提交单选节点选项。 */
	chooseSingle(
		eventInstanceId: string,
		nodeId: string,
		choiceId: string,
	): Promise<SessionCommandResult>
	/** 更新多选节点的选择数量。 */
	updateSelection(
		eventInstanceId: string,
		nodeId: string,
		choiceId: string,
		count: number,
	): Promise<SessionCommandResult>
	/** 执行多选节点命令。 */
	executeNodeCommand(
		eventInstanceId: string,
		nodeId: string,
		commandId: string,
	): Promise<SessionCommandResult>
	/** 通过回合门禁并进入下一回合。 */
	advanceTurn(): Promise<SessionCommandResult>
	/** 保存并离开当前游玩页。 */
	exitAndSave(): Promise<SessionCommandResult>
	/** 放弃当前 Run 并离开游玩页。 */
	abandonAndExit(): Promise<SessionCommandResult>
	/** 打开存档浏览器。 */
	openSaveBrowser(): Promise<SessionCommandResult>
	/** 从终局/放弃记录重新开始。 */
	restartRun(): Promise<SessionCommandResult>
}

/** 存档树中会改变恢复游标或元数据的应用命令。 */
export type SaveCommand =
	| { type: 'continue-checkpoint'; source: TurnRef }
	| { type: 'create-branch'; source: TurnRef }
	| { type: 'truncate-and-continue'; source: TurnRef }
	| { type: 'set-checkpoint-pinned'; source: TurnRef; pinned: boolean }

export interface SaveBrowserController {
	/** 执行继续、分支、截断或 pin 操作。 */
	dispatch(command: SaveCommand): Promise<SessionCommandResult>
}
