import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import type { GameMenuView } from '../../app/services'
import { useAppServices } from '../../app/useAppServices'
import { ButtonLink, StatusBanner, Surface } from '../components'
import { PageChrome } from './PageChrome'
import styles from './pages.module.css'

type MenuState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; view: GameMenuView }

/** 游戏菜单页：展示版本、最近存档和新建/继续/存档入口。 */
export function GameMenuPage() {
	const { gameId = '' } = useParams()
	const services = useAppServices()
	const [state, setState] = useState<MenuState>({ status: 'loading' })

	useEffect(() => {
		let active = true
		services.getGameMenu(gameId).then(
			(view) => { if (active) setState({ status: 'ready', view }) },
			(error: unknown) => { if (active) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }) },
		)
		return () => { active = false }
	}, [gameId, services])

	return (
		<PageChrome action={<ButtonLink variant="tertiary" to="/games">返回游戏列表</ButtonLink>}>
			{state.status === 'loading' && <StatusBanner tone="loading">正在装载游戏脚本…</StatusBanner>}
			{state.status === 'error' && <StatusBanner tone="error">无法打开游戏：{state.message}</StatusBanner>}
			{state.status === 'ready' && (
				<Surface tone="lilac" className={`${styles.menuHero} ${styles.fullBleed}`}>
					<div>
						<p className={styles.eyebrow}>Game menu · v{state.view.version}</p>
						<h1 className={styles.menuTitle}>{state.view.name}</h1>
						<p className={styles.menuCopy}>{state.view.background}</p>
					</div>
					<div className={styles.pageActions}>
						<ButtonLink to={`/games/${encodeURIComponent(gameId)}/new`}>新游戏</ButtonLink>
						{state.view.recentLocation && state.view.recentLabel && (
							<ButtonLink variant="secondary" to={state.view.recentLocation}>{state.view.recentLabel}</ButtonLink>
						)}
						<ButtonLink variant="secondary" to={`/games/${encodeURIComponent(gameId)}/saves`}>查看存档</ButtonLink>
					</div>
				</Surface>
			)}
		</PageChrome>
	)
}
