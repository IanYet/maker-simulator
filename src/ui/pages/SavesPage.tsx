import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import type {
	SaveBrowserView,
	SaveCheckpointPreview,
	SaveCheckpointView,
	SaveRunView,
} from '../../app/services'
import type { SaveCommand, SessionCommandResult, TurnRef } from '../../types'
import { useAppServices } from '../../app/useAppServices'
import { Button, ButtonLink, ConfirmDialog, StatusBanner } from '../components'
import { PageChrome } from './PageChrome'
import styles from './pages.module.css'

type SavesState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; view: SaveBrowserView }

interface TruncateTarget {
	profileId: string
	source: TurnRef
	removedCount: number
	pinnedCount: number
}

type PreviewState =
	| { status: 'loading'; key: string }
	| { status: 'error'; key: string; message: string }
	| { status: 'ready'; key: string; preview: SaveCheckpointPreview }

function formatDate(value: string): string {
	return new Intl.DateTimeFormat('zh-CN', {
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(new Date(value))
}

function kindLabel(turn: SaveCheckpointView): string {
	return turn.kind === 'initial'
		? '初始检查点'
		: turn.kind === 'turn_end'
			? `第 ${turn.turnNumber} 回合结束`
			: turn.kind === 'terminal'
				? '终局'
				: '放弃记录'
}

function checkpointKey(profileId: string, source: TurnRef): string {
	return `${profileId}:${source.runId}:${source.turnId}`
}

function checkpointDomId(profileId: string, source: TurnRef): string {
	return `checkpoint-${encodeURIComponent(profileId)}-${encodeURIComponent(source.runId)}-${encodeURIComponent(source.turnId)}`
}

function CheckpointPreviewPanel({ preview }: { preview: SaveCheckpointPreview }) {
	return (
		<div className={styles.checkpointPreview} aria-label="检查点预览">
			<p className={styles.previewHeading}>只读预览 · 回合 {preview.turnNumber} · {preview.phase} · {preview.runStatus}</p>
			<div className={styles.previewGrid}>
				<section>
					<h3>属性</h3>
					{preview.attributes.length === 0
						? <p className={styles.previewEmpty}>无可展示属性</p>
						: preview.attributes.map((attribute) => (
							<p className={styles.previewItem} key={`${attribute.characterId}:${attribute.attributeId}`}>
								<span>{attribute.characterDisplayName} · {attribute.displayName}</span>
								<strong>{attribute.displayValue}</strong>
							</p>
						))}
				</section>
				<section>
					<h3>效果</h3>
					{preview.effects.length === 0
						? <p className={styles.previewEmpty}>无已获得效果</p>
						: preview.effects.map((effect) => (
							<p className={styles.previewItem} key={effect.effectId}>
								<span>{effect.displayName}</span>
								<strong>{effect.actived ? '已激活' : '未激活'}</strong>
							</p>
						))}
				</section>
				<section>
					<h3>事件</h3>
					{preview.pendingEvents.map((event) => (
						<p className={styles.previewItem} key={`pending:${event.eventId}`}>
							<span>{event.displayName}</span><strong>待处理</strong>
						</p>
					))}
					{preview.activeEvents.map((event) => (
						<p className={styles.previewItem} key={event.eventInstanceId}>
							<span>{event.displayName}</span><strong>{event.nodeDisplayName}</strong>
						</p>
					))}
					{preview.pendingEvents.length === 0 && preview.activeEvents.length === 0 && (
						<p className={styles.previewEmpty}>无待处理或进行中事件</p>
					)}
				</section>
				<section>
					<h3>终局</h3>
					{preview.ending
						? <><p className={styles.previewItem}><span>{preview.ending.displayName}</span><strong>{preview.ending.nodeDisplayName}</strong></p><p className={styles.previewCopy}>{preview.ending.content}</p></>
						: <p className={styles.previewEmpty}>此检查点没有关联终局节点</p>}
				</section>
			</div>
		</div>
	)
}

/** 存档浏览页：只消费应用 read model，并通过应用命令操作稳定检查点。 */
export function SavesPage() {
	const { gameId = '' } = useParams()
	const services = useAppServices()
	const navigate = useNavigate()
	const [state, setState] = useState<SavesState>({ status: 'loading' })
	const [selectedId, setSelectedId] = useState<string>()
	const [message, setMessage] = useState<string>()
	const [truncateTarget, setTruncateTarget] = useState<TruncateTarget>()
	const [previewState, setPreviewState] = useState<PreviewState>()
	const previewRequest = useRef(0)

	const load = useCallback(() => {
		let active = true
		services.getSaveBrowser(gameId).then(
			(view) => {
				if (!active) return
				setState({ status: 'ready', view })
				setPreviewState(undefined)
				setSelectedId((current) => current && view.profiles.some(
					(profile) => profile.profileId === current,
				) ? current : view.profiles[0]?.profileId)
			},
			(error: unknown) => {
				if (active) setState({
					status: 'error',
					message: error instanceof Error ? error.message : String(error),
				})
			},
		)
		return () => { active = false }
	}, [gameId, services])

	useEffect(() => load(), [load])

	const selected = state.status === 'ready'
		? state.view.profiles.find((profile) => profile.profileId === selectedId)
		: undefined

	async function runCommand(
		profileId: string,
		command: SaveCommand,
		navigateAfter = false,
	): Promise<SessionCommandResult> {
		setMessage(undefined)
		const result = await services.executeSaveCommand(profileId, command)
		if (!result.ok) {
			setMessage(result.message)
			return result
		}
		if (navigateAfter) navigate(`/play/${encodeURIComponent(profileId)}`)
		else load()
		return result
	}

	const truncateSummary = useMemo(() => truncateTarget
		? `将永久删除其后的 ${truncateTarget.removedCount} 个检查点，其中 ${truncateTarget.pinnedCount} 个已固定。此操作不可撤销。`
		: '', [truncateTarget])

	function selectProfile(profileId: string): void {
		previewRequest.current += 1
		setPreviewState(undefined)
		setSelectedId(profileId)
	}

	function previewCheckpoint(profileId: string, source: TurnRef): void {
		const key = checkpointKey(profileId, source)
		const request = ++previewRequest.current
		setPreviewState({ status: 'loading', key })
		services.getCheckpointPreview(profileId, source).then(
			(preview) => {
				if (previewRequest.current === request) {
					setPreviewState({ status: 'ready', key, preview })
				}
			},
			(error: unknown) => {
				if (previewRequest.current === request) {
					setPreviewState({
						status: 'error',
						key,
						message: error instanceof Error ? error.message : String(error),
					})
				}
			},
		)
	}

	function renderRun(run: SaveRunView, runIndex: number) {
		if (!selected) return null
		const missingOrigin = Boolean(run.origin && !run.origin.resolved)
		return (
			<div
				className={`${styles.runGroup} ${run.origin ? styles.runGroupBranch : ''} ${run.origin?.kind === 'restart' ? styles.runGroupRestart : ''}`}
				key={run.runId}
			>
				<h2 className={styles.runTitle}>
					第 {runIndex + 1} 条时间线{' '}
					<span className={styles.pill}>{run.origin?.kind === 'restart' ? '再来一局' : run.origin?.kind === 'branch' ? '分支' : '起点'}</span>
				</h2>
				{run.origin?.resolved && (
					<a
						className={styles.originLink}
						href={`#${checkpointDomId(selected.profileId, run.origin.source)}`}
					>
						来源：第 {run.origin.sourceTurnNumber} 回合的 {run.origin.sourceKind}
					</a>
				)}
				{missingOrigin && run.origin && (
					<p className={styles.originMissing}>
						来源检查点已清理 · {run.origin.source.runId.slice(0, 12)} / {run.origin.source.turnId.slice(0, 12)}
					</p>
				)}
				<div className={styles.timeline}>
					{run.checkpoints.map((turn, turnIndex) => {
						const key = checkpointKey(selected.profileId, turn.source)
						return (
							<article
								className={`${styles.turnCard} ${turn.current ? styles.turnCurrent : ''}`}
								id={checkpointDomId(selected.profileId, turn.source)}
								key={turn.source.turnId}
							>
								<div className={styles.turnHeader}>
									<strong>{kindLabel(turn)}</strong>
									{turn.current && <span className={styles.pill}>当前</span>}
								</div>
								<span className={styles.turnMeta}>#{turnIndex + 1} · {formatDate(turn.createdAt)} · {turn.pinned ? '已固定' : '自动保留'}</span>
								<div className={styles.turnActions}>
									<Button className={styles.smallButton} disabled={!selected.available} variant="secondary" onClick={() => previewCheckpoint(selected.profileId, turn.source)}>预览</Button>
									{turn.canContinue && <Button className={styles.smallButton} onClick={() => void runCommand(selected.profileId, { type: 'continue-checkpoint', source: turn.source }, true)}>继续</Button>}
									{turn.canBranch && <Button className={styles.smallButton} onClick={() => void runCommand(selected.profileId, { type: 'create-branch', source: turn.source }, true)}>创建分支</Button>}
									{turn.canTruncate && <Button className={styles.smallButton} variant="tertiary" onClick={() => setTruncateTarget({ profileId: selected.profileId, source: turn.source, removedCount: turn.truncateRemovedCount, pinnedCount: turn.truncatePinnedCount })}>删除后续并继续</Button>}
									{turn.resultLocation && <ButtonLink className={styles.smallButton} variant={turn.kind === 'abandoned' ? 'secondary' : 'primary'} to={turn.resultLocation}>{turn.kind === 'abandoned' ? '查看记录' : '查看结局'}</ButtonLink>}
									<Button className={styles.smallButton} disabled={!selected.available} variant="secondary" onClick={() => void runCommand(selected.profileId, { type: 'set-checkpoint-pinned', source: turn.source, pinned: !turn.pinned })}>{turn.pinned ? '取消固定' : '固定'}</Button>
								</div>
								{previewState?.key === key && previewState.status === 'loading' && <StatusBanner tone="loading">正在投影检查点…</StatusBanner>}
								{previewState?.key === key && previewState.status === 'error' && <StatusBanner tone="error">无法预览：{previewState.message}</StatusBanner>}
								{previewState?.key === key && previewState.status === 'ready' && <CheckpointPreviewPanel preview={previewState.preview} />}
							</article>
						)
					})}
				</div>
			</div>
		)
	}

	return (
		<PageChrome action={<ButtonLink variant="tertiary" to={`/games/${encodeURIComponent(gameId)}`}>返回游戏菜单</ButtonLink>}>
			<p className={styles.eyebrow}>Save browser</p>
			<h1 className={styles.title}>时间线与分支。</h1>
			<p className={styles.subtitle}>浏览检查点不会改变当前恢复位置。继续、创建分支或截断后，新的恢复游标才会被原子保存。</p>
			{message && <div className={styles.statusWrap}><StatusBanner tone="error">{message}</StatusBanner></div>}
			{state.status === 'loading' && <StatusBanner tone="loading">正在读取 IndexedDB 存档…</StatusBanner>}
			{state.status === 'error' && <StatusBanner tone="error">无法读取存档：{state.message}</StatusBanner>}
			{state.status === 'ready' && state.view.invalidSaveCount > 0 && (
				<StatusBanner tone="error">有 {state.view.invalidSaveCount} 条损坏记录已被隔离，其余存档仍可使用。</StatusBanner>
			)}
			{state.status === 'ready' && state.view.profiles.length === 0 && (
				<StatusBanner tone="empty">这个游戏还没有可用存档。开始新游戏后，初始检查点会显示在这里。</StatusBanner>
			)}
			{state.status === 'ready' && state.view.profiles.length > 0 && (
				<div className={styles.savesLayout}>
					<aside className={styles.profileList} aria-label="存档列表">
						{state.view.profiles.map((profile) => (
							<button
								className={`${styles.profileCard} ${profile.profileId === selectedId ? styles.profileCardActive : ''}`}
								key={profile.profileId}
								onClick={() => selectProfile(profile.profileId)}
								type="button"
							>
								<span className={styles.profileName}>{profile.label || `存档 · ${formatDate(profile.createdAt)}`}</span>
								<span className={styles.profileMeta}>回合 {profile.currentTurnNumber} · {profile.currentRunStatus} · v{profile.configVersion}</span>
								{profile.unavailableReason && <span className={styles.profileMeta}>{profile.unavailableReason}</span>}
							</button>
						))}
					</aside>
					<section className={styles.timeline} aria-label="时间线">
						{selected && <p className={styles.metaLine}>{selected.runs.length} 条时间线 · 更新于 {formatDate(selected.updatedAt)}</p>}
						{selected && selected.runs
							.filter((run) => !run.origin || run.origin.resolved)
							.map((run) => renderRun(run, selected.runs.indexOf(run)))}
						{selected && selected.runs.some((run) => run.origin && !run.origin.resolved) && (
							<div className={styles.orphanedRuns}>
								<h2 className={styles.orphanedTitle}>来源已清理</h2>
								<p className={styles.turnMeta}>这些时间线仍有完整 initial snapshot，可以独立预览和恢复。</p>
								{selected.runs
									.filter((run) => run.origin && !run.origin.resolved)
									.map((run) => renderRun(run, selected.runs.indexOf(run)))}
							</div>
						)}
					</section>
				</div>
			)}
			<ConfirmDialog
				open={Boolean(truncateTarget)}
				title="删除后续检查点？"
				description={truncateSummary}
				confirmLabel="删除并继续"
				danger
				onClose={() => setTruncateTarget(undefined)}
				onConfirm={async () => {
					const target = truncateTarget
					if (!target) return
					const result = await runCommand(
						target.profileId,
						{ type: 'truncate-and-continue', source: target.source },
						true,
					)
					if (result.ok) setTruncateTarget(undefined)
				}}
			/>
		</PageChrome>
	)
}
