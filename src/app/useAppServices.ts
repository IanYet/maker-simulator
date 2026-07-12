import { useContext } from 'react'
import { ServicesContext } from './services-context'
import type { AppServices } from './services'

/** 读取 AppServices；必须在 AppServicesProvider 子树内调用。 */
export function useAppServices(): AppServices {
	const services = useContext(ServicesContext)
	if (!services) throw new Error('AppServicesProvider is missing')
	return services
}
