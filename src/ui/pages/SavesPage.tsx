import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { Profile, RunData, SessionCommandResult, TurnData, TurnRef } from '../../types'
import { useAppServices } from '../../app/useAppServices'
import { Button, ButtonLink, ConfirmDialog, StatusBanner } from '../components'
import { PageChrome } from './PageChrome'
import styles from './pages.module.css'

type SavesState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; profiles: readonly Profile[] }

function formatDate(value: string): string {
	return new Intl.DateTimeFormat('zh-CN', {
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(new Date(value))
}

function kindLabel(turn: TurnData): string {
	return turn.kind === 'initial'
		? '初始检查点'
		: turn.kind === 'turn_end'
			? `第 ${turn.snapshot.turnState.turnNumber} 回合结束`
			: turn.kind === 'terminal'
				? '终局'
				: '放弃记录'
}

export function SavesPage() {
	const { gameId = '' } = useParams()
	const services = useAppServices()
	const navigate = useNavigate()
	const [state, setState] = useState<SavesState>({ status: 'loading' })
	const [selectedId, setSelectedId] = useState<string>()
	const [message, setMessage] = useState<string>()
	const [truncateTarget, setTruncateTarget] = useState<{ profile: Profile; run: RunData; source: TurnRef }>()

	const load = useCallback(() => {
		let active = true
		services.saves.listByConfigId(gameId).then(
			(profiles) => {
				if (!active) return
				setState({ status: 'ready', profiles })
				setSelectedId((current) => current && profiles.some((profile) => profile.profileId === current) ? current : profiles[0]?.profileId)
			},
			(error: unknown) => { if (active) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }) },
		)
		return () => { active = false }
	}, [gameId, services])

	useEffect(() => load(), [load])

	const selected = state.status === 'ready'
		? state.profiles.find((profile) => profile.profileId === selectedId)
		: undefined

	const runCount = selected ? Object.keys(selected.runDatas).length : 0

	async function runCommand(
		profile: Profile,
		command: Parameters<ReturnType<typeof services.createSaveController>['dispatch']>[0],
		navigateAfter = false,
	): Promise<SessionCommandResult> {
		setMessage(undefined)
		const result = await services.createSaveController(profile.profileId).dispatch(command)
		if (!result.ok) {
			setMessage(result.message)
			return result
		}
		if (navigateAfter) navigate(`/play/${encodeURIComponent(profile.profileId)}`)
		else load()
		return result
	}

	const truncateSummary = useMemo(() => {
		if (!truncateTarget) return ''
		const index = truncateTarget.run.turnOrder.indexOf(truncateTarget.source.turnId)
		const removed = truncateTarget.run.turnOrder.slice(index + 1)
		const pins = removed.filter((id) => truncateTarget.run.turnDatas[id]?.pinned).length
		return `将永久删除其后的 ${removed.length} 个检查点，其中 ${pins} 个已固定。此操作不可撤销。`
	}, [truncateTarget])

	return (
		<PageChrome action={<ButtonLink variant="tertiary" to={`/games/${encodeURIComponent(gameId)}`}>返回游戏菜单</ButtonLink>}>
			<p className={styles.eyebrow}>Save browser</p>
			<h1 className={styles.title}>时间线与分支。</h1>
			<p className={styles.subtitle}>预览不会改变当前恢复位置。继续、创建分支或截断后，新的恢复游标才会被原子保存。</p>
			{message && <div className={styles.statusWrap}><StatusBanner tone="error">{message}</StatusBanner></div>}
			{state.status === 'loading' && <StatusBanner tone="loading">正在读取 IndexedDB 存档…</StatusBanner>}
			{state.status === 'error' && <StatusBanner tone="error">无法读取存档：{state.message}</StatusBanner>}
			{state.status === 'ready' && state.profiles.length === 0 && <StatusBanner tone="empty">这个游戏还没有存档。开始新游戏后，初始检查点会显示在这里。</StatusBanner>}
			{state.status === 'ready' && state.profiles.length > 0 && (
				<div className={styles.savesLayout}>
					<aside className={styles.profileList} aria-label="存档列表">
						{state.profiles.map((profile) => {
							const run = profile.runDatas[profile.current.runId]
							return (
								<button
									className={`${styles.profileCard} ${profile.profileId === selectedId ? styles.profileCardActive : ''}`}
									key={profile.profileId}
									onClick={() => setSelectedId(profile.profileId)}
									type="button"
								>
									<span className={styles.profileName}>{profile.label || `存档 · ${formatDate(profile.createdAt)}`}</span>
									<span className={styles.profileMeta}>回合 {run.turnState.turnNumber} · {run.status} · v{profile.configVersion}</span>
								</button>
							)
						})}
					</aside>
					<section className={styles.timeline} aria-label="时间线">
						{selected && <p className={styles.metaLine}>{runCount} 条时间线 · 更新于 {formatDate(selected.updatedAt)}</p>}
						{selected && Object.values(selected.runDatas)
							.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
							.map((run, runIndex) => (
								<div className={`${styles.runGroup} ${run.origin ? styles.runGroupBranch : ''}`} key={run.runId}>
									<h2 className={styles.runTitle}>
										第 {runIndex + 1} 条时间线
										{' '}<span className={styles.pill}>{run.origin?.kind === 'restart' ? '再来一局' : run.origin?.kind === 'branch' ? '分支' : '起点'}</span>
									</h2>
									{run.origin && <p className={styles.turnMeta}>来源 {run.origin.source.runId.slice(0, 18)} / {run.origin.source.turnId.slice(0, 18)}</p>}
									<div className={styles.timeline}>
										{run.turnOrder.map((turnId, turnIndex) => {
											const turn = run.turnDatas[turnId]
											const source = { runId: run.runId, turnId }
											const isCurrent = selected.current.runId === run.runId && selected.current.turnId === turnId
											const isLatest = run.currentTurnId === turnId
											const playable = turn.kind === 'initial' || turn.kind === 'turn_end'
											return (
												<article className={`${styles.turnCard} ${isCurrent ? styles.turnCurrent : ''}`} key={turnId}>
													<div className={styles.turnHeader}>
														<strong>{kindLabel(turn)}</strong>
														{isCurrent && <span className={styles.pill}>当前</span>}
													</div>
													<span className={styles.turnMeta}>#{turnIndex + 1} · {formatDate(turn.createdAt)} · {turn.pinned ? '已固定' : '自动保留'}</span>
													<div className={styles.turnActions}>
														{playable && isLatest && <Button className={styles.smallButton} onClick={() => void runCommand(selected, { type: 'continue-checkpoint', source }, true)}>继续</Button>}
														{playable && !isLatest && <Button className={styles.smallButton} onClick={() => void runCommand(selected, { type: 'create-branch', source }, true)}>创建分支</Button>}
														{playable && !isLatest && <Button className={styles.smallButton} variant="tertiary" onClick={() => setTruncateTarget({ profile: selected, run, source })}>删除后续并继续</Button>}
														{turn.kind === 'terminal' && <ButtonLink className={styles.smallButton} to={`/result/${encodeURIComponent(selected.profileId)}/${encodeURIComponent(run.runId)}/${encodeURIComponent(turnId)}`}>查看结局</ButtonLink>}
														{turn.kind === 'abandoned' && <ButtonLink className={styles.smallButton} variant="secondary" to={`/result/${encodeURIComponent(selected.profileId)}/${encodeURIComponent(run.runId)}/${encodeURIComponent(turnId)}`}>查看记录</ButtonLink>}
														<Button className={styles.smallButton} variant="secondary" onClick={() => void runCommand(selected, { type: 'set-checkpoint-pinned', source, pinned: !turn.pinned })}>{turn.pinned ? '取消固定' : '固定'}</Button>
													</div>
												</article>
											)
										})}
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
					if (target) void runCommand(target.profile, { type: 'truncate-and-continue', source: target.source }, true)
				}}
			/>
		</PageChrome>
	)
}
