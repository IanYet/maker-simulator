import { createContext } from 'react'
import type { AppServices } from './services'

export const ServicesContext = createContext<AppServices | undefined>(undefined)
