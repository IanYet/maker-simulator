import type { GameConfig, GameState, Primitive, Rule, TurnState } from '../types'

interface ViewEnvironment {
	readonly config: GameConfig
	readonly layers: readonly GameState[]
	readonly turnState?: TurnState
	readonly writable?: GameState
	readonly scope: 'profile' | 'run' | 'turn'
	readonly evaluateRule: (rule: Rule) => unknown
	readonly onStateRead?: (path: readonly string[]) => void
	readonly onStateWrite?: (path: readonly string[]) => void
	readonly onEventWrite?: (
		path: readonly string[],
		property: 'currentNodeId' | 'status',
		previous: unknown,
		next: unknown,
	) => void
}

const hasOwn = (value: object, key: PropertyKey): boolean =>
	Object.prototype.hasOwnProperty.call(value, key)

const derivedFields = new Set([
	'weight',
	'unlocked',
	'enabled',
	'acquired',
	'actived',
	'required',
	'maxCount',
	'choices',
])

function isDerivedFieldPath(path: readonly string[]): boolean {
	return derivedFields.has(path.at(-1) ?? '')
}

function isRule(value: unknown): value is Rule {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		'key' in value &&
		'args' in value &&
		typeof (value as { key?: unknown }).key === 'string' &&
		Array.isArray((value as { args?: unknown }).args)
	)
}

function valueSummary(value: unknown): string {
	if (value === null) return 'null'
	if (Array.isArray(value)) return `array(${value.length})`
	if (typeof value === 'object') return `object(${Object.keys(value).length} keys)`
	if (typeof value === 'string') return JSON.stringify(value.slice(0, 80))
	return String(value)
}

function invalidRuleResult(
	rule: Rule,
	path: readonly string[],
	expected: string,
	value: unknown,
): never {
	throw new Error(
		`Rule “${rule.key}” returned an invalid value for ${path.join('.')}: expected ${expected}, received ${valueSummary(value)}`,
	)
}

function validateDerivedRuleResult(
	rule: Rule,
	value: unknown,
	environment: ViewEnvironment,
	path: readonly string[],
): unknown {
	const property = path.at(-1)
	if (['unlocked', 'enabled', 'acquired', 'actived', 'required'].includes(property ?? '')) {
		if (typeof value !== 'boolean') invalidRuleResult(rule, path, 'boolean', value)
		return value
	}
	if (property === 'weight') {
		if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10) {
			invalidRuleResult(rule, path, 'a finite number between 0 and 10', value)
		}
		return value
	}
	if (property === 'maxCount') {
		if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
			invalidRuleResult(rule, path, 'a non-negative integer', value)
		}
		return value
	}
	if (property === 'choices') {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			invalidRuleResult(rule, path, 'a Choice record', value)
		}
		const choicesValue = rawConfigAt(environment, [...path.slice(0, -1), 'choicesValue'])
		if (choicesValue === null || typeof choicesValue !== 'object' || Array.isArray(choicesValue)) {
			invalidRuleResult(rule, path, 'a Choice record backed by choicesValue', value)
		}
		for (const key of Object.keys(value)) {
			if (!hasOwn(choicesValue, key)) {
				invalidRuleResult(
					rule,
					path,
					`only keys declared by choicesValue (unknown “${key}”)`,
					value,
				)
			}
			const choice = (value as Readonly<Record<string, unknown>>)[key]
			if (
				choice === null ||
				typeof choice !== 'object' ||
				(choice as Readonly<{ id?: unknown }>).id !== key
			) {
				invalidRuleResult(rule, path, `Choice “${key}” with matching id`, choice)
			}
		}
		return value
	}
	return value
}

function resolveRule(
	value: unknown,
	environment: ViewEnvironment,
	path: readonly string[],
): unknown {
	if (!isRule(value) || !isDerivedFieldPath(path)) return value
	return validateDerivedRuleResult(value, environment.evaluateRule(value), environment, path)
}

function configAt(environment: ViewEnvironment, path: readonly string[]): unknown {
	let cursor: unknown = environment.config
	for (let index = 0; index < path.length; index += 1) {
		const segment = path[index]
		cursor = resolveRule(cursor, environment, path.slice(0, index))
		if (cursor === null || typeof cursor !== 'object' || !hasOwn(cursor, segment)) return undefined
		cursor = (cursor as Readonly<Record<string, unknown>>)[segment]
	}
	return resolveRule(cursor, environment, path)
}

function rawConfigAt(environment: ViewEnvironment, path: readonly string[]): unknown {
	let cursor: unknown = environment.config
	for (let index = 0; index < path.length; index += 1) {
		const segment = path[index]
		cursor = resolveRule(cursor, environment, path.slice(0, index))
		if (cursor === null || typeof cursor !== 'object' || !hasOwn(cursor, segment)) return undefined
		cursor = (cursor as Readonly<Record<string, unknown>>)[segment]
	}
	return cursor
}

function stateAt(state: GameState, path: readonly string[]): unknown {
	let cursor: unknown = state
	for (const segment of path) {
		if (cursor === null || typeof cursor !== 'object' || !hasOwn(cursor, segment)) return undefined
		cursor = (cursor as Readonly<Record<string, unknown>>)[segment]
	}
	return cursor
}

function effectiveAt(environment: ViewEnvironment, path: readonly string[]): unknown {
	if (
		path.length === 1 &&
		environment.turnState &&
		(path[0] === 'turnNumber' || path[0] === 'phase')
	) {
		return environment.turnState[path[0]]
	}
	const rawConfig = rawConfigAt(environment, path)
	if (isRule(rawConfig) && isDerivedFieldPath(path)) {
		return validateDerivedRuleResult(
			rawConfig,
			environment.evaluateRule(rawConfig),
			environment,
			path,
		)
	}
	for (let index = environment.layers.length - 1; index >= 0; index -= 1) {
		const value = stateAt(environment.layers[index], path)
		if (value !== undefined) return value
	}
	return configAt(environment, path)
}

function stateObjectKeys(environment: ViewEnvironment, path: readonly string[]): string[] {
	const keys = new Set<string>()
	const configured = configAt(environment, path)
	if (configured !== null && typeof configured === 'object') {
		for (const key of Object.keys(configured)) keys.add(key)
	}
	for (const state of environment.layers) {
		const value = stateAt(state, path)
		if (value !== null && typeof value === 'object') {
			for (const key of Object.keys(value)) keys.add(key)
		}
	}
	if (path.length === 0 && environment.turnState) {
		keys.add('turnNumber')
		keys.add('phase')
	}
	return [...keys]
}

function needsId(path: readonly string[]): boolean {
	return (
		(path.length === 2 && ['characters', 'effects', 'events'].includes(path[0])) ||
		(path.length === 4 && path[0] === 'characters' && path[2] === 'attributes') ||
		(path.length === 4 && path[0] === 'events' && path[2] === 'nodes') ||
		(path.length === 6 &&
			path[0] === 'events' &&
			path[2] === 'nodes' &&
			['choices', 'choicesValue', 'commands'].includes(path[4]))
	)
}

function ensureParent(state: GameState, path: readonly string[]): Record<string, unknown> {
	let cursor = state as unknown as Record<string, unknown>
	const traversed: string[] = []
	for (const segment of path) {
		traversed.push(segment)
		const current = cursor[segment]
		if (current === undefined) {
			const created: Record<string, unknown> = {}
			if (needsId(traversed)) created.id = segment
			cursor[segment] = created
			cursor = created
		} else if (current !== null && typeof current === 'object') {
			cursor = current as Record<string, unknown>
		} else {
			throw new Error(`Cannot write through non-object state path ${traversed.join('.')}`)
		}
	}
	return cursor
}

function isEventLifecycle(
	path: readonly string[],
	property: PropertyKey,
): property is 'currentNodeId' | 'status' {
	return (
		path.length === 4 &&
		path[0] === 'events' &&
		path[2] === 'instances' &&
		(property === 'currentNodeId' || property === 'status')
	)
}

function isSyntheticRecord(path: readonly string[]): boolean {
	return path.length === 3 && path[0] === 'events' && path[2] === 'instances'
}

function isWritableContentPath(path: readonly string[]): boolean {
	const property = path.at(-1)
	if (!property) return false
	if (['weightValue', 'visible', 'unlockedValue', 'enabledValue'].includes(property)) return true
	if (
		path.length === 5 &&
		path[0] === 'characters' &&
		path[2] === 'attributes' &&
		property === 'value'
	)
		return true
	if (
		path.length === 3 &&
		path[0] === 'effects' &&
		['acquiredValue', 'activedValue', 'bindCharacterId'].includes(property)
	)
		return true
	if (
		path.length === 5 &&
		path[0] === 'events' &&
		path[2] === 'nodes' &&
		property === 'requiredValue'
	)
		return true
	if (
		path.length === 7 &&
		path[0] === 'events' &&
		path[2] === 'nodes' &&
		path[4] === 'choicesValue' &&
		property === 'maxCountValue'
	)
		return true
	return false
}

function validateWrite(
	environment: ViewEnvironment,
	path: readonly string[],
	value: unknown,
): unknown {
	const property = path.at(-1)
	if (property === 'weightValue') {
		if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10)
			throw new Error('weight must be between 0 and 10')
	}
	if (property === 'maxCountValue') {
		if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
			throw new Error('maxCount must be a non-negative integer')
	}
	if (property === 'value' && path[0] === 'characters') {
		const attribute = configAt(environment, path.slice(0, -1))
		if (
			attribute === null ||
			typeof attribute !== 'object' ||
			typeof value !== 'number' ||
			!Number.isFinite(value)
		) {
			throw new Error('Attribute value must be a finite number')
		}
		const typed = attribute as {
			type: string
			min?: number
			max?: number
			valueDisplay?: readonly string[]
		}
		if (typed.type === 'enum') {
			if (!Number.isInteger(value) || value < 0 || value >= (typed.valueDisplay?.length ?? 0))
				throw new Error('Invalid enum attribute value')
		} else {
			return Math.min(
				typed.max ?? Number.POSITIVE_INFINITY,
				Math.max(typed.min ?? Number.NEGATIVE_INFINITY, value),
			)
		}
	}
	if (property === 'bindCharacterId' && value !== undefined) {
		if (typeof value !== 'string' || !environment.config.characters[value])
			throw new Error('Unknown Effect character binding')
	}
	if (
		[
			'visible',
			'unlockedValue',
			'enabledValue',
			'acquiredValue',
			'activedValue',
			'requiredValue',
		].includes(property ?? '') &&
		typeof value !== 'boolean'
	) {
		throw new Error(`${String(property)} must be boolean`)
	}
	return value
}

function makeProxy(environment: ViewEnvironment, path: readonly string[]): object {
	return new Proxy(Object.create(null) as Record<string, unknown>, {
		get(_target, property) {
			if (property === Symbol.toStringTag) return 'MakerRuntimeView'
			if (property === 'toJSON') return undefined
			if (typeof property !== 'string') return undefined
			const childPath = [...path, property]
			environment.onStateRead?.(childPath)
			const value = effectiveAt(environment, childPath)
			if (value === undefined && isSyntheticRecord(childPath))
				return makeProxy(environment, childPath)
			if (Array.isArray(value)) return Object.freeze([...value])
			if (value !== null && typeof value === 'object') return makeProxy(environment, childPath)
			return value
		},
		set(_target, property, next) {
			if (typeof property !== 'string' || !environment.writable)
				throw new Error('Rule runtime views are read-only')
			const childPath = [...path, property]
			const lifecycle = isEventLifecycle(path, property)
			if (lifecycle && environment.scope !== 'run')
				throw new Error('EventInstance lifecycle is writable only through runState')
			if (!lifecycle && !isWritableContentPath(childPath))
				throw new Error(`State path ${childPath.join('.')} is read-only`)
			const rawConfig = rawConfigAt(environment, childPath)
			if (isRule(rawConfig))
				throw new Error(`Rule-derived field ${childPath.join('.')} cannot be assigned`)
			const previous = effectiveAt(environment, childPath)
			const value = lifecycle ? next : validateWrite(environment, childPath, next)
			if (lifecycle) environment.onEventWrite?.(path, property, previous, value)
			const parent = ensureParent(environment.writable, path)
			if (value === undefined) delete parent[property]
			else parent[property] = value
			if (!Object.is(previous, value)) environment.onStateWrite?.(childPath)
			return true
		},
		ownKeys() {
			environment.onStateRead?.(path)
			return stateObjectKeys(environment, path)
		},
		has(_target, property) {
			environment.onStateRead?.(path)
			return typeof property === 'string' && stateObjectKeys(environment, path).includes(property)
		},
		getOwnPropertyDescriptor(_target, property) {
			environment.onStateRead?.(path)
			if (typeof property === 'string' && stateObjectKeys(environment, path).includes(property)) {
				return { enumerable: true, configurable: true }
			}
			return undefined
		},
		deleteProperty() {
			throw new Error('Deleting runtime fields is not supported')
		},
	})
}

/**
 * 创建供 Rule、Action 和 Runtime selector 使用的分层 State Proxy。
 * 读取时按 Profile → Run → Turn → Config 合并并报告依赖路径；写入时只允许
 * ActionContext 的白名单字段，并把变更路径和事件生命周期写入交给 Runtime。
 */
export function createRuntimeView(environment: ViewEnvironment): Record<string, unknown> {
	return makeProxy(environment, []) as Record<string, unknown>
}

/** 按路径读取 Proxy/普通对象中的基础值；对象或数组结果返回 undefined。 */
export function readPath(root: unknown, path: readonly string[]): Primitive | undefined {
	let cursor = root
	for (const segment of path) {
		if (cursor === null || typeof cursor !== 'object') return undefined
		cursor = (cursor as Readonly<Record<string, unknown>>)[segment]
	}
	return cursor === null || ['string', 'number', 'boolean'].includes(typeof cursor)
		? (cursor as Primitive)
		: undefined
}
