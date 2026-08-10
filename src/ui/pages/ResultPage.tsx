import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { ResultView } from '../../app/services'
import { useAppServices } from '../../app/useAppServices'
import { Button, ButtonLink, StatusBanner, Surface } from '../components'
import { PageChrome } from './PageChrome'
import styles from './pages.module.css'

type ResultState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; view: ResultView }

function formatDate(value: string): string {
	return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeStyle: 'short' }).format(
		new Date(value),
	)
}

/** 终局/放弃结果页：展示只读检查点，并提供 restart 入口。 */
export function ResultPage() {
	const { profileId = '', runId = '', turnId = '' } = useParams()
	const services = useAppServices()
	const navigate = useNavigate()
	const [state, setState] = useState<ResultState>({ status: 'loading' })
	const [busy, setBusy] = useState(false)
	const [message, setMessage] = useState<string>()

	useEffect(() => {
		let active = true
		services.getResult(profileId, { runId, turnId }).then(
			(view) => {
				if (active) setState({ status: 'ready', view })
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
			await services.restart(profileId, { runId, turnId })
			navigate(`/play/${encodeURIComponent(profileId)}`)
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

	const result = state.view

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
