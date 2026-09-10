import type { CheckpointKind, RunStatus } from './model'
import type { CommandErrorCode } from './game'

/** 完整的时间线身份。 */
export interface RunRef {
	readonly profileId: string
	readonly runId: string
}
/** 完整的稳定检查点身份。 */
export interface CheckpointRef extends RunRef {
	readonly turnId: string
}

/** 跨局用例失败；不混入不存在的 Runtime revision。 */
export interface OperationFailure {
	readonly ok: false
	readonly errorId: string
	readonly code: CommandErrorCode | 'incompatible-save' | 'package-error'
	readonly message: string
}
/** 跨局写操作的结果；创建/恢复类用例返回新的检查点引用。 */
export type OperationResult<T = void> = { readonly ok: true; readonly value: T } | OperationFailure

/** 包信息、存档数量和可选的最近检查点。 */
export interface GameInfo {
	readonly gameId: string
	readonly version: string
	readonly name: string
	readonly background?: string
	readonly coverLocation?: string
	readonly saveCount: number
	readonly error?: string
	readonly recent?: {
		readonly source: CheckpointRef
		readonly kind: CheckpointKind
		readonly turnNumber: number
	}
}
/** 一个稳定检查点及当前允许的存档操作。 */
export interface SaveCheckpoint {
	readonly source: CheckpointRef
	readonly kind: CheckpointKind
	readonly turnNumber: number
	readonly createdAt: string
	readonly pinned: boolean
	readonly current: boolean
	readonly canContinue: boolean
	readonly canBranch: boolean
	readonly canTruncate: boolean
	readonly canViewResult: boolean
	readonly truncateRemovedCount: number
	readonly truncatePinnedCount: number
}
/** 存档时间线，来源删除后仍保留身份。 */
export interface SaveRun {
	readonly runId: string
	readonly origin?: {
		readonly kind: 'branch' | 'restart'
		readonly source: CheckpointRef
		readonly resolved: boolean
		readonly sourceTurnNumber?: number
		readonly sourceKind?: CheckpointKind
	}
	readonly checkpoints: readonly SaveCheckpoint[]
}
/** 已隔离领域容器的存档摘要。 */
export interface SaveProfile {
	readonly profileId: string
	readonly label?: string
	readonly createdAt: string
	readonly updatedAt: string
	readonly configVersion: string
	readonly currentTurnNumber: number
	readonly currentRunStatus: RunStatus
	readonly available: boolean
	readonly unavailableReason?: string
	readonly runs: readonly SaveRun[]
}
/** 存档集合，坏记录不阻止有效存档显示。 */
export interface SaveCollection {
	readonly profiles: readonly SaveProfile[]
	readonly invalidSaveCount: number
}
