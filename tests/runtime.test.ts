import 'fake-indexeddb/auto'
import { assert, expect, test } from 'vitest'
import type {
	ActionContext,
	ActionRegistry,
	CommonConfig,
	GameConfig,
	GameState,
	LoadedGamePackage,
	Primitive,
	Rule,
	RuleContext,
	RuleRegistry,
	StoredProfile,
} from '../src/types'
import {
	createBranch,
	deleteCheckpoint,
	deleteRun,
	IndexedDbSaveRepository,
	SaveConflictError,
	truncateAndContinue,
	validateProfileAgainstConfig,
	type SaveListResult,
	type SaveRepository,
} from '../src/persistence'
import { getDatabase } from '../src/persistence/database'
import { GameplayRuntimeImpl, createProfile } from '../src/runtime'
import type { RuntimeMonitor, RuntimeTrace } from '../src/runtime/monitor'
import { nextRandom } from '../src/runtime/random'
import { collectReactionDefinitions } from '../src/runtime/reactions'
import { createRuntimeView } from '../src/runtime/state-view'

/** 构造不带参数的 Rule 调用，减少测试夹具中的重复字段。 */
const rule = (key: string): Rule => ({ key, args: [] })

/** 构造所有 Config 实体共用的可见性、解锁和排序字段。 */
function common(id: string, order: number): CommonConfig {
	return {
		id,
		displayName: id,
		tags: [],
		order,
		weightValue: 1,
		weight: rule('constant.weight'),
		visible: true,
		unlockedValue: true,
		unlocked: rule('constant.true'),
		enabledValue: true,
		enabled: rule('constant.true'),
	}
}

/**
 * 构造覆盖 Runtime 核心路径的最小游戏配置。
 *
 * 配置包含一个数值属性、一个回合开始 Reaction，以及一条
 * `CheckNode -> required SingleTextNode` 事件链，供不同用例按需扩展。
 */
function makeConfig(): GameConfig {
	return {
		meta: {
			id: 'test-game',
			name: 'Test Game',
			version: 'test',
			background: '',
			maxTurnCountPerRun: 8,
		},
		characters: {
			hero: {
				...common('hero', 0),
				attributes: {
					score: {
						...common('score', 0),
						type: 'number',
						value: 0,
						min: 0,
						max: 10,
					},
				},
			},
		},
		effects: {
			turnEffect: {
				...common('turnEffect', 0),
				acquiredValue: false,
				acquired: rule('constant.false'),
				activedValue: false,
				actived: rule('constant.false'),
				manuallyActivatable: false,
				reactionList: [
					{
						watch: rule('watch.turn-start'),
						from: false,
						to: true,
						action: { key: 'score.increment', args: [] },
					},
				],
			},
		},
		events: {
			requiredEvent: {
				...common('requiredEvent', 0),
				entryNodeId: 'gate',
				nodes: {
					gate: {
						...common('gate', 0),
						type: 'check',
						candidateNodes: { requiredNode: true },
						check: { key: 'check.noop', args: [] },
					},
					// 该节点固定为单选，仅是本测试夹具的约定，并非通用游戏包约束。
					requiredNode: {
						...common('requiredNode', 1),
						type: 'single',
						content: 'required',
						requiredValue: true,
						required: rule('constant.true'),
						choicesValue: {},
						choices: rule('choices.required'),
					},
				},
			},
		},
	}
}

/** 构造与最小游戏配置配套的 Rule 注册表。 */
function makeRules(): RuleRegistry {
	return {
		'constant.weight': {
			key: 'constant.weight',
			calc: () => 1,
		},
		'constant.true': {
			key: 'constant.true',
			calc: () => true,
		},
		'constant.false': {
			key: 'constant.false',
			calc: () => false,
		},
		'watch.turn-start': {
			key: 'watch.turn-start',
			calc: (context: RuleContext) => context.turnState.phase === 'turn_start',
		},
		'choices.required': {
			key: 'choices.required',
			calc: (context: RuleContext) => {
				const node = context.turnState.events.requiredEvent.nodes.requiredNode
				// RuleContext 只暴露 EventNode 联合类型，需要重申测试夹具的节点类型才能安全读取选项。
				if (node.type !== 'single') {
					throw new Error('requiredNode must be a single-choice node')
				}
				return node.choicesValue
			},
		},
	}
}

/** 构造与最小游戏配置配套的 Action 注册表。 */
function makeActions(): ActionRegistry {
	return {
		'score.increment': {
			key: 'score.increment',
			exec: (context: ActionContext) => {
				context.runState.characters.hero.attributes.score.value += 1
			},
		},
		'check.noop': {
			key: 'check.noop',
			exec: () => undefined,
		},
	}
}

/** 将内存 Config、Rule 和 Action 组装为已经完成 linking 的测试游戏包。 */
function makeGame(config = makeConfig()): LoadedGamePackage {
	return {
		location: {
			descriptor: {
				id: config.meta.id,
				version: config.meta.version,
				name: config.meta.name,
				manifest: 'memory:manifest',
			},
			manifestLocation: 'memory:manifest',
		},
		manifest: {
			schemaVersion: 1,
			id: config.meta.id,
			version: config.meta.version,
			name: config.meta.name,
			entries: { config: 'config', rules: 'rules', actions: 'actions' },
		},
		config,
		rules: makeRules(),
		actions: makeActions(),
		assetsBaseLocation: 'memory:',
	}
}

/**
 * 通过复制注册表为单个用例覆盖实现，保留 LoadedGamePackage 的只读边界。
 */
function withImplementations(
	game: LoadedGamePackage,
	overrides: { rules?: RuleRegistry; actions?: ActionRegistry },
): LoadedGamePackage {
	return {
		...game,
		rules: { ...game.rules, ...overrides.rules },
		actions: { ...game.actions, ...overrides.actions },
	}
}

/** 构造不含 required 事件阻塞、可直接推进回合的游戏包。 */
function makePlayableGame(): LoadedGamePackage {
	const config = makeConfig()
	config.events.requiredEvent.enabled = rule('constant.false')
	return makeGame(config)
}

/**
 * 仅用于 Runtime 单元测试的内存 Repository。
 *
 * 写入和读取都复制数据，模拟真实持久化边界，避免引用共享掩盖回滚问题。
 */
class MemorySaveRepository implements SaveRepository {
	readonly profiles = new Map<string, StoredProfile>()

	async listByConfigId(configId: string): Promise<SaveListResult> {
		return {
			profiles: [...this.profiles.values()].filter((profile) => profile.configId === configId),
			invalid: [],
		}
	}

	async get(profileId: string): Promise<StoredProfile | undefined> {
		const profile = this.profiles.get(profileId)
		return profile ? structuredClone(profile) : undefined
	}

	async put(profile: StoredProfile): Promise<StoredProfile> {
		const stored = structuredClone({
			...profile,
			storageRevision: profile.storageRevision + 1,
		})
		this.profiles.set(stored.profileId, stored)
		return structuredClone(stored)
	}

	async delete(profileId: string, expectedStorageRevision: number): Promise<void> {
		const existing = this.profiles.get(profileId)
		if (!existing || existing.storageRevision !== expectedStorageRevision) {
			throw new SaveConflictError()
		}
		this.profiles.delete(profileId)
	}
}

/** 固定让写入失败，用于验证持久化异常下的事务回滚。 */
class FailingSaveRepository extends MemorySaveRepository {
	override async put(): Promise<StoredProfile> {
		throw new Error('synthetic persistence failure')
	}
}

/** 收集 Runtime trace，并记录监控会话是否正确结束。 */
class RecordingRuntimeMonitor implements RuntimeMonitor {
	readonly verbose = false
	readonly traces: RuntimeTrace[] = []
	finished = false

	trace(value: RuntimeTrace): void {
		this.traces.push(value)
	}

	finish(): void {
		this.finished = true
	}
}

/** 构造不含任何实体覆盖的空 State 层。 */
function emptyState(): GameState {
	return { characters: {}, effects: {}, events: {} }
}

/** 合法 Profile 通过校验后注入幽灵实体，验证错误能定位到精确 JSON Pointer。 */
test('Config-aware validation rejects ghost State keys with a JSON Pointer', () => {
	const game = makeGame()
	const profile = createProfile(game)
	validateProfileAgainstConfig(profile, game.config)
	const turn = profile.runDatas[profile.current.runId].turnDatas[profile.current.turnId]
	turn.snapshot.runState.characters.ghost = { id: 'ghost' }
	expect(() => validateProfileAgainstConfig(profile, game.config)).toThrowError(
		'/snapshot/runState/characters/ghost',
	)
})

/** Rule 派生值越过布尔、权重或 Choice 身份约束时，应在读取投影时立即失败。 */
test('derived Rule contracts reject invalid booleans, weights and Choice identities', () => {
	const config = makeConfig()
	const values: Record<string, unknown> = {
		'constant.true': 'yes',
		'constant.weight': 11,
		'choices.required': { ghost: { id: 'ghost' } },
	}
	const view = createRuntimeView({
		config,
		layers: [emptyState()],
		scope: 'run',
		evaluateRule: (call) => values[call.key],
	})
	assert.throws(
		() => (view.characters as Record<string, Record<string, unknown>>).hero.enabled,
		/expected boolean/,
	)
	assert.throws(
		() => (view.characters as Record<string, Record<string, unknown>>).hero.weight,
		/between 0 and 10/,
	)
	assert.throws(
		() =>
			(
				(view.events as Record<string, Record<string, unknown>>).requiredEvent.nodes as Record<
					string,
					Record<string, unknown>
				>
			).requiredNode.choices,
		/unknown “ghost”/,
	)
})

/** Effect、Event 和当前 TextNode 的 Reaction 必须按稳定的 canonical 顺序收集。 */
test('Reaction definitions use canonical Effect/Event/TextNode ordering', () => {
	const config = makeConfig()
	config.events.requiredEvent.reactionList = [
		{
			watch: rule('constant.true'),
			action: { key: 'check.noop', args: [] },
		},
	]
	const requiredNode = config.events.requiredEvent.nodes.requiredNode
	// 与 makeRules 中的检查相同：这里收窄的是测试夹具，不是在声明通用节点规则。
	if (requiredNode.type !== 'single') {
		throw new Error('requiredNode must be a single-choice node')
	}
	requiredNode.reactionList = [
		{
			watch: rule('constant.true'),
			action: { key: 'check.noop', args: [] },
		},
	]
	const runState = emptyState()
	runState.events.requiredEvent = {
		id: 'requiredEvent',
		activeInstanceId: 'instance-1',
		instances: {
			'instance-1': {
				instanceId: 'instance-1',
				eventId: 'requiredEvent',
				status: 'active',
				currentNodeId: 'requiredNode',
				nodePath: ['gate', 'requiredNode'],
				startedTurn: 1,
			},
		},
	}
	const definitions = collectReactionDefinitions(config, runState)
	assert.deepEqual(
		definitions.map((definition) => definition.ordinal[0]),
		[0, 1, 2],
	)
})

/** Runtime 打开时应传播阶段依赖，并将 required 阻塞原因投影为结构化数据。 */
test('Runtime dependency propagation executes turn-start Reaction and exposes structured required blockers', async () => {
	const game = makeGame()
	const profile = createProfile(game)
	const saves = new MemorySaveRepository()
	const runtime = await GameplayRuntimeImpl.open(game, profile, saves)
	try {
		const snapshot = runtime.getSnapshot()
		const score = snapshot.attributes.find((attribute) => attribute.attributeId === 'score')
		assert.equal(score?.value, 1)
		assert.equal(snapshot.eventCards[0]?.required, true)
		assert.deepEqual(
			snapshot.advanceTurnBlockers.map((blocker) => [blocker.kind, blocker.eventId]),
			[['pending-required-event', 'requiredEvent']],
		)
		const result = await runtime.dispatch({ type: 'advance-turn' })
		assert.equal(result.ok, false)
		if (!result.ok) {
			assert.equal(result.code, 'blocked')
			assert.match(result.errorId, /^runtime-/)
		}
	} finally {
		runtime.dispose()
	}
})

/** 一次 State 写入只能重算依赖该路径的 Reaction watch，不能遍历无关 observer。 */
test('Runtime dependency graph only recomputes affected Reaction observers', async () => {
	const config = makeConfig()
	const node = config.events.requiredEvent.nodes.requiredNode
	if (node.type !== 'single') throw new Error('requiredNode must be a single-choice node')
	config.events.requiredEvent.entryNodeId = node.id
	node.choicesValue.increment = {
		...common('increment', 0),
		action: { key: 'score.increment', args: [] },
	}
	config.effects.turnEffect.reactionList.push(
		{
			watch: rule('watch.score'),
			action: { key: 'check.noop', args: [] },
		},
		{
			watch: rule('watch.turn-number'),
			action: { key: 'check.noop', args: [] },
		},
		{
			watch: rule('watch.instance-count'),
			action: { key: 'check.noop', args: [] },
		},
	)
	const executions = { score: 0, turnNumber: 0, instanceCount: 0 }
	const game = withImplementations(makeGame(config), {
		rules: {
			'watch.score': {
				key: 'watch.score',
				calc: (context: RuleContext) => {
					executions.score += 1
					return context.runState.characters.hero.attributes.score.value
				},
			},
			'watch.turn-number': {
				key: 'watch.turn-number',
				calc: (context: RuleContext) => {
					executions.turnNumber += 1
					return context.turnState.turnNumber
				},
			},
			'watch.instance-count': {
				key: 'watch.instance-count',
				calc: (context: RuleContext) => {
					executions.instanceCount += 1
					return Object.keys(context.runState.events.requiredEvent.instances).length
				},
			},
		},
	})
	const runtime = await GameplayRuntimeImpl.open(
		game,
		createProfile(game),
		new MemorySaveRepository(),
	)
	try {
		const beforeStart = { ...executions }
		assert.equal(
			(
				await runtime.dispatch({
					type: 'start-event',
					eventId: 'requiredEvent',
				})
			).ok,
			true,
		)
		assert.equal(executions.score, beforeStart.score)
		assert.equal(executions.turnNumber, beforeStart.turnNumber)
		assert.equal(executions.instanceCount, beforeStart.instanceCount + 1)

		const active = runtime.getSnapshot().activeEvents[0]
		assert.ok(active)
		const beforeChoice = { ...executions }
		assert.equal(
			(
				await runtime.dispatch({
					type: 'choose-single',
					eventInstanceId: active.eventInstanceId,
					nodeId: active.currentNodeId,
					choiceId: 'increment',
				})
			).ok,
			true,
		)
		assert.equal(executions.score, beforeChoice.score + 1)
		assert.equal(executions.turnNumber, beforeChoice.turnNumber)
		assert.equal(executions.instanceCount, beforeChoice.instanceCount)
	} finally {
		runtime.dispose()
	}
})

/** TextNode Reaction 进入节点时注册，离开 active 实例后必须立即注销。 */
test('Runtime registers and unregisters TextNode observers with event lifecycle', async () => {
	const config = makeConfig()
	const node = config.events.requiredEvent.nodes.requiredNode
	if (node.type !== 'single') throw new Error('requiredNode must be a single-choice node')
	config.events.requiredEvent.entryNodeId = node.id
	node.reactionList = [
		{
			watch: rule('watch.score'),
			action: { key: 'check.noop', args: [] },
		},
	]
	node.choicesValue.increment = {
		...common('increment', 0),
		action: { key: 'score.increment', args: [] },
	}
	node.choicesValue.complete = {
		...common('complete', 1),
		action: { key: 'event.complete', args: [] },
	}
	const game = withImplementations(makeGame(config), {
		rules: {
			'watch.score': {
				key: 'watch.score',
				calc: (context: RuleContext) => context.runState.characters.hero.attributes.score.value,
			},
		},
		actions: {
			'event.complete': {
				key: 'event.complete',
				exec: (context: ActionContext) => {
					const event = context.runState.events.requiredEvent
					const instanceId = event.activeInstanceId
					if (!instanceId) throw new Error('requiredEvent must be active')
					event.instances[instanceId].status = 'completed'
				},
			},
		},
	})
	const monitor = new RecordingRuntimeMonitor()
	const runtime = await GameplayRuntimeImpl.open(
		game,
		createProfile(game),
		new MemorySaveRepository(),
		() => monitor,
	)
	try {
		assert.equal(
			(
				await runtime.dispatch({
					type: 'start-event',
					eventId: 'requiredEvent',
				})
			).ok,
			true,
		)
		const active = runtime.getSnapshot().activeEvents[0]
		assert.ok(active)
		const nodeReactionCount = (): number =>
			monitor.traces.filter(
				(trace) =>
					trace.kind === 'reaction' && trace.detail?.eventInstanceId === active.eventInstanceId,
			).length

		assert.equal(
			(
				await runtime.dispatch({
					type: 'choose-single',
					eventInstanceId: active.eventInstanceId,
					nodeId: active.currentNodeId,
					choiceId: 'increment',
				})
			).ok,
			true,
		)
		assert.equal(nodeReactionCount(), 1)

		assert.equal(
			(
				await runtime.dispatch({
					type: 'choose-single',
					eventInstanceId: active.eventInstanceId,
					nodeId: active.currentNodeId,
					choiceId: 'complete',
				})
			).ok,
			true,
		)
		assert.equal((await runtime.dispatch({ type: 'advance-turn' })).ok, true)
		assert.equal(nodeReactionCount(), 1)
	} finally {
		runtime.dispose()
	}
})

/** 一条命令内的 trace 应共享 parentId，并完整记录跨越的回合阶段。 */
test('Runtime monitor correlates command spans and records all turn transitions', async () => {
	const game = makePlayableGame()
	const monitor = new RecordingRuntimeMonitor()
	const runtime = await GameplayRuntimeImpl.open(
		game,
		createProfile(game),
		new MemorySaveRepository(),
		() => monitor,
	)
	try {
		const result = await runtime.dispatch({ type: 'advance-turn' })
		assert.equal(result.ok, true)
		const commandStartIndex = monitor.traces.findIndex(
			(trace) => trace.kind === 'command-start' && trace.name === 'advance-turn',
		)
		const commandEndIndex = monitor.traces.findIndex(
			(trace) => trace.kind === 'command-end' && trace.name === 'advance-turn',
		)
		assert.ok(commandStartIndex >= 0)
		assert.ok(commandEndIndex > commandStartIndex)
		const commandId = monitor.traces[commandStartIndex].traceId
		for (const trace of monitor.traces.slice(commandStartIndex + 1, commandEndIndex + 1)) {
			assert.equal(trace.parentId, commandId)
		}
		assert.deepEqual(
			monitor.traces
				.slice(commandStartIndex, commandEndIndex + 1)
				.filter((trace) => trace.kind === 'transition')
				.map((trace) => trace.name),
			['turn_end', 'turn_start', 'event_handle'],
		)
	} finally {
		runtime.dispose()
	}
})

/** turn_end 保存失败时，工作状态、revision 和阶段都必须回到命令执行前。 */
test('persistence failure rolls back the whole turn-end unit', async () => {
	const game = makePlayableGame()
	const runtime = await GameplayRuntimeImpl.open(
		game,
		createProfile(game),
		new FailingSaveRepository(),
	)
	try {
		const before = runtime.getSnapshot()
		const result = await runtime.dispatch({ type: 'advance-turn' })
		assert.equal(result.ok, false)
		if (!result.ok) {
			assert.equal(result.code, 'persistence-error')
			assert.equal(result.committed, false)
		}
		const after = runtime.getSnapshot()
		assert.equal(after.revision, before.revision)
		assert.equal(after.phase, 'event_handle')
		assert.equal(after.turnNumber, 1)
	} finally {
		runtime.dispose()
	}
})

/**
 * Action 请求终局后故意让 selector 失败，验证尚未稳定的 candidate
 * 不会替换当前状态，也不会写入 Repository。
 */
test('selector failure discards a terminal candidate before persistence', async () => {
	const config = makeConfig()
	const node = config.events.requiredEvent.nodes.requiredNode
	assert.equal(node.type, 'single')
	// 返回只用于满足 TypeScript 收窄；makeConfig 改坏夹具时，前一条断言会先失败。
	if (node.type !== 'single') return
	config.events.requiredEvent.entryNodeId = node.id
	config.characters.hero.unlocked = rule('selector.maybe-fail')
	node.choicesValue.finish = {
		...common('finish', 0),
		action: { key: 'score.finish', args: [] },
	}
	const game = withImplementations(makeGame(config), {
		rules: {
			'selector.maybe-fail': {
				key: 'selector.maybe-fail',
				calc: (context: RuleContext) => {
					if (context.runState.characters.hero.attributes.score.value > 1) {
						throw new Error('synthetic selector failure')
					}
					return true
				},
			},
		},
		actions: {
			'score.finish': {
				key: 'score.finish',
				exec: (context: ActionContext) => {
					context.runState.characters.hero.attributes.score.value += 1
					context.endRun()
				},
			},
		},
	})
	const saves = new MemorySaveRepository()
	const runtime = await GameplayRuntimeImpl.open(game, createProfile(game), saves)
	try {
		assert.equal(
			(
				await runtime.dispatch({
					type: 'start-event',
					eventId: 'requiredEvent',
				})
			).ok,
			true,
		)
		const active = runtime.getSnapshot().activeEvents[0]
		assert.ok(active)
		const before = runtime.getSnapshot()
		const result = await runtime.dispatch({
			type: 'choose-single',
			eventInstanceId: active.eventInstanceId,
			nodeId: active.currentNodeId,
			choiceId: 'finish',
		})
		assert.equal(result.ok, false)
		if (!result.ok) assert.equal(result.code, 'script-error')
		assert.equal(runtime.getSnapshot(), before)
		assert.equal(
			runtime.getStoredProfile().runDatas[runtime.getCurrentCheckpoint().runId].status,
			'active',
		)
		assert.equal(saves.profiles.size, 0)
	} finally {
		runtime.dispose()
	}
})

/** Reaction 反复修改自身 watch 值时，确定性的执行上限必须终止循环。 */
test('Reaction self-triggering loops stop at a deterministic execution limit', async () => {
	const config = makeConfig()
	const score = config.characters.hero.attributes.score
	assert.equal(score.type, 'number')
	if (score.type !== 'number') return
	score.max = 10_000
	config.effects.turnEffect.reactionList.push({
		watch: {
			source: 'runState',
			path: ['characters', 'hero', 'attributes', 'score', 'value'],
		},
		action: { key: 'score.increment', args: [] },
	})
	const game = makeGame(config)
	await expect(
		GameplayRuntimeImpl.open(game, createProfile(game), new MemorySaveRepository()),
	).rejects.toThrowError(/(Action execution|Rule recomputation) limit/)
})

/**
 * turn_end 已成功保存而下一回合启动失败时，错误必须标记 committed，
 * Runtime 和 Repository 都停留在同一个可重试边界。
 */
test('advance-turn reports a committed boundary when the next turn fails', async () => {
	const game = withImplementations(makePlayableGame(), {
		actions: {
			'score.increment': {
				key: 'score.increment',
				exec: (context: ActionContext) => {
					if (context.turnState.turnNumber >= 2) throw new Error('turn two failed')
					context.runState.characters.hero.attributes.score.value += 1
				},
			},
		},
	})
	const saves = new MemorySaveRepository()
	const runtime = await GameplayRuntimeImpl.open(game, createProfile(game), saves)
	try {
		const result = await runtime.dispatch({ type: 'advance-turn' })
		assert.equal(result.ok, false)
		if (!result.ok) {
			assert.equal(result.code, 'script-error')
			assert.equal(result.committed, true)
		}
		const snapshot = runtime.getSnapshot()
		assert.equal(snapshot.phase, 'turn_end')
		assert.equal(snapshot.turnNumber, 1)
		const stored = await saves.get(runtime.getStoredProfile().profileId)
		assert.equal(
			stored?.runDatas[stored.current.runId].turnDatas[stored.current.turnId].kind,
			'turn_end',
		)
	} finally {
		runtime.dispose()
	}
})

/** 分支与截断必须产生独立历史，不能反向修改来源 Profile。 */
test('branch and truncate operate on independent checkpoint histories', () => {
	const game = makeGame()
	const profile = createProfile(game)
	const run = profile.runDatas[profile.current.runId]
	const initialId = run.currentTurnId
	const initialTurn = run.turnDatas[initialId]
	const turnId = 'turn-later'
	run.turnDatas[turnId] = {
		turnId,
		kind: 'turn_end',
		createdAt: initialTurn.createdAt,
		pinned: initialTurn.pinned,
		snapshot: {
			...structuredClone(initialTurn.snapshot),
			turnState: {
				...structuredClone(initialTurn.snapshot.turnState),
				turnNumber: 1,
				phase: 'turn_end',
			},
		},
	}
	run.turnOrder.push(turnId)
	run.currentTurnId = turnId
	profile.current = { runId: run.runId, turnId }
	const branch = createBranch(profile, { runId: run.runId, turnId: initialId })
	const branchRun = branch.runDatas[branch.current.runId]
	assert.equal(branchRun.origin?.kind, 'branch')
	assert.equal(branchRun.turnOrder.length, 1)
	assert.equal(branch.runDatas[run.runId].turnOrder.length, 2)
	const truncated = truncateAndContinue(profile, { runId: run.runId, turnId: initialId })
	assert.deepEqual(truncated.runDatas[run.runId].turnOrder, [initialId])
	assert.equal(profile.runDatas[run.runId].turnOrder.length, 2)
})

/** 手动删除当前检查点必须忽略 pin，并把结束时间线恢复到前一个可游玩检查点。 */
test('manual checkpoint deletion ignores pin and repairs the current cursor', () => {
	const game = makeGame()
	const profile = createProfile(game)
	const run = profile.runDatas[profile.current.runId]
	const initialId = run.currentTurnId
	const terminalId = 'turn-terminal-to-delete'
	const endedAt = new Date().toISOString()
	run.turnDatas[terminalId] = {
		turnId: terminalId,
		kind: 'terminal',
		createdAt: endedAt,
		pinned: true,
		snapshot: structuredClone(run.turnDatas[initialId].snapshot),
	}
	run.turnOrder.push(terminalId)
	run.currentTurnId = terminalId
	run.status = 'ended'
	run.endedAt = endedAt
	profile.current = { runId: run.runId, turnId: terminalId }

	const deleted = deleteCheckpoint(profile, profile.current)
	assert.ok(deleted)
	validateProfileAgainstConfig(deleted, game.config)
	const repairedRun = deleted.runDatas[run.runId]
	assert.deepEqual(repairedRun.turnOrder, [initialId])
	assert.equal(repairedRun.currentTurnId, initialId)
	assert.equal(repairedRun.status, 'active')
	assert.equal(repairedRun.endedAt, undefined)
	assert.deepEqual(deleted.current, { runId: run.runId, turnId: initialId })
	assert.equal(profile.runDatas[run.runId].turnDatas[terminalId].pinned, true)
})

/** 删到空容器时逐级移除时间线和存档，任何层级都不能把 pin 当作手动删除保护。 */
test('manual deletion cascades empty timelines and profiles regardless of pin', () => {
	const game = makeGame()
	const profile = createProfile(game)
	const root = profile.current
	const branched = createBranch(profile, root)
	const branch = branched.current
	branched.runDatas[branch.runId].turnDatas[branch.turnId].pinned = true

	const afterCheckpoint = deleteCheckpoint(branched, branch)
	assert.ok(afterCheckpoint)
	assert.equal(afterCheckpoint.runDatas[branch.runId], undefined)
	assert.deepEqual(afterCheckpoint.current, root)
	validateProfileAgainstConfig(afterCheckpoint, game.config)

	const secondBranch = createBranch(profile, root)
	const secondBranchRef = secondBranch.current
	secondBranch.runDatas[secondBranchRef.runId].turnDatas[secondBranchRef.turnId].pinned = true
	const afterRun = deleteRun(secondBranch, secondBranchRef.runId)
	assert.ok(afterRun)
	assert.equal(afterRun.runDatas[secondBranchRef.runId], undefined)
	assert.deepEqual(afterRun.current, root)
	assert.equal(deleteRun(afterRun, root.runId), undefined)
})

/** 查看旧检查点时，生命周期应由目标检查点推导，而不是沿用当前终局状态。 */
test('read-only projection derives lifecycle from the selected historical checkpoint', () => {
	const game = makeGame()
	const profile = createProfile(game)
	const run = profile.runDatas[profile.current.runId]
	const initialId = run.currentTurnId
	const terminalId = 'turn-terminal'
	const endedAt = new Date().toISOString()
	run.turnDatas[terminalId] = {
		turnId: terminalId,
		kind: 'terminal',
		createdAt: endedAt,
		pinned: false,
		snapshot: structuredClone(run.turnDatas[initialId].snapshot),
	}
	run.turnOrder.push(terminalId)
	run.currentTurnId = terminalId
	run.status = 'ended'
	run.endedAt = endedAt
	profile.current = { runId: run.runId, turnId: terminalId }
	const historical = GameplayRuntimeImpl.projectCheckpoint(game, profile, {
		runId: run.runId,
		turnId: initialId,
	})
	assert.equal(historical.runStatus, 'active')
	assert.equal('endedAt' in historical, false)
})

/** 相同 seed 与 cursor 必须得到相同随机数，cursor 变化则应改变输出。 */
test('PRNG output is deterministic by seed and cursor', () => {
	assert.equal(nextRandom('same-seed', 7), nextRandom('same-seed', 7))
	assert.notEqual(nextRandom('same-seed', 7), nextRandom('same-seed', 8))
})

/** 嵌套 Rule 失败应保留 Reaction、Action、Rule 调用链和可复制的错误 id。 */
test('Rule failures return a copyable error id and complete nested call frames', async () => {
	const game = withImplementations(makeGame(), {
		rules: {
			'failing.nested': {
				key: 'failing.nested',
				calc: (...args: [RuleContext, ...Primitive[]]) => {
					void args
					throw new Error('synthetic rule failure')
				},
			},
		},
		actions: {
			'score.increment': {
				key: 'score.increment',
				exec: (context: ActionContext) => {
					context.rule['failing.nested']()
				},
			},
		},
	})
	const profile = createProfile(game)
	await expect(
		GameplayRuntimeImpl.open(game, profile, new MemorySaveRepository()),
	).rejects.toSatisfy(
		(error: unknown) =>
			error instanceof Error &&
			/Reaction/.test(error.message) &&
			/Action score\.increment/.test(error.message) &&
			/Rule failing\.nested/.test(error.message) &&
			/\[runtime-/.test(error.message),
	)
})

/** Runtime 尚在构造阶段失败时，也必须结束已经创建的 monitor 会话。 */
test('Runtime construction failures still finish the allocated monitor session', async () => {
	const game = withImplementations(makeGame(), {
		rules: {
			'watch.turn-start': {
				key: 'watch.turn-start',
				calc: () => {
					throw new Error('synthetic baseline failure')
				},
			},
		},
	})
	const monitor = new RecordingRuntimeMonitor()
	await expect(
		GameplayRuntimeImpl.open(game, createProfile(game), new MemorySaveRepository(), () => monitor),
	).rejects.toThrowError(/synthetic baseline failure/)
	assert.equal(monitor.finished, true)
})

/**
 * 串行验证 IndexedDB 三项存档边界：开发期升级清库、revision CAS 冲突，
 * 以及结构损坏记录与有效存档的隔离。
 */
test.sequential(
	'IndexedDB upgrade clears development data, CAS rejects stale writes, and bad records are isolated',
	async () => {
		const game = makeGame()
		const legacy = createProfile(game)
		// 手工建立旧版本数据库并写入数据，随后由当前 Repository 触发升级。
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open('maker-simulator', 2)
			request.onupgradeneeded = () => {
				const database = request.result
				const profiles = database.createObjectStore('profiles', { keyPath: 'profileId' })
				profiles.createIndex('by-config-id', 'configId')
				profiles.createIndex('by-updated-at', 'updatedAt')
				database.createObjectStore('app-metadata', { keyPath: 'key' })
			}
			request.onerror = () => reject(request.error)
			request.onsuccess = () => {
				const database = request.result
				const transaction = database.transaction('profiles', 'readwrite')
				transaction.objectStore('profiles').put(legacy)
				transaction.onerror = () => reject(transaction.error)
				transaction.oncomplete = () => {
					database.close()
					resolve()
				}
			}
		})

		const saves = new IndexedDbSaveRepository()
		assert.equal((await saves.listByConfigId(game.config.meta.id)).profiles.length, 0)
		const first = await saves.put(createProfile(game))
		const stale = structuredClone(first)
		const current = await saves.put(first)
		assert.equal(current.storageRevision, 2)
		await expect(saves.put(stale)).rejects.toBeInstanceOf(SaveConflictError)

		const database = await getDatabase()
		await database.put('profiles', {
			profileId: 'broken-profile',
			configId: game.config.meta.id,
			configVersion: game.config.meta.version,
			updatedAt: new Date().toISOString(),
		} as StoredProfile)
		const listed = await saves.listByConfigId(game.config.meta.id)
		assert.equal(listed.profiles.length, 1)
		assert.equal(listed.invalid.length, 1)
		await expect(saves.delete(current.profileId, stale.storageRevision)).rejects.toBeInstanceOf(
			SaveConflictError,
		)
		await saves.delete(current.profileId, current.storageRevision)
		assert.equal(await saves.get(current.profileId), undefined)
	},
)
