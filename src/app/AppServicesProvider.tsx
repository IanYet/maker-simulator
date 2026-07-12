import { useState, type ReactNode } from 'react'
import { AppServices } from './services'
import { ServicesContext } from './services-context'

/** 为所有页面提供单例 AppServices，避免每次渲染重复创建数据库和包加载器。 */
export function AppServicesProvider({ children }: { children: ReactNode }) {
	const [services] = useState(() => new AppServices())
	return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
}
