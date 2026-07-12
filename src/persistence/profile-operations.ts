import type { Profile, RunData, StateSnapshot, TurnData, TurnRef } from '../types'

const now = (): string => new Date().toISOString()
const createId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`

function sourceTurn(profile: Profile, source: TurnRef): TurnData {
	const turn = profile.runDatas[source.runId]?.turnDatas[source.turnId]
	if (!turn) throw new Error('The selected checkpoint no longer exists')
	return turn
}

function requirePlayable(turn: TurnData): void {
	if (turn.kind !== 'initial' && turn.kind !== 'turn_end') {
		throw new Error('This checkpoint is read-only')
	}
}

function copySnapshotToWorking(profile: Profile, run: RunData, snapshot: StateSnapshot): void {
	profile.state = structuredClone(snapshot.profileState)
	run.state = structuredClone(snapshot.runState)
	run.turnState = structuredClone(snapshot.turnState)
	run.randomState = structuredClone(snapshot.randomState)
}

export function continueCheckpoint(input: Profile, source: TurnRef): Profile {
	const profile = structuredClone(input)
	const turn = sourceTurn(profile, source)
	requirePlayable(turn)
	const run = profile.runDatas[source.runId]
	if (run.currentTurnId !== source.turnId) throw new Error('A historical checkpoint requires a branch or truncation')
	copySnapshotToWorking(profile, run, turn.snapshot)
	profile.current = { ...source }
	return profile
}

export function createBranch(input: Profile, source: TurnRef): Profile {
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
		randomState: structuredClone(turn.snapshot.randomState),
		state: structuredClone(turn.snapshot.runState),
		turnState: structuredClone(turn.snapshot.turnState),
		currentTurnId: turnId,
		turnOrder: [turnId],
		turnDatas: { [turnId]: initial },
	}
	profile.state = structuredClone(turn.snapshot.profileState)
	profile.runDatas[runId] = run
	profile.current = { runId, turnId }
	profile.updatedAt = createdAt
	return profile
}

export function truncateAndContinue(input: Profile, source: TurnRef): Profile {
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
	copySnapshotToWorking(profile, run, turn.snapshot)
	const updatedAt = now()
	run.updatedAt = updatedAt
	profile.updatedAt = updatedAt
	profile.current = { ...source }
	return profile
}

export function setCheckpointPinned(input: Profile, source: TurnRef, pinned: boolean): Profile {
	const profile = structuredClone(input)
	const turn = sourceTurn(profile, source)
	turn.pinned = pinned
	const updatedAt = now()
	profile.runDatas[source.runId].updatedAt = updatedAt
	profile.updatedAt = updatedAt
	return profile
}
