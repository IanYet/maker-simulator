import { Suspense } from 'react'
import { Outlet } from 'react-router'
import { AppServicesProvider } from './AppServicesProvider'

/** 游戏路由布局；限定 AppServices 生命周期，并承载懒加载的游戏子页面。 */
export default function GameLayout() {
	return (
		<AppServicesProvider>
			<Suspense fallback={null}>
				<Outlet />
			</Suspense>
		</AppServicesProvider>
	)
}
