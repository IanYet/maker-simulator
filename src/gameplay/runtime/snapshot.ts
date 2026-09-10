import type {
	ActiveEventView,
	EffectView,
	EndingEventView,
	EventNodeView,
	MultipleChoiceView,
	GameSnapshot,
	SingleChoiceView,
} from '../types/game'
import type {
	DeepReadonly,
	GameConfig,
	StoredProfile,
	TurnRef,
	StateSnapshot,
	RunData,
	TurnRuntime,
} from '../types/model'
import type { LoadedGamePackage } from '../types/package'
import { validateProfileAgainstConfig } from '../persistence/validation'
import { deepFreeze } from '../package-loader/linker'
import { createRules } from './rules'
import { ReactiveDependencyGraph } from './reactivity'

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
export function projectGameSnapshot(options: {
	readonly config: DeepReadonly<GameConfig>
	readonly runtime: TurnRuntime
	readonly run: RunData
	readonly profile: StoredProfile
	readonly revision: number
}): GameSnapshot {
	const { config, runtime, run, profile, revision } = options

	const characters = Object.values(config.characters)
		.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
		.flatMap((characterConfig) => {
			const character = runtime.characters[characterConfig.id]
			if (!character.visible || !character.unlocked) return []
			const attributes = Object.values(characterConfig.attributes)
				.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
				.flatMap((attributeConfig) => {
					const attribute = character.attributes[attributeConfig.id]
					if (!attribute.visible || !attribute.unlocked) return []
					return [
						{
							attributeId: attribute.id,
							displayName: attribute.displayName,
							type: attribute.type,
							value: attribute.value,
							...(attribute.type === 'enum'
								? { valueLabel: attribute.valueDisplay[attribute.value] }
								: {}),
							...(attribute.type === 'number' && attribute.min !== undefined
								? { min: attribute.min }
								: {}),
							...(attribute.type === 'number' && attribute.max !== undefined
								? { max: attribute.max }
								: {}),
						},
					]
				})
			return [{ characterId: character.id, displayName: character.displayName, attributes }]
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
	const pendingEventBlockers: GameSnapshot['advanceTurnBlockers'][number][] = []
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
			})),
	]
	const base = {
		game: { id: config.meta.id, version: config.meta.version, name: config.meta.name },
		profile: { id: profile.profileId, ...(profile.label ? { label: profile.label } : {}) },
		checkpoint: {
			profileId: profile.profileId,
			...profile.current,
			kind: run.turnDatas[profile.current.turnId].kind,
		},
		revision,
		runId: run.runId,
		turnNumber: runtime.turnNumber,
		phase: runtime.phase,
		characters,
		effects,
		events: { available: eventCards, active: activeEvents },
		canAdvanceTurn:
			run.status === 'active' &&
			(runtime.phase === 'event_handle' || runtime.phase === 'turn_end') &&
			blockers.length === 0,
		advanceTurnBlockers: blockers,
	}
	if (run.status === 'active') return { ...base, status: 'active' }
	if (run.status === 'abandoned') {
		return { ...base, status: 'abandoned', endedAt: run.endedAt as string }
	}
	return {
		...base,
		status: 'ended',
		endedAt: run.endedAt as string,
		...projectEndingEvent(run, runtime),
	}
}

/** 克隆目标检查点，并按其 kind 投影当时的 Run 生命周期供恢复或只读预览。 */
export function stateFromCheckpoint(
	profile: StoredProfile,
	source: TurnRef = profile.current,
): { profile: StoredProfile; working: StateSnapshot } {
	const run = profile.runDatas[source.runId]
	const turn = run?.turnDatas[source.turnId]
	if (!run || !turn) throw new Error('The current checkpoint is missing')
	const stored = structuredClone(profile)
	stored.current = { runId: source.runId, turnId: source.turnId }
	const projectedRun = stored.runDatas[source.runId]
	projectedRun.currentTurnId = source.turnId
	if (turn.kind === 'terminal') {
		projectedRun.status = 'ended'
		projectedRun.endedAt = turn.createdAt
	} else if (turn.kind === 'abandoned') {
		projectedRun.status = 'abandoned'
		projectedRun.endedAt = turn.createdAt
	} else {
		projectedRun.status = 'active'
		delete projectedRun.endedAt
	}
	return {
		profile: stored,
		working: structuredClone(turn.snapshot),
	}
}

/**
 * 投影指定稳定检查点；只求值实际读取的规则，不创建可写 Runtime 或持续 observer。
 * 来源生命周期由检查点 kind 决定，读取不会影响输入、随机游标和恢复位置。
 */
export function projectCheckpoint(
	game: LoadedGamePackage,
	profile: StoredProfile,
	source: TurnRef,
): GameSnapshot {
	const state = stateFromCheckpoint(validateProfileAgainstConfig(profile, game.config), source)
	const rules = createRules(game, state.working, new ReactiveDependencyGraph())
	return deepFreeze(
		projectGameSnapshot({
			config: game.config,
			runtime: rules.turn,
			profile: state.profile,
			run: state.profile.runDatas[source.runId],
			revision: 0,
		}),
	)
}
