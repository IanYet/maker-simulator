/** Runtime State 的持久层级；读取层级同时表示分层视图的可见范围。 */
export type RuntimeStateScope = 'profile' | 'run' | 'turn'

interface ComputationNode {
	readonly id: string
	value: unknown
	hasValue: boolean
	dirty: boolean
	stateDependencies: Set<string>
	computationDependencies: Set<string>
	dependents: Set<string>
}

interface DependencyCollector {
	readonly nodeId: string
	readonly stateDependencies: Set<string>
	readonly computationDependencies: Set<string>
}

function stateDependencyKey(scope: RuntimeStateScope, path: readonly string[]): string {
	return `${scope}:${JSON.stringify(path)}`
}

function visibleScopes(scope: RuntimeStateScope): readonly RuntimeStateScope[] {
	if (scope === 'profile') return ['profile', 'run', 'turn']
	if (scope === 'run') return ['run', 'turn']
	return ['turn']
}

function isStableCachedValue(value: unknown): boolean {
	return (
		value === undefined || value === null || ['string', 'number', 'boolean'].includes(typeof value)
	)
}

/**
 * 维护 State 路径、计算节点和持续 observer 之间的双向依赖。
 *
 * 图本身可克隆并随 Runtime 处理单元提交或回滚。基础类型结果可以跨处理单元缓存；
 * 对象结果可能包含绑定当前 Immer draft 的 Proxy，因此只记录依赖，不跨读取缓存。
 */
export class ReactiveDependencyGraph {
	readonly #nodes = new Map<string, ComputationNode>()
	readonly #stateDependents = new Map<string, Set<string>>()
	readonly #observers = new Set<string>()
	readonly #dirtyObservers = new Set<string>()
	readonly #collectors: DependencyCollector[] = []
	readonly #computing = new Set<string>()

	/** 创建一份不共享可变集合的图副本，供新的事务处理单元使用。 */
	clone(): ReactiveDependencyGraph {
		const graph = new ReactiveDependencyGraph()
		for (const [id, node] of this.#nodes) {
			graph.#nodes.set(id, {
				id,
				value: node.value,
				hasValue: node.hasValue,
				dirty: node.dirty,
				stateDependencies: new Set(node.stateDependencies),
				computationDependencies: new Set(node.computationDependencies),
				dependents: new Set(node.dependents),
			})
		}
		for (const [key, dependents] of this.#stateDependents) {
			graph.#stateDependents.set(key, new Set(dependents))
		}
		for (const id of this.#observers) graph.#observers.add(id)
		for (const id of this.#dirtyObservers) graph.#dirtyObservers.add(id)
		return graph
	}

	/** 在当前计算节点上登记一次分层 State 路径读取。 */
	trackStateRead(scope: RuntimeStateScope, path: readonly string[]): void {
		const collector = this.#collectors.at(-1)
		if (!collector) return
		collector.stateDependencies.add(stateDependencyKey(scope, path))
	}

	/**
	 * 使一次 State 写入影响到的计算节点失效。
	 *
	 * Profile 写入会影响三层视图，Run 写入影响 Run/Turn 视图。路径的所有祖先
	 * 同时失效，以覆盖对象成员访问、ownKeys 和集合迭代依赖。
	 */
	invalidateStateWrite(scope: RuntimeStateScope, path: readonly string[]): void {
		const affected = new Set<string>()
		for (const visibleScope of visibleScopes(scope)) {
			for (let length = 0; length <= path.length; length += 1) {
				const key = stateDependencyKey(visibleScope, path.slice(0, length))
				for (const nodeId of this.#stateDependents.get(key) ?? []) affected.add(nodeId)
			}
		}
		const visited = new Set<string>()
		for (const nodeId of affected) this.markDirty(nodeId, visited)
	}

	/**
	 * 读取一个计算节点；缓存有效时直接返回，否则重算并原子替换动态依赖集合。
	 * 计算抛错时不保存本次值或依赖。
	 */
	read<T>(nodeId: string, calculate: () => T): T {
		const parent = this.#collectors.at(-1)
		if (parent && parent.nodeId !== nodeId) {
			parent.computationDependencies.add(nodeId)
		}
		const node = this.ensureNode(nodeId)
		if (!node.dirty && node.hasValue) return node.value as T
		if (this.#computing.has(nodeId)) {
			throw new Error(`Reactive computation cycle: ${nodeId}`)
		}

		const collector: DependencyCollector = {
			nodeId,
			stateDependencies: new Set(),
			computationDependencies: new Set(),
		}
		this.#collectors.push(collector)
		this.#computing.add(nodeId)
		try {
			const value = calculate()
			this.replaceDependencies(node, collector)
			if (isStableCachedValue(value)) {
				node.value = value
				node.hasValue = true
				node.dirty = false
			} else {
				node.value = undefined
				node.hasValue = false
				node.dirty = true
			}
			return value
		} catch (error) {
			node.value = undefined
			node.hasValue = false
			node.dirty = true
			throw error
		} finally {
			this.#computing.delete(nodeId)
			this.#collectors.pop()
		}
	}

	/** 注册一个需要在依赖失效后主动重算的持续 observer。 */
	registerObserver(nodeId: string): void {
		this.ensureNode(nodeId)
		this.#observers.add(nodeId)
		this.#dirtyObservers.add(nodeId)
	}

	/** 注销持续 observer，并移除它占用的依赖边。 */
	unregisterObserver(nodeId: string): void {
		this.#observers.delete(nodeId)
		this.#dirtyObservers.delete(nodeId)
		this.removeNode(nodeId)
	}

	/** 注销全部持续 observer；普通 Rule 节点仍可供终局快照惰性读取。 */
	clearObservers(): void {
		for (const nodeId of [...this.#observers]) this.unregisterObserver(nodeId)
	}

	/** 返回当前因依赖变化而失效的 observer，不会扫描未受影响节点。 */
	dirtyObserverIds(): readonly string[] {
		return [...this.#dirtyObservers]
	}

	/** observer 成功重算并更新自身 baseline 后，将其移出待处理集合。 */
	markObserverClean(nodeId: string): void {
		this.#dirtyObservers.delete(nodeId)
	}

	/** 返回计算节点当前的依赖与反向扇出数量，供监控汇总。 */
	nodeDependencyStats(nodeId: string): {
		readonly dependencies: number
		readonly dependents: number
	} {
		const node = this.#nodes.get(nodeId)
		return {
			dependencies: (node?.stateDependencies.size ?? 0) + (node?.computationDependencies.size ?? 0),
			dependents: node?.dependents.size ?? 0,
		}
	}

	private ensureNode(nodeId: string): ComputationNode {
		const existing = this.#nodes.get(nodeId)
		if (existing) return existing
		const node: ComputationNode = {
			id: nodeId,
			value: undefined,
			hasValue: false,
			dirty: true,
			stateDependencies: new Set(),
			computationDependencies: new Set(),
			dependents: new Set(),
		}
		this.#nodes.set(nodeId, node)
		return node
	}

	private replaceDependencies(node: ComputationNode, collector: DependencyCollector): void {
		for (const dependency of node.stateDependencies) {
			const dependents = this.#stateDependents.get(dependency)
			dependents?.delete(node.id)
			if (dependents?.size === 0) this.#stateDependents.delete(dependency)
		}
		for (const dependency of node.computationDependencies) {
			this.#nodes.get(dependency)?.dependents.delete(node.id)
		}

		node.stateDependencies = collector.stateDependencies
		node.computationDependencies = collector.computationDependencies
		for (const dependency of node.stateDependencies) {
			const dependents = this.#stateDependents.get(dependency) ?? new Set<string>()
			dependents.add(node.id)
			this.#stateDependents.set(dependency, dependents)
		}
		for (const dependency of node.computationDependencies) {
			this.ensureNode(dependency).dependents.add(node.id)
		}
	}

	private markDirty(nodeId: string, visited: Set<string>): void {
		if (visited.has(nodeId)) return
		visited.add(nodeId)
		const node = this.#nodes.get(nodeId)
		if (!node) return
		node.dirty = true
		if (this.#observers.has(nodeId)) this.#dirtyObservers.add(nodeId)
		for (const dependent of node.dependents) this.markDirty(dependent, visited)
	}

	private removeNode(nodeId: string): void {
		const node = this.#nodes.get(nodeId)
		if (!node) return
		for (const dependency of node.stateDependencies) {
			const dependents = this.#stateDependents.get(dependency)
			dependents?.delete(nodeId)
			if (dependents?.size === 0) this.#stateDependents.delete(dependency)
		}
		for (const dependency of node.computationDependencies) {
			this.#nodes.get(dependency)?.dependents.delete(nodeId)
		}
		const visited = new Set<string>()
		for (const dependentId of node.dependents) {
			const dependent = this.#nodes.get(dependentId)
			dependent?.computationDependencies.delete(nodeId)
			this.markDirty(dependentId, visited)
		}
		this.#nodes.delete(nodeId)
	}
}
