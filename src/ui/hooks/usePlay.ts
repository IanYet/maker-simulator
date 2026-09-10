import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router'
import type { Game, CommandResult, GameSnapshot } from '../../gameplay'
import { useGameplay } from '../app/useGameplay'
import { gameLocation, resultLocation } from '../app/routes'
import { attributeRows } from '../presentation'

type OpenState =
	| { status: 'loading' }
	| { status: 'error'; message: string; profileId: string }
	| { status: 'ready'; game: Game; profileId: string }

/** 将打开/取消/关闭绑定到页面生命周期，防止过期实例遗留。 */
export function useOpenGame(profileId: string): OpenState {
	const gameplay = useGameplay()
	const [state, setState] = useState<OpenState>({ status: 'loading' })
	useEffect(() => {
		let opened: Game | undefined
		const controller = new AbortController()
		gameplay.openGame(profileId, controller.signal).then(
			(game) => {
				opened = game
				if (controller.signal.aborted) game.close()
				else setState({ status: 'ready', game, profileId })
			},
			(error: unknown) => {
				if (!controller.signal.aborted)
					setState({
						status: 'error',
						profileId,
						message: error instanceof Error ? error.message : String(error),
					})
			},
		)
		return () => {
			controller.abort()
			opened?.close()
		}
	}, [gameplay, profileId])
	return state.status !== 'loading' && state.profileId !== profileId ? { status: 'loading' } : state
}

interface AttributeChange {
	from: string
	to: string
	delta: number
	token: string
}

/** 用户操作、pending、焦点、确认与导航；唯一游戏数据来自 GameSnapshot。 */
export function usePlay(game: Game) {
	const navigate = useNavigate()
	const subscribe = useMemo(() => (listener: () => void) => game.subscribe(listener), [game])
	const getSnapshot = useMemo(() => () => game.getSnapshot(), [game])
	const snapshot = useSyncExternalStore(subscribe, getSnapshot)
	const [busy, setBusy] = useState(false)
	const pending = useRef(false)
	const mounted = useRef(true)
	const leaving = useRef(false)
	const [message, setMessage] = useState<string>()
	const [dialog, setDialog] = useState<'exit' | 'saves' | 'abandon'>()
	const [focus, setFocus] = useState<string>()
	const [attributeChanges, setAttributeChanges] = useState<Record<string, AttributeChange>>({})
	const focused =
		snapshot.events.active.find((event) => event.eventInstanceId === focus) ??
		snapshot.events.active[0]

	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	useEffect(() => {
		if (!busy && snapshot.status !== 'active' && !leaving.current)
			navigate(resultLocation(snapshot.checkpoint), { replace: true })
	}, [busy, snapshot, navigate])
	useEffect(() => {
		const changes = Object.entries(attributeChanges)
		if (!changes.length) return
		const timer = setTimeout(
			() =>
				setAttributeChanges((active) => {
					const next = { ...active }
					for (const [key, change] of changes)
						if (active[key]?.token === change.token) delete next[key]
					return next
				}),
			2200,
		)
		return () => clearTimeout(timer)
	}, [attributeChanges])

	function showChanges(previous: GameSnapshot, current: GameSnapshot): void {
		const before = new Map(
			attributeRows(previous).map((attribute) => [
				`${attribute.characterId}.${attribute.attributeId}`,
				attribute,
			]),
		)
		const changes: Record<string, AttributeChange> = {}
		for (const attribute of attributeRows(current)) {
			const key = `${attribute.characterId}.${attribute.attributeId}`
			const prior = before.get(key)
			if (
				!prior ||
				(prior.value === attribute.value && prior.displayValue === attribute.displayValue)
			)
				continue
			changes[key] = {
				from: prior.displayValue,
				to: attribute.displayValue,
				delta: attribute.value - prior.value,
				token: `${current.revision}:${key}`,
			}
		}
		if (Object.keys(changes).length) setAttributeChanges((active) => ({ ...active, ...changes }))
	}

	async function execute(command: () => Promise<CommandResult>, exitAfter = false): Promise<void> {
		if (pending.current) return
		pending.current = true
		setBusy(true)
		setMessage(undefined)
		const previous = game.getSnapshot()
		try {
			const result = await command()
			if (!mounted.current) return
			showChanges(previous, game.getSnapshot())
			if (!result.ok) setMessage(result.message)
			else if (exitAfter) {
				leaving.current = true
				game.close()
				navigate(gameLocation(snapshot.game.id))
			}
		} catch (error) {
			if (mounted.current) setMessage(error instanceof Error ? error.message : String(error))
		} finally {
			pending.current = false
			if (mounted.current) setBusy(false)
		}
	}

	function leave(page: 'menu' | 'saves'): void {
		if (pending.current) return
		leaving.current = true
		game.close()
		navigate(gameLocation(snapshot.game.id, page))
	}

	return {
		snapshot,
		busy,
		message,
		dialog,
		setDialog,
		focused,
		focusEvent: setFocus,
		attributeChanges,
		execute,
		leave,
		abandonAndExit: () => execute(() => game.abandon(), true),
	}
}
