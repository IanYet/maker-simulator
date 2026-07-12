import { useEffect, useState } from 'react'
import type { GameListItem } from '../../app/services'
import { useAppServices } from '../../app/useAppServices'
import { ButtonLink, StatusBanner, Surface, type SurfaceTone } from '../components'
import { PageChrome } from './PageChrome'
import styles from './pages.module.css'

const tones: SurfaceTone[] = ['lime', 'lilac', 'cream', 'mint', 'coral', 'pink']

type LoadState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; games: readonly GameListItem[] }

export function GamesPage() {
	const services = useAppServices()
	const [state, setState] = useState<LoadState>({ status: 'loading' })

	useEffect(() => {
		let active = true
		services.listGames().then(
			(games) => { if (active) setState({ status: 'ready', games }) },
			(error: unknown) => { if (active) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }) },
		)
		return () => { active = false }
	}, [services])

	return (
		<PageChrome>
			<p className={styles.eyebrow}>Game package viewer / MVP</p>
			<h1 className={styles.title}>选择一段可被改写的故事。</h1>
			<p className={styles.subtitle}>每个游戏都由外部脚本包驱动。开始一条时间线，在事件网络中构建状态，并从任意稳定检查点继续。</p>
			{state.status === 'loading' && <StatusBanner tone="loading">正在读取游戏目录与脚本包…</StatusBanner>}
			{state.status === 'error' && <StatusBanner tone="error">无法读取游戏目录：{state.message}</StatusBanner>}
			{state.status === 'ready' && state.games.length === 0 && <StatusBanner tone="empty">目录中还没有游戏包。</StatusBanner>}
			{state.status === 'ready' && state.games.length > 0 && (
				<section className={styles.gameGrid} aria-label="游戏列表">
					{state.games.map((game, index) => (
						<Surface className={styles.gameCard} tone={tones[index % tones.length]} key={`${game.descriptor.id}@${game.descriptor.version}`}>
							<div>
								{game.location.coverLocation && <img className={styles.cover} src={game.location.coverLocation} alt="" loading="lazy" />}
								<div className={styles.metaLine}>
									<span>v{game.descriptor.version}</span>
									<span>·</span>
									<span>{game.saveCount} 个存档</span>
									<span>·</span>
									<span>{game.error ? '加载失败' : '可游玩'}</span>
								</div>
								<h2 className={styles.cardTitle}>{game.descriptor.name}</h2>
								<p className={styles.cardText}>{game.descriptor.background || '这个游戏包没有提供简介。'}</p>
								{game.error && <StatusBanner tone="error">{game.error}</StatusBanner>}
							</div>
							<div className={styles.inlineActions}>
								{game.error
									? <span className={styles.pill}>Package unavailable</span>
									: <ButtonLink to={`/games/${encodeURIComponent(game.descriptor.id)}`}>进入游戏</ButtonLink>}
							</div>
						</Surface>
					))}
				</section>
			)}
		</PageChrome>
	)
}
