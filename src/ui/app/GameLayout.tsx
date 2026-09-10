import { Suspense } from 'react'
import { Outlet } from 'react-router'
import { GameplayProvider } from './GameplayProvider'

/** 游戏路由布局；限定 Gameplay 生命周期，并承载懒加载的游戏子页面。 */
export default function GameLayout() {
	return (
		<GameplayProvider>
			<Suspense fallback={null}>
				<Outlet />
			</Suspense>
		</GameplayProvider>
	)
}
