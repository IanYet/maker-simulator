import type { CheckpointRef } from '../../gameplay'

/** 根据完整身份生成结果地址。 */
export function resultLocation(source: CheckpointRef): string {
	return `/result/${encodeURIComponent(source.profileId)}/${encodeURIComponent(source.runId)}/${encodeURIComponent(source.turnId)}`
}
/** 根据 Profile 身份进入游玩页。 */
export function playLocation(profileId: string): string {
	return `/play/${encodeURIComponent(profileId)}`
}
/** 游戏菜单与存档地址由 UI 定义。 */
export function gameLocation(gameId: string, page: 'menu' | 'saves' = 'menu'): string {
	return `/games/${encodeURIComponent(gameId)}${page === 'saves' ? '/saves' : ''}`
}
