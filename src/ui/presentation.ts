import type { AttributeView, GameSnapshot, AdvanceTurnBlocker, CheckpointRef } from '../gameplay'

/** 数值格式与枚举作者标签转成 UI 文本。 */
export function formatAttribute(attribute: AttributeView): string {
	return attribute.valueLabel ?? String(attribute.value)
}

/** 动画与紧凑预览使用的属性行，角色分组展示直接使用 characters。 */
export function attributeRows(snapshot: GameSnapshot) {
	return snapshot.characters.flatMap((character) =>
		character.attributes.map((attribute) => ({
			...attribute,
			characterId: character.characterId,
			characterDisplayName: character.displayName,
			displayValue: formatAttribute(attribute),
		})),
	)
}

/** 关联门禁中的领域身份并生成用户提示。 */
export function blockerMessage(blocker: AdvanceTurnBlocker, snapshot: GameSnapshot): string {
	const events =
		blocker.kind === 'pending-required-event' ? snapshot.events.available : snapshot.events.active
	const event = events.find((item) => item.eventId === blocker.eventId)
	return `${blocker.kind === 'pending-required-event' ? '待处理' : '进行中'}事件「${event?.displayName ?? blocker.eventId}」必须处理`
}

/** 同一检查点在异步预览与界面中的稳定身份。 */
export function checkpointKey(source: CheckpointRef): string {
	return `${source.profileId}:${source.runId}:${source.turnId}`
}
