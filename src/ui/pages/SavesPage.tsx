import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { SaveBrowserView, SaveCheckpointView } from '../../app/services'
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

/** 存档浏览页：只消费应用 read model，并通过应用命令操作稳定检查点。 */
export function SavesPage() {
	const { gameId = '' } = useParams()
	const services = useAppServices()
	const navigate = useNavigate()
	const [state, setState] = useState<SavesState>({ status: 'loading' })
	const [selectedId, setSelectedId] = useState<string>()
	const [message, setMessage] = useState<string>()
	const [truncateTarget, setTruncateTarget] = useState<TruncateTarget>()

	const load = useCallback(() => {
		let active = true
		services.getSaveBrowser(gameId).then(
			(view) => {
				if (!active) return
				setState({ status: 'ready', view })
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
								onClick={() => setSelectedId(profile.profileId)}
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
						{selected && selected.runs.map((run, runIndex) => (
							<div className={`${styles.runGroup} ${run.originKind ? styles.runGroupBranch : ''}`} key={run.runId}>
								<h2 className={styles.runTitle}>
									第 {runIndex + 1} 条时间线{' '}
									<span className={styles.pill}>{run.originKind === 'restart' ? '再来一局' : run.originKind === 'branch' ? '分支' : '起点'}</span>
								</h2>
								{run.originSummary && <p className={styles.turnMeta}>来源 {run.originSummary}</p>}
								<div className={styles.timeline}>
									{run.checkpoints.map((turn, turnIndex) => (
										<article className={`${styles.turnCard} ${turn.current ? styles.turnCurrent : ''}`} key={turn.source.turnId}>
											<div className={styles.turnHeader}>
												<strong>{kindLabel(turn)}</strong>
												{turn.current && <span className={styles.pill}>当前</span>}
											</div>
											<span className={styles.turnMeta}>#{turnIndex + 1} · {formatDate(turn.createdAt)} · {turn.pinned ? '已固定' : '自动保留'}</span>
											<div className={styles.turnActions}>
												{turn.canContinue && <Button className={styles.smallButton} onClick={() => void runCommand(selected.profileId, { type: 'continue-checkpoint', source: turn.source }, true)}>继续</Button>}
												{turn.canBranch && <Button className={styles.smallButton} onClick={() => void runCommand(selected.profileId, { type: 'create-branch', source: turn.source }, true)}>创建分支</Button>}
												{turn.canTruncate && <Button className={styles.smallButton} variant="tertiary" onClick={() => setTruncateTarget({ profileId: selected.profileId, source: turn.source, removedCount: turn.truncateRemovedCount, pinnedCount: turn.truncatePinnedCount })}>删除后续并继续</Button>}
												{turn.resultLocation && <ButtonLink className={styles.smallButton} variant={turn.kind === 'abandoned' ? 'secondary' : 'primary'} to={turn.resultLocation}>{turn.kind === 'abandoned' ? '查看记录' : '查看结局'}</ButtonLink>}
												<Button className={styles.smallButton} variant="secondary" onClick={() => void runCommand(selected.profileId, { type: 'set-checkpoint-pinned', source: turn.source, pinned: !turn.pinned })}>{turn.pinned ? '取消固定' : '固定'}</Button>
											</div>
										</article>
									))}
								</div>
							</div>
						))}
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
				onConfirm={() => {
					const target = truncateTarget
					setTruncateTarget(undefined)
					if (target) void runCommand(target.profileId, { type: 'truncate-and-continue', source: target.source }, true)
				}}
			/>
		</PageChrome>
	)
}
