import type {
	GameState,
	LoadedGamePackage,
	Profile,
	RunData,
	StateSnapshot,
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

/** 根据 Config 的直接初始值构造首个 RunState；Rule 派生值由 Runtime 后续计算。 */
function initialRunState(game: LoadedGamePackage): GameState {
	const state = emptyGameState()
	for (const effect of Object.values(game.config.effects)) {
		const acquired = typeof effect.acquired === 'boolean' ? effect.acquired : effect.acquired.value
		const actived = typeof effect.actived === 'boolean' ? effect.actived : effect.actived.value
		if (acquired || actived) {
			state.effects[effect.id] = {
				id: effect.id,
				...(acquired ? { acquired: true, acquiredTurn: 0 } : {}),
				...(actived ? { actived: true, activedTurn: 0 } : {}),
			}
		}
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
		randomState,
		state: runState,
		turnState,
		currentTurnId: turnId,
		turnOrder: [turnId],
		turnDatas: { [turnId]: initial },
	}
	return { run, ref: { runId, turnId } }
}

/** 为指定游戏创建新的 Profile、RunData 和 initial 检查点。 */
export function createProfile(game: LoadedGamePackage): Profile {
	const createdAt = timestamp()
	const profileState = emptyGameState()
	const { run, ref } = makeInitialRun(game, profileState)
	return {
		profileId: createId('profile'),
		stateVersion: 1,
		configId: game.config.meta.id,
		configVersion: game.config.meta.version,
		createdAt,
		updatedAt: createdAt,
		state: profileState,
		runDatas: { [run.runId]: run },
		current: ref,
	}
}

/** 从终局或放弃检查点创建一条新的 restart 时间线。 */
export function addRestartRun(
	input: Profile,
	game: LoadedGamePackage,
	source: TurnRef,
): Profile {
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
	profile.state = profileState
	profile.runDatas[run.runId] = run
	profile.current = ref
	profile.updatedAt = timestamp()
	return profile
}
