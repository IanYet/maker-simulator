import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useAppServices } from '../../app/useAppServices'
import { ButtonLink, StatusBanner } from '../components'
import { PageChrome } from './PageChrome'
import styles from './pages.module.css'

/** 新游戏页：只负责触发稳定存档创建，成功后跳转到游玩页。 */
export function NewGamePage() {
	const { gameId = '' } = useParams()
	const services = useAppServices()
	const navigate = useNavigate()
	const started = useRef(false)
	const [error, setError] = useState<string>()

	useEffect(() => {
		if (started.current) return
		started.current = true
		services.createNewGame(gameId).then(
			(profile) => navigate(`/play/${encodeURIComponent(profile.profileId)}`, { replace: true }),
			(reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
		)
	}, [gameId, navigate, services])

	return (
		<PageChrome>
			<p className={styles.eyebrow}>Creating profile</p>
			<h1 className={styles.title}>正在建立新的时间线。</h1>
			{error ? (
				<div className={styles.statusWrap}>
					<StatusBanner tone="error">创建失败：{error}</StatusBanner>
					<div className={styles.pageActions}>
						<ButtonLink variant="secondary" to={`/games/${encodeURIComponent(gameId)}`}>
							返回
						</ButtonLink>
					</div>
				</div>
			) : (
				<StatusBanner tone="loading">正在校验脚本、创建初始检查点并保存…</StatusBanner>
			)}
		</PageChrome>
	)
}
