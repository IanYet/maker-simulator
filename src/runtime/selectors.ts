import type {
	ActiveEventView,
	DeepReadonly,
	EffectView,
	EndingEventView,
	EventNodeView,
	GameConfig,
	MultipleChoiceView,
	RunData,
	RuntimeSnapshot,
	SingleChoiceView,
	TurnRuntime,
} from '../types'

/** 判断 pending Event 的入口或 CheckNode 候选链是否可达 required TextNode。 */
export function pendingEventRequired(event: TurnRuntime['events'][string]): boolean {
	const visited = new Set<string>()
	const requiresHandling = (nodeId: string): boolean => {
		if (visited.has(nodeId)) return false
		visited.add(nodeId)
		const node = event.nodes[nodeId]
		if (!node) return false
		if (node.type !== 'check') return node.required ?? false
		return Object.keys(node.candidateNodes).some((candidateId) => requiresHandling(candidateId))
	}
	return requiresHandling(event.entryNodeId)
}

/** 把一个稳定 TextNode 运行时对象投影为 UI 节点模型。 */
export function projectNodeView(
	node: TurnRuntime['events'][string]['nodes'][string],
	instanceId: string,
): EventNodeView {
	const common = {
		nodeId: node.id,
		displayName: node.displayName,
		...(node.description ? { description: node.description } : {}),
		content: 'content' in node ? node.content : '',
		required: 'required' in node ? (node.required ?? false) : false,
	}
	if (node.type === 'single') {
		const choices: SingleChoiceView[] = Object.values(node.choices)
			.filter((choice) => choice.visible && choice.unlocked)
			.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
			.map((choice) => ({
				choiceId: choice.id,
				displayName: choice.displayName,
				...(choice.description ? { description: choice.description } : {}),
				enabled: choice.enabled,
			}))
		return { ...common, type: 'single', choices }
	}
	if (node.type === 'check') throw new Error('CheckNode cannot be projected to the UI')
	const selection = node.selections?.[instanceId]
	const choices: MultipleChoiceView[] = Object.values(node.choices)
		.filter((choice) => choice.visible && choice.unlocked)
		.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
		.map((choice) => ({
			choiceId: choice.id,
			displayName: choice.displayName,
			...(choice.description ? { description: choice.description } : {}),
			enabled: choice.enabled,
			value: choice.value,
			count: selection?.choices[choice.id]?.count ?? 0,
			...(choice.maxCount !== undefined ? { maxCount: choice.maxCount } : {}),
		}))
	const commands = Object.values(node.commands)
		.filter((command) => command.visible && command.unlocked)
		.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
		.map((command) => ({
			commandId: command.id,
			displayName: command.displayName,
			...(command.description ? { description: command.description } : {}),
			enabled: command.enabled,
		}))
	return { ...common, type: 'multiple', choices, commands }
}

function projectEndingEvent(run: RunData, runtime: TurnRuntime): { endingEvent?: EndingEventView } {
	const terminal = run.turnDatas[run.currentTurnId]
	if (terminal.kind !== 'terminal' || !terminal.endingEventInstanceId) return {}
	for (const event of Object.values(runtime.events)) {
		const instance = event.instances[terminal.endingEventInstanceId]
		if (!instance) continue
		const node = event.nodes[instance.currentNodeId]
		if (!node || node.type === 'check') return {}
		return {
			endingEvent: {
				eventId: event.id,
				eventInstanceId: instance.instanceId,
				displayName: event.displayName,
				status: instance.status,
				currentNodeId: node.id,
				currentNode: projectNodeView(node, instance.instanceId),
			},
		}
	}
	return {}
}

/** 从已稳定的解析 State 生成唯一的 Runtime UI snapshot。 */
export function projectRuntimeSnapshot(options: {
	readonly config: DeepReadonly<GameConfig>
	readonly runtime: TurnRuntime
	readonly run: RunData
	readonly revision: number
}): RuntimeSnapshot {
	const { config, runtime, run, revision } = options
	const attributes = Object.values(config.characters)
		.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
		.flatMap((characterConfig) => {
			const character = runtime.characters[characterConfig.id]
			if (!character.visible || !character.unlocked) return []
			return Object.values(characterConfig.attributes)
				.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
				.flatMap((attributeConfig) => {
					const attribute = character.attributes[attributeConfig.id]
					if (!attribute.visible || !attribute.unlocked) return []
					return [
						{
							characterId: character.id,
							characterDisplayName: character.displayName,
							attributeId: attribute.id,
							displayName: attribute.displayName,
							type: attribute.type,
							value: attribute.value,
							displayValue:
								attribute.type === 'enum'
									? attribute.valueDisplay[attribute.value]
									: String(attribute.value),
							...(attribute.type === 'number' && attribute.min !== undefined
								? { min: attribute.min }
								: {}),
							...(attribute.type === 'number' && attribute.max !== undefined
								? { max: attribute.max }
								: {}),
						},
					]
				})
		})
	const effects: EffectView[] = Object.values(config.effects)
		.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
		.flatMap((effectConfig) => {
			const effect = runtime.effects[effectConfig.id]
			if (!effect.visible || !effect.unlocked || !effect.acquired) return []
			const bound = effect.bindCharacterId ? runtime.characters[effect.bindCharacterId] : undefined
			return [
				{
					effectId: effect.id,
					displayName: effect.displayName,
					...(effect.description ? { description: effect.description } : {}),
					actived: effect.actived,
					manuallyActivatable: effectConfig.manuallyActivatable,
					canActivate:
						effectConfig.manuallyActivatable &&
						!effect.actived &&
						effect.enabled &&
						run.status === 'active' &&
						runtime.phase === 'event_handle',
					...(effect.bindCharacterId ? { bindCharacterId: effect.bindCharacterId } : {}),
					...(bound ? { bindCharacterDisplayName: bound.displayName } : {}),
				},
			]
		})
	const eventCards = []
	const activeEvents: ActiveEventView[] = []
	const pendingEventBlockers: RuntimeSnapshot['advanceTurnBlockers'][number][] = []
	for (const eventConfig of Object.values(config.events).sort(
		(a, b) => a.order - b.order || a.id.localeCompare(b.id),
	)) {
		const event = runtime.events[eventConfig.id]
		if (event.activeInstanceId) {
			const instance = event.instances[event.activeInstanceId]
			if (instance?.status === 'active') {
				const node = event.nodes[instance.currentNodeId]
				if (node.type !== 'check') {
					const currentNode = projectNodeView(node, instance.instanceId)
					activeEvents.push({
						eventId: event.id,
						eventInstanceId: instance.instanceId,
						displayName: event.displayName,
						status: 'active',
						currentNodeId: node.id,
						required: currentNode.required,
						currentNode,
					})
				}
			}
		} else if (
			run.status === 'active' &&
			runtime.phase === 'event_handle' &&
			event.visible &&
			event.unlocked &&
			event.enabled &&
			!Object.values(event.instances).some(
				(instance) => instance.startedTurn === runtime.turnNumber,
			)
		) {
			const required = pendingEventRequired(event)
			eventCards.push({
				eventId: event.id,
				displayName: event.displayName,
				...(event.description ? { description: event.description } : {}),
				required,
			})
			if (required) {
				pendingEventBlockers.push({
					kind: 'pending-required-event',
					eventId: event.id,
					message: `待处理事件「${event.displayName}」必须处理`,
				})
			}
		}
	}
	const blockers = [
		...pendingEventBlockers,
		...activeEvents
			.filter((event) => event.required)
			.map((event) => ({
				kind: 'active-required-event' as const,
				eventId: event.eventId,
				eventInstanceId: event.eventInstanceId,
				message: `进行中事件「${event.displayName}」必须处理`,
			})),
	]
	const base = {
		revision,
		runId: run.runId,
		turnNumber: runtime.turnNumber,
		phase: runtime.phase,
		attributes,
		effects,
		eventCards,
		activeEvents,
		canAdvanceTurn:
			run.status === 'active' &&
			(runtime.phase === 'event_handle' || runtime.phase === 'turn_end') &&
			blockers.length === 0,
		advanceTurnBlockers: blockers,
	}
	if (run.status === 'active') return { ...base, runStatus: 'active' }
	if (run.status === 'abandoned') {
		return { ...base, runStatus: 'abandoned', endedAt: run.endedAt as string }
	}
	return {
		...base,
		runStatus: 'ended',
		endedAt: run.endedAt as string,
		...projectEndingEvent(run, runtime),
	}
}
