/** Runtime 内部命令标识，用于执行与监控；UI 使用 Game 具名方法。 */
export type RuntimeCommand =
	| { type: 'start-event'; eventId: string }
	| { type: 'activate-effect'; effectId: string }
	| {
			type: 'choose-single'
			eventInstanceId: string
			nodeId: string
			choiceId: string
	  }
	| {
			type: 'set-multiple-choice'
			eventInstanceId: string
			nodeId: string
			choiceId: string
			count: number
	  }
	| {
			type: 'execute-node-command'
			eventInstanceId: string
			nodeId: string
			commandId: string
	  }
	| { type: 'advance-turn' }
	| { type: 'abandon' }
