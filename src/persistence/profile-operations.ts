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

function removeRun(
	profile: StoredProfile,
	runId: string,
	updatedAt: string,
): StoredProfile | undefined {
	if (!profile.runDatas[runId]) throw new Error('The selected timeline no longer exists')
	delete profile.runDatas[runId]
	const remainingRuns = Object.values(profile.runDatas)
	if (remainingRuns.length === 0) return undefined

	if (profile.current.runId === runId) {
		// 删除当前时间线后，选择最近更新的剩余时间线；额外比较字段保证结果稳定。
		const fallback = remainingRuns.sort(
			(left, right) =>
				right.updatedAt.localeCompare(left.updatedAt) ||
				right.createdAt.localeCompare(left.createdAt) ||
				right.runId.localeCompare(left.runId),
		)[0]
		profile.current = { runId: fallback.runId, turnId: fallback.currentTurnId }
	}
	profile.updatedAt = updatedAt
	return profile
}

function restoreRunLifecycle(run: RunData, current: TurnData): void {
	if (current.kind === 'terminal') {
		run.status = 'ended'
		run.endedAt ??= current.createdAt
		return
	}
	if (current.kind === 'abandoned') {
		run.status = 'abandoned'
		run.endedAt ??= current.createdAt
		return
	}
	run.status = 'active'
	delete run.endedAt
}

/** 从当前检查点继续游玩；历史检查点必须先创建分支或截断。 */
export function continueCheckpoint(input: StoredProfile, source: TurnRef): StoredProfile {
	const profile = structuredClone(input)
	const turn = sourceTurn(profile, source)
	requirePlayable(turn)
	const run = profile.runDatas[source.runId]
	if (run.currentTurnId !== source.turnId)
		throw new Error('A historical checkpoint requires a branch or truncation')
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
export function setCheckpointPinned(
	input: StoredProfile,
	source: TurnRef,
	pinned: boolean,
): StoredProfile {
	const profile = structuredClone(input)
	const turn = sourceTurn(profile, source)
	turn.pinned = pinned
	const updatedAt = now()
	profile.runDatas[source.runId].updatedAt = updatedAt
	profile.updatedAt = updatedAt
	return profile
}

/**
 * 显式删除一个检查点；pin 只影响自动清理，不阻止此操作。
 *
 * 删除时间线最后一个检查点时级联删除该时间线；存档因此不再包含时间线时
 * 返回 undefined，交由 Repository 删除整个 Profile。
 */
export function deleteCheckpoint(input: StoredProfile, source: TurnRef): StoredProfile | undefined {
	const profile = structuredClone(input)
	const run = profile.runDatas[source.runId]
	if (!run?.turnDatas[source.turnId]) {
		throw new Error('The selected checkpoint no longer exists')
	}
	const updatedAt = now()
	if (run.turnOrder.length === 1) return removeRun(profile, source.runId, updatedAt)

	delete run.turnDatas[source.turnId]
	run.turnOrder = run.turnOrder.filter((turnId) => turnId !== source.turnId)
	if (run.currentTurnId === source.turnId) {
		const fallbackTurnId = run.turnOrder.at(-1)
		if (!fallbackTurnId) throw new Error('The selected timeline has no remaining checkpoint')
		run.currentTurnId = fallbackTurnId
		const fallback = run.turnDatas[fallbackTurnId]
		restoreRunLifecycle(run, fallback)
		if (profile.current.runId === source.runId) {
			profile.current = { runId: source.runId, turnId: fallbackTurnId }
		}
	}
	run.updatedAt = updatedAt
	profile.updatedAt = updatedAt
	return profile
}

/**
 * 显式删除一条完整时间线；其中的 pin 检查点不会受到额外保护。
 * 删除最后一条时间线时返回 undefined，表示整个 Profile 应一并删除。
 */
export function deleteRun(input: StoredProfile, runId: string): StoredProfile | undefined {
	return removeRun(structuredClone(input), runId, now())
}
