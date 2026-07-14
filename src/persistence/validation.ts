import type {
	DeepReadonly,
	GameConfig,
	GameState,
	Primitive,
	RunState,
	StoredProfile,
	TurnData,
	TurnState,
} from '../types'
import { parseProfile } from '../package-loader/schemas'

/** 指出存档结构错误及其 JSON 路径，便于定位损坏数据。 */
export class SaveValidationError extends Error {
	readonly path: string

	constructor(message: string, path: string) {
		super(`${message} (${path})`)
		this.name = 'SaveValidationError'
		this.path = path
	}
}

function validateTurn(turn: TurnData, runId: string, turnId: string): void {
	if (turn.turnId !== turnId) {
		throw new SaveValidationError('Turn key/id mismatch', `/runDatas/${runId}/turnDatas/${turnId}`)
	}
	if (
		turn.snapshot.randomState.cursor < 0 ||
		!Number.isSafeInteger(turn.snapshot.randomState.cursor)
	) {
		throw new SaveValidationError(
			'Invalid random cursor',
			`/runDatas/${runId}/turnDatas/${turnId}/snapshot/randomState/cursor`,
		)
	}
}

/** 解析并验证稳定存档的游标、检查点、RunData 和生命周期约束。 */
export function validateStoredProfile(input: unknown): StoredProfile {
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
			throw new SaveValidationError(
				'Duplicate TurnData in turnOrder',
				`/runDatas/${runId}/turnOrder`,
			)
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
			throw new SaveValidationError(
				'Ended RunData must end in terminal',
				`/runDatas/${runId}/status`,
			)
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

type StateLayer = 'profileState' | 'runState' | 'turnState'

function pointerSegment(value: string): string {
	return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function childPath(path: string, value: string): string {
	return `${path}/${pointerSegment(value)}`
}

function assertStateId(id: string, key: string, path: string): void {
	if (id !== key) throw new SaveValidationError('State key/id mismatch', path)
}

function assertPrimitiveEqual(actual: Primitive, expected: Primitive, path: string): void {
	if (!Object.is(actual, expected)) {
		throw new SaveValidationError('Selection value differs from Config', path)
	}
}

function validateGameState(
	state: GameState,
	config: DeepReadonly<GameConfig>,
	path: string,
	layer: StateLayer,
): void {
	for (const [characterId, characterState] of Object.entries(state.characters)) {
		const characterPath = childPath(`${path}/characters`, characterId)
		const character = config.characters[characterId]
		if (!character) throw new SaveValidationError('Unknown Character state', characterPath)
		assertStateId(characterState.id, characterId, characterPath)
		for (const [attributeId, attributeState] of Object.entries(characterState.attributes ?? {})) {
			const attributePath = childPath(`${characterPath}/attributes`, attributeId)
			const attribute = character.attributes[attributeId]
			if (!attribute) throw new SaveValidationError('Unknown Attribute state', attributePath)
			assertStateId(attributeState.id, attributeId, attributePath)
			if (attributeState.value === undefined) continue
			if (attribute.type === 'enum') {
				if (
					!Number.isInteger(attributeState.value) ||
					attributeState.value < 0 ||
					attributeState.value >= attribute.valueDisplay.length
				) {
					throw new SaveValidationError('Invalid enum Attribute value', `${attributePath}/value`)
				}
			} else if (
				(attribute.min !== undefined && attributeState.value < attribute.min) ||
				(attribute.max !== undefined && attributeState.value > attribute.max)
			) {
				throw new SaveValidationError(
					'Number Attribute value is outside Config range',
					`${attributePath}/value`,
				)
			}
		}
	}

	for (const [effectId, effectState] of Object.entries(state.effects)) {
		const effectPath = childPath(`${path}/effects`, effectId)
		if (!config.effects[effectId]) throw new SaveValidationError('Unknown Effect state', effectPath)
		assertStateId(effectState.id, effectId, effectPath)
		if (effectState.bindCharacterId && !config.characters[effectState.bindCharacterId]) {
			throw new SaveValidationError(
				'Unknown Effect character binding',
				`${effectPath}/bindCharacterId`,
			)
		}
		if (
			layer !== 'runState' &&
			(effectState.acquiredTurn !== undefined || effectState.activedTurn !== undefined)
		) {
			throw new SaveValidationError(
				'Effect lifecycle turns are allowed only in RunState',
				effectPath,
			)
		}
	}

	for (const [eventId, eventState] of Object.entries(state.events)) {
		const eventPath = childPath(`${path}/events`, eventId)
		const event = config.events[eventId]
		if (!event) throw new SaveValidationError('Unknown Event state', eventPath)
		assertStateId(eventState.id, eventId, eventPath)
		if (layer !== 'runState' && (eventState.instances || eventState.activeInstanceId)) {
			throw new SaveValidationError('Event instances are allowed only in RunState', eventPath)
		}
		for (const [nodeId, nodeState] of Object.entries(eventState.nodes ?? {})) {
			const nodePath = childPath(`${eventPath}/nodes`, nodeId)
			const node = event.nodes[nodeId]
			if (!node) throw new SaveValidationError('Unknown Event node state', nodePath)
			assertStateId(nodeState.id, nodeId, nodePath)
			if (nodeState.requiredValue !== undefined && node.type === 'check') {
				throw new SaveValidationError(
					'CheckNode cannot have required state',
					`${nodePath}/requiredValue`,
				)
			}
			if (nodeState.selections && layer !== 'turnState') {
				throw new SaveValidationError(
					'Selections are allowed only in TurnState',
					`${nodePath}/selections`,
				)
			}
			if (nodeState.choicesValue && node.type === 'check') {
				throw new SaveValidationError(
					'CheckNode cannot have Choice state',
					`${nodePath}/choicesValue`,
				)
			}
			for (const [choiceId, choiceState] of Object.entries(nodeState.choicesValue ?? {})) {
				const choicePath = childPath(`${nodePath}/choicesValue`, choiceId)
				if (node.type === 'check' || !node.choicesValue[choiceId]) {
					throw new SaveValidationError('Unknown Choice state', choicePath)
				}
				assertStateId(choiceState.id, choiceId, choicePath)
			}
			if (nodeState.commands && node.type !== 'multiple') {
				throw new SaveValidationError(
					'Commands state requires a multiple node',
					`${nodePath}/commands`,
				)
			}
			for (const [commandId, commandState] of Object.entries(nodeState.commands ?? {})) {
				const commandPath = childPath(`${nodePath}/commands`, commandId)
				if (node.type !== 'multiple' || !node.commands[commandId]) {
					throw new SaveValidationError('Unknown NodeCommand state', commandPath)
				}
				assertStateId(commandState.id, commandId, commandPath)
			}
		}
	}
}

function validateRunInstances(
	runState: RunState,
	config: DeepReadonly<GameConfig>,
	turnNumber: number,
	path: string,
): ReadonlyMap<string, { eventId: string; currentNodeId: string }> {
	const instances = new Map<string, { eventId: string; currentNodeId: string }>()
	for (const [eventId, eventState] of Object.entries(runState.events)) {
		const event = config.events[eventId]
		if (!event) continue
		const eventPath = childPath(`${path}/events`, eventId)
		const active: string[] = []
		for (const [instanceId, instance] of Object.entries(eventState.instances ?? {})) {
			const instancePath = childPath(`${eventPath}/instances`, instanceId)
			if (instances.has(instanceId)) {
				throw new SaveValidationError('Duplicate EventInstance id in RunState', instancePath)
			}
			if (instance.instanceId !== instanceId) {
				throw new SaveValidationError('EventInstance key/id mismatch', instancePath)
			}
			if (instance.eventId !== eventId) {
				throw new SaveValidationError(
					'EventInstance belongs to another Event',
					`${instancePath}/eventId`,
				)
			}
			if (!event.nodes[instance.currentNodeId]) {
				throw new SaveValidationError('Unknown current Event node', `${instancePath}/currentNodeId`)
			}
			for (let index = 0; index < instance.nodePath.length; index += 1) {
				if (!event.nodes[instance.nodePath[index]]) {
					throw new SaveValidationError(
						'Unknown Event node in nodePath',
						`${instancePath}/nodePath/${index}`,
					)
				}
			}
			if (instance.nodePath.at(-1) !== instance.currentNodeId) {
				throw new SaveValidationError(
					'nodePath must end at currentNodeId',
					`${instancePath}/nodePath`,
				)
			}
			if (instance.startedTurn > turnNumber) {
				throw new SaveValidationError(
					'EventInstance starts after snapshot turn',
					`${instancePath}/startedTurn`,
				)
			}
			if (instance.status === 'active') {
				active.push(instanceId)
				if (instance.endedTurn !== undefined) {
					throw new SaveValidationError(
						'Active EventInstance cannot have endedTurn',
						`${instancePath}/endedTurn`,
					)
				}
			} else if (
				instance.endedTurn === undefined ||
				instance.endedTurn < instance.startedTurn ||
				instance.endedTurn > turnNumber
			) {
				throw new SaveValidationError(
					'Invalid EventInstance endedTurn',
					`${instancePath}/endedTurn`,
				)
			}
			instances.set(instanceId, { eventId, currentNodeId: instance.currentNodeId })
		}
		if (active.length > 1) {
			throw new SaveValidationError(
				'Event has more than one active instance',
				`${eventPath}/instances`,
			)
		}
		if (eventState.activeInstanceId !== active[0]) {
			throw new SaveValidationError(
				'activeInstanceId must point to the active EventInstance',
				`${eventPath}/activeInstanceId`,
			)
		}
	}
	return instances
}

function validateSelections(
	turnState: TurnState,
	config: DeepReadonly<GameConfig>,
	instances: ReadonlyMap<string, { eventId: string; currentNodeId: string }>,
	path: string,
): void {
	for (const [eventId, eventState] of Object.entries(turnState.events)) {
		const event = config.events[eventId]
		if (!event) continue
		for (const [nodeId, nodeState] of Object.entries(eventState.nodes ?? {})) {
			const node = event.nodes[nodeId]
			if (!nodeState.selections) continue
			const selectionsPath = `${childPath(`${path}/events`, eventId)}/nodes/${pointerSegment(nodeId)}/selections`
			if (!node || node.type !== 'multiple') {
				throw new SaveValidationError('Selections require a multiple node', selectionsPath)
			}
			for (const [instanceId, selection] of Object.entries(nodeState.selections)) {
				const selectionPath = childPath(selectionsPath, instanceId)
				const instance = instances.get(instanceId)
				if (selection.eventInstanceId !== instanceId) {
					throw new SaveValidationError('Selection key/id mismatch', selectionPath)
				}
				if (!instance || instance.eventId !== eventId || instance.currentNodeId !== nodeId) {
					throw new SaveValidationError(
						'Selection does not target the current Event node',
						selectionPath,
					)
				}
				for (const [choiceId, choice] of Object.entries(selection.choices)) {
					const choicePath = childPath(`${selectionPath}/choices`, choiceId)
					const configured = node.choicesValue[choiceId]
					if (!configured) throw new SaveValidationError('Unknown selected Choice', choicePath)
					if (choice.id !== choiceId) {
						throw new SaveValidationError('Selected Choice key/id mismatch', choicePath)
					}
					assertPrimitiveEqual(choice.value, configured.value, `${choicePath}/value`)
				}
			}
		}
	}
}

function validateSnapshot(turn: TurnData, config: DeepReadonly<GameConfig>, path: string): void {
	const { snapshot } = turn
	validateGameState(snapshot.profileState, config, `${path}/snapshot/profileState`, 'profileState')
	validateGameState(snapshot.runState, config, `${path}/snapshot/runState`, 'runState')
	validateGameState(snapshot.turnState, config, `${path}/snapshot/turnState`, 'turnState')
	const instances = validateRunInstances(
		snapshot.runState,
		config,
		snapshot.turnState.turnNumber,
		`${path}/snapshot/runState`,
	)
	validateSelections(snapshot.turnState, config, instances, `${path}/snapshot/turnState`)
	if (
		turn.kind === 'terminal' &&
		turn.endingEventInstanceId &&
		!instances.has(turn.endingEventInstanceId)
	) {
		throw new SaveValidationError(
			'endingEventInstanceId does not exist in snapshot RunState',
			`${path}/endingEventInstanceId`,
		)
	}
}

/**
 * 使用存档记录的精确 Config 校验所有 State key、对象引用和领域生命周期。
 * 返回重新解析后的副本；错误路径使用稳定 JSON Pointer。
 */
export function validateProfileAgainstConfig(
	input: unknown,
	config: DeepReadonly<GameConfig>,
): StoredProfile {
	const profile = validateStoredProfile(input)
	if (profile.configId !== config.meta.id) {
		throw new SaveValidationError('Profile configId differs from Config', '/configId')
	}
	if (profile.configVersion !== config.meta.version) {
		throw new SaveValidationError('Profile configVersion differs from Config', '/configVersion')
	}

	for (const [runId, run] of Object.entries(profile.runDatas)) {
		const runPath = childPath('/runDatas', runId)
		let previousTurnNumber = -1
		for (const turnId of run.turnOrder) {
			const turn = run.turnDatas[turnId]
			const turnPath = childPath(`${runPath}/turnDatas`, turnId)
			const turnNumber = turn.snapshot.turnState.turnNumber
			if (turnNumber < previousTurnNumber) {
				throw new SaveValidationError(
					'Checkpoint turn numbers must be monotonic',
					`${turnPath}/snapshot/turnState/turnNumber`,
				)
			}
			previousTurnNumber = turnNumber
			validateSnapshot(turn, config, turnPath)
		}
		if (run.origin) {
			const source = profile.runDatas[run.origin.source.runId]?.turnDatas[run.origin.source.turnId]
			if (
				source &&
				(run.origin.kind === 'branch'
					? source.kind !== 'initial' && source.kind !== 'turn_end'
					: source.kind !== 'terminal' && source.kind !== 'abandoned')
			) {
				throw new SaveValidationError(
					'Run origin points to an incompatible checkpoint kind',
					`${runPath}/origin/source`,
				)
			}
		}
	}

	return profile
}
