import type {
	ChoiceState,
	CommonConfig,
	CommonState,
	DeepReadonly,
	EffectState,
	EventNodeState,
	GameState,
	LoadedGamePackage,
	MultipleChoice,
	RunData,
	SingleChoice,
	StateSnapshot,
	StoredProfile,
	TurnData,
	TurnRef,
	TurnState,
} from '../types'

const createId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`
const timestamp = (): string => new Date().toISOString()

/** 创建不含任何游戏对象状态的稀疏 GameState。 */
export function emptyGameState(): GameState {
	return { characters: {}, effects: {}, events: {} }
}

function commonState(config: DeepReadonly<CommonConfig>): CommonState {
	return {
		id: config.id,
		weightValue: config.weightValue,
		unlockedValue: config.unlockedValue,
		enabledValue: config.enabledValue,
	}
}

function choiceState(choice: DeepReadonly<SingleChoice | MultipleChoice>): ChoiceState {
	return {
		...commonState(choice),
		...('maxCountValue' in choice && choice.maxCountValue !== undefined
			? { maxCountValue: choice.maxCountValue }
			: {}),
	}
}

/** 根据 Config 的基础值构造首个 RunState；Rule 只在运行时计算有效值。 */
function initialRunState(game: LoadedGamePackage): GameState {
	const state = emptyGameState()
	for (const character of Object.values(game.config.characters)) {
		state.characters[character.id] = {
			...commonState(character),
			attributes: Object.fromEntries(
				Object.values(character.attributes).map((attribute) => [attribute.id, commonState(attribute)]),
			),
		}
	}
	for (const effect of Object.values(game.config.effects)) {
		const effectState: EffectState = {
			...commonState(effect),
			acquiredValue: effect.acquiredValue,
			activedValue: effect.activedValue,
			...(effect.acquiredValue ? { acquiredTurn: 0 } : {}),
			...(effect.activedValue ? { activedTurn: 0 } : {}),
		}
		state.effects[effect.id] = effectState
	}
	for (const event of Object.values(game.config.events)) {
		const eventState = {
			...commonState(event),
			nodes: {} as Record<string, EventNodeState>,
		}
		for (const node of Object.values(event.nodes)) {
			const nodeState: EventNodeState = {
				...commonState(node),
			}
			if (node.type !== 'check') {
				if (node.requiredValue !== undefined) nodeState.requiredValue = node.requiredValue
				nodeState.choicesValue = Object.fromEntries(
					Object.values(node.choicesValue).map((choice) => [choice.id, choiceState(choice)]),
				)
			}
			if (node.type === 'multiple') {
				nodeState.commands = Object.fromEntries(
					Object.values(node.commands).map((command) => [command.id, commonState(command)]),
				)
			}
			eventState.nodes[node.id] = nodeState
		}
		state.events[event.id] = eventState
	}
	return state
}

/** 创建 initializing 阶段的空 TurnState。 */
function initialTurnState(): TurnState {
	return { ...emptyGameState(), turnNumber: 0, phase: 'initializing' }
}

/** 创建一条带 initial 检查点的 RunData，并返回当前游标。 */
function makeInitialRun(
	game: LoadedGamePackage,
	profileState: GameState,
	origin?: RunData['origin'],
): { run: RunData; ref: TurnRef } {
	const createdAt = timestamp()
	const runId = createId('run')
	const turnId = createId('turn')
	const runState = initialRunState(game)
	const turnState = initialTurnState()
	const randomState = { seed: crypto.randomUUID(), cursor: 0 }
	const snapshot: StateSnapshot = {
		profileState: structuredClone(profileState),
		runState: structuredClone(runState),
		turnState: structuredClone(turnState),
		randomState: structuredClone(randomState),
	}
	const initial: TurnData = {
		turnId,
		kind: 'initial',
		createdAt,
		pinned: false,
		snapshot,
	}
	const run: RunData = {
		runId,
		...(origin ? { origin } : {}),
		status: 'active',
		createdAt,
		updatedAt: createdAt,
		maxTurnCount: game.config.meta.maxTurnCountPerRun,
		currentTurnId: turnId,
		turnOrder: [turnId],
		turnDatas: { [turnId]: initial },
	}
	return { run, ref: { runId, turnId } }
}

/** 为指定游戏创建新的稳定存档和 initial 检查点。 */
export function createProfile(game: LoadedGamePackage): StoredProfile {
	const createdAt = timestamp()
	const profileState = emptyGameState()
	const { run, ref } = makeInitialRun(game, profileState)
	return {
		profileId: createId('profile'),
		configId: game.config.meta.id,
		configVersion: game.config.meta.version,
		createdAt,
		updatedAt: createdAt,
		runDatas: { [run.runId]: run },
		current: ref,
	}
}

/** 从终局或放弃检查点创建一条新的 restart 时间线。 */
export function addRestartRun(
	input: StoredProfile,
	game: LoadedGamePackage,
	source: TurnRef,
): StoredProfile {
	const profile = structuredClone(input)
	const sourceTurn = profile.runDatas[source.runId]?.turnDatas[source.turnId]
	if (!sourceTurn || (sourceTurn.kind !== 'terminal' && sourceTurn.kind !== 'abandoned')) {
		throw new Error('Restart requires a terminal or abandoned checkpoint')
	}
	const profileState = structuredClone(sourceTurn.snapshot.profileState)
	const { run, ref } = makeInitialRun(game, profileState, {
		kind: 'restart',
		source: { ...source },
	})
	profile.runDatas[run.runId] = run
	profile.current = ref
	profile.updatedAt = timestamp()
	return profile
}
