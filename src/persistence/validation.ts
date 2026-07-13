import type { StoredProfile, TurnData } from '../types'
import { parseProfile } from '../package-loader/schemas'

/** 指出存档结构错误及其 JSON 路径，便于定位损坏数据。 */
export class SaveValidationError extends Error {
	readonly path: string

	constructor(
		message: string,
		path: string,
	) {
		super(`${message} (${path})`)
		this.name = 'SaveValidationError'
		this.path = path
	}
}

function validateTurn(turn: TurnData, runId: string, turnId: string): void {
	if (turn.turnId !== turnId) {
		throw new SaveValidationError(
			'Turn key/id mismatch',
			`/runDatas/${runId}/turnDatas/${turnId}`,
		)
	}
	if (turn.snapshot.randomState.cursor < 0 || !Number.isSafeInteger(turn.snapshot.randomState.cursor)) {
		throw new SaveValidationError(
			'Invalid random cursor',
			`/runDatas/${runId}/turnDatas/${turnId}/snapshot/randomState/cursor`,
		)
	}
}

/** 解析并验证稳定存档的游标、检查点、RunData 和生命周期约束。 */
export function validateProfile(input: unknown): StoredProfile {
	const profile = parseProfile(input)
	const currentRun = profile.runDatas[profile.current.runId]
	if (!currentRun) throw new SaveValidationError('Current RunData does not exist', '/current/runId')
	if (currentRun.currentTurnId !== profile.current.turnId) {
		throw new SaveValidationError('Profile and RunData cursors differ', '/current/turnId')
	}

	for (const [runId, run] of Object.entries(profile.runDatas)) {
		if (run.runId !== runId) {
			throw new SaveValidationError('Run key/id mismatch', `/runDatas/${runId}`)
		}
		const orderSet = new Set(run.turnOrder)
		if (orderSet.size !== run.turnOrder.length) {
			throw new SaveValidationError('Duplicate TurnData in turnOrder', `/runDatas/${runId}/turnOrder`)
		}
		const dataKeys = Object.keys(run.turnDatas)
		if (dataKeys.length !== orderSet.size || dataKeys.some((id) => !orderSet.has(id))) {
			throw new SaveValidationError('turnOrder and turnDatas differ', `/runDatas/${runId}`)
		}
		if (run.currentTurnId !== run.turnOrder.at(-1)) {
			throw new SaveValidationError(
				'Current checkpoint must be the last retained checkpoint',
				`/runDatas/${runId}/currentTurnId`,
			)
		}
		for (const [turnId, turn] of Object.entries(run.turnDatas)) {
			validateTurn(turn, runId, turnId)
		}
		const current = run.turnDatas[run.currentTurnId]
		if (!current) {
			throw new SaveValidationError(
				'Run current checkpoint does not exist',
				`/runDatas/${runId}/currentTurnId`,
			)
		}
		if (run.status === 'ended' && (current.kind !== 'terminal' || !run.endedAt)) {
			throw new SaveValidationError('Ended RunData must end in terminal', `/runDatas/${runId}/status`)
		}
		if (run.status === 'abandoned' && (current.kind !== 'abandoned' || !run.endedAt)) {
			throw new SaveValidationError(
				'Abandoned RunData must end in abandoned',
				`/runDatas/${runId}/status`,
			)
		}
		if (run.status === 'active' && current.kind !== 'initial' && current.kind !== 'turn_end') {
			throw new SaveValidationError(
				'Active RunData must point to a playable checkpoint',
				`/runDatas/${runId}/status`,
			)
		}
	}

	return profile
}
