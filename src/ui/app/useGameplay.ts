import { useContext } from 'react'
import { GameplayContext } from './gameplay-context'

/** 读取当前游戏布局提供的公共 Gameplay 能力。 */
export function useGameplay() {
	const gameplay = useContext(GameplayContext)
	if (!gameplay) throw new Error('GameplayProvider is missing')
	return gameplay
}
