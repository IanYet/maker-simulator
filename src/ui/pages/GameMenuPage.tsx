import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import type { LoadedGamePackage, Profile, TurnData } from '../../types'
import { useAppServices } from '../../app/useAppServices'
import { ButtonLink, StatusBanner, Surface } from '../components'
import { PageChrome } from './PageChrome'
import styles from './pages.module.css'

type MenuState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; game: LoadedGamePackage; profiles: readonly Profile[]; recent?: Profile }

function currentTurn(profile: Profile): TurnData {
	return profile.runDatas[profile.current.runId].turnDatas[profile.current.turnId]
}

export function GameMenuPage() {
	const { gameId = '' } = useParams()
	const services = useAppServices()
	const [state, setState] = useState<MenuState>({ status: 'loading' })

	useEffect(() => {
		let active = true
		Promise.all([
			services.getDefaultPackage(gameId),
			services.saves.listByConfigId(gameId),
			services.metadata.getRecentProfile(gameId),
		]).then(
			([game, profiles, recentId]) => {
				if (!active) return
				setState({
					status: 'ready',
					game,
					profiles,
					recent: profiles.find((profile) => profile.profileId === recentId) ?? profiles[0],
				})
			},
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
						<p className={styles.eyebrow}>Game menu · v{state.game.config.meta.version}</p>
						<h1 className={styles.menuTitle}>{state.game.config.meta.name}</h1>
						<p className={styles.menuCopy}>{state.game.config.meta.background}</p>
					</div>
					<div className={styles.pageActions}>
						<ButtonLink to={`/games/${encodeURIComponent(gameId)}/new`}>新游戏</ButtonLink>
						{state.recent && (() => {
							const turn = currentTurn(state.recent)
							const target = turn.kind === 'terminal' || turn.kind === 'abandoned'
								? `/result/${encodeURIComponent(state.recent.profileId)}/${encodeURIComponent(state.recent.current.runId)}/${encodeURIComponent(state.recent.current.turnId)}`
								: `/play/${encodeURIComponent(state.recent.profileId)}`
							const label = turn.kind === 'terminal' ? '查看上次结局' : turn.kind === 'abandoned' ? '查看上次记录' : '继续游戏'
							return <ButtonLink variant="secondary" to={target}>{label}</ButtonLink>
						})()}
						<ButtonLink variant="secondary" to={`/games/${encodeURIComponent(gameId)}/saves`}>查看存档</ButtonLink>
					</div>
				</Surface>
			)}
		</PageChrome>
	)
}
