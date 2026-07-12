import type { Profile, TurnData } from '../types'
import { parseProfile } from '../package-loader/schemas'

/** 指出存档结构错误及其 JSON 路径，便于定位损坏或过期数据。 */
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

const sameJson = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left) === JSON.stringify(right)

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function moveLegacyField(object: Record<string, unknown>, legacy: string, current: string): void {
	if (object[current] === undefined && object[legacy] !== undefined) object[current] = object[legacy]
	delete object[legacy]
}

function migrateCommonState(object: Record<string, unknown>): void {
	moveLegacyField(object, 'weight', 'weightValue')
	moveLegacyField(object, 'unlocked', 'unlockedValue')
	moveLegacyField(object, 'enabled', 'enabledValue')
}

function migrateGameState(input: unknown): void {
	if (!isRecord(input)) return
	const characters = isRecord(input.characters) ? input.characters : {}
	for (const character of Object.values(characters)) {
		if (!isRecord(character)) continue
		migrateCommonState(character)
		if (!isRecord(character.attributes)) continue
		for (const attribute of Object.values(character.attributes)) {
			if (isRecord(attribute)) migrateCommonState(attribute)
		}
	}
	const effects = isRecord(input.effects) ? input.effects : {}
	for (const effect of Object.values(effects)) {
		if (!isRecord(effect)) continue
		migrateCommonState(effect)
		moveLegacyField(effect, 'acquired', 'acquiredValue')
		moveLegacyField(effect, 'actived', 'activedValue')
	}
	const events = isRecord(input.events) ? input.events : {}
	for (const event of Object.values(events)) {
		if (!isRecord(event)) continue
		migrateCommonState(event)
		if (!isRecord(event.nodes)) continue
		for (const node of Object.values(event.nodes)) {
			if (!isRecord(node)) continue
			migrateCommonState(node)
			moveLegacyField(node, 'required', 'requiredValue')
			moveLegacyField(node, 'choices', 'choicesValue')
			if (isRecord(node.choicesValue)) {
				for (const choice of Object.values(node.choicesValue)) {
					if (!isRecord(choice)) continue
					migrateCommonState(choice)
					moveLegacyField(choice, 'maxCount', 'maxCountValue')
				}
			}
			if (isRecord(node.commands)) {
				for (const command of Object.values(node.commands)) {
					if (isRecord(command)) migrateCommonState(command)
				}
			}
		}
	}
}

/** 将 State schema v1 的同名覆盖字段迁移为 v2 的 xxxValue 字段。 */
function migrateLegacyProfile(profile: Profile): Profile {
	migrateGameState(profile.state)
	for (const run of Object.values(profile.runDatas)) {
		migrateGameState(run.state)
		migrateGameState(run.turnState)
		for (const turn of Object.values(run.turnDatas)) {
			migrateGameState(turn.snapshot.profileState)
			migrateGameState(turn.snapshot.runState)
			migrateGameState(turn.snapshot.turnState)
		}
	}
	profile.stateVersion = 2
	return profile
}

function validateTurn(turn: TurnData, runId: string, turnId: string): void {
	if (turn.turnId !== turnId) throw new SaveValidationError('Turn key/id mismatch', `/runDatas/${runId}/turnDatas/${turnId}`)
	if (turn.snapshot.randomState.cursor < 0 || !Number.isSafeInteger(turn.snapshot.randomState.cursor)) {
		throw new SaveValidationError('Invalid random cursor', `/runDatas/${runId}/turnDatas/${turnId}/snapshot/randomState/cursor`)
	}
}

/** 解析并验证完整 Profile 的游标、检查点、RunData 和随机状态一致性。 */
export function validateProfile(input: unknown): Profile {
	const profile = migrateLegacyProfile(parseProfile(input))
	const currentRun = profile.runDatas[profile.current.runId]
	if (!currentRun) throw new SaveValidationError('Current RunData does not exist', '/current/runId')
	if (currentRun.currentTurnId !== profile.current.turnId) {
		throw new SaveValidationError('Profile and RunData cursors differ', '/current/turnId')
	}

	for (const [runId, run] of Object.entries(profile.runDatas)) {
		if (run.runId !== runId) throw new SaveValidationError('Run key/id mismatch', `/runDatas/${runId}`)
		const orderSet = new Set(run.turnOrder)
		if (orderSet.size !== run.turnOrder.length) {
			throw new SaveValidationError('Duplicate TurnData in turnOrder', `/runDatas/${runId}/turnOrder`)
		}
		const dataKeys = Object.keys(run.turnDatas)
		if (dataKeys.length !== orderSet.size || dataKeys.some((id) => !orderSet.has(id))) {
			throw new SaveValidationError('turnOrder and turnDatas differ', `/runDatas/${runId}`)
		}
		if (run.currentTurnId !== run.turnOrder.at(-1)) {
			throw new SaveValidationError('Current checkpoint must be the last retained checkpoint', `/runDatas/${runId}/currentTurnId`)
		}
		for (const [turnId, turn] of Object.entries(run.turnDatas)) validateTurn(turn, runId, turnId)
		const current = run.turnDatas[run.currentTurnId]
		if (!current) throw new SaveValidationError('Run current checkpoint does not exist', `/runDatas/${runId}/currentTurnId`)
		if (!sameJson(run.state, current.snapshot.runState) || !sameJson(run.turnState, current.snapshot.turnState)) {
			throw new SaveValidationError('Run working state differs from current checkpoint', `/runDatas/${runId}`)
		}
		if (!sameJson(run.randomState, current.snapshot.randomState)) {
			throw new SaveValidationError('Random state differs from current checkpoint', `/runDatas/${runId}/randomState`)
		}
		if (run.status === 'ended' && (current.kind !== 'terminal' || !run.endedAt)) {
			throw new SaveValidationError('Ended RunData must end in terminal', `/runDatas/${runId}/status`)
		}
		if (run.status === 'abandoned' && (current.kind !== 'abandoned' || !run.endedAt)) {
			throw new SaveValidationError('Abandoned RunData must end in abandoned', `/runDatas/${runId}/status`)
		}
		if (run.status === 'active' && current.kind !== 'initial' && current.kind !== 'turn_end') {
			throw new SaveValidationError('Active RunData must point to a playable checkpoint', `/runDatas/${runId}/status`)
		}
	}

	const currentTurn = currentRun.turnDatas[profile.current.turnId]
	if (!sameJson(profile.state, currentTurn.snapshot.profileState)) {
		throw new SaveValidationError('Profile working state differs from current checkpoint', '/state')
	}
	return profile
}
