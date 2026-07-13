import type { DeepReadonly, GameConfig, Reaction, RunState } from '../types'

/** 一个当前生效 Reaction 的 canonical 身份与执行上下文。 */
export interface ReactionDefinition {
	readonly key: string
	readonly ordinal: readonly (number | string)[]
	readonly reaction: DeepReadonly<Reaction>
	readonly selfPath: readonly string[]
	readonly sourceEventInstanceId?: string
}

/** 比较两个 Reaction 的 canonical ordinal。 */
export function compareReactionDefinitions(
	left: ReactionDefinition,
	right: ReactionDefinition,
): number {
	return compareOrdinal(left.ordinal, right.ordinal)
}

function compareOrdinal(
	left: readonly (number | string)[],
	right: readonly (number | string)[],
): number {
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const a = left[index]
		const b = right[index]
		if (a === undefined) return -1
		if (b === undefined) return 1
		if (a === b) continue
		if (typeof a === 'number' && typeof b === 'number') return a - b
		return String(a) < String(b) ? -1 : 1
	}
	return 0
}

/** 收集一局内始终注册的 EffectConfig 与 EventConfig Reaction。 */
export function collectStaticReactionDefinitions(
	config: DeepReadonly<GameConfig>,
): ReactionDefinition[] {
	const definitions: ReactionDefinition[] = []
	const effects = Object.values(config.effects).sort(
		(a, b) => a.order - b.order || a.id.localeCompare(b.id),
	)
	for (const effect of effects) {
		effect.reactionList.forEach((reaction, index) => {
			const ordinal = [0, effect.order, effect.id, index] as const
			definitions.push({
				key: JSON.stringify(ordinal),
				ordinal,
				reaction,
				selfPath: ['effects', effect.id],
			})
		})
	}
	const events = Object.values(config.events).sort(
		(a, b) => a.order - b.order || a.id.localeCompare(b.id),
	)
	for (const event of events) {
		event.reactionList?.forEach((reaction, index) => {
			const ordinal = [1, event.order, event.id, index] as const
			definitions.push({
				key: JSON.stringify(ordinal),
				ordinal,
				reaction,
				selfPath: ['events', event.id],
			})
		})
	}
	return definitions.sort(compareReactionDefinitions)
}

/** 为一个 active EventInstance 的当前 TextNode 构造局部 Reaction 定义。 */
export function collectTextNodeReactionDefinitions(
	config: DeepReadonly<GameConfig>,
	eventId: string,
	instance: {
		readonly instanceId: string
		readonly currentNodeId: string
		readonly startedTurn: number
		readonly status: string
	},
): ReactionDefinition[] {
	if (instance.status !== 'active') return []
	const event = config.events[eventId]
	const node = event?.nodes[instance.currentNodeId]
	if (!event || !node || node.type === 'check') return []
	return (node.reactionList ?? []).map((reaction, index) => {
		const ordinal = [
			2,
			event.order,
			event.id,
			instance.startedTurn,
			instance.instanceId,
			node.order,
			node.id,
			index,
		] as const
		return {
			key: JSON.stringify(ordinal),
			ordinal,
			reaction,
			selfPath: ['events', event.id, 'nodes', node.id],
			sourceEventInstanceId: instance.instanceId,
		}
	})
}

/** 恢复 Runtime 时一次性收集全部静态及当前 active TextNode Reaction。 */
export function collectReactionDefinitions(
	config: DeepReadonly<GameConfig>,
	runState: DeepReadonly<RunState>,
): ReactionDefinition[] {
	const definitions = collectStaticReactionDefinitions(config)
	for (const [eventId, state] of Object.entries(runState.events)) {
		for (const instance of Object.values(state.instances ?? {})) {
			definitions.push(...collectTextNodeReactionDefinitions(config, eventId, instance))
		}
	}
	return definitions.sort(compareReactionDefinitions)
}
