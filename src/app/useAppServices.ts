import { useContext } from 'react'
import { ServicesContext } from './services-context'
import type { AppServices } from './services'

export function useAppServices(): AppServices {
	const services = useContext(ServicesContext)
	if (!services) throw new Error('AppServicesProvider is missing')
	return services
}
