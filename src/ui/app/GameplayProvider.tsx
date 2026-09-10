import { useState, type ReactNode } from 'react'
import { createGameplay } from '../../gameplay'
import { GameplayContext } from './gameplay-context'

/** 游戏路由共享 Gameplay；浏览器环境配置在 UI 启动边界解析。 */
export function GameplayProvider({ children }: { children: ReactNode }) {
	const [gameplay] = useState(() => {
		const setting = new URLSearchParams(window.location.search).get('runtimeMonitor')
		return createGameplay({
			baseUrl: new URL(import.meta.env.BASE_URL, window.location.origin).href,
			cache: import.meta.env.DEV ? 'no-cache' : 'default',
			monitor:
				setting === 'verbose'
					? 'verbose'
					: import.meta.env.DEV || setting === '1'
						? 'basic'
						: 'off',
		})
	})
	return <GameplayContext.Provider value={gameplay}>{children}</GameplayContext.Provider>
}
