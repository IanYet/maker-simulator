import { createDraft, current, finishDraft, type Draft } from 'immer'
import type {
	Action,
	ActionContext,
	ActionFunctions,
	ActionProfileRuntime,
	ActionRunRuntime,
	ActionTurnRuntime,
	CheckpointKind,
	DeepReadonly,
	EventInstance,
	GameConfig,
	GameplayRuntime,
	LoadedGamePackage,
	Primitive,
	ProfileRuntime,
	Rule,
	RuleContext,
	RuleFunctions,
	RunData,
	RunRuntime,
	RuntimeCommand,
	RuntimeCommandResult,
	RuntimeSnapshot,
	StateSnapshot,
	StoredProfile,
	TurnData,
	TurnPhase,
	TurnRef,
	TurnRuntime,
} from '../types'
import { validateProfileAgainstConfig, type SaveRepository } from '../persistence'
import { deepFreeze, stableArgs } from '../package-loader/linker'
import {
	asRuntimeFailure,
	errorMessage,
	RuntimeFailure,
	runtimeFailureResult,
	ScriptExecutionError,
} from './errors'
import { nextRandom } from './random'
import {
	collectReactionDefinitions,
	type ReactionDefinition,
} from './reactions'
import { projectRuntimeSnapshot } from './selectors'
import { createRuntimeView, readPath } from './state-view'
import {
	argsTraceDetail,
	commandTraceDetail,
	type RuntimeMonitor,
	type RuntimeMonitorFactory,
	type RuntimeTraceKind,
} from './monitor'
import { NoopRuntimeMonitor } from './monitor'

const ACTION_LIMIT = 512
const RULE_EXECUTION_LIMIT = 4096
const CHECK_LIMIT = 128

interface RuleStat {
	count: number
	durationMs: number
	maxMs: number
}

interface LifecycleWrite {
	path: readonly string[]
	property: 'currentNodeId' | 'status'
	previous: unknown
	next: unknown
}

interface ActionFrame {
	key: string
	sourceEventInstanceId?: string
	allowedCandidates?: ReadonlySet<string>
	writes: LifecycleWrite[]
}

interface ReactionTask {
	definition: ReactionDefinition
}

/** Runtime 内存中的稳定存档与当前回合工作状态。 */
interface RuntimeState {
	profile: StoredProfile
	working: StateSnapshot
}

interface Unit {
	id: string
	name: string
	parentTraceId?: string
	draft: Draft<RuntimeState>
	profile: Draft<StoredProfile>
	run: Draft<RunData>
	working: Draft<StateSnapshot>
	baselines: Map<string, Primitive>
	ruleStack: string[]
	actionStack: ActionFrame[]
	ruleCount: number
	actionCount: number
	checkCount: number
	ruleStats: Map<string, RuleStat>
	pendingEnd?: { sourceEventInstanceId?: string }
	persist: boolean
	effectValues: Map<string, { acquired: boolean; actived: boolean }>
	finished: boolean
	traceRunId: string
	traceTurnNumber: number
	tracePhase: TurnPhase
}


const now = (): string => new Date().toISOString()
const createId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`
function isPrimitive(value: unknown): value is Primitive {
	return value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean' ||
		(typeof value === 'number' && Number.isFinite(value))
}

function freezeSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
	return deepFreeze(snapshot)
}

/** 克隆目标检查点，并按其 kind 投影当时的 Run 生命周期供恢复或只读预览。 */
function stateFromCheckpoint(profile: StoredProfile, source: TurnRef = profile.current): RuntimeState {
	const run = profile.runDatas[source.runId]
	const turn = run?.turnDatas[source.turnId]
	if (!run || !turn) throw new Error('The current checkpoint is missing')
	const stored = structuredClone(profile)
	stored.current = { ...source }
	const projectedRun = stored.runDatas[source.runId]
	projectedRun.currentTurnId = source.turnId
	if (turn.kind === 'terminal') {
		projectedRun.status = 'ended'
		projectedRun.endedAt = turn.createdAt
	} else if (turn.kind === 'abandoned') {
		projectedRun.status = 'abandoned'
		projectedRun.endedAt = turn.createdAt
	} else {
		projectedRun.status = 'active'
		delete projectedRun.endedAt
	}
	return {
		profile: stored,
		working: structuredClone(turn.snapshot),
	}
}

/**
 * 游戏回合运行时的唯一状态变更入口。
 *
 * Runtime 以 Immer draft 执行一个完整处理单元，统一协调命令、Action、Rule、Reaction、
 * CheckNode、随机游标、回合阶段和检查点；处理单元失败时不会发布部分 State。
 */
export class GameplayRuntimeImpl implements GameplayRuntime {
	readonly #listeners = new Set<() => void>()
	#state: RuntimeState
	#snapshot: RuntimeSnapshot
	#revision = 0
	#busy = false
	#disposed = false
	#unitCounter = 0
	#commandCounter = 0
	#traceCounter = 0
	#activeCommandTraceId?: string
	#baselines = new Map<string, Primitive>()
	readonly #monitor: RuntimeMonitor
	readonly game: LoadedGamePackage
	private readonly saves?: SaveRepository

	private constructor(
		game: LoadedGamePackage,
		profile: StoredProfile,
		saves?: SaveRepository,
		monitor: RuntimeMonitor = new NoopRuntimeMonitor(),
		source: TurnRef = profile.current,
	) {
		this.game = game
		this.saves = saves
		if (
			profile.configId !== game.config.meta.id ||
			profile.configVersion !== game.config.meta.version
		) {
			throw new Error('The save and game package versions do not match')
		}
		const validatedProfile = validateProfileAgainstConfig(profile, game.config)
		this.#state = stateFromCheckpoint(validatedProfile, source)
		this.#monitor = monitor
		this.initializeReactionBaselines()
		this.#snapshot = this.selectSnapshot(this.#state, this.#baselines, this.#revision)
	}

	/** 从已有稳定存档的当前检查点恢复 Runtime。 */
	static async open(
		game: LoadedGamePackage,
		profile: StoredProfile,
		saves: SaveRepository,
		monitorFactory?: RuntimeMonitorFactory
	): Promise<GameplayRuntimeImpl> {
		const monitor = monitorFactory?.(profile.current.runId) ?? new NoopRuntimeMonitor()
		let runtime: GameplayRuntimeImpl | undefined
		try {
			runtime = new GameplayRuntimeImpl(game, profile, saves, monitor)
			await runtime.beginFromCheckpoint()
			return runtime
		} catch (error) {
			if (runtime) runtime.dispose()
			else {
				try {
					monitor.finish()
				} catch {
					// 构造失败时监控回收异常不能遮蔽原始错误。
				}
			}
			throw error
		}
	}

	/** 从任意保留检查点构造只读 RuntimeSnapshot，不启动状态机或写入存档。 */
	static projectCheckpoint(
		game: LoadedGamePackage,
		profile: StoredProfile,
		source: TurnRef,
	): RuntimeSnapshot {
		const runtime = new GameplayRuntimeImpl(
			game,
			profile,
			undefined,
			new NoopRuntimeMonitor(),
			source,
		)
		try {
			return runtime.getSnapshot()
		} finally {
			runtime.dispose()
		}
	}

	/** 串行执行一条 RuntimeCommand；并发命令会返回 busy。 */
	dispatch(command: RuntimeCommand): Promise<RuntimeCommandResult> {
		if (this.#disposed) {
			return Promise.resolve(runtimeFailureResult(
				new RuntimeFailure('not-found', 'This runtime has been closed'),
				this.#revision,
			))
		}
		if (this.#busy) {
			return Promise.resolve(runtimeFailureResult(
				new RuntimeFailure('busy', 'Another command is still running'),
				this.#revision,
			))
		}
		this.#busy = true
		return this.executeCommand(command).finally(() => {
			this.#busy = false
		})
	}

	/** 订阅稳定 RuntimeSnapshot 发布；返回取消订阅函数。 */
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener)
		return () => this.#listeners.delete(listener)
	}

	/** 返回当前不可变的 UI read model。 */
	getSnapshot(): RuntimeSnapshot {
		return this.#snapshot
	}

	/** 返回当前稳定存档的深拷贝；未提交工作状态不会包含在内。 */
	getStoredProfile(): StoredProfile {
		return structuredClone(this.#state.profile)
	}

	/** 返回当前稳定检查点引用。 */
	getCurrentCheckpoint(): TurnRef {
		return { ...this.#state.profile.current }
	}

	/** 将当前 active Run 写入 abandoned 检查点，并结束本条时间线。 */
	async abandon(): Promise<RuntimeCommandResult> {
		if (this.currentRun().status !== 'active') {
			return runtimeFailureResult(
				new RuntimeFailure('invalid-phase', 'Only an active run can be abandoned'),
				this.#revision,
			)
		}
		try {
			await this.runUnit(
				'abandon',
				(unit) => {
					this.appendCheckpoint(unit, 'abandoned')
					unit.baselines.clear()
					unit.persist = true
				},
				true
			)
			return { ok: true, revision: this.#revision }
		} catch (error) {
			return runtimeFailureResult(asRuntimeFailure(error), this.#revision)
		}
	}

	/** 停止发布快照并输出监控摘要；不会删除 IndexedDB 中已有存档。 */
	dispose(): void {
		if (this.#disposed) return
		this.#disposed = true
		this.#listeners.clear()
		try {
			this.#monitor.finish()
		} catch {
			// 监控回收异常不能影响 Session 销毁或覆盖原始错误。
		}
	}

	private async executeCommand(command: RuntimeCommand): Promise<RuntimeCommandResult> {
		const started = performance.now()
		const commandTraceId = `command-${++this.#commandCounter}`
		const previousCommandTraceId = this.#activeCommandTraceId
		this.trace(
			'command-start',
			command.type,
			0,
			'ok',
			0,
			undefined,
			this.commandTraceDetail(command),
			{ traceId: commandTraceId }
		)
		this.#activeCommandTraceId = commandTraceId
		let outcome: 'ok' | 'error' = 'ok'
		let traceFailure: RuntimeFailure | undefined
		try {
			switch (command.type) {
				case 'start-event':
					await this.startEvent(command.eventId)
					break
				case 'activate-effect':
					await this.activateEffect(command.effectId)
					break
				case 'choose-single':
					await this.chooseSingle(
						command.eventInstanceId,
						command.nodeId,
						command.choiceId
					)
					break
				case 'set-multiple-choice':
					await this.setMultipleChoice(
						command.eventInstanceId,
						command.nodeId,
						command.choiceId,
						command.count
					)
					break
				case 'execute-node-command':
					await this.executeNodeCommand(
						command.eventInstanceId,
						command.nodeId,
						command.commandId
					)
					break
				case 'advance-turn':
					await this.advanceTurn()
					break
			}
			return { ok: true, revision: this.#revision }
		} catch (error) {
			outcome = 'error'
			traceFailure = asRuntimeFailure(error)
			return runtimeFailureResult(traceFailure, this.#revision)
		} finally {
			this.trace(
				'command-end',
				command.type,
				performance.now() - started,
				outcome,
				0,
				undefined,
				{
					...this.commandTraceDetail(command),
					...(traceFailure
						? {
							errorId: traceFailure.errorId,
							code: traceFailure.code,
							callChain: JSON.stringify(traceFailure.callChain),
							...(traceFailure.jsonPointer
								? { jsonPointer: traceFailure.jsonPointer }
								: {}),
						}
						: {}),
				},
				{ parentId: commandTraceId }
			)
			this.#activeCommandTraceId = previousCommandTraceId
		}
	}

	private commandTraceDetail(command: RuntimeCommand): Readonly<Record<string, Primitive>> {
		try {
			return this.commandTraceDetailUnsafe(command)
		} catch {
			// 监控详情失败时回退到基础字段，不能改变命令结果。
			return commandTraceDetail(command)
		}
	}

	private commandTraceDetailUnsafe(command: RuntimeCommand): Readonly<Record<string, Primitive>> {
		const detail = commandTraceDetail(command)
		if (
			command.type !== 'choose-single' &&
			command.type !== 'set-multiple-choice' &&
			command.type !== 'execute-node-command'
		) {
			return detail
		}

		const eventId = Object.entries(this.#state.working.runState.events).find(
			([, state]) => state.instances?.[command.eventInstanceId]
		)?.[0]
		const event = eventId ? this.game.config.events[eventId] : undefined
		const node = event?.nodes[command.nodeId]
		if (!node || node.type === 'check') return detail

		if (command.type === 'choose-single') {
			if (node.type !== 'single') return detail
			const authoredChoices = node.choicesValue
			const choice = Object.values(authoredChoices).find(
				(item) => item.id === command.choiceId
			)
			return choice ? { ...detail, actionKey: choice.action.key } : detail
		}
		if (command.type === 'set-multiple-choice') {
			if (node.type !== 'multiple') return detail
			const authoredChoices = node.choicesValue
			const choice = Object.values(authoredChoices).find(
				(item) => item.id === command.choiceId
			)
			return choice ? { ...detail, value: choice.value } : detail
		}
		const authoredCommand =
			node.type === 'multiple' ? node.commands[command.commandId] : undefined
		return authoredCommand ? { ...detail, actionKey: authoredCommand.action.key } : detail
	}

	private async startEvent(eventId: string): Promise<void> {
		this.requireInputPhase()
		await this.runUnit(`start-event:${eventId}`, (unit) => {
			const runtime = this.turnView(unit)
			const event = runtime.events[eventId]
			if (!event) throw new RuntimeFailure('not-found', 'The event does not exist')
			if (!event.visible || !event.unlocked || !event.enabled) {
				throw new RuntimeFailure('not-enabled', 'The event is not currently available')
			}
			if (event.activeInstanceId)
				throw new RuntimeFailure('not-enabled', 'The event is already active')
			if (
				Object.values(event.instances).some(
					(instance) => instance.startedTurn === unit.working.turnState.turnNumber
				)
			) {
				throw new RuntimeFailure('not-enabled', 'This event has already started this turn')
			}
			const instanceId = createId('event')
			const instance: EventInstance = {
				instanceId,
				eventId,
				status: 'active',
				currentNodeId: event.entryNodeId,
				nodePath: [event.entryNodeId],
				startedTurn: unit.working.turnState.turnNumber,
			}
			const eventState = (unit.working.runState.events[eventId] ??= { id: eventId })
			;(eventState.instances ??= {})[instanceId] = instance
			eventState.activeInstanceId = instanceId
			const entry = this.game.config.events[eventId].nodes[event.entryNodeId]
			if (entry.type === 'check') this.runCheck(unit, instanceId, entry.id)
		})
	}

	/**
	 * 在当前回合直接激活已获得且声明支持手动激活的 Effect。
	 * 状态写入与随后触发的 Effect Reaction 共用同一处理单元；任一 Reaction
	 * 失败时，激活状态和其它写入一起回滚。
	 */
	private async activateEffect(effectId: string): Promise<void> {
		this.requireInputPhase()
		await this.runUnit(`activate-effect:${effectId}`, (unit) => {
			const config = this.game.config.effects[effectId]
			const effect = this.runView(unit).effects[effectId]
			if (!config || !effect) throw new RuntimeFailure('not-found', 'The Effect does not exist')
			if (!config.manuallyActivatable)
				throw new RuntimeFailure('not-enabled', 'The Effect cannot be activated manually')
			if (!effect.visible || !effect.unlocked || !effect.enabled)
				throw new RuntimeFailure('not-enabled', 'The Effect is not currently available')
			if (!effect.acquired)
				throw new RuntimeFailure('not-enabled', 'The Effect has not been acquired')
			if (effect.actived)
				throw new RuntimeFailure('not-enabled', 'The Effect is already active')
			this.runView(unit, true).effects[effectId].activedValue = true
		})
	}

	private async chooseSingle(
		instanceId: string,
		nodeId: string,
		choiceId: string
	): Promise<void> {
		this.requireInputPhase()
		await this.runUnit(`choose-single:${choiceId}`, (unit) => {
			const { instance, eventId } = this.requireCurrentInstance(unit, instanceId, nodeId)
			const node = this.turnView(unit).events[eventId].nodes[nodeId]
			if (node.type !== 'single')
				throw new RuntimeFailure(
					'stale-node',
					'The current node is not a single-choice node'
				)
			const choice = node.choices[choiceId]
			if (!choice) throw new RuntimeFailure('not-found', 'The choice does not exist')
			if (!choice.visible || !choice.unlocked || !choice.enabled)
				throw new RuntimeFailure('not-enabled', 'The choice is disabled')
			this.runAction(unit, choice.action, instance.instanceId)
		})
	}

	private async setMultipleChoice(
		instanceId: string,
		nodeId: string,
		choiceId: string,
		count: number
	): Promise<void> {
		this.requireInputPhase()
		if (!Number.isInteger(count) || count < 0)
			throw new RuntimeFailure(
				'not-enabled',
				'Selection count must be a non-negative integer'
			)
		await this.runUnit(`set-multiple-choice:${choiceId}`, (unit) => {
			const { instance, eventId } = this.requireCurrentInstance(unit, instanceId, nodeId)
			const node = this.turnView(unit).events[eventId].nodes[nodeId]
			if (node.type !== 'multiple')
				throw new RuntimeFailure(
					'stale-node',
					'The current node is not a multiple-choice node'
				)
			const choice = node.choices[choiceId]
			if (!choice) throw new RuntimeFailure('not-found', 'The choice does not exist')
			if (!choice.visible || !choice.unlocked || !choice.enabled)
				throw new RuntimeFailure('not-enabled', 'The choice is disabled')
			if (choice.maxCount !== undefined && count > choice.maxCount)
				throw new RuntimeFailure('not-enabled', `The maximum count is ${choice.maxCount}`)
			const eventState = (unit.working.turnState.events[eventId] ??= { id: eventId })
			const nodeState = ((eventState.nodes ??= {})[nodeId] ??= { id: nodeId })
			const selections = (nodeState.selections ??= {})
			const selection = (selections[instance.instanceId] ??= {
				eventInstanceId: instance.instanceId,
				choices: {},
			})
			if (count === 0) delete selection.choices[choiceId]
			else selection.choices[choiceId] = { id: choiceId, value: choice.value, count }
		})
	}

	private async executeNodeCommand(
		instanceId: string,
		nodeId: string,
		commandId: string
	): Promise<void> {
		this.requireInputPhase()
		await this.runUnit(`execute-node-command:${commandId}`, (unit) => {
			const { instance, eventId } = this.requireCurrentInstance(unit, instanceId, nodeId)
			const node = this.turnView(unit).events[eventId].nodes[nodeId]
			if (node.type !== 'multiple')
				throw new RuntimeFailure('stale-node', 'The current node has no commands')
			const command = node.commands[commandId]
			if (!command) throw new RuntimeFailure('not-found', 'The command does not exist')
			if (!command.visible || !command.unlocked || !command.enabled)
				throw new RuntimeFailure('not-enabled', 'The command is disabled')
			this.runAction(unit, command.action, instance.instanceId)
			this.clearSelection(unit, eventId, nodeId, instance.instanceId)
		})
	}

	private async advanceTurn(): Promise<void> {
		const run = this.currentRun()
		const phase = this.#state.working.turnState.phase
		if (run.status === 'active' && (phase === 'initializing' || phase === 'turn_end')) {
			await this.beginNextTurn()
			return
		}
		this.requireInputPhase()
		const blockers = this.computeBlockers()
		if (blockers.length > 0) {
			throw new RuntimeFailure('blocked', blockers.map((blocker) => blocker.message).join('；'))
		}

		await this.runUnit(
			'turn-end',
			(unit) => {
				unit.working.turnState.phase = 'turn_end'
				this.trace('transition', 'turn_end', 0, 'ok', 0, unit)
				this.stabilize(unit)
				if (!unit.pendingEnd) {
					this.appendCheckpoint(unit, 'turn_end')
					unit.persist = true
				}
			},
			true,
			false
		)
		if (this.currentRun().status === 'active') {
			try {
				await this.beginNextTurn()
			} catch (error) {
				// turn_end 已经是新的持久化边界；失败时发布它并允许再次执行 advance-turn。
				this.notify()
				throw asRuntimeFailure(error, true)
			}
		}
	}

	private async beginFromCheckpoint(): Promise<void> {
		const run = this.currentRun()
		const turn = run.turnDatas[run.currentTurnId]
		if (run.status === 'active' && (turn.kind === 'initial' || turn.kind === 'turn_end')) {
			await this.beginNextTurn()
		}
	}

	private async beginNextTurn(): Promise<void> {
		await this.runUnit('turn-start', (unit) => {
			this.clearAllSelections(unit)
			unit.working.turnState.turnNumber += 1
			unit.working.turnState.phase = 'turn_start'
			this.trace('transition', 'turn_start', 0, 'ok', 0, unit)
			this.stabilize(unit)
			if (!unit.pendingEnd) {
				unit.working.turnState.phase = 'event_handle'
				this.trace('transition', 'event_handle', 0, 'ok', 0, unit)
				this.stabilize(unit)
			}
		})
	}

	private requireInputPhase(): void {
		const run = this.currentRun()
		if (run.status !== 'active' || this.#state.working.turnState.phase !== 'event_handle') {
			throw new RuntimeFailure(
				'invalid-phase',
				'This command is only available while handling events'
			)
		}
	}

	private requireCurrentInstance(
		unit: Unit,
		instanceId: string,
		nodeId: string
	): { eventId: string; instance: Draft<EventInstance> } {
		for (const [eventId, eventState] of Object.entries(unit.working.runState.events)) {
			const instance = eventState.instances?.[instanceId]
			if (!instance) continue
			if (
				instance.status !== 'active' ||
				eventState.activeInstanceId !== instanceId ||
				instance.currentNodeId !== nodeId
			) {
				throw new RuntimeFailure('stale-node', 'The event node has changed')
			}
			return { eventId, instance }
		}
		throw new RuntimeFailure('not-found', 'The event instance does not exist')
	}

	private createUnit(
		name: string,
		source: RuntimeState = this.#state,
		baselines: ReadonlyMap<string, Primitive> = this.#baselines,
	): Unit {
		const draft = createDraft(source)
		const profile = draft.profile
		const working = draft.working
		const run = profile.runDatas[profile.current.runId]
		if (!run) {
			finishDraft(draft)
			throw new Error('The current RunData is missing')
		}
		return {
			id: `u-${++this.#unitCounter}`,
			name,
			...(this.#activeCommandTraceId
				? { parentTraceId: this.#activeCommandTraceId }
				: {}),
			draft,
			profile,
			run,
			working,
			baselines: new Map(baselines),
			ruleStack: [],
			actionStack: [],
			ruleCount: 0,
			actionCount: 0,
			checkCount: 0,
			ruleStats: new Map(),
			persist: false,
			effectValues: new Map(),
			finished: false,
			traceRunId: run.runId,
			traceTurnNumber: working.turnState.turnNumber,
			tracePhase: working.turnState.phase,
		}
	}

	/**
	 * 在临时 draft 中执行一个处理单元，并按需要持久化/发布结果。
	 * `allowHostTerminal` 控制终局请求是否允许在本次宿主操作中提交。
	 */
	private async runUnit(
		name: string,
		operation: (unit: Unit) => void,
		allowHostTerminal = true,
		publish = true
	): Promise<void> {
		const unit = this.createUnit(name)
		const started = performance.now()
		let finished = false
		try {
			this.captureEffectValues(unit)
			operation(unit)
			this.stabilize(unit)
			if (unit.pendingEnd) {
				if (!allowHostTerminal)
					throw new Error('A terminal request is not allowed in this unit')
				this.appendCheckpoint(unit, 'terminal', unit.pendingEnd.sourceEventInstanceId)
				unit.baselines.clear()
				unit.persist = true
			}
			const candidate = finishDraft(unit.draft)
			finished = true
			unit.finished = true
			if (unit.persist) validateProfileAgainstConfig(candidate.profile, this.game.config)
			const nextRevision = this.#revision + 1
			const nextSnapshot = this.selectSnapshot(candidate, unit.baselines, nextRevision)
			let committedState = candidate
			if (unit.persist) {
				const persistenceStarted = performance.now()
				try {
					if (!this.saves) throw new Error('This Runtime is read-only')
					const stored = await this.saves.put(candidate.profile)
					committedState = { profile: stored, working: candidate.working }
					this.trace(
						'persistence',
						name,
						performance.now() - persistenceStarted,
						'ok',
						0,
						unit
					)
				} catch (error) {
					this.trace(
						'persistence',
						name,
						performance.now() - persistenceStarted,
						'error',
						0,
						unit,
						{ code: 'persistence-error' }
					)
					throw new RuntimeFailure(
						'persistence-error',
						`Unable to save the checkpoint: ${errorMessage(error)}`,
					)
				}
			}
			this.#state = committedState
			this.#baselines = unit.baselines
			this.#revision = nextRevision
			this.#snapshot = nextSnapshot
			if (publish) this.notify()
			this.trace('transaction', 'commit', performance.now() - started, 'ok', 0, unit)
			this.traceRuleSummary(unit)
		} catch (error) {
			if (!finished) {
				finishDraft(unit.draft)
				unit.finished = true
			}
			this.trace(
				'transaction',
				'rollback',
				performance.now() - started,
				'rollback',
				0,
				unit,
				{
					code: error instanceof RuntimeFailure ? error.code : 'script-error',
				}
			)
			this.traceRuleSummary(unit, 'rollback')
			throw error
		}
	}

	private profileView(unit: Unit): ProfileRuntime
	private profileView(unit: Unit, writable: true): ActionProfileRuntime
	private profileView(unit: Unit, writable = false): ProfileRuntime | ActionProfileRuntime {
		return createRuntimeView({
			config: this.game.config as GameConfig,
			layers: [unit.working.profileState],
			writable: writable ? unit.working.profileState : undefined,
			scope: 'profile',
			evaluateRule: (rule) => this.evaluateRule(unit, rule),
		}) as unknown as ProfileRuntime | ActionProfileRuntime
	}

	private runView(unit: Unit): RunRuntime
	private runView(unit: Unit, writable: true): ActionRunRuntime
	private runView(unit: Unit, writable = false): RunRuntime | ActionRunRuntime {
		return createRuntimeView({
			config: this.game.config as GameConfig,
			layers: [unit.working.profileState, unit.working.runState],
			writable: writable ? unit.working.runState : undefined,
			scope: 'run',
			evaluateRule: (rule) => this.evaluateRule(unit, rule),
			onEventWrite: (path, property, previous, next) => {
				const frame = unit.actionStack.at(-1)
				if (!frame) throw new Error('Event lifecycle can only be changed by an Action')
				frame.writes.push({ path, property, previous, next })
			},
		}) as unknown as RunRuntime | ActionRunRuntime
	}

	private turnView(unit: Unit): TurnRuntime
	private turnView(unit: Unit, writable: true): ActionTurnRuntime
	private turnView(unit: Unit, writable = false): TurnRuntime | ActionTurnRuntime {
		return createRuntimeView({
			config: this.game.config as GameConfig,
			layers: [unit.working.profileState, unit.working.runState, unit.working.turnState],
			turnState: unit.working.turnState,
			writable: writable ? unit.working.turnState : undefined,
			scope: 'turn',
			evaluateRule: (rule) => this.evaluateRule(unit, rule),
		}) as unknown as TurnRuntime | ActionTurnRuntime
	}

	private ruleFunctions(unit: Unit): RuleFunctions {
		return Object.fromEntries(
			Object.keys(this.game.rules).map((key) => [
				key,
				(...args: Primitive[]) => this.evaluateRule(unit, { key, args }),
			])
		) as RuleFunctions
	}

	private actionFunctions(unit: Unit): ActionFunctions {
		return Object.fromEntries(
			Object.keys(this.game.actions).map((key) => [
				key,
				(...args: Primitive[]) => {
					const parent = unit.actionStack.at(-1)
					this.runAction(
						unit,
						{ key, args },
						parent?.sourceEventInstanceId,
						parent?.allowedCandidates
					)
				},
			])
		) as ActionFunctions
	}

	private evaluateRule(unit: Unit, call: DeepReadonly<Rule>): unknown {
		const implementation = this.game.rules[call.key]
		if (!implementation) throw new Error(`Unknown Rule “${call.key}”`)
		if (++unit.ruleCount > RULE_EXECUTION_LIMIT)
			throw new Error(`Rule execution limit (${RULE_EXECUTION_LIMIT}) exceeded`)
		const identity = `${call.key}:${stableArgs(call.args)}`
		if (unit.ruleStack.includes(identity))
			throw new Error(`Recursive Rule cycle: ${[...unit.ruleStack, identity].join(' → ')}`)
		const context: RuleContext = {
			config: this.game.config as DeepReadonly<GameConfig>,
			profileState: this.profileView(unit) as DeepReadonly<ProfileRuntime>,
			runState: this.runView(unit) as DeepReadonly<RunRuntime>,
			turnState: this.turnView(unit) as DeepReadonly<TurnRuntime>,
			rule: this.ruleFunctions(unit),
		}
		unit.ruleStack.push(identity)
		const started = performance.now()
		let outcome: 'ok' | 'error' = 'ok'
		try {
			return implementation.calc(context, ...call.args)
		} catch (error) {
			outcome = 'error'
			throw new ScriptExecutionError(error, `Rule ${identity}`)
		} finally {
			unit.ruleStack.pop()
			const duration = performance.now() - started
			const stat = unit.ruleStats.get(call.key) ?? { count: 0, durationMs: 0, maxMs: 0 }
			stat.count += 1
			stat.durationMs += duration
			stat.maxMs = Math.max(stat.maxMs, duration)
			unit.ruleStats.set(call.key, stat)
			if (this.#monitor.verbose)
				this.trace('rule-summary', call.key, duration, outcome, unit.ruleStack.length, unit, {
					args: argsTraceDetail(call.args),
				})
		}
	}

	private runAction(
		unit: Unit,
		call: DeepReadonly<Action>,
		sourceEventInstanceId?: string,
		allowedCandidates?: ReadonlySet<string>
	): void {
		const implementation = this.game.actions[call.key]
		if (!implementation) throw new Error(`Unknown Action “${call.key}”`)
		if (++unit.actionCount > ACTION_LIMIT)
			throw new Error(`Action execution limit (${ACTION_LIMIT}) exceeded`)
		const frame: ActionFrame = {
			key: call.key,
			sourceEventInstanceId,
			allowedCandidates,
			writes: [],
		}
		unit.actionStack.push(frame)
		const context: ActionContext = {
			config: this.game.config as DeepReadonly<GameConfig>,
			profileState: this.profileView(unit, true) as ActionProfileRuntime,
			runState: this.runView(unit, true) as ActionRunRuntime,
			turnState: this.turnView(unit, true) as ActionTurnRuntime,
			random: () => {
				const value = nextRandom(unit.working.randomState.seed, unit.working.randomState.cursor)
				unit.working.randomState.cursor += 1
				return value
			},
			action: this.actionFunctions(unit),
			rule: this.ruleFunctions(unit),
			endRun: () => {
				if (unit.pendingEnd) return
				unit.pendingEnd = {
					...(sourceEventInstanceId &&
					this.isTextNodeInstance(unit, sourceEventInstanceId)
						? { sourceEventInstanceId }
						: {}),
				}
			},
		}
		const started = performance.now()
		let outcome: 'ok' | 'error' = 'ok'
		try {
			implementation.exec(context, ...call.args)
			this.finalizeActionFrame(unit, frame)
		} catch (error) {
			outcome = 'error'
			throw new ScriptExecutionError(
				error,
				`Action ${call.key}:${stableArgs(call.args)}`,
			)
		} finally {
			unit.actionStack.pop()
			this.trace(
				'action',
				call.key,
				performance.now() - started,
				outcome,
				unit.actionStack.length + 1,
				unit,
				{
					actionKey: call.key,
					args: argsTraceDetail(call.args),
					...(sourceEventInstanceId ? { eventInstanceId: sourceEventInstanceId } : {}),
					...(frame.writes[0]
						? {
								eventField: frame.writes[0].property,
								previousValue: String(frame.writes[0].previous),
								nextValue: String(frame.writes[0].next),
							}
						: {}),
				}
			)
		}
	}

	private finalizeActionFrame(unit: Unit, frame: ActionFrame): void {
		if (frame.writes.length > 1)
			throw new Error('An Action frame may perform only one event jump or termination')
		const write = frame.writes[0]
		if (!write) return
		const eventId = write.path[1]
		const instanceId = write.path[3]
		const eventState = unit.working.runState.events[eventId]
		const instance = eventState?.instances?.[instanceId]
		const event = this.game.config.events[eventId]
		if (!instance || !event) throw new Error('The Action targeted an unknown EventInstance')
		if (write.property === 'currentNodeId') {
			if (write.previous === write.next) return
			if (typeof write.next !== 'string' || !event.nodes[write.next])
				throw new Error(`Unknown target node “${String(write.next)}”`)
			if (frame.allowedCandidates && !frame.allowedCandidates.has(write.next))
				throw new Error(`Node “${write.next}” is not a declared CheckNode candidate`)
			if (instance.status !== 'active' || eventState.activeInstanceId !== instanceId)
				throw new Error('Only an active EventInstance can navigate')
			const previousNode = String(write.previous)
			instance.nodePath.push(write.next)
			this.clearSelection(unit, eventId, previousNode, instanceId)
			const target = event.nodes[write.next]
			if (target.type === 'check') this.runCheck(unit, instanceId, target.id)
			return
		}
		if (write.previous === write.next) return
		if (
			write.previous !== 'active' ||
			(write.next !== 'completed' && write.next !== 'abandoned')
		) {
			throw new Error(
				'EventInstance status can only transition from active to completed or abandoned'
			)
		}
		instance.endedTurn = unit.working.turnState.turnNumber
		delete eventState.activeInstanceId
		this.clearSelection(unit, eventId, instance.currentNodeId, instanceId)
	}

	private runCheck(unit: Unit, instanceId: string, nodeId: string): void {
		if (++unit.checkCount > CHECK_LIMIT)
			throw new Error(`Automatic CheckNode limit (${CHECK_LIMIT}) exceeded`)
		let eventId: string | undefined
		for (const [candidateEventId, state] of Object.entries(unit.working.runState.events)) {
			if (state.instances?.[instanceId]) {
				eventId = candidateEventId
				break
			}
		}
		if (!eventId) throw new Error('CheckNode EventInstance is missing')
		const node = this.game.config.events[eventId].nodes[nodeId]
		if (node.type !== 'check') return
		this.trace(
			'transition',
			`check:${eventId}.${nodeId}`,
			0,
			'ok',
			unit.actionStack.length,
			unit,
			{ eventId, nodeId, eventInstanceId: instanceId }
		)
		this.runAction(unit, node.check, instanceId, new Set(Object.keys(node.candidateNodes)))
		const instance = unit.working.runState.events[eventId].instances?.[instanceId]
		if (
			instance?.status === 'active' &&
			instance.currentNodeId === nodeId &&
			!unit.pendingEnd
		) {
			throw new Error(`CheckNode ${eventId}.${nodeId} did not leave the node`)
		}
	}

	private isTextNodeInstance(unit: Unit, instanceId: string): boolean {
		for (const [eventId, state] of Object.entries(unit.working.runState.events)) {
			const instance = state.instances?.[instanceId]
			if (
				instance &&
				this.game.config.events[eventId].nodes[instance.currentNodeId]?.type !== 'check'
			)
				return true
		}
		return false
	}

	/** 返回当前生效且已按 canonical ordinal 排序的 Reaction。 */
	private reactionDefinitions(unit: Unit): ReactionDefinition[] {
		return collectReactionDefinitions(this.game.config, unit.working.runState)
	}
	private evaluateReaction(unit: Unit, definition: ReactionDefinition): Primitive {
		const watch = definition.reaction.watch
		let value: unknown
		if ('source' in watch) {
			const root =
				watch.source === 'profileState'
					? this.profileView(unit)
					: watch.source === 'runState'
						? this.runView(unit)
						: this.turnView(unit)
			const path =
				watch.source === 'self' ? [...definition.selfPath, ...watch.path] : watch.path
			value = readPath(root, path)
		} else {
			value = this.evaluateRule(unit, watch)
		}
		if (!isPrimitive(value))
			throw new Error(`Reaction ${definition.key} did not resolve to a Primitive`)
		return value
	}

	private scanReactions(unit: Unit, queue: ReactionTask[]): void {
		const definitions = this.reactionDefinitions(unit)
		const activeKeys = new Set(definitions.map((definition) => definition.key))
		for (const key of unit.baselines.keys())
			if (!activeKeys.has(key)) unit.baselines.delete(key)
		for (const definition of definitions) {
			const value = this.evaluateReaction(unit, definition)
			if (!unit.baselines.has(definition.key)) {
				unit.baselines.set(definition.key, value)
				continue
			}
			const previous = unit.baselines.get(definition.key) as Primitive
			if (Object.is(previous, value)) continue
			unit.baselines.set(definition.key, value)
			const { from, to } = definition.reaction
			if (
				(from === undefined || Object.is(from, previous)) &&
				(to === undefined || Object.is(to, value))
			) {
				queue.push({ definition })
			}
		}
	}

	/**
	 * 全量扫描当前 Reaction 的 Rule/ValueRef，并按 canonical ordinal 加入 FIFO。
	 * root 操作后及每个 Reaction Action 后重新扫描；新增定义只建立 baseline。
	 */
	private stabilize(unit: Unit): void {
		this.syncEffectLifecycle(unit)
		const queue: ReactionTask[] = []
		this.scanReactions(unit, queue)
		while (queue.length > 0) {
			const task = queue.shift()
			if (!task) break
			if (!this.reactionDefinitions(unit).some((item) => item.key === task.definition.key))
				continue
			const started = performance.now()
			let outcome: 'ok' | 'error' = 'ok'
			try {
				this.runAction(
					unit,
					task.definition.reaction.action,
					task.definition.sourceEventInstanceId
				)
				this.syncEffectLifecycle(unit)
				this.scanReactions(unit, queue)
			} catch (error) {
				outcome = 'error'
				throw new ScriptExecutionError(error, `Reaction ${task.definition.key}`)
			} finally {
				this.trace(
					'reaction',
					task.definition.key,
					performance.now() - started,
					outcome,
					unit.actionStack.length,
					unit,
					{
						action: task.definition.reaction.action.key,
						args: argsTraceDetail(task.definition.reaction.action.args),
						...(task.definition.sourceEventInstanceId
							? { eventInstanceId: task.definition.sourceEventInstanceId }
							: {}),
					}
				)
			}
		}
	}

	private captureEffectValues(unit: Unit): void {
		const view = this.turnView(unit)
		for (const effect of Object.values(view.effects)) {
			unit.effectValues.set(effect.id, { acquired: effect.acquired, actived: effect.actived })
		}
	}

	private syncEffectLifecycle(unit: Unit): void {
		const view = this.turnView(unit)
		for (const effect of Object.values(view.effects)) {
			const previous = unit.effectValues.get(effect.id) ?? {
				acquired: effect.acquired,
				actived: effect.actived,
			}
			const state = (unit.working.runState.effects[effect.id] ??= { id: effect.id })
			if (!previous.acquired && effect.acquired)
				state.acquiredTurn = unit.working.turnState.turnNumber
			if (!previous.actived && effect.actived)
				state.activedTurn = unit.working.turnState.turnNumber
			unit.effectValues.set(effect.id, { acquired: effect.acquired, actived: effect.actived })
		}
	}

	private initializeReactionBaselines(): void {
		const unit = this.createUnit('baseline')
		try {
			for (const definition of this.reactionDefinitions(unit)) {
				unit.baselines.set(definition.key, this.evaluateReaction(unit, definition))
			}
			this.#baselines = unit.baselines
			this.traceRuleSummary(unit)
			finishDraft(unit.draft)
			unit.finished = true
		} catch (error) {
			this.traceRuleSummary(unit, 'error')
			if (!unit.finished) {
				finishDraft(unit.draft)
				unit.finished = true
			}
			throw error
		}
	}

	private makeStateSnapshot(unit: Unit): StateSnapshot {
		return {
			profileState: structuredClone(current(unit.working.profileState)),
			runState: structuredClone(current(unit.working.runState)),
			turnState: structuredClone(current(unit.working.turnState)),
			randomState: structuredClone(current(unit.working.randomState)),
		}
	}

	private appendCheckpoint(
		unit: Unit,
		kind: CheckpointKind,
		endingEventInstanceId?: string
	): void {
		const createdAt = now()
		const turnId = createId('turn')
		const snapshot = this.makeStateSnapshot(unit)
		const turn: TurnData =
			kind === 'terminal'
				? {
						turnId,
						kind,
						createdAt,
						pinned: false,
						snapshot,
						...(endingEventInstanceId ? { endingEventInstanceId } : {}),
					}
				: { turnId, kind, createdAt, pinned: false, snapshot }
		unit.run.turnDatas[turnId] = turn
		unit.run.turnOrder.push(turnId)
		unit.run.currentTurnId = turnId
		unit.run.updatedAt = createdAt
		unit.profile.current = { runId: unit.run.runId, turnId }
		unit.profile.updatedAt = createdAt
		if (kind === 'terminal') {
			unit.run.status = 'ended'
			unit.run.endedAt = createdAt
		} else if (kind === 'abandoned') {
			unit.run.status = 'abandoned'
			unit.run.endedAt = createdAt
		}
		if (kind === 'terminal' || kind === 'abandoned') {
			this.trace('transition', kind, 0, 'ok', 0, unit)
		}
		this.applyRetention(unit)
	}

	private applyRetention(unit: Unit): void {
		while (unit.run.turnOrder.length > unit.run.maxTurnCount) {
			const removableIndex = unit.run.turnOrder.findIndex((turnId) => {
				const turn = unit.run.turnDatas[turnId]
				return turnId !== unit.run.currentTurnId && !turn.pinned
			})
			if (removableIndex < 0) return
			const [turnId] = unit.run.turnOrder.splice(removableIndex, 1)
			delete unit.run.turnDatas[turnId]
		}
	}

	private clearSelection(unit: Unit, eventId: string, nodeId: string, instanceId: string): void {
		const selections = unit.working.turnState.events[eventId]?.nodes?.[nodeId]?.selections
		if (selections) delete selections[instanceId]
	}

	private clearAllSelections(unit: Unit): void {
		for (const event of Object.values(unit.working.turnState.events)) {
			for (const node of Object.values(event.nodes ?? {})) delete node.selections
		}
	}

	private computeBlockers(): RuntimeSnapshot['advanceTurnBlockers'] {
		return [...this.#snapshot.advanceTurnBlockers]
	}

	private currentRun(): RunData {
		const run = this.#state.profile.runDatas[this.#state.profile.current.runId]
		if (!run) throw new Error('The current RunData is missing')
		return run
	}

	/** 将当前工作状态投影为 UI 使用的深度冻结 RuntimeSnapshot。 */
	private selectSnapshot(
		state: RuntimeState,
		baselines: ReadonlyMap<string, Primitive>,
		revision: number,
	): RuntimeSnapshot {
		const unit = this.createUnit('selector', state, baselines)
		try {
			const snapshot = projectRuntimeSnapshot({
				config: this.game.config,
				runtime: this.turnView(unit),
				run: unit.run,
				revision,
			})
			const frozen = freezeSnapshot(snapshot)
			this.traceRuleSummary(unit)
			finishDraft(unit.draft)
			unit.finished = true
			return frozen
		} catch (error) {
			this.traceRuleSummary(unit, 'error')
			finishDraft(unit.draft)
			unit.finished = true
			throw error
		}
	}

	private notify(): void {
		for (const listener of this.#listeners) {
			try {
				listener()
			} catch {
				// 订阅者异常不能影响 Runtime 状态。
			}
		}
	}

	private trace(
		kind: RuntimeTraceKind,
		name: string,
		durationMs: number,
		outcome: 'ok' | 'error' | 'rollback',
		depth: number,
		unit?: Unit,
		detail?: Readonly<Record<string, Primitive>>,
		options: { traceId?: string; parentId?: string } = {}
	): void {
		let runId: string
		let turnNumber: number
		let phase: TurnPhase
		if (unit) {
			if (!unit.finished) {
				unit.traceRunId = unit.run.runId
				unit.traceTurnNumber = unit.working.turnState.turnNumber
				unit.tracePhase = unit.working.turnState.phase
			}
			runId = unit.traceRunId
			turnNumber = unit.traceTurnNumber
			phase = unit.tracePhase
		} else {
			const run = this.currentRun()
			runId = run.runId
			turnNumber = this.#state.working.turnState.turnNumber
			phase = this.#state.working.turnState.phase
		}
		try {
			const parentId = options.parentId ?? unit?.parentTraceId ?? this.#activeCommandTraceId
			this.#monitor.trace({
				traceId: options.traceId ?? `trace-${++this.#traceCounter}`,
				...(parentId ? { parentId } : {}),
				at: now(),
				runId,
				turnNumber,
				phase,
				unitId: unit?.id ?? `u-${this.#unitCounter}`,
				depth,
				kind,
				name,
				durationMs,
				outcome,
				...(detail ? { detail } : {}),
			})
		} catch {
			// 监控实现异常不能改变事务结果。
		}
	}

	private traceRuleSummary(
		unit: Unit,
		outcome: 'ok' | 'error' | 'rollback' = 'ok',
	): void {
		if (unit.ruleStats.size === 0) return
		const slowest = [...unit.ruleStats.entries()].sort((a, b) => b[1].maxMs - a[1].maxMs)[0]
		const duration = [...unit.ruleStats.values()].reduce(
			(sum, stat) => sum + stat.durationMs,
			0
		)
		this.trace('rule-summary', slowest?.[0] ?? 'rules', duration, outcome, 0, unit, {
			count: unit.ruleCount,
			slowest: slowest?.[0] ?? '',
		})
	}
}
