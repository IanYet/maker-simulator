import type {
	DeepReadonly,
	GameConfig,
	Reaction,
	RunState,
} from '../types'

/** 一个当前生效 Reaction 的 canonical 身份与执行上下文。 */
export interface ReactionDefinition {
	readonly key: string
	readonly ordinal: readonly (number | string)[]
	readonly reaction: DeepReadonly<Reaction>
	readonly selfPath: readonly string[]
	readonly sourceEventInstanceId?: string
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

/** 按 canonical ordinal 收集当前 Effect、Event 和 active TextNode Reaction。 */
export function collectReactionDefinitions(
	config: DeepReadonly<GameConfig>,
	runState: DeepReadonly<RunState>,
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
		const state = runState.events[event.id]
		for (const instance of Object.values(state?.instances ?? {})) {
			if (instance.status !== 'active') continue
			const node = event.nodes[instance.currentNodeId]
			if (!node || node.type === 'check') continue
			node.reactionList?.forEach((reaction, index) => {
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
				definitions.push({
					key: JSON.stringify(ordinal),
					ordinal,
					reaction,
					selfPath: ['events', event.id, 'nodes', node.id],
					sourceEventInstanceId: instance.instanceId,
				})
			})
		}
	}
	return definitions.sort((left, right) => compareOrdinal(left.ordinal, right.ordinal))
}
