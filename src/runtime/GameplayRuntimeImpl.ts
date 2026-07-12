import { createDraft, current, finishDraft, type Draft } from 'immer'
import type {
	Action,
	ActionContext,
	ActionFunctions,
	ActionProfileRuntime,
	ActionRunRuntime,
	ActionTurnRuntime,
	ActiveEventView,
	CheckpointKind,
	DeepReadonly,
	EffectView,
	EndingEventView,
	EventInstance,
	EventNodeView,
	GameConfig,
	GameplayRuntime,
	LoadedGamePackage,
	MultipleChoiceView,
	Primitive,
	Profile,
	ProfileRuntime,
	Reaction,
	Rule,
	RuleContext,
	RuleFunctions,
	RunData,
	RunRuntime,
	RuntimeCommand,
	RuntimeCommandErrorCode,
	RuntimeCommandResult,
	RuntimeSnapshot,
	SingleChoiceView,
	StateSnapshot,
	TurnData,
	TurnRuntime,
} from '../types'
import type { SaveRepository } from '../persistence'
import { deepFreeze, stableArgs } from '../package-loader/linker'
import { nextRandom } from './random'
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
const RULE_LIMIT = 4096
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

interface ReactionDefinition {
	key: string
	ordinal: readonly (number | string)[]
	reaction: DeepReadonly<Reaction>
	selfPath: readonly string[]
	sourceEventInstanceId?: string
}

interface ReactionTask {
	definition: ReactionDefinition
}

interface Unit {
	id: string
	name: string
	draft: Draft<Profile>
	run: Draft<RunData>
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
	tracePhase: RunData['turnState']['phase']
}

class RuntimeFailure extends Error {
	readonly code: RuntimeCommandErrorCode

	constructor(code: RuntimeCommandErrorCode, message: string) {
		super(message)
		this.name = 'RuntimeFailure'
		this.code = code
	}
}

const now = (): string => new Date().toISOString()
const createId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`
function compareOrdinal(
	left: readonly (number | string)[],
	right: readonly (number | string)[]
): number {
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const a = left[index]
		const b = right[index]
		if (a === undefined) return -1
		if (b === undefined) return 1
		if (a === b) continue
		if (typeof a === 'number' && typeof b === 'number') return a - b
		return String(a) < String(b) ? -1 : 1
	}
	return 0
}

function isPrimitive(value: unknown): value is Primitive {
	return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function asMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function freezeSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
	return deepFreeze(snapshot)
}

/**
 * 游戏回合运行时的唯一状态变更入口。
 *
 * Runtime 以 Immer draft 执行一个完整处理单元，统一协调命令、Action、Rule、Reaction、
 * CheckNode、随机游标、回合阶段和检查点；处理单元失败时不会发布部分 State。
 */
export class GameplayRuntimeImpl implements GameplayRuntime {
	readonly #listeners = new Set<() => void>()
	#profile: Profile
	#snapshot: RuntimeSnapshot
	#revision = 0
	#busy = false
	#disposed = false
	#unitCounter = 0
	#baselines = new Map<string, Primitive>()
	readonly #monitor: RuntimeMonitor
	readonly game: LoadedGamePackage
	private readonly saves: SaveRepository

	private constructor(
		game: LoadedGamePackage,
		profile: Profile,
		saves: SaveRepository,
		monitorFactory?: RuntimeMonitorFactory
	) {
		this.game = game
		this.saves = saves
		if (
			profile.configId !== game.config.meta.id ||
			profile.configVersion !== game.config.meta.version
		) {
			throw new Error('The save and game package versions do not match')
		}
		this.#profile = structuredClone(profile)
		this.#monitor = monitorFactory?.(profile.current.runId) ?? new NoopRuntimeMonitor()
		this.initializeReactionBaselines()
		this.#snapshot = this.selectSnapshot()
	}

	/** 创建新游戏 Runtime，保存初始 Profile 后自动启动首回合。 */
	static async create(
		game: LoadedGamePackage,
		profile: Profile,
		saves: SaveRepository,
		monitorFactory?: RuntimeMonitorFactory
	): Promise<GameplayRuntimeImpl> {
		const runtime = new GameplayRuntimeImpl(game, profile, saves, monitorFactory)
		await saves.put(profile)
		await runtime.beginFromCheckpoint()
		return runtime
	}

	/** 从已有 Profile 的当前稳定检查点恢复 Runtime。 */
	static async open(
		game: LoadedGamePackage,
		profile: Profile,
		saves: SaveRepository,
		monitorFactory?: RuntimeMonitorFactory
	): Promise<GameplayRuntimeImpl> {
		const runtime = new GameplayRuntimeImpl(game, profile, saves, monitorFactory)
		await runtime.beginFromCheckpoint()
		return runtime
	}

	/** 串行执行一条 RuntimeCommand；并发命令会返回 busy。 */
	dispatch(command: RuntimeCommand): Promise<RuntimeCommandResult> {
		if (this.#disposed) {
			return Promise.resolve({
				ok: false,
				code: 'not-found',
				message: 'This runtime has been closed',
				revision: this.#revision,
			})
		}
		if (this.#busy) {
			return Promise.resolve({
				ok: false,
				code: 'busy',
				message: 'Another command is still running',
				revision: this.#revision,
			})
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

	/** 返回 Profile 的深拷贝，避免调用方修改 Runtime 内部状态。 */
	getProfile(): Profile {
		return structuredClone(this.#profile)
	}

	/** 将当前 active Run 写入 abandoned 检查点，并结束本条时间线。 */
	async abandon(): Promise<RuntimeCommandResult> {
		if (this.currentRun().status !== 'active') {
			return {
				ok: false,
				code: 'invalid-phase',
				message: 'Only an active run can be abandoned',
				revision: this.#revision,
			}
		}
		try {
			await this.runUnit(
				'abandon',
				(unit) => {
					this.appendCheckpoint(unit, 'abandoned')
					unit.persist = true
				},
				true
			)
			return { ok: true, revision: this.#revision }
		} catch (error) {
			return {
				ok: false,
				code: 'script-error',
				message: asMessage(error),
				revision: this.#revision,
			}
		}
	}

	/** 停止发布快照并输出监控摘要；不会删除 IndexedDB 中已有存档。 */
	dispose(): void {
		if (this.#disposed) return
		this.#disposed = true
		this.#listeners.clear()
		this.#monitor.finish()
	}

	private async executeCommand(command: RuntimeCommand): Promise<RuntimeCommandResult> {
		const started = performance.now()
		let outcome: 'ok' | 'error' = 'ok'
		try {
			switch (command.type) {
				case 'start-event':
					await this.startEvent(command.eventId)
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
			const failure =
				error instanceof RuntimeFailure
					? error
					: new RuntimeFailure('script-error', asMessage(error))
			return {
				ok: false,
				code: failure.code,
				message: failure.message,
				revision: this.#revision,
			}
		} finally {
			this.trace(
				'command',
				command.type,
				performance.now() - started,
				outcome,
				0,
				undefined,
				this.commandTraceDetail(command)
			)
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

		const eventId = Object.entries(this.currentRun().state.events).find(
			([, state]) => state.instances?.[command.eventInstanceId]
		)?.[0]
		const event = eventId ? this.game.config.events[eventId] : undefined
		const node = event?.nodes[command.nodeId]
		if (!node || node.type === 'check') return detail

		if (command.type === 'choose-single') {
			if (node.type !== 'single') return detail
			const authoredChoices = 'rule' in node.choices ? node.choices.value : node.choices
			const choice = Object.values(authoredChoices).find(
				(item) => item.id === command.choiceId
			)
			return choice ? { ...detail, actionKey: choice.action.key } : detail
		}
		if (command.type === 'set-multiple-choice') {
			if (node.type !== 'multiple') return detail
			const authoredChoices = 'rule' in node.choices ? node.choices.value : node.choices
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
					(instance) => instance.startedTurn === unit.run.turnState.turnNumber
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
				startedTurn: unit.run.turnState.turnNumber,
			}
			const eventState = (unit.run.state.events[eventId] ??= { id: eventId })
			;(eventState.instances ??= {})[instanceId] = instance
			eventState.activeInstanceId = instanceId
			const entry = this.game.config.events[eventId].nodes[event.entryNodeId]
			if (entry.type === 'check') this.runCheck(unit, instanceId, entry.id)
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
			const eventState = (unit.run.turnState.events[eventId] ??= { id: eventId })
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
		this.requireInputPhase()
		const blockers = this.computeBlockers()
		if (blockers.length > 0) throw new RuntimeFailure('blocked', blockers.join('；'))

		await this.runUnit(
			'turn-end',
			(unit) => {
				unit.run.turnState.phase = 'turn_end'
				this.stabilize(unit)
				if (!unit.pendingEnd) {
					this.appendCheckpoint(unit, 'turn_end')
					unit.persist = true
				}
			},
			true,
			false
		)
		if (this.currentRun().status === 'active') await this.beginNextTurn()
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
			unit.run.turnState.turnNumber += 1
			unit.run.turnState.phase = 'turn_start'
			this.trace('transition', 'turn_start', 0, 'ok', 0, unit)
			this.stabilize(unit)
			if (!unit.pendingEnd) {
				unit.run.turnState.phase = 'event_handle'
				this.trace('transition', 'event_handle', 0, 'ok', 0, unit)
				this.stabilize(unit)
			}
		})
	}

	private requireInputPhase(): void {
		const run = this.currentRun()
		if (run.status !== 'active' || run.turnState.phase !== 'event_handle') {
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
		for (const [eventId, eventState] of Object.entries(unit.run.state.events)) {
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

	private createUnit(name: string): Unit {
		const draft = createDraft(this.#profile)
		const run = draft.runDatas[draft.current.runId]
		if (!run) {
			finishDraft(draft)
			throw new Error('The current RunData is missing')
		}
		return {
			id: `u-${++this.#unitCounter}`,
			name,
			draft,
			run,
			baselines: new Map(this.#baselines),
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
			traceTurnNumber: run.turnState.turnNumber,
			tracePhase: run.turnState.phase,
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
			if (unit.persist) {
				const persistenceStarted = performance.now()
				try {
					await this.saves.put(candidate)
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
					throw new Error(`Unable to save the checkpoint: ${asMessage(error)}`, {
						cause: error,
					})
				}
			}
			this.#profile = candidate
			this.#baselines = unit.baselines
			this.#revision += 1
			this.#snapshot = this.selectSnapshot()
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
			this.traceRuleSummary(unit)
			throw error
		}
	}

	private profileView(unit: Unit): ProfileRuntime
	private profileView(unit: Unit, writable: true): ActionProfileRuntime
	private profileView(unit: Unit, writable = false): ProfileRuntime | ActionProfileRuntime {
		return createRuntimeView({
			config: this.game.config as GameConfig,
			layers: [unit.draft.state],
			writable: writable ? unit.draft.state : undefined,
			scope: 'profile',
			evaluateRule: (rule) => this.evaluateRule(unit, rule),
		}) as unknown as ProfileRuntime | ActionProfileRuntime
	}

	private runView(unit: Unit): RunRuntime
	private runView(unit: Unit, writable: true): ActionRunRuntime
	private runView(unit: Unit, writable = false): RunRuntime | ActionRunRuntime {
		return createRuntimeView({
			config: this.game.config as GameConfig,
			layers: [unit.draft.state, unit.run.state],
			writable: writable ? unit.run.state : undefined,
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
			layers: [unit.draft.state, unit.run.state, unit.run.turnState],
			turnState: unit.run.turnState,
			writable: writable ? unit.run.turnState : undefined,
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
		if (++unit.ruleCount > RULE_LIMIT)
			throw new Error(`Rule execution limit (${RULE_LIMIT}) exceeded`)
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
		try {
			return implementation.calc(context, ...call.args)
		} finally {
			unit.ruleStack.pop()
			const duration = performance.now() - started
			const stat = unit.ruleStats.get(call.key) ?? { count: 0, durationMs: 0, maxMs: 0 }
			stat.count += 1
			stat.durationMs += duration
			stat.maxMs = Math.max(stat.maxMs, duration)
			unit.ruleStats.set(call.key, stat)
			if (this.#monitor.verbose)
				this.trace('rule-summary', call.key, duration, 'ok', unit.ruleStack.length, unit, {
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
				const value = nextRandom(unit.run.randomState.seed, unit.run.randomState.cursor)
				unit.run.randomState.cursor += 1
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
			throw new Error(`Action ${call.key} failed: ${asMessage(error)}`, { cause: error })
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
		const eventState = unit.run.state.events[eventId]
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
		instance.endedTurn = unit.run.turnState.turnNumber
		delete eventState.activeInstanceId
		this.clearSelection(unit, eventId, instance.currentNodeId, instanceId)
	}

	private runCheck(unit: Unit, instanceId: string, nodeId: string): void {
		if (++unit.checkCount > CHECK_LIMIT)
			throw new Error(`Automatic CheckNode limit (${CHECK_LIMIT}) exceeded`)
		let eventId: string | undefined
		for (const [candidateEventId, state] of Object.entries(unit.run.state.events)) {
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
		const instance = unit.run.state.events[eventId].instances?.[instanceId]
		if (
			instance?.status === 'active' &&
			instance.currentNodeId === nodeId &&
			!unit.pendingEnd
		) {
			throw new Error(`CheckNode ${eventId}.${nodeId} did not leave the node`)
		}
	}

	private isTextNodeInstance(unit: Unit, instanceId: string): boolean {
		for (const [eventId, state] of Object.entries(unit.run.state.events)) {
			const instance = state.instances?.[instanceId]
			if (
				instance &&
				this.game.config.events[eventId].nodes[instance.currentNodeId]?.type !== 'check'
			)
				return true
		}
		return false
	}

	/** 按 canonical ordinal 收集当前所有 Effect、Event 和 active TextNode Reaction。 */
	private reactionDefinitions(unit: Unit): ReactionDefinition[] {
		const definitions: ReactionDefinition[] = []
		const effects = Object.values(this.game.config.effects).sort(
			(a, b) => a.order - b.order || a.id.localeCompare(b.id)
		)
		for (const effect of effects) {
			effect.reactionList.forEach((reaction, index) => {
				const ordinal = [0, effect.order, effect.id, index] as const
				definitions.push({
					key: JSON.stringify(ordinal),
					ordinal,
					reaction,
					selfPath: ['effects', effect.id],
				})
			})
		}
		const events = Object.values(this.game.config.events).sort(
			(a, b) => a.order - b.order || a.id.localeCompare(b.id)
		)
		for (const event of events) {
			event.reactionList?.forEach((reaction, index) => {
				const ordinal = [1, event.order, event.id, index] as const
				definitions.push({
					key: JSON.stringify(ordinal),
					ordinal,
					reaction,
					selfPath: ['events', event.id],
				})
			})
			const state = unit.run.state.events[event.id]
			for (const instance of Object.values(state?.instances ?? {})) {
				if (instance.status !== 'active') continue
				const node = event.nodes[instance.currentNodeId]
				if (!node || node.type === 'check') continue
				node.reactionList?.forEach((reaction, index) => {
					const ordinal = [
						2,
						event.order,
						event.id,
						instance.startedTurn,
						instance.instanceId,
						node.order,
						node.id,
						index,
					] as const
					definitions.push({
						key: JSON.stringify(ordinal),
						ordinal,
						reaction,
						selfPath: ['events', event.id, 'nodes', node.id],
						sourceEventInstanceId: instance.instanceId,
					})
				})
			}
		}
		return definitions.sort((left, right) => compareOrdinal(left.ordinal, right.ordinal))
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

	/** 反复扫描 Rule/ValueRef，按 FIFO 执行变化触发的 Reaction，直到状态稳定。 */
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
				throw error
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
			const state = (unit.run.state.effects[effect.id] ??= { id: effect.id })
			if (!previous.acquired && effect.acquired)
				state.acquiredTurn = unit.run.turnState.turnNumber
			if (!previous.actived && effect.actived)
				state.activedTurn = unit.run.turnState.turnNumber
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
			if (!unit.finished) finishDraft(unit.draft)
			throw error
		}
	}

	private makeStateSnapshot(unit: Unit): StateSnapshot {
		return {
			profileState: structuredClone(current(unit.draft.state)),
			runState: structuredClone(current(unit.run.state)),
			turnState: structuredClone(current(unit.run.turnState)),
			randomState: structuredClone(current(unit.run.randomState)),
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
		unit.run.state = structuredClone(snapshot.runState)
		unit.run.turnState = structuredClone(snapshot.turnState)
		unit.run.randomState = structuredClone(snapshot.randomState)
		unit.draft.state = structuredClone(snapshot.profileState)
		unit.draft.current = { runId: unit.run.runId, turnId }
		unit.draft.updatedAt = createdAt
		if (kind === 'terminal') {
			unit.run.status = 'ended'
			unit.run.endedAt = createdAt
		} else if (kind === 'abandoned') {
			unit.run.status = 'abandoned'
			unit.run.endedAt = createdAt
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
		const selections = unit.run.turnState.events[eventId]?.nodes?.[nodeId]?.selections
		if (selections) delete selections[instanceId]
	}

	private clearAllSelections(unit: Unit): void {
		for (const event of Object.values(unit.run.turnState.events)) {
			for (const node of Object.values(event.nodes ?? {})) delete node.selections
		}
	}

	private computeBlockers(): string[] {
		return [...this.#snapshot.advanceTurnBlockers]
	}

	private currentRun(): RunData {
		const run = this.#profile.runDatas[this.#profile.current.runId]
		if (!run) throw new Error('The current RunData is missing')
		return run
	}

	/** 将当前工作状态投影为 UI 使用的深度冻结 RuntimeSnapshot。 */
	private selectSnapshot(): RuntimeSnapshot {
		const unit = this.createUnit('selector')
		try {
			const runtime = this.turnView(unit)
			const run = unit.run
			const attributes = Object.values(this.game.config.characters)
				.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
				.flatMap((characterConfig) => {
					const character = runtime.characters[characterConfig.id]
					if (!character.visible || !character.unlocked) return []
					return Object.values(characterConfig.attributes)
						.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
						.flatMap((attributeConfig) => {
							const attribute = character.attributes[attributeConfig.id]
							if (!attribute.visible || !attribute.unlocked) return []
							return [
								{
									characterId: character.id,
									characterDisplayName: character.displayName,
									attributeId: attribute.id,
									displayName: attribute.displayName,
									type: attribute.type,
									value: attribute.value,
									displayValue:
										attribute.type === 'enum'
											? attribute.valueDisplay[attribute.value]
											: String(attribute.value),
									...(attribute.type === 'number' && attribute.min !== undefined
										? { min: attribute.min }
										: {}),
									...(attribute.type === 'number' && attribute.max !== undefined
										? { max: attribute.max }
										: {}),
								},
							]
						})
				})
			const effects: EffectView[] = Object.values(this.game.config.effects)
				.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
				.flatMap((config) => {
					const effect = runtime.effects[config.id]
					if (!effect.visible || !effect.unlocked || !effect.acquired) return []
					const bound = effect.bindCharacterId
						? runtime.characters[effect.bindCharacterId]
						: undefined
					return [
						{
							effectId: effect.id,
							displayName: effect.displayName,
							...(effect.description ? { description: effect.description } : {}),
							actived: effect.actived,
							...(effect.bindCharacterId
								? { bindCharacterId: effect.bindCharacterId }
								: {}),
							...(bound ? { bindCharacterDisplayName: bound.displayName } : {}),
						},
					]
				})
			const eventCards = []
			const activeEvents: ActiveEventView[] = []
			const pendingEventBlockers: string[] = []
			for (const config of Object.values(this.game.config.events).sort(
				(a, b) => a.order - b.order || a.id.localeCompare(b.id)
			)) {
				const event = runtime.events[config.id]
				if (event.activeInstanceId) {
					const instance = event.instances[event.activeInstanceId]
					if (instance?.status === 'active') {
						const node = event.nodes[instance.currentNodeId]
						if (node.type !== 'check') {
							const currentNode = this.nodeView(node, instance.instanceId)
							activeEvents.push({
								eventId: event.id,
								eventInstanceId: instance.instanceId,
								displayName: event.displayName,
								status: 'active',
								currentNodeId: node.id,
								required: currentNode.required,
								currentNode,
							})
						}
					}
				} else if (
					run.status === 'active' &&
					run.turnState.phase === 'event_handle' &&
					event.visible &&
					event.unlocked &&
					event.enabled &&
					!Object.values(event.instances).some(
						(instance) => instance.startedTurn === run.turnState.turnNumber
					)
				) {
					eventCards.push({
						eventId: event.id,
						displayName: event.displayName,
						...(event.description ? { description: event.description } : {}),
					})
					if (this.pendingEventRequired(event)) {
						pendingEventBlockers.push(`待处理事件「${event.displayName}」必须处理`)
					}
				}
			}
			const blockers = [
				...pendingEventBlockers,
				...activeEvents
					.filter((event) => event.required)
					.map((event) => `进行中事件「${event.displayName}」必须处理`),
			]
			const base = {
				revision: this.#revision,
				runId: run.runId,
				turnNumber: run.turnState.turnNumber,
				phase: run.turnState.phase,
				attributes,
				effects,
				eventCards,
				activeEvents,
				canAdvanceTurn:
					run.status === 'active' &&
					run.turnState.phase === 'event_handle' &&
					blockers.length === 0,
				advanceTurnBlockers: blockers,
			}
			let snapshot: RuntimeSnapshot
			if (run.status === 'active') snapshot = { ...base, runStatus: 'active' }
			else if (run.status === 'abandoned')
				snapshot = { ...base, runStatus: 'abandoned', endedAt: run.endedAt as string }
			else
				snapshot = {
					...base,
					runStatus: 'ended',
					endedAt: run.endedAt as string,
					...this.endingEvent(unit, runtime),
				}
			finishDraft(unit.draft)
			return freezeSnapshot(snapshot)
		} catch (error) {
			finishDraft(unit.draft)
			throw error
		}
	}

	private pendingEventRequired(event: TurnRuntime['events'][string]): boolean {
		const visited = new Set<string>()
		const requiresHandling = (nodeId: string): boolean => {
			if (visited.has(nodeId)) return false
			visited.add(nodeId)
			const node = event.nodes[nodeId]
			if (!node) return false
			if (node.type !== 'check') return node.required ?? false
			return Object.keys(node.candidateNodes).some((candidateId) =>
				requiresHandling(candidateId)
			)
		}
		return requiresHandling(event.entryNodeId)
	}

	private nodeView(
		node: TurnRuntime['events'][string]['nodes'][string],
		instanceId: string
	): EventNodeView {
		const common = {
			nodeId: node.id,
			displayName: node.displayName,
			...(node.description ? { description: node.description } : {}),
			content: 'content' in node ? node.content : '',
			required: 'required' in node ? (node.required ?? false) : false,
		}
		if (node.type === 'single') {
			const choices: SingleChoiceView[] = Object.values(node.choices)
				.filter((choice) => choice.visible && choice.unlocked)
				.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
				.map((choice) => ({
					choiceId: choice.id,
					displayName: choice.displayName,
					...(choice.description ? { description: choice.description } : {}),
					enabled: choice.enabled,
				}))
			return { ...common, type: 'single', choices }
		}
		if (node.type === 'check') throw new Error('CheckNode cannot be projected to the UI')
		const selection = node.selections?.[instanceId]
		const choices: MultipleChoiceView[] = Object.values(node.choices)
			.filter((choice) => choice.visible && choice.unlocked)
			.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
			.map((choice) => ({
				choiceId: choice.id,
				displayName: choice.displayName,
				...(choice.description ? { description: choice.description } : {}),
				enabled: choice.enabled,
				value: choice.value,
				count: selection?.choices[choice.id]?.count ?? 0,
				...(choice.maxCount !== undefined ? { maxCount: choice.maxCount } : {}),
			}))
		const commands = Object.values(node.commands)
			.filter((command) => command.visible && command.unlocked)
			.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
			.map((command) => ({
				commandId: command.id,
				displayName: command.displayName,
				...(command.description ? { description: command.description } : {}),
				enabled: command.enabled,
			}))
		return { ...common, type: 'multiple', choices, commands }
	}

	private endingEvent(unit: Unit, runtime: TurnRuntime): { endingEvent?: EndingEventView } {
		const terminal = unit.run.turnDatas[unit.run.currentTurnId]
		if (terminal.kind !== 'terminal' || !terminal.endingEventInstanceId) return {}
		for (const event of Object.values(runtime.events)) {
			const instance = event.instances[terminal.endingEventInstanceId]
			if (!instance) continue
			const node = event.nodes[instance.currentNodeId]
			if (!node || node.type === 'check') return {}
			return {
				endingEvent: {
					eventId: event.id,
					eventInstanceId: instance.instanceId,
					displayName: event.displayName,
					status: instance.status,
					currentNodeId: node.id,
					currentNode: this.nodeView(node, instance.instanceId),
				},
			}
		}
		return {}
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
		detail?: Readonly<Record<string, Primitive>>
	): void {
		let runId: string
		let turnNumber: number
		let phase: RunData['turnState']['phase']
		if (unit) {
			if (!unit.finished) {
				unit.traceRunId = unit.run.runId
				unit.traceTurnNumber = unit.run.turnState.turnNumber
				unit.tracePhase = unit.run.turnState.phase
			}
			runId = unit.traceRunId
			turnNumber = unit.traceTurnNumber
			phase = unit.tracePhase
		} else {
			const run = this.currentRun()
			runId = run.runId
			turnNumber = run.turnState.turnNumber
			phase = run.turnState.phase
		}
		this.#monitor.trace({
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
	}

	private traceRuleSummary(unit: Unit): void {
		if (unit.ruleStats.size === 0) return
		const slowest = [...unit.ruleStats.entries()].sort((a, b) => b[1].maxMs - a[1].maxMs)[0]
		const duration = [...unit.ruleStats.values()].reduce(
			(sum, stat) => sum + stat.durationMs,
			0
		)
		this.trace('rule-summary', slowest?.[0] ?? 'rules', duration, 'ok', 0, unit, {
			count: unit.ruleCount,
			slowest: slowest?.[0] ?? '',
		})
	}
}
