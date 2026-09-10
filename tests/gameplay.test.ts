import { afterEach, expect, test, vi } from 'vitest'
import type { Game, OperationResult } from '../src/gameplay'
import type {
	GamePackageSource,
	LoadedGamePackage,
	LocatedGameCatalog,
} from '../src/gameplay/types/package'
import type { StoredProfile, ActionContext } from '../src/gameplay/types/model'
import { Gameplay } from '../src/gameplay/gameplay'
import { PackageLoader } from '../src/gameplay/package-loader/PackageLoader'
import { HttpPackageSource } from '../src/gameplay/package-loader/HttpPackageSource'
import { Runtime } from '../src/gameplay/runtime/Runtime'
import { ReactiveDependencyGraph } from '../src/gameplay/runtime/reactivity'
import { createProfile } from '../src/gameplay/runtime/profile-factory'
import { projectCheckpoint } from '../src/gameplay/runtime/snapshot'
import {
	common,
	rule,
	makeConfig,
	makeGame,
	makePlayableGame,
	withImplementations,
	MemorySaveRepository,
	RecordingRuntimeMonitor,
} from './fixtures'

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

/** 真实 PackageLoader 的内存输入，仍经过 schema、registry 与 linking。 */
class MemoryPackageSource implements GamePackageSource {
	readonly game: LoadedGamePackage
	catalogReads = 0
	jsonReads = 0
	moduleReads = 0
	failCatalog = false
	failConfig = false
	constructor(game: LoadedGamePackage) {
		this.game = game
	}
	async list(): Promise<LocatedGameCatalog> {
		this.catalogReads += 1
		if (this.failCatalog) throw new Error('catalog offline')
		return {
			packages: [this.game.location],
			defaultVersions: { [this.game.config.meta.id]: this.game.config.meta.version },
		}
	}
	async readJson(location: string): Promise<unknown> {
		this.jsonReads += 1
		if (location === this.game.location.manifestLocation) return structuredClone(this.game.manifest)
		if (this.failConfig) return { invalid: true }
		return structuredClone(this.game.config)
	}
	async importTrustedModule(location: string): Promise<unknown> {
		this.moduleReads += 1
		return location === 'rules' ? { rules: this.game.rules } : { actions: this.game.actions }
	}
	resolve(_base: string, reference: string): string {
		return reference
	}
}

function setup(game = makePlayableGame()) {
	const source = new MemoryPackageSource(game)
	const packages = new PackageLoader(source)
	const saves = new MemorySaveRepository()
	const recent = new Map<string, string>()
	const metadata = {
		getRecentProfile: vi.fn(async (id: string) => recent.get(id)),
		setRecentProfile: vi.fn(async (id: string, profileId: string) => {
			recent.set(id, profileId)
		}),
	}
	const monitor = new RecordingRuntimeMonitor()
	const gameplay = new Gameplay(packages, saves, metadata, () => monitor)
	return { gameplay, saves, source, packages, metadata, monitor }
}

function value<T>(result: OperationResult<T>): T {
	if (!result.ok) throw new Error(result.message)
	return result.value
}

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

/** 覆盖 Check、单选、多选、命令、手动 Effect 与事件终局的最小交互内容。 */
function interactiveGame(): LoadedGamePackage {
	const config = makeConfig()
	const node = config.events.requiredEvent.nodes.requiredNode
	if (node.type !== 'single') throw new Error('fixture node type')
	node.choicesValue.continue = { ...common('continue', 0), action: { key: 'event.next', args: [] } }
	config.events.requiredEvent.nodes.multipleNode = {
		...common('multipleNode', 2),
		type: 'multiple',
		content: 'select supplies',
		requiredValue: true,
		required: rule('constant.true'),
		choicesValue: {
			supplies: {
				...common('supplies', 0),
				value: 'supplies',
				maxCountValue: 3,
				maxCount: rule('supplies.max'),
			},
		},
		choices: rule('choices.multiple'),
		commands: {
			finish: { ...common('finish', 0), action: { key: 'event.finish', args: [] } },
			end: { ...common('end', 1), action: { key: 'run.end', args: [] } },
		},
	}
	config.effects.manual = {
		...common('manual', 1),
		acquiredValue: true,
		acquired: rule('constant.true'),
		activedValue: false,
		actived: rule('manual.active'),
		manuallyActivatable: true,
		reactionList: [],
	}
	const instance = (context: ActionContext) => {
		const event = context.runState.events.requiredEvent
		if (!event.activeInstanceId) throw new Error('missing active instance')
		return event.instances[event.activeInstanceId]
	}
	return withImplementations(makeGame(config), {
		rules: {
			'supplies.max': { key: 'supplies.max', calc: () => 3 },
			'choices.multiple': {
				key: 'choices.multiple',
				calc: (context) => {
					const multiple = context.turnState.events.requiredEvent.nodes.multipleNode
					if (multiple.type !== 'multiple') throw new Error('fixture multiple type')
					return multiple.choicesValue
				},
			},
			'manual.active': {
				key: 'manual.active',
				calc: (context) => context.turnState.effects.manual.activedValue,
			},
		},
		actions: {
			'check.noop': {
				key: 'check.noop',
				exec: (context) => {
					instance(context).currentNodeId = 'requiredNode'
				},
			},
			'event.next': {
				key: 'event.next',
				exec: (context) => {
					instance(context).currentNodeId = 'multipleNode'
				},
			},
			'event.finish': {
				key: 'event.finish',
				exec: (context) => {
					const active = instance(context)
					const multiple = context.turnState.events.requiredEvent.nodes.multipleNode
					if (multiple.type !== 'multiple') throw new Error('fixture multiple type')
					const count = multiple.selections?.[active.instanceId]?.choices.supplies?.count ?? 0
					context.runState.characters.hero.attributes.score.value += count
					active.status = 'completed'
				},
			},
			'run.end': { key: 'run.end', exec: (context) => context.endRun() },
		},
	})
}

test('Gameplay drives creation, player commands, saves, results and restart without React or DOM', async () => {
	const { gameplay, saves } = setup(interactiveGame())
	const opened: Game[] = []
	try {
		const games = await gameplay.listGames()
		expect(games[0]).toMatchObject({ gameId: 'test-game', saveCount: 0 })
		const initial = value(await gameplay.createGame('test-game'))
		const game = await gameplay.openGame(initial.profileId)
		opened.push(game)
		expect(game.getSnapshot().game.id).toBe('test-game')
		expect(game.getSnapshot().characters[0]).toMatchObject({
			characterId: 'hero',
			attributes: [{ attributeId: 'score', value: 1 }],
		})
		expect(Object.isFrozen(game.getSnapshot().characters[0].attributes)).toBe(true)
		expect(await game.advanceTurn()).toMatchObject({ ok: false, code: 'blocked', committed: false })
		expect(await game.activateEffect('manual')).toMatchObject({ ok: true })
		expect(game.getSnapshot().effects.find((effect) => effect.effectId === 'manual')?.actived).toBe(
			true,
		)
		expect(await game.startEvent('requiredEvent')).toMatchObject({ ok: true })
		const active = game.getSnapshot().events.active[0]
		expect(active.currentNodeId).toBe('requiredNode')
		expect(
			await game.chooseSingle(active.eventInstanceId, active.currentNodeId, 'continue'),
		).toMatchObject({ ok: true })
		expect(
			await game.chooseSingle(active.eventInstanceId, active.currentNodeId, 'continue'),
		).toMatchObject({ ok: false, code: 'stale-node' })
		expect(
			await game.setChoiceCount(active.eventInstanceId, 'multipleNode', 'supplies', 2),
		).toMatchObject({ ok: true })
		expect(game.getSnapshot().events.active[0].currentNode.choices[0]).toMatchObject({
			count: 2,
			maxCount: 3,
		})
		expect(
			await game.executeNodeCommand(active.eventInstanceId, 'multipleNode', 'finish'),
		).toMatchObject({ ok: true })
		expect(await game.advanceTurn()).toMatchObject({ ok: true })
		const checkpoint = game.getSnapshot().checkpoint
		expect(checkpoint.kind).toBe('turn_end')
		expect((await gameplay.getCheckpoint(checkpoint)).characters[0].attributes[0].value).toBe(3)
		game.close()
		expect((await saves.get(initial.profileId))?.current.turnId).toBe(checkpoint.turnId)

		const branch = value(await gameplay.branchGame(initial))
		expect(branch.runId).not.toBe(initial.runId)
		let collection = await gameplay.listSaves('test-game')
		expect(collection.profiles[0].runs).toHaveLength(2)
		expect(value(await gameplay.setPinned(checkpoint, true))).toBeUndefined()
		collection = await gameplay.listSaves('test-game')
		const root = collection.profiles[0].runs.find((run) => run.runId === initial.runId)!
		expect(root.checkpoints[0]).toMatchObject({
			canBranch: true,
			canTruncate: true,
			truncateRemovedCount: 1,
			truncatePinnedCount: 1,
		})
		expect(value(await gameplay.continueGame(checkpoint))).toEqual({
			profileId: checkpoint.profileId,
			runId: checkpoint.runId,
			turnId: checkpoint.turnId,
		})
		expect((await gameplay.getGameInfo('test-game')).recent?.source).toEqual({
			profileId: checkpoint.profileId,
			runId: checkpoint.runId,
			turnId: checkpoint.turnId,
		})
		expect(value(await gameplay.truncateGame(initial))).toEqual(initial)
		expect(
			(await gameplay.listSaves('test-game')).profiles[0].runs.find(
				(run) => run.runId === initial.runId,
			)?.checkpoints,
		).toHaveLength(1)

		const resumed = await gameplay.openGame(initial.profileId)
		opened.push(resumed)
		expect(await resumed.abandon()).toMatchObject({ ok: true })
		const abandoned = resumed.getSnapshot().checkpoint
		resumed.close()
		expect((await gameplay.getCheckpoint(abandoned)).status).toBe('abandoned')
		const restart = value(await gameplay.restartGame(abandoned))
		expect(restart.runId).not.toBe(abandoned.runId)
		expect((await gameplay.getCheckpoint(abandoned)).status).toBe('abandoned')
		const restarted = await gameplay.openGame(restart.profileId)
		opened.push(restarted)
		expect(await restarted.startEvent('requiredEvent')).toMatchObject({ ok: true })
		const ending = restarted.getSnapshot().events.active[0]
		await restarted.chooseSingle(ending.eventInstanceId, ending.currentNodeId, 'continue')
		expect(
			await restarted.executeNodeCommand(ending.eventInstanceId, 'multipleNode', 'end'),
		).toMatchObject({ ok: true })
		expect(restarted.getSnapshot()).toMatchObject({
			status: 'ended',
			endingEvent: { currentNode: { content: 'select supplies' } },
		})
		const terminal = restarted.getSnapshot().checkpoint
		restarted.close()
		expect((await gameplay.getCheckpoint(terminal)).status).toBe('ended')
		expect((await gameplay.getCheckpoint(initial)).status).toBe('active')
		expect((await gameplay.deleteCheckpoint(abandoned)).ok).toBe(true)
		expect((await gameplay.deleteRun(branch)).ok).toBe(true)
		expect((await gameplay.deleteProfile(initial.profileId)).ok).toBe(true)
		expect((await gameplay.listSaves('test-game')).profiles).toHaveLength(0)
	} finally {
		opened.forEach((game) => game.close())
	}
})

test('cross-run commands read once and persistence failure preserves the original save', async () => {
	const { gameplay, saves } = setup()
	const source = value(await gameplay.createGame('test-game'))
	const before = await saves.get(source.profileId)
	const get = vi.spyOn(saves, 'get')
	const put = vi.spyOn(saves, 'put').mockRejectedValueOnce(new Error('disk full'))
	expect(await gameplay.branchGame(source)).toMatchObject({ ok: false, code: 'persistence-error' })
	expect(get).toHaveBeenCalledTimes(1)
	expect(put).toHaveBeenCalledTimes(1)
	expect(await saves.get(source.profileId)).toEqual(before)
	expect((await gameplay.branchGame(source)).ok).toBe(true)
})

test('unavailable exact packages allow deletion while play and mutation remain blocked', async () => {
	const { gameplay, saves } = setup()
	const source = value(await gameplay.createGame('test-game'))
	const profile = (await saves.get(source.profileId))!
	profile.configVersion = 'missing'
	await saves.put(profile)
	expect((await gameplay.listSaves('test-game')).profiles[0].available).toBe(false)
	expect(await gameplay.continueGame(source)).toMatchObject({
		ok: false,
		code: 'incompatible-save',
	})
	await expect(gameplay.openGame(source.profileId)).rejects.toThrow('not available')
	expect((await gameplay.deleteCheckpoint(source)).ok).toBe(true)
	expect(await saves.get(source.profileId)).toBeUndefined()
})

test('recent metadata failure does not turn a committed operation into failure', async () => {
	const { gameplay, metadata } = setup()
	metadata.setRecentProfile.mockRejectedValue(new Error('metadata unavailable'))
	const source = value(await gameplay.createGame('test-game'))
	const game = await gameplay.openGame(source.profileId)
	try {
		expect(await game.advanceTurn()).toMatchObject({ ok: true })
	} finally {
		game.close()
	}
	expect((await gameplay.getGameInfo('test-game')).recent).toBeDefined()
})

test('historical reads do not construct Runtime, register observers, run actions or change cursors', async () => {
	const game = makePlayableGame()
	const profile = createProfile(game)
	const original = structuredClone(profile)
	const action = vi.spyOn(game.actions['score.increment'], 'exec')
	const watch = vi.spyOn(game.rules['watch.turn-start'], 'calc')
	const observer = vi.spyOn(ReactiveDependencyGraph.prototype, 'registerObserver')
	const open = vi.spyOn(Runtime, 'open')
	const snapshot = projectCheckpoint(game, profile, profile.current)
	expect(snapshot.turnNumber).toBe(0)
	expect(snapshot.status).toBe('active')
	expect(action).not.toHaveBeenCalled()
	expect(watch).not.toHaveBeenCalled()
	expect(observer).not.toHaveBeenCalled()
	expect(open).not.toHaveBeenCalled()
	expect(profile).toEqual(original)
})

test('cancelled opens stop before construction and release a runtime created during cancellation', async () => {
	const { gameplay, saves, packages, monitor } = setup()
	const source = value(await gameplay.createGame('test-game'))
	const controller = new AbortController()
	controller.abort()
	const get = vi.spyOn(saves, 'get')
	await expect(gameplay.openGame(source.profileId, controller.signal)).rejects.toMatchObject({
		name: 'AbortError',
	})
	expect(get).not.toHaveBeenCalled()

	const waiting = deferred<LoadedGamePackage>()
	const pendingController = new AbortController()
	const load = vi.spyOn(packages, 'loadExact').mockReturnValueOnce(waiting.promise)
	const open = gameplay.openGame(source.profileId, pendingController.signal)
	await vi.waitFor(() => expect(load).toHaveBeenCalled())
	pendingController.abort()
	waiting.resolve(makePlayableGame())
	await expect(open).rejects.toMatchObject({ name: 'AbortError' })
	expect(monitor.finished).toBe(false)

	const during = new AbortController()
	const runtimeOpen = Runtime.open.bind(Runtime)
	vi.spyOn(Runtime, 'open').mockImplementationOnce(async (...args) => {
		const runtime = await runtimeOpen(...args)
		during.abort()
		return runtime
	})
	await expect(gameplay.openGame(source.profileId, during.signal)).rejects.toMatchObject({
		name: 'AbortError',
	})
	expect(monitor.finished).toBe(true)
})

test('abandon shares the command lock and close during persistence prevents another turn and notifications', async () => {
	const game = makePlayableGame()
	const saves = new MemorySaveRepository()
	const profile = createProfile(game)
	await saves.put(profile)
	const monitor = new RecordingRuntimeMonitor()
	const finish = vi.spyOn(monitor, 'finish')
	const runtime = await Runtime.open(game, profile, saves, () => monitor)
	const published = vi.fn()
	runtime.subscribe(published)
	const gate = deferred<void>()
	const actualPut = saves.put.bind(saves)
	vi.spyOn(saves, 'put').mockImplementationOnce(async (candidate: StoredProfile) => {
		await gate.promise
		return actualPut(candidate)
	})
	const pending = runtime.advanceTurn()
	expect(await runtime.abandon()).toMatchObject({ ok: false, code: 'busy' })
	runtime.close()
	runtime.close()
	expect(finish).not.toHaveBeenCalled()
	gate.resolve()
	expect(await pending).toMatchObject({ ok: true })
	expect(finish).toHaveBeenCalledTimes(1)
	expect(published).not.toHaveBeenCalled()
	expect(runtime.getSnapshot()).toMatchObject({ phase: 'turn_end', turnNumber: 1 })
	expect(await runtime.advanceTurn()).toMatchObject({ ok: false, code: 'not-found' })
	expect((await saves.get(profile.profileId))?.current).toEqual(runtime.getCurrentCheckpoint())
})

test('abandon failure keeps the game usable and close discards ordinary work', async () => {
	const { gameplay, saves } = setup()
	const source = value(await gameplay.createGame('test-game'))
	const game = await gameplay.openGame(source.profileId)
	const snapshot = game.getSnapshot()
	const before = await saves.get(source.profileId)
	vi.spyOn(saves, 'put').mockRejectedValueOnce(new Error('disk full'))
	expect(await game.abandon()).toMatchObject({
		ok: false,
		code: 'persistence-error',
		committed: false,
	})
	expect(game.getSnapshot()).toBe(snapshot)
	expect(await saves.get(source.profileId)).toEqual(before)
	game.close()
	const reopened = await gameplay.openGame(source.profileId)
	expect(reopened.getSnapshot().characters[0].attributes[0].value).toBe(
		snapshot.characters[0].attributes[0].value,
	)
	expect(await reopened.abandon()).toMatchObject({ ok: true })
	reopened.close()
})

test('terminal at turn_end is published once and a throwing subscriber cannot undo the commit', async () => {
	const config = makeConfig()
	config.events = {}
	config.effects.turnEffect.reactionList = [
		{ watch: rule('watch.end'), from: false, to: true, action: { key: 'run.end', args: [] } },
	]
	const game = withImplementations(makeGame(config), {
		rules: {
			'watch.end': { key: 'watch.end', calc: (context) => context.turnState.phase === 'turn_end' },
		},
		actions: { 'run.end': { key: 'run.end', exec: (context) => context.endRun() } },
	})
	const saves = new MemorySaveRepository()
	const runtime = await Runtime.open(game, createProfile(game), saves)
	const observe = vi.fn()
	runtime.subscribe(() => {
		throw new Error('UI subscriber failed')
	})
	runtime.subscribe(observe)
	const before = runtime.getSnapshot()
	expect(runtime.getSnapshot()).toBe(before)
	try {
		expect(await runtime.advanceTurn()).toMatchObject({ ok: true })
		expect(observe).toHaveBeenCalledTimes(1)
		expect(runtime.getSnapshot()).toMatchObject({
			status: 'ended',
			checkpoint: { kind: 'terminal' },
		})
	} finally {
		runtime.close()
	}
})

test('catalog and exact packages share concurrent loads, and failures can be retried', async () => {
	const source = new MemoryPackageSource(makeGame())
	const packages = new PackageLoader(source)
	source.failCatalog = true
	const first = packages.list()
	expect(packages.list()).toBe(first)
	await expect(first).rejects.toThrow('catalog offline')
	source.failCatalog = false
	source.failConfig = true
	await expect(packages.loadDefault('test-game')).rejects.toMatchObject({
		stage: 'schema-validation',
	})
	source.failConfig = false
	const [a, b] = await Promise.all([
		packages.loadDefault('test-game'),
		packages.loadExact('test-game', 'test'),
	])
	expect(a).toBe(b)
	expect(Object.isFrozen(a.config)).toBe(true)
	expect(source.catalogReads).toBe(2)
	expect(source.jsonReads).toBe(4)
	expect(source.moduleReads).toBe(4)
})

test('HTTP source uses the injected deployment base and unknown JSON still needs schema validation', async () => {
	const fetch = vi
		.fn()
		.mockResolvedValue(
			new Response(JSON.stringify({ schemaVersion: 1, games: [], defaultVersions: {} })),
		)
	vi.stubGlobal('fetch', fetch)
	const source = new HttpPackageSource('https://example.test/subpath/', 'no-cache')
	expect((await source.list()).packages).toEqual([])
	expect(fetch).toHaveBeenCalledWith('https://example.test/subpath/games/catalog.json', {
		cache: 'no-cache',
	})
	expect(() =>
		source.resolve(
			'https://example.test/subpath/games/catalog.json',
			'https://foreign.test/manifest',
		),
	).toThrow('Cross-origin')
	fetch.mockResolvedValueOnce(new Response('{'))
	await expect(source.readJson('https://example.test/broken.json')).rejects.toThrow(
		'Invalid JSON at https://example.test/broken.json',
	)
	fetch.mockResolvedValueOnce(new Response('42'))
	await expect(source.list()).rejects.toMatchObject({ stage: 'catalog' })
})
