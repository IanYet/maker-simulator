import { useEffect, useRef, type RefObject } from 'react'
import { useParams } from 'react-router'
import type { ActiveEventView, EffectView, Game, CommandResult } from '../../gameplay'
import { useOpenGame, usePlay } from '../hooks/usePlay'
import { formatAttribute, blockerMessage } from '../presentation'
import { Button, ConfirmDialog, LiveRegion, StatusBanner, Surface } from '../components'
import styles from './pages.module.css'

const attributeKey = (characterId: string, attributeId: string): string =>
	`${characterId}.${attributeId}`

function EffectCard({
	effect,
	game,
	busy,
	execute,
}: {
	effect: EffectView
	game: Game
	busy: boolean
	execute: (command: () => Promise<CommandResult>) => Promise<void>
}) {
	const pending = !effect.actived
	return (
		<article
			className={`${styles.effectCard} ${effect.actived ? styles.effectCardActive : styles.effectCardPending}`}
		>
			<div className={styles.effectName}>
				<span>{effect.displayName}</span>
				<span className={styles.pill}>{effect.actived ? '已激活' : '待激活'}</span>
			</div>
			{effect.description && <p className={styles.effectText}>{effect.description}</p>}
			{effect.bindCharacterDisplayName && (
				<p className={styles.effectText}>绑定：{effect.bindCharacterDisplayName}</p>
			)}
			{pending && effect.manuallyActivatable && (
				<div className={styles.effectActions}>
					<Button
						className={styles.effectAction}
						disabled={busy || !effect.canActivate}
						onClick={() => void execute(() => game.activateEffect(effect.effectId))}
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

/** 游玩页面只负责连接 Game 生命周期与界面。 */
export function PlayPage() {
	const { profileId = '' } = useParams()
	const state = useOpenGame(profileId)

	if (state.status === 'loading') {
		return (
			<main className={styles.page}>
				<StatusBanner tone="loading">正在从最后稳定检查点重建运行时…</StatusBanner>
			</main>
		)
	}
	if (state.status === 'error') {
		return (
			<main className={styles.page}>
				<StatusBanner tone="error">无法恢复游戏：{state.message}</StatusBanner>
			</main>
		)
	}
	return <GameScreen game={state.game} />
}

function GameScreen({ game }: { game: Game }) {
	const {
		snapshot,
		busy,
		message,
		dialog,
		setDialog,
		focused,
		focusEvent,
		attributeChanges,
		execute,
		leave,
		abandonAndExit,
	} = usePlay(game)
	const nodeHeading = useRef<HTMLHeadingElement>(null)
	const focusedEventInstanceId = focused?.eventInstanceId
	const focusedNodeId = focused?.currentNodeId
	useEffect(() => {
		if (focusedEventInstanceId && focusedNodeId) nodeHeading.current?.focus()
	}, [focusedEventInstanceId, focusedNodeId])
	const activeEffects = snapshot.effects.filter((effect) => effect.actived)
	const pendingEffects = snapshot.effects.filter((effect) => !effect.actived)
	const blockers = snapshot.advanceTurnBlockers
		.map((blocker) => blockerMessage(blocker, snapshot))
		.join('；')

	function eventButtons() {
		return (
			<>
				{snapshot.events.active.map((event) => (
					<button
						aria-pressed={event.eventInstanceId === focusedEventInstanceId}
						className={`${styles.eventButton} ${event.eventInstanceId === focusedEventInstanceId ? styles.eventButtonActive : ''}`}
						key={event.eventInstanceId}
						onClick={() => focusEvent(event.eventInstanceId)}
						type="button"
					>
						{event.displayName} · 进行中{event.required ? ' · 必须处理' : ''}
					</button>
				))}
				{snapshot.events.available.map((event) => (
					<button
						className={styles.eventButton}
						disabled={busy}
						key={event.eventId}
						onClick={() => void execute(() => game.startEvent(event.eventId))}
						type="button"
					>
						{event.displayName} · 开始{event.required ? ' · 必须处理' : ''}
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
						{snapshot.characters.every((character) => character.attributes.length === 0) && (
							<p>暂无可见属性。</p>
						)}
						{snapshot.characters.map((group) => (
							<div className={styles.attributeGroup} key={group.characterId}>
								<h3>{group.displayName}</h3>
								{group.attributes.map((attribute) => {
									const change =
										attributeChanges[attributeKey(group.characterId, attribute.attributeId)]
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
											key={attributeKey(group.characterId, attribute.attributeId)}
										>
											<span>{attribute.displayName}</span>
											<span className={styles.attributeValueWrap}>
												<span className={styles.attributeValue}>
													{formatAttribute(attribute)}
													{attribute.min !== undefined || attribute.max !== undefined
														? ` / ${attribute.min ?? '−∞'}–${attribute.max ?? '∞'}`
														: ''}
												</span>
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
						{snapshot.effects.length === 0 ? (
							<p>尚未获得 Effect。</p>
						) : (
							<>
								<div className={styles.effectGroup}>
									<h3 className={styles.effectGroupTitle}>已激活</h3>
									<div className={styles.effectList}>
										{activeEffects.length === 0 && <p>暂无已激活 Effect。</p>}
										{activeEffects.map((effect) => (
											<EffectCard
												busy={busy}
												effect={effect}
												execute={execute}
												key={effect.effectId}
												game={game}
											/>
										))}
									</div>
								</div>
								<div className={styles.effectGroup}>
									<h3 className={styles.effectGroupTitle}>已获得 · 待激活</h3>
									<div className={styles.effectList}>
										{pendingEffects.length === 0 && <p>暂无待激活 Effect。</p>}
										{pendingEffects.map((effect) => (
											<EffectCard
												busy={busy}
												effect={effect}
												execute={execute}
												key={effect.effectId}
												game={game}
											/>
										))}
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
							<h1 className={styles.playTitle}>{snapshot.game.name}</h1>
						</div>
						<div className={styles.playMeta}>
							回合 {snapshot.turnNumber} · {snapshot.phase}
							{busy ? ' · 执行中' : ''}
						</div>
					</header>
					{message && (
						<div className={styles.message} role="alert">
							{message}
						</div>
					)}
					<div className={styles.eventStrip} aria-label="事件入口">
						{snapshot.events.active.length === 0 && snapshot.events.available.length === 0 ? (
							<span className={styles.playMeta}>本回合没有可启动事件</span>
						) : (
							eventButtons()
						)}
					</div>
					<div className={styles.nodeArea}>
						{focused ? (
							<EventNode
								key={`${focused.eventInstanceId}:${focused.currentNodeId}`}
								game={game}
								event={focused}
								busy={busy}
								execute={execute}
								headingRef={nodeHeading}
							/>
						) : (
							<Surface tone="soft" className={styles.emptyNode}>
								<p className={styles.eyebrow}>Event network</p>
								<h2 className={styles.nodeTitle}>选择一个事件，或结束当前回合。</h2>
								<p className={styles.nodeContent}>
									事件可以并行进行；待处理区或进行中带有“必须处理”标记的事件会阻止进入下一回合。
								</p>
							</Surface>
						)}
					</div>
					<footer className={styles.actionBar}>
						<div className={styles.actionBarSecondary}>
							<Button variant="tertiary" disabled={busy} onClick={() => setDialog('exit')}>
								退出
							</Button>
							<Button variant="tertiary" disabled={busy} onClick={() => setDialog('abandon')}>
								放弃
							</Button>
							<Button variant="tertiary" disabled={busy} onClick={() => setDialog('saves')}>
								选择存档
							</Button>
						</div>
						<div className={styles.actionBarPrimary}>
							{busy && <span className={styles.busy}>处理中</span>}
							<Button
								disabled={busy || !snapshot.canAdvanceTurn}
								title={blockers || undefined}
								onClick={() => void execute(() => game.advanceTurn())}
							>
								下一回合
							</Button>
						</div>
					</footer>
				</section>
			</div>
			<LiveRegion>{message || (busy ? '正在执行命令' : blockers)}</LiveRegion>
			<ConfirmDialog
				open={dialog === 'exit'}
				title="退出当前回合？"
				description="本回合尚未到达稳定保存边界，退出后会从上一检查点重新开始本回合。"
				confirmLabel="退出"
				onClose={() => setDialog(undefined)}
				onConfirm={async () => {
					leave('menu')
					setDialog(undefined)
				}}
			/>
			<ConfirmDialog
				open={dialog === 'saves'}
				title="打开存档浏览器？"
				description="本回合未提交的状态将被丢弃，存档中的最后稳定检查点不会改变。"
				confirmLabel="打开存档"
				onClose={() => setDialog(undefined)}
				onConfirm={async () => {
					leave('saves')
					setDialog(undefined)
				}}
			/>
			<ConfirmDialog
				open={dialog === 'abandon'}
				title="放弃整条时间线？"
				description="系统会创建一条只读的放弃记录并结束当前 Run。之后仍可从记录中再来一局。"
				confirmLabel="放弃并退出"
				danger
				onClose={() => setDialog(undefined)}
				onConfirm={async () => {
					await abandonAndExit()
					setDialog(undefined)
				}}
			/>
		</main>
	)
}

function EventNode({
	game,
	event,
	busy,
	execute,
	headingRef,
}: {
	game: Game
	event: ActiveEventView
	busy: boolean
	execute: (command: () => Promise<CommandResult>) => Promise<void>
	headingRef: RefObject<HTMLHeadingElement | null>
}) {
	const node = event.currentNode
	return (
		<Surface tone="lilac" className={styles.nodeBlock}>
			<p className={styles.eyebrow}>
				{event.displayName}
				{node.required ? ' · Required' : ''}
			</p>
			<h2 className={styles.nodeTitle} ref={headingRef} tabIndex={-1}>
				{node.displayName}
			</h2>
			<p className={styles.nodeContent}>{node.content}</p>
			{node.type === 'single' ? (
				<div className={styles.choiceList}>
					{node.choices.map((choice) => (
						<Button
							className={styles.choiceButton}
							disabled={busy || !choice.enabled}
							key={choice.choiceId}
							onClick={() =>
								void execute(() =>
									game.chooseSingle(event.eventInstanceId, node.nodeId, choice.choiceId),
								)
							}
							variant="secondary"
						>
							{choice.displayName}
							{choice.description ? ` — ${choice.description}` : ''}
						</Button>
					))}
				</div>
			) : (
				<div className={styles.choiceList}>
					{node.choices.map((choice) => (
						<div className={styles.multipleRow} key={choice.choiceId}>
							<div>
								<strong>{choice.displayName}</strong>
								{choice.description && <p>{choice.description}</p>}
							</div>
							<div className={styles.stepper}>
								<Button
									icon
									variant="secondary"
									aria-label={`减少 ${choice.displayName}`}
									disabled={busy || !choice.enabled || choice.count === 0}
									onClick={() =>
										void execute(() =>
											game.setChoiceCount(
												event.eventInstanceId,
												node.nodeId,
												choice.choiceId,
												choice.count - 1,
											),
										)
									}
								>
									−
								</Button>
								<span className={styles.count} aria-live="polite">
									{choice.count}
									{choice.maxCount !== undefined ? ` / ${choice.maxCount}` : ''}
								</span>
								<Button
									icon
									variant="secondary"
									aria-label={`增加 ${choice.displayName}`}
									disabled={
										busy ||
										!choice.enabled ||
										(choice.maxCount !== undefined && choice.count >= choice.maxCount)
									}
									onClick={() =>
										void execute(() =>
											game.setChoiceCount(
												event.eventInstanceId,
												node.nodeId,
												choice.choiceId,
												choice.count + 1,
											),
										)
									}
								>
									＋
								</Button>
							</div>
						</div>
					))}
					<div className={styles.commandList}>
						{node.commands.map((command) => (
							<Button
								disabled={busy || !command.enabled}
								key={command.commandId}
								onClick={() =>
									void execute(() =>
										game.executeNodeCommand(event.eventInstanceId, node.nodeId, command.commandId),
									)
								}
							>
								{command.displayName}
							</Button>
						))}
					</div>
				</div>
			)}
		</Surface>
	)
}
