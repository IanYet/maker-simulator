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

/** ProfileState 未提供覆盖时回退到 Config 的基础初始值。 */
function inheritedValue<T>(profileValue: T | undefined, configValue: T): T {
	return profileValue === undefined ? configValue : profileValue
}

function commonState(
	config: DeepReadonly<CommonConfig>,
	profileState?: DeepReadonly<CommonState>,
): CommonState {
	return {
		id: config.id,
		weightValue: inheritedValue(profileState?.weightValue, config.weightValue),
		unlockedValue: inheritedValue(profileState?.unlockedValue, config.unlockedValue),
		enabledValue: inheritedValue(profileState?.enabledValue, config.enabledValue),
	}
}

function choiceState(
	choice: DeepReadonly<SingleChoice | MultipleChoice>,
	profileState?: DeepReadonly<ChoiceState>,
): ChoiceState {
	return {
		...commonState(choice, profileState),
		...('maxCountValue' in choice && choice.maxCountValue !== undefined
			? {
					maxCountValue: inheritedValue(profileState?.maxCountValue, choice.maxCountValue),
				}
			: {}),
	}
}

/** 根据 ProfileState 覆盖 Config 后的基础值构造首个 RunState。 */
function initialRunState(
	game: LoadedGamePackage,
	profileState: DeepReadonly<GameState>,
): GameState {
	const state = emptyGameState()
	for (const character of Object.values(game.config.characters)) {
		const characterProfile = profileState.characters[character.id]
		state.characters[character.id] = {
			...commonState(character, characterProfile),
			attributes: Object.fromEntries(
				Object.values(character.attributes).map((attribute) => [
					attribute.id,
					commonState(attribute, characterProfile?.attributes?.[attribute.id]),
				]),
			),
		}
	}
	for (const effect of Object.values(game.config.effects)) {
		const effectProfile = profileState.effects[effect.id]
		const acquiredValue = inheritedValue(effectProfile?.acquiredValue, effect.acquiredValue)
		const activedValue = inheritedValue(effectProfile?.activedValue, effect.activedValue)
		const effectState: EffectState = {
			...commonState(effect, effectProfile),
			acquiredValue,
			activedValue,
			...(acquiredValue ? { acquiredTurn: 0 } : {}),
			...(activedValue ? { activedTurn: 0 } : {}),
		}
		state.effects[effect.id] = effectState
	}
	for (const event of Object.values(game.config.events)) {
		const eventProfile = profileState.events[event.id]
		const eventState = {
			...commonState(event, eventProfile),
			nodes: {} as Record<string, EventNodeState>,
		}
		for (const node of Object.values(event.nodes)) {
			const nodeProfile = eventProfile?.nodes?.[node.id]
			const nodeState: EventNodeState = {
				...commonState(node, nodeProfile),
			}
			if (node.type !== 'check') {
				if (node.requiredValue !== undefined) {
					nodeState.requiredValue = inheritedValue(nodeProfile?.requiredValue, node.requiredValue)
				}
				nodeState.choicesValue = Object.fromEntries(
					Object.values(node.choicesValue).map((choice) => [
						choice.id,
						choiceState(choice, nodeProfile?.choicesValue?.[choice.id]),
					]),
				)
			}
			if (node.type === 'multiple') {
				nodeState.commands = Object.fromEntries(
					Object.values(node.commands).map((command) => [
						command.id,
						commonState(command, nodeProfile?.commands?.[command.id]),
					]),
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
	const runState = initialRunState(game, profileState)
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
