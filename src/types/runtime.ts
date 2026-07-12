import type { NodeId, RunStatus, Timestamp, TurnPhase, TurnRef } from './model'

/** UI 到 GameplayRuntime 的权威命令协议。 */
export type RuntimeCommand =
	| { type: 'start-event'; eventId: string }
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

export type RuntimeCommandErrorCode =
	| 'busy'
	| 'invalid-phase'
	| 'not-found'
	| 'not-enabled'
	| 'stale-node'
	| 'blocked'
	| 'script-error'

export type RuntimeCommandResult =
	| { ok: true; revision: number }
	| {
			ok: false
			code: RuntimeCommandErrorCode
			message: string
			revision: number
	  }

export type SessionCommandErrorCode =
	| RuntimeCommandErrorCode
	| 'persistence-error'
	| 'confirmation-required'
	| 'not-active'
	| 'incompatible-save'

export type SessionCommandResult =
	| { ok: true; revision: number }
	| {
			ok: false
			code: SessionCommandErrorCode
			message: string
			revision: number
	  }

export interface AttributeView {
	readonly characterId: string
	readonly attributeId: string
	readonly displayName: string
	readonly type: 'number' | 'enum'
	readonly value: number
	readonly displayValue: string
	readonly min?: number
	readonly max?: number
}

export interface EffectView {
	readonly effectId: string
	readonly displayName: string
	readonly description?: string
	readonly actived: boolean
	readonly bindCharacterId?: string
}

export interface EventCardView {
	readonly eventId: string
	readonly displayName: string
	readonly description?: string
}

export interface ActiveEventView {
	readonly eventId: string
	readonly eventInstanceId: string
	readonly displayName: string
	readonly currentNodeId: NodeId
	readonly required: boolean
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
				readonly ending?: never
		  }
		| {
				readonly runStatus: Extract<RunStatus, 'ended'>
				readonly endedAt: Timestamp
				readonly endingEvent: Readonly<ActiveEventView>
		  }
		| {
				readonly runStatus: Extract<RunStatus, 'abandoned'>
				readonly endedAt: Timestamp
				readonly ending?: never
		  }
	)

export interface GameplayRuntime {
	dispatch(command: RuntimeCommand): Promise<RuntimeCommandResult>
	subscribe(listener: () => void): () => void
	getSnapshot(): RuntimeSnapshot
}

/** GameSession 合并稳定运行时视图与应用级瞬时状态。 */
export interface SessionView {
	readonly gameId: string
	readonly gameVersion: string
	readonly profileId: string
	readonly runtime: RuntimeSnapshot
	readonly busy: boolean
	readonly focusedEventInstanceId?: string
}

/** React/UI 使用的 facade；camelCase 方法只转换为 RuntimeCommand 或应用命令。 */
export interface GameSession {
	subscribe(listener: () => void): () => void
	getView(): SessionView
	startEvent(eventId: string): Promise<SessionCommandResult>
	chooseSingle(
		eventInstanceId: string,
		nodeId: string,
		choiceId: string,
	): Promise<SessionCommandResult>
	updateSelection(
		eventInstanceId: string,
		nodeId: string,
		choiceId: string,
		count: number,
	): Promise<SessionCommandResult>
	executeNodeCommand(
		eventInstanceId: string,
		nodeId: string,
		commandId: string,
	): Promise<SessionCommandResult>
	advanceTurn(): Promise<SessionCommandResult>
	exitAndSave(): Promise<SessionCommandResult>
	abandonAndExit(): Promise<SessionCommandResult>
	openSaveBrowser(): Promise<SessionCommandResult>
	restartRun(): Promise<SessionCommandResult>
}

/** 存档树中会改变恢复游标或元数据的应用命令。 */
export type SaveCommand =
	| { type: 'continue-checkpoint'; source: TurnRef }
	| { type: 'create-branch'; source: TurnRef }
	| { type: 'truncate-and-continue'; source: TurnRef }
	| { type: 'set-checkpoint-pinned'; source: TurnRef; pinned: boolean }

export interface SaveBrowserController {
	dispatch(command: SaveCommand): Promise<SessionCommandResult>
}
