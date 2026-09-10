import type {
	ActionContext,
	ActionRegistry,
	CommonConfig,
	GameConfig,
	GameState,
	Rule,
	RuleContext,
	RuleRegistry,
	StoredProfile,
} from '../src/gameplay/types/model'
import type { LoadedGamePackage } from '../src/gameplay/types/package'
import type { SaveListResult, SaveRepository } from '../src/gameplay/persistence/SaveRepository'
import type { RuntimeMonitor, RuntimeTrace } from '../src/gameplay/runtime/monitor'

/** 构造不带参数的 Rule 调用，减少测试夹具中的重复字段。 */
export const rule = (key: string): Rule => ({ key, args: [] })

/** 构造所有 Config 实体共用的可见性、解锁和排序字段。 */
export function common(id: string, order: number): CommonConfig {
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
export function makeConfig(): GameConfig {
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
export function makeRules(): RuleRegistry {
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
export function makeActions(): ActionRegistry {
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
export function makeGame(config = makeConfig()): LoadedGamePackage {
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
export function withImplementations(
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
export function makePlayableGame(): LoadedGamePackage {
	const config = makeConfig()
	config.events.requiredEvent.enabled = rule('constant.false')
	return makeGame(config)
}

/**
 * 仅用于 Runtime 单元测试的内存 Repository。
 *
 * 写入和读取都复制数据，模拟真实持久化边界，避免引用共享掩盖回滚问题。
 */
export class MemorySaveRepository implements SaveRepository {
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
		const stored = structuredClone(profile)
		this.profiles.set(stored.profileId, stored)
		return structuredClone(stored)
	}

	async delete(profileId: string): Promise<void> {
		this.profiles.delete(profileId)
	}
}

/** 固定让写入失败，用于验证持久化异常下的事务回滚。 */
export class FailingSaveRepository extends MemorySaveRepository {
	override async put(): Promise<StoredProfile> {
		throw new Error('synthetic persistence failure')
	}
}

/** 收集 Runtime trace，并记录监控会话是否正确结束。 */
export class RecordingRuntimeMonitor implements RuntimeMonitor {
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
export function emptyState(): GameState {
	return { characters: {}, effects: {}, events: {} }
}
