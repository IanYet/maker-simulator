import { useParams } from 'react-router'
import type { SaveCheckpoint, SaveRun, GameSnapshot, CheckpointRef } from '../../gameplay'
import { useSaves } from '../hooks/useSaves'
import { checkpointKey, attributeRows } from '../presentation'
import { resultLocation } from '../app/routes'
import { Button, ButtonLink, ConfirmDialog, StatusBanner } from '../components'
import { PageChrome } from './PageChrome'
import styles from './pages.module.css'

function formatDate(value: string): string {
	return new Intl.DateTimeFormat('zh-CN', {
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(new Date(value))
}

function kindLabel(turn: SaveCheckpoint): string {
	return turn.kind === 'initial'
		? '初始检查点'
		: turn.kind === 'turn_end'
			? `第 ${turn.turnNumber} 回合结束`
			: turn.kind === 'terminal'
				? '终局'
				: '放弃记录'
}

function checkpointDomId(source: CheckpointRef): string {
	return `checkpoint-${encodeURIComponent(source.profileId)}-${encodeURIComponent(source.runId)}-${encodeURIComponent(source.turnId)}`
}

function checkpointPreviewDomId(source: CheckpointRef): string {
	return `${checkpointDomId(source)}-preview`
}

function CheckpointPreviewPanel({ snapshot }: { snapshot: GameSnapshot }) {
	const preview = {
		...snapshot,
		runStatus: snapshot.status,
		attributes: attributeRows(snapshot),
		pendingEvents: snapshot.events.available,
		activeEvents: snapshot.events.active.map((event) => ({
			...event,
			nodeDisplayName: event.currentNode.displayName,
		})),
		ending: snapshot.endingEvent
			? {
					displayName: snapshot.endingEvent.displayName,
					nodeDisplayName: snapshot.endingEvent.currentNode.displayName,
					content: snapshot.endingEvent.currentNode.content,
				}
			: undefined,
	}
	return (
		<div className={styles.checkpointPreview}>
			<p className={styles.previewHeading}>
				只读预览 · 回合 {preview.turnNumber} · {preview.phase} · {preview.runStatus}
			</p>
			<div className={styles.previewGrid}>
				<section>
					<h3>属性</h3>
					{preview.attributes.length === 0 ? (
						<p className={styles.previewEmpty}>无可展示属性</p>
					) : (
						preview.attributes.map((attribute) => (
							<p
								className={styles.previewItem}
								key={`${attribute.characterId}:${attribute.attributeId}`}
							>
								<span>
									{attribute.characterDisplayName} · {attribute.displayName}
								</span>
								<strong>{attribute.displayValue}</strong>
							</p>
						))
					)}
				</section>
				<section>
					<h3>效果</h3>
					{preview.effects.length === 0 ? (
						<p className={styles.previewEmpty}>无已获得效果</p>
					) : (
						preview.effects.map((effect) => (
							<p className={styles.previewItem} key={effect.effectId}>
								<span>{effect.displayName}</span>
								<strong>{effect.actived ? '已激活' : '未激活'}</strong>
							</p>
						))
					)}
				</section>
				<section>
					<h3>事件</h3>
					{preview.pendingEvents.map((event) => (
						<p className={styles.previewItem} key={`pending:${event.eventId}`}>
							<span>{event.displayName}</span>
							<strong>待处理</strong>
						</p>
					))}
					{preview.activeEvents.map((event) => (
						<p className={styles.previewItem} key={event.eventInstanceId}>
							<span>{event.displayName}</span>
							<strong>{event.nodeDisplayName}</strong>
						</p>
					))}
					{preview.pendingEvents.length === 0 && preview.activeEvents.length === 0 && (
						<p className={styles.previewEmpty}>无待处理或进行中事件</p>
					)}
				</section>
				<section>
					<h3>终局</h3>
					{preview.ending ? (
						<>
							<p className={styles.previewItem}>
								<span>{preview.ending.displayName}</span>
								<strong>{preview.ending.nodeDisplayName}</strong>
							</p>
							<p className={styles.previewCopy}>{preview.ending.content}</p>
						</>
					) : (
						<p className={styles.previewEmpty}>此检查点没有关联终局节点</p>
					)}
				</section>
			</div>
		</div>
	)
}

/** 存档浏览页：只消费应用 read model，并通过应用命令操作稳定检查点。 */
export function SavesPage() {
	const { gameId = '' } = useParams()
	const {
		state,
		selected,
		selectedId,
		message,
		busy,
		services,
		runCommand,
		truncateTarget,
		setTruncateTarget,
		truncateSummary,
		deleteTarget,
		setDeleteTarget,
		deleteDialog,
		previewState,
		expandedPreviewKey,
		selectProfile,
		toggleCheckpointPreview,
	} = useSaves(gameId)

	function renderRun(run: SaveRun, runIndex: number) {
		if (!selected) return null
		const missingOrigin = Boolean(run.origin && !run.origin.resolved)
		const pinnedCount = run.checkpoints.filter((checkpoint) => checkpoint.pinned).length
		return (
			<div
				className={`${styles.runGroup} ${run.origin ? styles.runGroupBranch : ''} ${run.origin?.kind === 'restart' ? styles.runGroupRestart : ''}`}
				key={run.runId}
			>
				<div className={styles.runHeader}>
					<h2 className={styles.runTitle}>
						第 {runIndex + 1} 条时间线{' '}
						<span className={styles.pill}>
							{run.origin?.kind === 'restart'
								? '再来一局'
								: run.origin?.kind === 'branch'
									? '分支'
									: '起点'}
						</span>
					</h2>
					<Button
						disabled={busy}
						className={styles.smallButton}
						variant="danger"
						onClick={() =>
							setDeleteTarget({
								kind: 'run',
								profileId: selected.profileId,
								runId: run.runId,
								checkpointCount: run.checkpoints.length,
								pinnedCount,
							})
						}
					>
						删除时间线
					</Button>
				</div>
				{run.origin?.resolved && (
					<a className={styles.originLink} href={`#${checkpointDomId(run.origin.source)}`}>
						来源：第 {run.origin.sourceTurnNumber} 回合的 {run.origin.sourceKind}
					</a>
				)}
				{missingOrigin && run.origin && (
					<p className={styles.originMissing}>
						来源检查点已清理 · {run.origin.source.runId.slice(0, 12)} /{' '}
						{run.origin.source.turnId.slice(0, 12)}
					</p>
				)}
				<div className={styles.timeline}>
					{run.checkpoints.map((turn, turnIndex) => {
						const key = checkpointKey(turn.source)
						const preview = previewState?.key === key ? previewState : undefined
						const previewExpanded = expandedPreviewKey === key
						const previewId = checkpointPreviewDomId(turn.source)
						return (
							<article
								className={`${styles.turnCard} ${turn.current ? styles.turnCurrent : ''}`}
								id={checkpointDomId(turn.source)}
								key={turn.source.turnId}
							>
								<div className={styles.turnHeader}>
									<strong>{kindLabel(turn)}</strong>
									{turn.current && <span className={styles.pill}>当前</span>}
								</div>
								<span className={styles.turnMeta}>
									#{turnIndex + 1} · {formatDate(turn.createdAt)} ·{' '}
									{turn.pinned ? '已固定' : '自动保留'}
								</span>
								<div className={styles.turnActions}>
									<Button
										aria-controls={previewId}
										aria-expanded={previewExpanded}
										className={styles.smallButton}
										disabled={busy || !selected.available}
										variant="secondary"
										onClick={() => toggleCheckpointPreview(turn.source)}
									>
										{previewExpanded ? '收起预览' : '预览'}
									</Button>
									{turn.canContinue && (
										<Button
											disabled={busy}
											className={styles.smallButton}
											onClick={() =>
												void runCommand(() => services.continueGame(turn.source), true)
											}
										>
											继续
										</Button>
									)}
									{turn.canBranch && (
										<Button
											disabled={busy}
											className={styles.smallButton}
											onClick={() => void runCommand(() => services.branchGame(turn.source), true)}
										>
											创建分支
										</Button>
									)}
									{turn.canTruncate && (
										<Button
											disabled={busy}
											className={styles.smallButton}
											variant="tertiary"
											onClick={() =>
												setTruncateTarget({
													profileId: selected.profileId,
													source: turn.source,
													removedCount: turn.truncateRemovedCount,
													pinnedCount: turn.truncatePinnedCount,
												})
											}
										>
											删除后续并继续
										</Button>
									)}
									{turn.canViewResult && (
										<ButtonLink
											className={styles.smallButton}
											variant={turn.kind === 'abandoned' ? 'secondary' : 'primary'}
											to={resultLocation(turn.source)}
										>
											{turn.kind === 'abandoned' ? '查看记录' : '查看结局'}
										</ButtonLink>
									)}
									<Button
										className={styles.smallButton}
										disabled={busy || !selected.available}
										variant="secondary"
										onClick={() =>
											void runCommand(() => services.setPinned(turn.source, !turn.pinned))
										}
									>
										{turn.pinned ? '取消固定' : '固定'}
									</Button>
									<Button
										disabled={busy}
										className={styles.smallButton}
										variant="danger"
										onClick={() =>
											setDeleteTarget({
												kind: 'checkpoint',
												profileId: selected.profileId,
												source: turn.source,
												label: kindLabel(turn),
												pinned: turn.pinned,
											})
										}
									>
										删除检查点
									</Button>
								</div>
								<div
									aria-busy={preview?.status === 'loading'}
									aria-hidden={!previewExpanded}
									aria-label="检查点预览"
									className={`${styles.previewRegion} ${previewExpanded ? styles.previewRegionOpen : ''}`}
									id={previewId}
									role="region"
								>
									<div className={styles.previewRegionInner}>
										{preview && (
											<div className={styles.previewRegionContent}>
												{preview.status === 'loading' && (
													<StatusBanner tone="loading">正在投影检查点…</StatusBanner>
												)}
												{preview.status === 'error' && (
													<StatusBanner tone="error">无法预览：{preview.message}</StatusBanner>
												)}
												{preview.status === 'ready' && (
													<CheckpointPreviewPanel snapshot={preview.preview} />
												)}
											</div>
										)}
									</div>
								</div>
							</article>
						)
					})}
				</div>
			</div>
		)
	}

	return (
		<PageChrome
			action={
				<ButtonLink variant="tertiary" to={`/games/${encodeURIComponent(gameId)}`}>
					返回游戏菜单
				</ButtonLink>
			}
		>
			<p className={styles.eyebrow}>Save browser</p>
			<h1 className={styles.title}>时间线与分支。</h1>
			<p className={styles.subtitle}>
				浏览检查点不会改变当前恢复位置。继续、创建分支、截断或手动删除后，新的恢复游标才会被原子保存。
			</p>
			{message && (
				<div className={styles.statusWrap}>
					<StatusBanner tone="error">{message}</StatusBanner>
				</div>
			)}
			{state.status === 'loading' && (
				<StatusBanner tone="loading">正在读取 IndexedDB 存档…</StatusBanner>
			)}
			{state.status === 'error' && (
				<StatusBanner tone="error">无法读取存档：{state.message}</StatusBanner>
			)}
			{state.status === 'ready' && state.view.invalidSaveCount > 0 && (
				<StatusBanner tone="error">
					有 {state.view.invalidSaveCount} 条损坏记录已被隔离，其余存档仍可使用。
				</StatusBanner>
			)}
			{state.status === 'ready' && state.view.profiles.length === 0 && (
				<StatusBanner tone="empty">
					这个游戏还没有可用存档。开始新游戏后，初始检查点会显示在这里。
				</StatusBanner>
			)}
			{state.status === 'ready' && state.view.profiles.length > 0 && (
				<div className={styles.savesLayout}>
					<aside className={styles.profileList} aria-label="存档列表">
						{state.view.profiles.map((profile) => (
							<button
								className={`${styles.profileCard} ${profile.profileId === selectedId ? styles.profileCardActive : ''}`}
								key={profile.profileId}
								disabled={busy}
								onClick={() => selectProfile(profile.profileId)}
								type="button"
							>
								<span className={styles.profileName}>
									{profile.label || `存档 · ${formatDate(profile.createdAt)}`}
								</span>
								<span className={styles.profileMeta}>
									回合 {profile.currentTurnNumber} · {profile.currentRunStatus} · v
									{profile.configVersion}
								</span>
								{profile.unavailableReason && (
									<span className={styles.profileMeta}>{profile.unavailableReason}</span>
								)}
							</button>
						))}
					</aside>
					<section
						className={`${styles.timeline} ${styles.timelineView}`}
						aria-label="时间线"
						key={selected?.profileId ?? 'empty'}
					>
						{selected && (
							<div className={styles.profileToolbar}>
								<p className={styles.metaLine}>
									{selected.runs.length} 条时间线 · 更新于 {formatDate(selected.updatedAt)}
								</p>
								<Button
									disabled={busy}
									className={styles.smallButton}
									variant="danger"
									onClick={() => {
										const checkpoints = selected.runs.flatMap((run) => run.checkpoints)
										setDeleteTarget({
											kind: 'profile',
											profileId: selected.profileId,
											label: selected.label || `存档 · ${formatDate(selected.createdAt)}`,
											runCount: selected.runs.length,
											checkpointCount: checkpoints.length,
											pinnedCount: checkpoints.filter((checkpoint) => checkpoint.pinned).length,
										})
									}}
								>
									删除存档
								</Button>
							</div>
						)}
						{selected &&
							selected.runs
								.filter((run) => !run.origin || run.origin.resolved)
								.map((run) => renderRun(run, selected.runs.indexOf(run)))}
						{selected && selected.runs.some((run) => run.origin && !run.origin.resolved) && (
							<div className={styles.orphanedRuns}>
								<h2 className={styles.orphanedTitle}>来源已清理</h2>
								<p className={styles.turnMeta}>
									这些时间线仍有完整 initial snapshot，可以独立预览和恢复。
								</p>
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
					const result = await runCommand(() => services.truncateGame(target.source), true)
					if (result?.ok) setTruncateTarget(undefined)
				}}
			/>
			<ConfirmDialog
				open={Boolean(deleteTarget)}
				title={deleteDialog.title}
				description={deleteDialog.description}
				confirmLabel={deleteDialog.confirmLabel}
				danger
				onClose={() => setDeleteTarget(undefined)}
				onConfirm={async () => {
					const target = deleteTarget
					if (!target) return
					const result = await runCommand(() =>
						target.kind === 'checkpoint'
							? services.deleteCheckpoint(target.source)
							: target.kind === 'run'
								? services.deleteRun({ profileId: target.profileId, runId: target.runId })
								: services.deleteProfile(target.profileId),
					)
					if (result?.ok) setDeleteTarget(undefined)
				}}
			/>
		</PageChrome>
	)
}
