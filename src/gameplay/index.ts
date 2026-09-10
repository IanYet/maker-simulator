/** UI 唯一使用的 Gameplay 公共入口。 */
export { createGameplay } from './gameplay'
export type { Gameplay, GameplayOptions } from './gameplay'
export type {
	Game,
	GameSnapshot,
	CommandResult,
	CommandErrorCode,
	AttributeView,
	CharacterView,
	EffectView,
	AvailableEvent,
	ActiveEventView,
	EndingEventView,
	EventNodeView,
	SingleChoiceView,
	MultipleChoiceView,
	AdvanceTurnBlocker,
} from './types/game'
export type {
	GameInfo,
	CheckpointRef,
	RunRef,
	SaveCollection,
	SaveProfile,
	SaveRun,
	SaveCheckpoint,
	OperationResult,
	OperationFailure,
} from './types/saves'
