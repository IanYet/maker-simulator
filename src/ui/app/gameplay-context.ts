import { createContext } from 'react'
import type { Gameplay } from '../../gameplay'

/** 游戏页面共享的 Gameplay 实例，生命周期随游戏布局。 */
export const GameplayContext = createContext<Gameplay | undefined>(undefined)
