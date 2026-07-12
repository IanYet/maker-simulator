import {
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type RefObject,
} from 'react'
import { useNavigate, useParams } from 'react-router'
import type { ActiveEventView, AttributeView, EffectView, SessionCommandResult } from '../../types'
import { useAppServices } from '../../app/useAppServices'
import type { GameSessionImpl } from '../../session'
import { Button, ConfirmDialog, LiveRegion, StatusBanner, Surface } from '../components'
import styles from './pages.module.css'

type SessionState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; session: GameSessionImpl }

interface AttributeChange {
	from: string
	to: string
	delta: number
	token: string
}

const attributeKey = (characterId: string, attributeId: string): string => `${characterId}.${attributeId}`

function EffectCard({
	effect,
	session,
	busy,
	execute,
}: {
	effect: EffectView
	session: GameSessionImpl
	busy: boolean
	execute: (command: Promise<SessionCommandResult>) => Promise<void>
}) {
	const pending = !effect.actived
	return (
		<article className={`${styles.effectCard} ${effect.actived ? styles.effectCardActive : styles.effectCardPending}`}>
			<div className={styles.effectName}>
				<span>{effect.displayName}</span>
				<span className={styles.pill}>{effect.actived ? '已激活' : '待激活'}</span>
			</div>
			{effect.description && <p className={styles.effectText}>{effect.description}</p>}
			{effect.bindCharacterDisplayName && <p className={styles.effectText}>绑定：{effect.bindCharacterDisplayName}</p>}
			{pending && effect.manuallyActivatable && (
				<div className={styles.effectActions}>
					<Button
						className={styles.effectAction}
						disabled={busy || !effect.canActivate}
						onClick={() => void execute(session.activateEffect(effect.effectId))}
						variant="secondary"
					>
						激活
					</Button>
				</div>
			)}
			{pending && !effect.manuallyActivatable && <p className={styles.effectHint}>等待条件满足</p>}
		</article>
	)
}

/** 游戏主界面：连接 SessionView、事件操作、属性/Effect 面板和回合推进。 */
export function PlayPage() {
	const { profileId = '' } = useParams()
	const services = useAppServices()
	const navigate = useNavigate()
	const [state, setState] = useState<SessionState>({ status: 'loading' })

	useEffect(() => {
		let active = true
		let opened: GameSessionImpl | undefined
		services.openSession(profileId, navigate).then(
			(session) => {
				opened = session
				if (active) setState({ status: 'ready', session })
				else session.dispose()
			},
			(error: unknown) => { if (active) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }) },
		)
		return () => {
			active = false
			opened?.dispose()
		}
	}, [navigate, profileId, services])

	if (state.status === 'loading') {
		return <main className={styles.page}><StatusBanner tone="loading">正在从最后稳定检查点重建运行时…</StatusBanner></main>
	}
	if (state.status === 'error') {
		return <main className={styles.page}><StatusBanner tone="error">无法恢复游戏：{state.message}</StatusBanner></main>
	}
	return <GameScreen session={state.session} />
}

function GameScreen({ session }: { session: GameSessionImpl }) {
	const navigate = useNavigate()
	const subscribe = useMemo(() => (listener: () => void) => session.subscribe(listener), [session])
	const getSnapshot = useMemo(() => () => session.getView(), [session])
	const view = useSyncExternalStore(subscribe, getSnapshot)
	const [message, setMessage] = useState<string>()
	const [dialog, setDialog] = useState<'exit' | 'saves' | 'abandon'>()
	const [attributeChanges, setAttributeChanges] = useState<Record<string, AttributeChange>>({})
	const nodeHeading = useRef<HTMLHeadingElement>(null)
	const focused = view.runtime.activeEvents.find(
		(event) => event.eventInstanceId === view.focusedEventInstanceId,
	)

	useEffect(() => {
		if (focused) nodeHeading.current?.focus()
	}, [focused])

	useEffect(() => {
		const changes = Object.entries(attributeChanges)
		if (changes.length === 0) return
		const timer = setTimeout(() => {
			setAttributeChanges((active) => {
				const next = { ...active }
				for (const [key, change] of changes) {
					if (active[key]?.token === change.token) delete next[key]
				}
				return next
			})
		}, 2200)
		return () => clearTimeout(timer)
	}, [attributeChanges])

	/** 记录一次命令造成的属性差异，并交给面板动画短暂展示。 */
	function showAttributeChanges(previous: readonly AttributeView[], current: readonly AttributeView[], revision: number): void {
		const previousByKey = new Map(previous.map((attribute) => [attributeKey(attribute.characterId, attribute.attributeId), attribute]))
		const changes: Record<string, AttributeChange> = {}

		for (const attribute of current) {
			const key = attributeKey(attribute.characterId, attribute.attributeId)
			const prior = previousByKey.get(key)
			if (!prior || (prior.value === attribute.value && prior.displayValue === attribute.displayValue)) continue
			changes[key] = {
				from: prior.displayValue,
				to: attribute.displayValue,
				delta: attribute.value - prior.value,
				token: `${revision}:${key}`,
			}
		}

		if (Object.keys(changes).length > 0) setAttributeChanges((active) => ({ ...active, ...changes }))
	}

	const attributesByCharacter = useMemo(() => {
		const groups = new Map<string, typeof view.runtime.attributes>()
		for (const attribute of view.runtime.attributes) {
			const current = groups.get(attribute.characterDisplayName) ?? []
			groups.set(attribute.characterDisplayName, [...current, attribute])
		}
		return groups
	}, [view])
	const activeEffects = view.runtime.effects.filter((effect) => effect.actived)
	const pendingEffects = view.runtime.effects.filter((effect) => !effect.actived)

	/** 执行 Session 命令，统一处理错误提示、属性动画和终局导航。 */
	async function execute(command: Promise<SessionCommandResult>): Promise<void> {
		const previousAttributes = view.runtime.attributes
		setMessage(undefined)
		const result = await command
		if (!result.ok) {
			setMessage(result.message)
			return
		}
		const snapshot = session.runtime.getSnapshot()
		showAttributeChanges(previousAttributes, snapshot.attributes, snapshot.revision)
		if (snapshot.runStatus !== 'active') {
			const profile = session.runtime.getProfile()
			navigate(`/result/${encodeURIComponent(profile.profileId)}/${encodeURIComponent(profile.current.runId)}/${encodeURIComponent(profile.current.turnId)}`, { replace: true })
		}
	}

	async function abandonAndExit(): Promise<void> {
		setMessage(undefined)
		const result = await session.abandonAndExit()
		if (!result.ok) setMessage(result.message)
	}

	function eventButtons() {
		const pendingRequired = new Set(
			view.runtime.advanceTurnBlockers
				.filter((blocker) => blocker.startsWith('待处理事件「'))
				.map((blocker) => blocker.slice('待处理事件「'.length, -'」必须处理'.length)),
		)
		return (
			<>
				{view.runtime.activeEvents.map((event) => (
					<button
						aria-pressed={event.eventInstanceId === view.focusedEventInstanceId}
						className={`${styles.eventButton} ${event.eventInstanceId === view.focusedEventInstanceId ? styles.eventButtonActive : ''}`}
						key={event.eventInstanceId}
						onClick={() => session.focusEvent(event.eventInstanceId)}
						type="button"
					>
						{event.displayName} · 进行中{event.required ? ' · 必须处理' : ''}
					</button>
				))}
				{view.runtime.eventCards.map((event) => (
					<button
						className={styles.eventButton}
						disabled={view.busy}
						key={event.eventId}
						onClick={() => void execute(session.startEvent(event.eventId))}
						type="button"
					>
						{event.displayName} · 开始{pendingRequired.has(event.displayName) ? ' · 必须处理' : ''}
					</button>
				))}
			</>
		)
	}

	return (
		<main className={styles.gamePage}>
			<div className={styles.gameLayout}>
				<aside className={styles.sidebar} aria-label="游戏状态">
					<section className={styles.sideSection}>
						<h2 className={styles.sectionLabel}>Attributes / 属性</h2>
						{attributesByCharacter.size === 0 && <p>暂无可见属性。</p>}
						{[...attributesByCharacter.entries()].map(([character, attributes]) => (
							<div className={styles.attributeGroup} key={character}>
								<h3>{character}</h3>
								{attributes.map((attribute) => {
									const change = attributeChanges[attributeKey(attribute.characterId, attribute.attributeId)]
									const direction = change
										? change.delta > 0
											? styles.attributeChangePositive
											: change.delta < 0
												? styles.attributeChangeNegative
												: styles.attributeChangeNeutral
										: undefined
									return (
										<div
											className={`${styles.attributeRow} ${change ? styles.attributeRowChanged : ''}`}
											key={attributeKey(attribute.characterId, attribute.attributeId)}
										>
											<span>{attribute.displayName}</span>
											<span className={styles.attributeValueWrap}>
												<span className={styles.attributeValue}>{attribute.displayValue}{attribute.min !== undefined || attribute.max !== undefined ? ` / ${attribute.min ?? '−∞'}–${attribute.max ?? '∞'}` : ''}</span>
												{change && (
													<span
														aria-live="polite"
														className={`${styles.attributeChange} ${direction ?? ''}`}
														key={change.token}
													>
														{change.from} → {change.to}
													</span>
												)}
											</span>
										</div>
									)
								})}
							</div>
						))}
					</section>
					<section className={styles.sideSection}>
						<h2 className={styles.sectionLabel}>Effects / 构建</h2>
						{view.runtime.effects.length === 0 ? <p>尚未获得 Effect。</p> : (
							<>
								<div className={styles.effectGroup}>
									<h3 className={styles.effectGroupTitle}>已激活</h3>
									<div className={styles.effectList}>
										{activeEffects.length === 0 && <p>暂无已激活 Effect。</p>}
										{activeEffects.map((effect) => <EffectCard busy={view.busy} effect={effect} execute={execute} key={effect.effectId} session={session} />)}
									</div>
								</div>
								<div className={styles.effectGroup}>
									<h3 className={styles.effectGroupTitle}>已获得 · 待激活</h3>
									<div className={styles.effectList}>
										{pendingEffects.length === 0 && <p>暂无待激活 Effect。</p>}
										{pendingEffects.map((effect) => <EffectCard busy={view.busy} effect={effect} execute={execute} key={effect.effectId} session={session} />)}
									</div>
								</div>
							</>
						)}
					</section>
				</aside>
				<section className={styles.playMain}>
					<header className={styles.playHeader}>
						<div>
							<p className={styles.sectionLabel}>Current run</p>
							<h1 className={styles.playTitle}>{view.gameName}</h1>
						</div>
						<div className={styles.playMeta}>回合 {view.runtime.turnNumber} · {view.runtime.phase}{view.busy ? ' · 执行中' : ''}</div>
					</header>
					{message && <div className={styles.message} role="alert">{message}</div>}
					<div className={styles.eventStrip} aria-label="事件入口">
						{view.runtime.activeEvents.length === 0 && view.runtime.eventCards.length === 0
							? <span className={styles.playMeta}>本回合没有可启动事件</span>
							: eventButtons()}
					</div>
					<div className={styles.nodeArea}>
						{focused
							? <EventNode session={session} event={focused} busy={view.busy} execute={execute} headingRef={nodeHeading} />
							: (
								<Surface tone="soft" className={styles.emptyNode}>
									<p className={styles.eyebrow}>Event network</p>
									<h2 className={styles.nodeTitle}>选择一个事件，或结束当前回合。</h2>
									<p className={styles.nodeContent}>事件可以并行进行；待处理区或进行中带有“必须处理”标记的事件会阻止进入下一回合。</p>
								</Surface>
							)}
					</div>
					<footer className={styles.actionBar}>
						<div className={styles.actionBarSecondary}>
							<Button variant="tertiary" disabled={view.busy} onClick={() => setDialog('exit')}>退出</Button>
							<Button variant="tertiary" disabled={view.busy} onClick={() => setDialog('abandon')}>退出并放弃</Button>
							<Button variant="tertiary" disabled={view.busy} onClick={() => setDialog('saves')}>选择存档</Button>
						</div>
						<div className={styles.actionBarPrimary}>
							{view.busy && <span className={styles.busy}>处理中</span>}
							<Button
								disabled={view.busy || !view.runtime.canAdvanceTurn}
								title={view.runtime.advanceTurnBlockers.join('；') || undefined}
								onClick={() => void execute(session.advanceTurn())}
							>
								下一回合
							</Button>
						</div>
					</footer>
				</section>
			</div>
			<LiveRegion>{message || (view.busy ? '正在执行命令' : view.runtime.advanceTurnBlockers.join('；'))}</LiveRegion>
			<ConfirmDialog
				open={dialog === 'exit'}
				title="退出当前回合？"
				description="本回合尚未到达稳定保存边界，退出后会从上一检查点重新开始本回合。"
				confirmLabel="退出"
				onClose={() => setDialog(undefined)}
				onConfirm={() => { setDialog(undefined); void session.exitAndSave() }}
			/>
			<ConfirmDialog
				open={dialog === 'saves'}
				title="打开存档浏览器？"
				description="本回合未提交的状态将被丢弃，存档中的最后稳定检查点不会改变。"
				confirmLabel="打开存档"
				onClose={() => setDialog(undefined)}
				onConfirm={() => { setDialog(undefined); void session.openSaveBrowser() }}
			/>
			<ConfirmDialog
				open={dialog === 'abandon'}
				title="放弃整条时间线？"
				description="系统会创建一条只读的放弃记录并结束当前 Run。之后仍可从记录中再来一局。"
				confirmLabel="放弃并退出"
				danger
				onClose={() => setDialog(undefined)}
				onConfirm={() => { setDialog(undefined); void abandonAndExit() }}
			/>
		</main>
	)
}

function EventNode({
	session,
	event,
	busy,
	execute,
	headingRef,
}: {
	session: GameSessionImpl
	event: ActiveEventView
	busy: boolean
	execute: (command: Promise<SessionCommandResult>) => Promise<void>
	headingRef: RefObject<HTMLHeadingElement | null>
}) {
	const node = event.currentNode
	return (
		<Surface tone="lilac" className={styles.nodeBlock}>
			<p className={styles.eyebrow}>{event.displayName}{node.required ? ' · Required' : ''}</p>
			<h2 className={styles.nodeTitle} ref={headingRef} tabIndex={-1}>{node.displayName}</h2>
			<p className={styles.nodeContent}>{node.content}</p>
			{node.type === 'single' ? (
				<div className={styles.choiceList}>
					{node.choices.map((choice) => (
						<Button
							className={styles.choiceButton}
							disabled={busy || !choice.enabled}
							key={choice.choiceId}
							onClick={() => void execute(session.chooseSingle(event.eventInstanceId, node.nodeId, choice.choiceId))}
							variant="secondary"
						>
							{choice.displayName}{choice.description ? ` — ${choice.description}` : ''}
						</Button>
					))}
				</div>
			) : (
				<div className={styles.choiceList}>
					{node.choices.map((choice) => (
						<div className={styles.multipleRow} key={choice.choiceId}>
							<div><strong>{choice.displayName}</strong>{choice.description && <p>{choice.description}</p>}</div>
							<div className={styles.stepper}>
								<Button icon variant="secondary" aria-label={`减少 ${choice.displayName}`} disabled={busy || !choice.enabled || choice.count === 0} onClick={() => void execute(session.updateSelection(event.eventInstanceId, node.nodeId, choice.choiceId, choice.count - 1))}>−</Button>
								<span className={styles.count} aria-live="polite">{choice.count}</span>
								<Button icon variant="secondary" aria-label={`增加 ${choice.displayName}`} disabled={busy || !choice.enabled || (choice.maxCount !== undefined && choice.count >= choice.maxCount)} onClick={() => void execute(session.updateSelection(event.eventInstanceId, node.nodeId, choice.choiceId, choice.count + 1))}>＋</Button>
							</div>
						</div>
					))}
					<div className={styles.commandList}>
						{node.commands.map((command) => (
							<Button disabled={busy || !command.enabled} key={command.commandId} onClick={() => void execute(session.executeNodeCommand(event.eventInstanceId, node.nodeId, command.commandId))}>{command.displayName}</Button>
						))}
					</div>
				</div>
			)}
		</Surface>
	)
}
