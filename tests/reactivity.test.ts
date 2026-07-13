import { assert, expect, test } from 'vitest'
import { ReactiveDependencyGraph } from '../src/runtime/reactivity'

/** 缓存只在依赖路径失效后重算，并把失效沿计算节点反向边传播给 observer。 */
test('cached computation only reruns after one of its State dependencies changes', () => {
	const graph = new ReactiveDependencyGraph()
	let executions = 0
	let score = 1
	graph.registerObserver('reaction:score')

	const readScore = (): number =>
		graph.read('reaction:score', () =>
			graph.read('rule:score', () => {
				executions += 1
				graph.trackStateRead('run', ['characters', 'hero', 'score'])
				return score
			}),
		)

	assert.equal(readScore(), 1)
	graph.markObserverClean('reaction:score')
	assert.equal(readScore(), 1)
	assert.equal(executions, 1)

	graph.invalidateStateWrite('run', ['events', 'unrelated'])
	assert.deepEqual(graph.dirtyObserverIds(), [])
	assert.equal(readScore(), 1)
	assert.equal(executions, 1)

	score = 2
	graph.invalidateStateWrite('run', ['characters', 'hero', 'score'])
	assert.deepEqual(graph.dirtyObserverIds(), ['reaction:score'])
	assert.equal(readScore(), 2)
	assert.equal(executions, 2)
})

/** 条件分支重算成功后必须替换旧依赖，后续写入旧分支不能再唤醒 observer。 */
test('successful recomputation replaces dynamic branch dependencies', () => {
	const graph = new ReactiveDependencyGraph()
	let usePrimary = true
	let primary = 1
	let secondary = 10
	graph.registerObserver('reaction:selected')

	const readSelected = (): number =>
		graph.read('reaction:selected', () => {
			graph.trackStateRead('run', ['flags', 'usePrimary'])
			if (usePrimary) {
				graph.trackStateRead('run', ['values', 'primary'])
				return primary
			}
			graph.trackStateRead('run', ['values', 'secondary'])
			return secondary
		})

	assert.equal(readSelected(), 1)
	graph.markObserverClean('reaction:selected')
	usePrimary = false
	graph.invalidateStateWrite('run', ['flags', 'usePrimary'])
	assert.equal(readSelected(), 10)
	graph.markObserverClean('reaction:selected')

	primary = 2
	graph.invalidateStateWrite('run', ['values', 'primary'])
	assert.deepEqual(graph.dirtyObserverIds(), [])

	secondary = 11
	graph.invalidateStateWrite('run', ['values', 'secondary'])
	assert.deepEqual(graph.dirtyObserverIds(), ['reaction:selected'])
	assert.equal(readSelected(), 11)
})

/** 失败计算不缓存结果或本次动态依赖，事务副本也不能污染稳定图。 */
test('failed and discarded graph work does not replace stable cache or dependencies', () => {
	const stable = new ReactiveDependencyGraph()
	let attempts = 0
	expect(() =>
		stable.read('rule:failing', () => {
			attempts += 1
			throw new Error('synthetic failure')
		}),
	).toThrowError('synthetic failure')
	expect(() =>
		stable.read('rule:failing', () => {
			attempts += 1
			throw new Error('synthetic failure')
		}),
	).toThrowError('synthetic failure')
	assert.equal(attempts, 2)

	stable.registerObserver('reaction:branch')
	stable.read('reaction:branch', () => {
		stable.trackStateRead('run', ['stable'])
		return 1
	})
	stable.markObserverClean('reaction:branch')

	const discarded = stable.clone()
	discarded.invalidateStateWrite('run', ['stable'])
	discarded.read('reaction:branch', () => {
		discarded.trackStateRead('run', ['discarded'])
		return 2
	})

	stable.invalidateStateWrite('run', ['discarded'])
	assert.deepEqual(stable.dirtyObserverIds(), [])
	stable.invalidateStateWrite('run', ['stable'])
	assert.deepEqual(stable.dirtyObserverIds(), ['reaction:branch'])
})
