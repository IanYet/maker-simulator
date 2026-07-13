import type { RunData, StoredProfile, TurnData, TurnRef } from '../types'

const now = (): string => new Date().toISOString()
const createId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`

function sourceTurn(profile: StoredProfile, source: TurnRef): TurnData {
	const turn = profile.runDatas[source.runId]?.turnDatas[source.turnId]
	if (!turn) throw new Error('The selected checkpoint no longer exists')
	return turn
}

function requirePlayable(turn: TurnData): void {
	if (turn.kind !== 'initial' && turn.kind !== 'turn_end') {
		throw new Error('This checkpoint is read-only')
	}
}

/** 从当前检查点继续游玩；历史检查点必须先创建分支或截断。 */
export function continueCheckpoint(input: StoredProfile, source: TurnRef): StoredProfile {
	const profile = structuredClone(input)
	const turn = sourceTurn(profile, source)
	requirePlayable(turn)
	const run = profile.runDatas[source.runId]
	if (run.currentTurnId !== source.turnId) throw new Error('A historical checkpoint requires a branch or truncation')
	profile.current = { ...source }
	return profile
}

/** 从可游玩的检查点复制一条独立 RunData 时间线。 */
export function createBranch(input: StoredProfile, source: TurnRef): StoredProfile {
	const profile = structuredClone(input)
	const turn = sourceTurn(profile, source)
	requirePlayable(turn)
	const createdAt = now()
	const runId = createId('run')
	const turnId = createId('turn')
	const initial: TurnData = {
		turnId,
		kind: 'initial',
		createdAt,
		pinned: false,
		snapshot: structuredClone(turn.snapshot),
	}
	const sourceRun = profile.runDatas[source.runId]
	const run: RunData = {
		runId,
		origin: { kind: 'branch', source: { ...source } },
		status: 'active',
		createdAt,
		updatedAt: createdAt,
		maxTurnCount: sourceRun.maxTurnCount,
		currentTurnId: turnId,
		turnOrder: [turnId],
		turnDatas: { [turnId]: initial },
	}
	profile.runDatas[runId] = run
	profile.current = { runId, turnId }
	profile.updatedAt = createdAt
	return profile
}

/** 删除目标检查点之后的历史，并把同一条时间线恢复到该检查点。 */
export function truncateAndContinue(input: StoredProfile, source: TurnRef): StoredProfile {
	const profile = structuredClone(input)
	const turn = sourceTurn(profile, source)
	requirePlayable(turn)
	const run = profile.runDatas[source.runId]
	const index = run.turnOrder.indexOf(source.turnId)
	if (index < 0) throw new Error('The selected checkpoint no longer exists')
	for (const turnId of run.turnOrder.slice(index + 1)) delete run.turnDatas[turnId]
	run.turnOrder = run.turnOrder.slice(0, index + 1)
	run.currentTurnId = source.turnId
	run.status = 'active'
	delete run.endedAt
	const updatedAt = now()
	run.updatedAt = updatedAt
	profile.updatedAt = updatedAt
	profile.current = { ...source }
	return profile
}

/** 修改检查点的 pin 状态，影响后续自动保留策略。 */
export function setCheckpointPinned(input: StoredProfile, source: TurnRef, pinned: boolean): StoredProfile {
	const profile = structuredClone(input)
	const turn = sourceTurn(profile, source)
	turn.pinned = pinned
	const updatedAt = now()
	profile.runDatas[source.runId].updatedAt = updatedAt
	profile.updatedAt = updatedAt
	return profile
}
