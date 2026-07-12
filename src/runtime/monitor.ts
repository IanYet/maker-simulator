import type { Primitive, TurnPhase } from '../types'

export type RuntimeTraceKind =
	| 'command'
	| 'transition'
	| 'action'
	| 'reaction'
	| 'transaction'
	| 'persistence'
	| 'rule-summary'

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

export interface RuntimeMonitor {
	readonly verbose: boolean
	trace(value: RuntimeTrace): void
	finish(): void
}

export class NoopRuntimeMonitor implements RuntimeMonitor {
	readonly verbose = false
	trace(): void {}
	finish(): void {}
}

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
			console.info(
				`[maker-runtime] run=${value.runId} turn=${value.turnNumber} unit=${value.unitId} ${indent}${value.kind} ${value.name} ${value.durationMs.toFixed(2)}ms ${value.outcome}`,
				value.detail ?? '',
			)
		} catch {
			// Monitoring must never affect gameplay.
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
			// Monitoring must never affect gameplay.
		}
	}
}

export type RuntimeMonitorFactory = (runId: string) => RuntimeMonitor

export function createMonitorFactory(): RuntimeMonitorFactory {
	const setting = new URLSearchParams(window.location.search).get('runtimeMonitor')
	const enabled = import.meta.env.DEV || setting === '1' || setting === 'verbose'
	const verbose = setting === 'verbose'
	return (runId) =>
		enabled ? new ConsoleRuntimeMonitor(verbose, runId) : new NoopRuntimeMonitor()
}
