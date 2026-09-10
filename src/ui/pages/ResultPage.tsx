import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { GameSnapshot } from '../../gameplay'
import { useGameplay } from '../app/useGameplay'
import { Button, ButtonLink, StatusBanner, Surface } from '../components'
import { PageChrome } from './PageChrome'
import styles from './pages.module.css'

function resultView(snapshot: GameSnapshot) {
	const abandoned = snapshot.status === 'abandoned'
	return {
		gameId: snapshot.game.id,
		gameName: snapshot.game.name,
		abandoned,
		title: abandoned
			? '这条时间线已被放弃。'
			: (snapshot.endingEvent?.currentNode.displayName ?? '本局已经抵达终点。'),
		content: abandoned
			? '这是一条只读的放弃记录。它不是游戏脚本定义的结局，但仍保留放弃时的状态与随机游标。'
			: (snapshot.endingEvent?.currentNode.content ??
				'终局由游戏脚本触发；本次调用链没有关联可展示的叙事节点。完整状态已经保存在 terminal 检查点中。'),
		turnNumber: snapshot.turnNumber,
		phase: snapshot.phase,
		endedAt: snapshot.endedAt,
	}
}

type ResultState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; snapshot: GameSnapshot }

function formatDate(value: string): string {
	return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeStyle: 'short' }).format(
		new Date(value),
	)
}

/** 终局/放弃结果页：展示只读检查点，并提供 restart 入口。 */
export function ResultPage() {
	const { profileId = '', runId = '', turnId = '' } = useParams()
	const services = useGameplay()
	const navigate = useNavigate()
	const [state, setState] = useState<ResultState>({ status: 'loading' })
	const [busy, setBusy] = useState(false)
	const [message, setMessage] = useState<string>()

	useEffect(() => {
		let active = true
		services.getCheckpoint({ profileId, runId, turnId }).then(
			(snapshot) => {
				if (!active) return
				if (snapshot.checkpoint.kind !== 'terminal' && snapshot.checkpoint.kind !== 'abandoned')
					setState({ status: 'error', message: '此检查点尚未结束' })
				else setState({ status: 'ready', snapshot })
			},
			(error: unknown) => {
				if (active)
					setState({
						status: 'error',
						message: error instanceof Error ? error.message : String(error),
					})
			},
		)
		return () => {
			active = false
		}
	}, [profileId, runId, services, turnId])

	async function restart(): Promise<void> {
		setBusy(true)
		setMessage(undefined)
		try {
			const result = await services.restartGame({ profileId, runId, turnId })
			if (!result.ok) {
				setMessage(result.message)
				setBusy(false)
				return
			}
			navigate(`/play/${encodeURIComponent(result.value.profileId)}`)
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error))
			setBusy(false)
		}
	}

	if (state.status === 'loading')
		return (
			<main className={styles.page}>
				<StatusBanner tone="loading">正在重建只读结果…</StatusBanner>
			</main>
		)
	if (state.status === 'error')
		return (
			<main className={styles.page}>
				<StatusBanner tone="error">无法打开结果：{state.message}</StatusBanner>
			</main>
		)

	const result = resultView(state.snapshot)

	return (
		<PageChrome
			action={
				<ButtonLink variant="tertiary" to={`/games/${encodeURIComponent(result.gameId)}`}>
					退出到菜单
				</ButtonLink>
			}
		>
			<Surface
				tone={result.abandoned ? 'cream' : 'coral'}
				className={`${styles.resultHero} ${styles.fullBleed}`}
			>
				<div>
					<p className={styles.eyebrow}>
						{result.abandoned ? 'Abandoned record' : 'Run ended'} · {result.gameName}
					</p>
					<h1 className={styles.resultTitle}>{result.title}</h1>
					<p className={styles.resultCopy}>{result.content}</p>
					<div className={styles.resultMeta}>
						<span className={styles.pill}>回合 {result.turnNumber}</span>
						<span className={styles.pill}>{result.phase}</span>
						{result.endedAt && <span className={styles.pill}>{formatDate(result.endedAt)}</span>}
					</div>
				</div>
				<div>
					{message && (
						<div className={styles.statusWrap}>
							<StatusBanner tone="error">{message}</StatusBanner>
						</div>
					)}
					<div className={styles.pageActions}>
						<Button disabled={busy} onClick={() => void restart()}>
							{busy ? '正在创建…' : '再来一局'}
						</Button>
						<ButtonLink
							variant="secondary"
							to={`/games/${encodeURIComponent(result.gameId)}/saves`}
						>
							选择存档
						</ButtonLink>
						<ButtonLink variant="tertiary" to={`/games/${encodeURIComponent(result.gameId)}`}>
							退出
						</ButtonLink>
					</div>
				</div>
			</Surface>
		</PageChrome>
	)
}
