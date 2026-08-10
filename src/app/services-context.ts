import { createContext } from 'react'
import type { AppServices } from './services'

/** React 层共享的应用服务上下文；Provider 缺失时值为 undefined。 */
export const ServicesContext = createContext<AppServices | undefined>(undefined)
