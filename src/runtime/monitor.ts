import type { Primitive, RuntimeCommand, TurnPhase } from '../types'

export type RuntimeTraceKind =
	| 'command'
	| 'transition'
	| 'action'
	| 'reaction'
	| 'transaction'
	| 'persistence'
	| 'rule-summary'

/** RuntimeMonitor 输出的单条事件，detail 只允许基础类型。 */
export interface RuntimeTrace {
	at: string
	runId: string
	turnNumber: number
	phase: TurnPhase
	unitId: string
	depth: number
	kind: RuntimeTraceKind
	name: string
	durationMs: number
	outcome: 'ok' | 'error' | 'rollback'
	detail?: Readonly<Record<string, Primitive>>
}

/**
 * 将 RuntimeCommand 的业务参数投影为可安全打印的标量字段。
 * 不把完整 State、Config 或脚本对象交给控制台。
 */
export function commandTraceDetail(command: RuntimeCommand): Readonly<Record<string, Primitive>> {
	switch (command.type) {
		case 'start-event':
			return { commandType: command.type, eventId: command.eventId }
		case 'activate-effect':
			return { commandType: command.type, effectId: command.effectId }
		case 'choose-single':
			return {
				commandType: command.type,
				eventInstanceId: command.eventInstanceId,
				nodeId: command.nodeId,
				choiceId: command.choiceId,
			}
		case 'set-multiple-choice':
			return {
				commandType: command.type,
				eventInstanceId: command.eventInstanceId,
				nodeId: command.nodeId,
				choiceId: command.choiceId,
				count: command.count,
			}
		case 'execute-node-command':
			return {
				commandType: command.type,
				eventInstanceId: command.eventInstanceId,
				nodeId: command.nodeId,
				commandId: command.commandId,
			}
		case 'advance-turn':
			return { commandType: command.type, value: 'next-turn' }
	}
}

/** 将 Action/Reaction 参数序列化为控制台可读且不展开对象的字符串。 */
export function argsTraceDetail(args: readonly Primitive[]): string {
	return JSON.stringify(args)
}

/** Runtime 执行轨迹的输出边界；实现不应影响游戏结果。 */
export interface RuntimeMonitor {
	readonly verbose: boolean
	trace(value: RuntimeTrace): void
	finish(): void
}

/** 关闭监控时使用的空实现。 */
export class NoopRuntimeMonitor implements RuntimeMonitor {
	readonly verbose = false
	trace(): void {}
	finish(): void {}
}

/** 向浏览器控制台输出执行轨迹，并在结束时打印会话摘要。 */
export class ConsoleRuntimeMonitor implements RuntimeMonitor {
	readonly #started = performance.now()
	readonly #records: RuntimeTrace[] = []
	#finished = false
	readonly verbose: boolean
	private readonly runId: string

	constructor(
		verbose: boolean,
		runId: string,
	) {
		this.verbose = verbose
		this.runId = runId
	}

	trace(value: RuntimeTrace): void {
		try {
			this.#records.push(value)
			const indent = '  '.repeat(Math.max(0, value.depth))
			const detail = value.detail
				? Object.entries(value.detail)
					.map(([key, item]) => `${key}=${String(item)}`)
					.join(' ')
				: ''
			console.info(
				`[maker-runtime] run=${value.runId} turn=${value.turnNumber} unit=${value.unitId} ${indent}${value.kind} ${value.name}${detail ? ` ${detail}` : ''} ${value.durationMs.toFixed(2)}ms ${value.outcome}`,
				value.detail ?? '',
			)
		} catch {
			// 监控失败不能影响游戏结果。
		}
	}

	finish(): void {
		if (this.#finished) return
		this.#finished = true
		try {
			const commands = this.#records.filter((item) => item.kind === 'command').length
			const actions = this.#records.filter((item) => item.kind === 'action').length
			const persistenceMs = this.#records
				.filter((item) => item.kind === 'persistence')
				.reduce((sum, item) => sum + item.durationMs, 0)
			const unitMs = this.#records
				.filter((item) => item.kind === 'transaction' && item.depth === 0)
				.reduce((sum, item) => sum + item.durationMs, 0)
			const slowest = [...this.#records]
				.sort((left, right) => right.durationMs - left.durationMs)
				.slice(0, 5)
				.map((item) => `${item.kind}:${item.name} ${item.durationMs.toFixed(2)}ms`)
			console.info('[maker-runtime] session summary', {
				runId: this.runId,
				durationMs: Number((performance.now() - this.#started).toFixed(2)),
				commands,
				actions,
				unitMs: Number(unitMs.toFixed(2)),
				persistenceMs: Number(persistenceMs.toFixed(2)),
				slowest,
			})
		} catch {
			// 监控失败不能影响游戏结果。
		}
	}
}

export type RuntimeMonitorFactory = (runId: string) => RuntimeMonitor

/** 根据开发环境或 URL 查询参数创建监控工厂。 */
export function createMonitorFactory(): RuntimeMonitorFactory {
	const setting = new URLSearchParams(window.location.search).get('runtimeMonitor')
	const enabled = import.meta.env.DEV || setting === '1' || setting === 'verbose'
	const verbose = setting === 'verbose'
	return (runId) =>
		enabled ? new ConsoleRuntimeMonitor(verbose, runId) : new NoopRuntimeMonitor()
}
