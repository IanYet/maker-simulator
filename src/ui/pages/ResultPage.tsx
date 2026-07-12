import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useAppServices } from '../../app/useAppServices'
import type { GameplayRuntimeImpl } from '../../runtime'
import { Button, ButtonLink, StatusBanner, Surface } from '../components'
import { PageChrome } from './PageChrome'
import styles from './pages.module.css'

type ResultState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; runtime: GameplayRuntimeImpl }

function formatDate(value: string): string {
	return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value))
}

export function ResultPage() {
	const { profileId = '', runId = '', turnId = '' } = useParams()
	const services = useAppServices()
	const navigate = useNavigate()
	const [state, setState] = useState<ResultState>({ status: 'loading' })
	const [busy, setBusy] = useState(false)
	const [message, setMessage] = useState<string>()

	useEffect(() => {
		let active = true
		let opened: GameplayRuntimeImpl | undefined
		services.openResult(profileId, { runId, turnId }).then(
			(runtime) => {
				opened = runtime
				if (active) setState({ status: 'ready', runtime })
				else runtime.dispose()
			},
			(error: unknown) => { if (active) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }) },
		)
		return () => { active = false; opened?.dispose() }
	}, [profileId, runId, services, turnId])

	async function restart(): Promise<void> {
		setBusy(true)
		setMessage(undefined)
		try {
			await services.restart(profileId, { runId, turnId })
			if (state.status === 'ready') state.runtime.dispose()
			navigate(`/play/${encodeURIComponent(profileId)}`)
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error))
			setBusy(false)
		}
	}

	if (state.status === 'loading') return <main className={styles.page}><StatusBanner tone="loading">正在重建只读结果…</StatusBanner></main>
	if (state.status === 'error') return <main className={styles.page}><StatusBanner tone="error">无法打开结果：{state.message}</StatusBanner></main>

	const snapshot = state.runtime.getSnapshot()
	const gameId = state.runtime.game.config.meta.id
	const abandoned = snapshot.runStatus === 'abandoned'
	const title = abandoned
		? '这条时间线已被放弃。'
		: snapshot.endingEvent?.currentNode.displayName ?? '本局已经抵达终点。'
	const content = abandoned
		? '这是一条只读的放弃记录。它不是游戏脚本定义的结局，但仍保留放弃时的状态与随机游标。'
		: snapshot.endingEvent?.currentNode.content ?? '终局由游戏脚本触发；本次调用链没有关联可展示的叙事节点。完整状态已经保存在 terminal 检查点中。'

	return (
		<PageChrome action={<ButtonLink variant="tertiary" to={`/games/${encodeURIComponent(gameId)}`}>退出到菜单</ButtonLink>}>
			<Surface tone={abandoned ? 'cream' : 'coral'} className={`${styles.resultHero} ${styles.fullBleed}`}>
				<div>
					<p className={styles.eyebrow}>{abandoned ? 'Abandoned record' : 'Run ended'} · {state.runtime.game.config.meta.name}</p>
					<h1 className={styles.resultTitle}>{title}</h1>
					<p className={styles.resultCopy}>{content}</p>
					<div className={styles.resultMeta}>
						<span className={styles.pill}>回合 {snapshot.turnNumber}</span>
						<span className={styles.pill}>{snapshot.phase}</span>
						{snapshot.endedAt && <span className={styles.pill}>{formatDate(snapshot.endedAt)}</span>}
					</div>
				</div>
				<div>
					{message && <div className={styles.statusWrap}><StatusBanner tone="error">{message}</StatusBanner></div>}
					<div className={styles.pageActions}>
						<Button disabled={busy} onClick={() => void restart()}>{busy ? '正在创建…' : '再来一局'}</Button>
						<ButtonLink variant="secondary" to={`/games/${encodeURIComponent(gameId)}/saves`}>选择存档</ButtonLink>
						<ButtonLink variant="tertiary" to={`/games/${encodeURIComponent(gameId)}`}>退出</ButtonLink>
					</div>
				</div>
			</Surface>
		</PageChrome>
	)
}
