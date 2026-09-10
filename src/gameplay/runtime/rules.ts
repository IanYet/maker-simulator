import type {
	DeepReadonly,
	GameConfig,
	Primitive,
	ProfileRuntime,
	Rule,
	RuleContext,
	RuleFunctions,
	RunRuntime,
	StateSnapshot,
	TurnRuntime,
} from '../types/model'
import type { LoadedGamePackage } from '../types/package'
import { stableArgs } from '../package-loader/linker'
import { ScriptExecutionError } from './errors'
import { ReactiveDependencyGraph } from './reactivity'
import { createRuntimeView } from './state-view'

const RULE_RECOMPUTATION_LIMIT = 4096

/** 一个求值上下文内的 Rule 统计，不跨事务共享。 */
export interface RuleStat {
	count: number
	durationMs: number
	maxMs: number
	maxDependencies: number
	maxDependents: number
}

/**
 * 创建无写入能力的规则上下文；运行事务和历史投影共用此实现。
 * 图由调用方拥有，动态依赖、缓存、异常和预算限定在该候选上下文内。
 */
export function createRules(
	game: LoadedGamePackage,
	working: StateSnapshot,
	graph: ReactiveDependencyGraph,
	onRule?: (
		call: DeepReadonly<Rule>,
		duration: number,
		outcome: 'ok' | 'error',
		depth: number,
	) => void,
) {
	const stack: string[] = []
	const stats = new Map<string, RuleStat>()
	let count = 0
	const profile = createRuntimeView({
		config: game.config as GameConfig,
		layers: [working.profileState],
		scope: 'profile',
		evaluateRule: evaluate,
		onStateRead: (path) => graph.trackStateRead('profile', path),
	}) as unknown as ProfileRuntime
	const run = createRuntimeView({
		config: game.config as GameConfig,
		layers: [working.profileState, working.runState],
		scope: 'run',
		evaluateRule: evaluate,
		onStateRead: (path) => graph.trackStateRead('run', path),
	}) as unknown as RunRuntime
	const turn = createRuntimeView({
		config: game.config as GameConfig,
		layers: [working.profileState, working.runState, working.turnState],
		turnState: working.turnState,
		scope: 'turn',
		evaluateRule: evaluate,
		onStateRead: (path) => graph.trackStateRead('turn', path),
	}) as unknown as TurnRuntime
	const functions = Object.fromEntries(
		Object.keys(game.rules).map((key) => [key, (...args: Primitive[]) => evaluate({ key, args })]),
	) as RuleFunctions
	const context: RuleContext = {
		config: game.config,
		profileState: profile,
		runState: run,
		turnState: turn,
		rule: functions,
	}

	function evaluate(call: DeepReadonly<Rule>): unknown {
		const implementation = game.rules[call.key]
		if (!implementation) throw new Error(`Unknown Rule “${call.key}”`)
		const identity = `${call.key}:${stableArgs(call.args)}`
		if (stack.includes(identity))
			throw new Error(`Recursive Rule cycle: ${[...stack, identity].join(' → ')}`)
		const nodeId = `rule:${identity}`
		const value = graph.read(nodeId, () => {
			if (++count > RULE_RECOMPUTATION_LIMIT)
				throw new Error(`Rule recomputation limit (${RULE_RECOMPUTATION_LIMIT}) exceeded`)
			stack.push(identity)
			const started = performance.now()
			let outcome: 'ok' | 'error' = 'ok'
			try {
				return implementation.calc(context, ...call.args)
			} catch (error) {
				outcome = 'error'
				throw new ScriptExecutionError(error, `Rule ${identity}`)
			} finally {
				stack.pop()
				const duration = performance.now() - started
				const stat = stats.get(call.key) ?? {
					count: 0,
					durationMs: 0,
					maxMs: 0,
					maxDependencies: 0,
					maxDependents: 0,
				}
				stat.count += 1
				stat.durationMs += duration
				stat.maxMs = Math.max(stat.maxMs, duration)
				stats.set(call.key, stat)
				onRule?.(call, duration, outcome, stack.length)
			}
		})
		const dependencies = graph.nodeDependencyStats(nodeId)
		const stat = stats.get(call.key)
		if (stat) {
			stat.maxDependencies = Math.max(stat.maxDependencies, dependencies.dependencies)
			stat.maxDependents = Math.max(stat.maxDependents, dependencies.dependents)
		}
		return value
	}
	return {
		profile,
		run,
		turn,
		functions,
		evaluate,
		stats,
		get count() {
			return count
		},
	}
}
