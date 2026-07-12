import { useState, type ReactNode } from 'react'
import { AppServices } from './services'
import { ServicesContext } from './services-context'

export function AppServicesProvider({ children }: { children: ReactNode }) {
	const [services] = useState(() => new AppServices())
	return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
}
