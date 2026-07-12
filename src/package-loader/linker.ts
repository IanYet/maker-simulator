import type {
	Action,
	ActionRegistry,
	CommonConfig,
	EventConfig,
	GameConfig,
	GamePackageDescriptor,
	GamePackageManifest,
	Primitive,
	Reaction,
	Rule,
	RuleRegistry,
	ValueRef,
} from '../types'
import { GamePackageLoadError } from './errors'

const hasOwn = (value: object, key: PropertyKey): boolean =>
	Object.prototype.hasOwnProperty.call(value, key)

function fail(message: string, path: string): never {
	throw new GamePackageLoadError('linking', message, { path })
}

function defaultReactive(value: unknown): unknown {
	return value !== null && typeof value === 'object' && 'rule' in value && 'value' in value
		? (value as { value: unknown }).value
		: value
}

function assertRecordIdentity(
	record: Readonly<Record<string, CommonConfig>>,
	path: string,
): void {
	const orders = new Map<number, string>()
	for (const [key, value] of Object.entries(record)) {
		if (key !== value.id) fail(`Record key “${key}” does not match id “${value.id}”`, `${path}/${key}`)
		const previous = orders.get(value.order)
		if (previous) fail(`Order ${value.order} is also used by “${previous}”`, `${path}/${key}/order`)
		orders.set(value.order, key)
	}
}

function assertRule(call: Rule, rules: RuleRegistry, path: string): void {
	if (!rules[call.key]) fail(`Unknown Rule “${call.key}”`, `${path}/key`)
}

function assertAction(call: Action, actions: ActionRegistry, path: string): void {
	if (!actions[call.key]) fail(`Unknown Action “${call.key}”`, `${path}/key`)
}

function visitReactive(
	value: unknown,
	rules: RuleRegistry,
	path: string,
): void {
	if (value !== null && typeof value === 'object' && 'rule' in value) {
		assertRule((value as { rule: Rule }).rule, rules, `${path}/rule`)
	}
}

function resolveStatic(root: unknown, path: readonly string[]): unknown {
	let cursor = root
	for (const segment of path) {
		cursor = defaultReactive(cursor)
		if (cursor === null || typeof cursor !== 'object' || !hasOwn(cursor, segment)) return undefined
		cursor = (cursor as Readonly<Record<string, unknown>>)[segment]
	}
	return defaultReactive(cursor)
}

function assertValueRef(
	ref: ValueRef,
	self: unknown,
	config: GameConfig,
	path: string,
): void {
	const root: unknown = ref.source === 'self' ? self : config
	if (ref.source === 'turnState' && ['turnNumber', 'phase'].includes(ref.path[0])) {
		return
	}
	const value = resolveStatic(root, ref.path)
	if (value === undefined) fail(`ValueRef path cannot be resolved`, path)
	if (
		value !== null &&
		typeof value !== 'string' &&
		typeof value !== 'number' &&
		typeof value !== 'boolean'
	) {
		fail(`ValueRef must resolve to a Primitive`, path)
	}
}

function assertReaction(
	reaction: Reaction,
	self: unknown,
	config: GameConfig,
	rules: RuleRegistry,
	actions: ActionRegistry,
	path: string,
): void {
	if ('source' in reaction.watch) {
		assertValueRef(reaction.watch, self, config, `${path}/watch/path`)
	} else {
		assertRule(reaction.watch, rules, `${path}/watch`)
	}
	assertAction(reaction.action, actions, `${path}/action`)
}

function visitCommon(value: CommonConfig, rules: RuleRegistry, path: string): void {
	visitReactive(value.weight, rules, `${path}/weight`)
	visitReactive(value.unlocked, rules, `${path}/unlocked`)
	visitReactive(value.enabled, rules, `${path}/enabled`)
}

/**
 * 校验 catalog、manifest、Config 与脚本 registry 的身份和静态引用。
 * linking 成功后，Runtime 才可以安全地注册 Rule、Action 和 Reaction。
 *
 * @throws {GamePackageLoadError} 任意身份、引用或节点目标不一致时抛出。
 */
export function linkConfig(
	descriptor: Readonly<GamePackageDescriptor>,
	manifest: Readonly<GamePackageManifest>,
	config: GameConfig,
	rules: RuleRegistry,
	actions: ActionRegistry,
): void {
	for (const [label, left, right] of [
		['id', descriptor.id, manifest.id],
		['version', descriptor.version, manifest.version],
		['name', descriptor.name, manifest.name],
		['config id', descriptor.id, config.meta.id],
		['config version', descriptor.version, config.meta.version],
		['config name', descriptor.name, config.meta.name],
	] as const) {
		if (left !== right) fail(`Package ${label} mismatch: “${left}” / “${right}”`, '/meta')
	}
	if (descriptor.background !== undefined && descriptor.background !== config.meta.background) {
		fail('Descriptor background does not match Config meta', '/meta/background')
	}

	assertRecordIdentity(config.characters, '/characters')
	assertRecordIdentity(config.effects, '/effects')
	assertRecordIdentity(config.events, '/events')

	for (const [characterId, character] of Object.entries(config.characters)) {
		const base = `/characters/${characterId}`
		visitCommon(character, rules, base)
		assertRecordIdentity(character.attributes, `${base}/attributes`)
		for (const [attributeId, attribute] of Object.entries(character.attributes)) {
			const attributePath = `${base}/attributes/${attributeId}`
			visitCommon(attribute, rules, attributePath)
			if (attribute.type === 'number') {
				if (attribute.min !== undefined && attribute.max !== undefined && attribute.min > attribute.max) {
					fail('Attribute min must not exceed max', attributePath)
				}
				if (attribute.min !== undefined && attribute.value < attribute.min) fail('Value is below min', `${attributePath}/value`)
				if (attribute.max !== undefined && attribute.value > attribute.max) fail('Value is above max', `${attributePath}/value`)
			} else if (attribute.value >= attribute.valueDisplay.length) {
				fail('Enum value is outside valueDisplay', `${attributePath}/value`)
			}
		}
	}

	for (const [effectId, effect] of Object.entries(config.effects)) {
		const base = `/effects/${effectId}`
		visitCommon(effect, rules, base)
		visitReactive(effect.acquired, rules, `${base}/acquired`)
		visitReactive(effect.actived, rules, `${base}/actived`)
		if (effect.bindCharacterId && !config.characters[effect.bindCharacterId]) {
			fail(`Unknown Character “${effect.bindCharacterId}”`, `${base}/bindCharacterId`)
		}
		effect.reactionList.forEach((reaction, index) =>
			assertReaction(reaction, effect, config, rules, actions, `${base}/reactionList/${index}`),
		)
	}

	for (const [eventId, event] of Object.entries(config.events)) {
		const base = `/events/${eventId}`
		visitCommon(event, rules, base)
		if (!event.nodes[event.entryNodeId]) fail('Unknown entry node', `${base}/entryNodeId`)
		assertRecordIdentity(event.nodes, `${base}/nodes`)
		event.reactionList?.forEach((reaction, index) =>
			assertReaction(reaction, event, config, rules, actions, `${base}/reactionList/${index}`),
		)
		for (const [nodeId, node] of Object.entries(event.nodes)) {
			const nodePath = `${base}/nodes/${nodeId}`
			visitCommon(node, rules, nodePath)
			if (node.type === 'check') {
				assertAction(node.check, actions, `${nodePath}/check`)
				for (const candidate of Object.keys(node.candidateNodes)) {
					if (!event.nodes[candidate]) fail(`Unknown candidate node “${candidate}”`, `${nodePath}/candidateNodes/${candidate}`)
				}
				continue
			}
			visitReactive(node.required, rules, `${nodePath}/required`)
			node.reactionList?.forEach((reaction, index) =>
				assertReaction(reaction, node, config, rules, actions, `${nodePath}/reactionList/${index}`),
			)
			visitReactive(node.choices, rules, `${nodePath}/choices`)
			const choices = defaultReactive(node.choices) as Record<
				string,
				CommonConfig & { action?: Action; maxCount?: unknown }
			>
			assertRecordIdentity(choices, `${nodePath}/choices`)
			for (const [choiceId, choice] of Object.entries(choices)) {
				const choicePath = `${nodePath}/choices/${choiceId}`
				visitCommon(choice, rules, choicePath)
				if (node.type === 'single') {
					if (!choice.action) fail('Single choice requires an Action', `${choicePath}/action`)
					assertAction(choice.action, actions, `${choicePath}/action`)
				}
				else visitReactive(choice.maxCount, rules, `${choicePath}/maxCount`)
			}
			if (node.type === 'multiple') {
				assertRecordIdentity(node.commands, `${nodePath}/commands`)
				for (const [commandId, command] of Object.entries(node.commands)) {
					visitCommon(command, rules, `${nodePath}/commands/${commandId}`)
					assertAction(command.action, actions, `${nodePath}/commands/${commandId}/action`)
				}
			}
		}
	}
}

/**
 * 校验 Rule/Action 模块的导出形状，并返回可供 Runtime 使用的 registry。
 *
 * @throws {GamePackageLoadError} 模块缺少 registry、key 不一致或实现不是函数时抛出。
 */
export function validateRegistries(
	ruleModule: unknown,
	actionModule: unknown,
): { rules: RuleRegistry; actions: ActionRegistry } {
	if (ruleModule === null || typeof ruleModule !== 'object' || !('rules' in ruleModule)) {
		throw new GamePackageLoadError('registry-validation', 'Rule module must export “rules”')
	}
	if (actionModule === null || typeof actionModule !== 'object' || !('actions' in actionModule)) {
		throw new GamePackageLoadError('registry-validation', 'Action module must export “actions”')
	}
	const rules = (ruleModule as { rules: unknown }).rules
	const actions = (actionModule as { actions: unknown }).actions
	if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) {
		throw new GamePackageLoadError('registry-validation', '“rules” must be an object')
	}
	if (actions === null || typeof actions !== 'object' || Array.isArray(actions)) {
		throw new GamePackageLoadError('registry-validation', '“actions” must be an object')
	}
	for (const [key, implementation] of Object.entries(rules)) {
		if (
			implementation === null ||
			typeof implementation !== 'object' ||
			(implementation as { key?: unknown }).key !== key ||
			typeof (implementation as { calc?: unknown }).calc !== 'function'
		) {
			throw new GamePackageLoadError('registry-validation', `Invalid Rule implementation “${key}”`, { path: `/rules/${key}` })
		}
	}
	for (const [key, implementation] of Object.entries(actions)) {
		if (
			implementation === null ||
			typeof implementation !== 'object' ||
			(implementation as { key?: unknown }).key !== key ||
			typeof (implementation as { exec?: unknown }).exec !== 'function'
		) {
			throw new GamePackageLoadError('registry-validation', `Invalid Action implementation “${key}”`, { path: `/actions/${key}` })
		}
	}
	return { rules: rules as RuleRegistry, actions: actions as ActionRegistry }
}

/** 深度冻结 Config 与 registry，防止运行时脚本意外修改静态包对象。 */
export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
	if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
	const object = value as object
	if (seen.has(object)) return value
	seen.add(object)
	for (const child of Object.values(object)) deepFreeze(child, seen)
	return Object.freeze(value)
}

/** 将基础参数稳定序列化，用于 Rule 递归检测和监控标识。 */
export function stableArgs(args: readonly Primitive[]): string {
	return JSON.stringify(args)
}

/** 根据 EventNode id 找到其所属 EventConfig；找不到时返回 undefined。 */
export function eventForNode(config: GameConfig, eventId: string): EventConfig | undefined {
	return config.events[eventId]
}
