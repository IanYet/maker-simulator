/** JSON primitive value supported by model data. */
export type JsonPrimitive = string | number | boolean | null

/** JSON value supported by generic condition and action payload fields. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/** Top-level model data kind. */
export type ModelDataKind = 'default' | 'save' | 'run'

/** Current runtime step used by run data. */
export type RuntimeStep =
  | 'turn_start'
  | 'combo_check'
  | 'event_appear'
  | 'event_start'
  | 'player_event'
  | 'event_node'
  | 'turn_end'
  | 'snapshot'
  | 'next_turn'

/** Effect kind used to classify non-narrative state. */
export type EffectKind =
  | 'tag'
  | 'counter'
  | 'buff'
  | 'debuff'
  | 'equipment'
  | 'building'
  | 'plant'
  | 'pet'
  | 'tech'
  | 'passive'

/** Effect duration kind. */
export type DurationType = 'instant' | 'turns' | 'permanent'

/** Timing hook used by effects and effect combos. */
export type TriggerTiming =
  | 'turn_start'
  | 'event_appear'
  | 'event_start'
  | 'event_node'
  | 'event_result'
  | 'turn_end'

/** Event start behavior after an event appears. */
export type EventStartMode = 'auto' | 'manual'

/** Presentation behavior for events and nodes. */
export type Visibility = 'foreground' | 'background'

/** Selection behavior for a choice node. */
export type ChoiceMode = 'single' | 'multiple' | 'quantity'

/** Local event state keyed by field name. */
export type EventData = Record<string, JsonValue>

/** Event node kind in the directed event graph. */
export type EventNodeType = 'text' | 'choice' | 'check' | 'action' | 'wait' | 'result'

/** Comparison operator supported by conditions. */
export type ComparisonOperator =
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'not_contains'

/** Scope that an action writes to. */
export type ActionScope = 'run' | 'save' | 'default'

/** Action mutation mode. */
export type ActionMode = 'set' | 'add' | 'multiply' | 'min' | 'max'

/** Target collection queried by selectors. */
export type SelectorTarget = 'effect' | 'event'

/** Aggregate operation over a selected collection. */
export type AggregateFunction = 'count' | 'sum' | 'min' | 'max' | 'average'

/** Arithmetic operation used by calculate value expressions. */
export type CalculateOperator = 'add' | 'subtract' | 'multiply' | 'divide' | 'min' | 'max'

/** Condition type discriminator. */
export type ConditionType =
  | 'attribute'
  | 'effect'
  | 'event'
  | 'turn'
  | 'aggregate'
  | 'and'
  | 'or'
  | 'not'

/** Action type discriminator. */
export type ActionType = 'modify_attribute' | 'modify_effect' | 'modify_event' | 'draw_pool'

/** Complete model data shape shared by default data, save data, and run data. */
export interface GameModelData {
  /** Data metadata. */
  meta: ModelMeta
  /** Current character data. */
  character: Character
  /** Effect definitions and their current state. */
  effects: Effect[]
  /** Independent effect-combination rules. */
  effectCombos: EffectCombo[]
  /** Reusable effect or event candidate pools. */
  pools: Pool[]
  /** Event definitions and their current state. */
  events: GameEvent[]
}

/** Metadata for default data, save data, or run data. */
export interface ModelMeta {
  /** Data identifier. */
  id: string
  /** Content version. */
  version: string
  /** Current turn; default data and save data usually use 0. */
  turn: number
  /** Current random seed. */
  seed: string | null
  /** Current runtime step; only run data needs this field. */
  step?: RuntimeStep
  /** Number of started runs; only save data needs this field. */
  runs?: number
  /** Optional top-level data kind. */
  kind?: ModelDataKind
}

/** Player-controlled character. */
export interface Character {
  /** Character identifier. */
  id: string
  /** Attribute table keyed by attribute id. */
  attributes: Record<string, Attribute>
}

/** Numeric character attribute. */
export interface Attribute {
  /** Current attribute value. */
  value: number
  /** Minimum attribute value. */
  min: number
  /** Maximum attribute value. */
  max: number
}

/** Non-narrative state such as tags, counters, buildings, buffs, or tech. */
export interface Effect {
  /** Effect identifier. */
  id: string
  /** Display name. */
  name: string
  /** Effect content description. */
  description: string
  /** Effect classification. */
  kind: EffectKind
  /** Whether this effect has been unlocked and can appear as a reward or candidate. */
  unlocked: boolean
  /** Whether this effect has currently appeared. */
  appeared: boolean
  /** Whether the player has currently acquired this effect. */
  acquired: boolean
  /** Effect level. */
  level: number
  /** Effect stack count. */
  stacks: number
  /** Generic numeric value for counters, progress, or strength. */
  value: number
  /** Tag list used for filtering and condition checks. */
  tags: string[]
  /** Appearance rules used when this effect is considered as a candidate, reward, or shop item. */
  appear: EffectAppear
  /** Effect duration, or null when no duration data is needed. */
  duration?: Duration | null
  /** Timing-based effect triggers. */
  triggers?: Trigger[]
}

/** Effect appearance rules. */
export type EffectAppear = EventAppear

/** Effect duration data. */
export interface Duration {
  /** Duration kind. */
  type: DurationType
  /** Remaining turns, or null for non-turn-based durations. */
  remaining: number | null
}

/** Timing-based rule attached to an effect. */
export interface Trigger {
  /** Trigger timing hook. */
  timing: TriggerTiming
  /** Conditions required before trigger actions execute. */
  conditions: Condition[]
  /** Actions executed when the trigger fires. */
  actions: Action[]
}

/** Independent rule that reacts to combinations of effects. */
export interface EffectCombo {
  /** Effect-combination rule identifier. */
  id: string
  /** Display name. */
  name: string
  /** Whether this effect combination has currently appeared. */
  appeared: boolean
  /** Conditions required for the combination to apply. */
  conditions: Condition[]
  /** Timing hook used to check this combination. */
  timing: TriggerTiming
  /** Actions executed when combination conditions are met. */
  actions: Action[]
}

/** Pure candidate filtering and random draw rule for effects or events. */
export interface Pool {
  /** Pool identifier. */
  id: string
  /** Selector that defines the candidate collection. */
  selector: Selector
  /** Default number of candidates to draw. */
  count: ValueExpression
  /** Whether candidates may appear only once in the same draw. */
  unique: boolean
  /** Candidate weight evaluated in the candidate context; defaults to 1. */
  weight?: ValueExpression
}

/** Narrative event represented as a directed graph of nodes. */
export interface GameEvent {
  /** Event identifier. */
  id: string
  /** Display name. */
  name: string
  /** Whether this event has been unlocked. */
  unlocked: boolean
  /** Whether this event has appeared and entered the current event flow. */
  appeared: boolean
  /** Whether this event is shown in the foreground or runs in the background. */
  visibility: Visibility
  /** Event start behavior after appearing. */
  startMode: EventStartMode
  /** Whether the event can happen repeatedly. */
  repeatable: boolean
  /** Number of times this event has occurred. */
  occurrences: number
  /** Whether this event is completed. */
  completed: boolean
  /** Latest or final event result. */
  result: string | null
  /** Node id used when the event starts. */
  entryNode: string
  /** Current node id, or null when the event is not active. */
  currentNode: string | null
  /** Remaining turns before the event times out. */
  remainingTurns: number
  /** Conditions that automatically end this event. */
  endConditions: Condition[]
  /** Node id entered when the event times out. */
  timeoutNode: string | null
  /** Local event state such as shop inventory, discounts, and temporary event variables. */
  data: EventData
  /** Event appearance rules. */
  appear: EventAppear
  /** Directed graph node list. */
  nodes: EventNode[]
}

/** Event appearance rules. */
export interface EventAppear {
  /** Conditions required before chance is evaluated. */
  conditions: Condition[]
  /** Appearance probability from 0 to 1. */
  chance: number
}

/** Directed event graph node. */
export type EventNode = TextNode | ChoiceNode | CheckNode | ActionNode | WaitNode | ResultNode

/** Common fields shared by all event nodes. */
export interface BaseNode {
  /** Node identifier. */
  id: string
  /** Node kind. */
  type: EventNodeType
  /** Whether this node is shown in the foreground or runs in the background. */
  visibility: Visibility
  /** Display text for the node. */
  text?: string
  /** Conditions required before this node can be processed. */
  conditions?: Condition[]
  /** Actions executed by this node. */
  actions?: Action[]
  /** Next node id, or null when there is no automatic next node. */
  next?: string | null
}

/** Narrative text node. */
export interface TextNode extends BaseNode {
  /** Node kind discriminator. */
  type: 'text'
  /** Narrative text shown by this node. */
  text: string
  /** Next node id after the text is processed. */
  next: string
}

/** Player choice node. */
export interface ChoiceNode extends BaseNode {
  /** Node kind discriminator. */
  type: 'choice'
  /** Choice selection mode. */
  mode: ChoiceMode
  /** Minimum number of choices required before submission. */
  minSelections?: number
  /** Maximum number of choices allowed before submission. */
  maxSelections?: number
  /** Choice list shown to the player. */
  choices: Choice[]
  /** Node id entered after submitting multiple or quantity choices. */
  next?: string | null
}

/** Probability check node. */
export interface CheckNode extends BaseNode {
  /** Node kind discriminator. */
  type: 'check'
  /** Conditions required before chance is evaluated. */
  conditions: Condition[]
  /** Success probability from 0 to 1. */
  chance: number
  /** Node id entered on success. */
  success: string
  /** Node id entered on failure. */
  failure: string
}

/** Action-only node. */
export interface ActionNode extends BaseNode {
  /** Node kind discriminator. */
  type: 'action'
  /** Actions executed by this node. */
  actions: Action[]
  /** Next node id after actions execute. */
  next: string
}

/** Cross-turn wait node. */
export interface WaitNode extends BaseNode {
  /** Node kind discriminator. */
  type: 'wait'
  /** Remaining wait turns. */
  remainingTurns: number
  /** Conditions that end waiting early. */
  endConditions: Condition[]
  /** Node id entered when waiting times out. */
  timeoutNode: string
  /** Node id entered when waiting completes normally. */
  next: string
}

/** Event result node. */
export interface ResultNode extends BaseNode {
  /** Node kind discriminator. */
  type: 'result'
  /** Result value written to the event. */
  result: string
  /** Actions executed by this result. */
  actions: Action[]
  /** Whether this result completes the event. */
  completeEvent: boolean
}

/** Player-selectable option inside a choice node. */
export interface Choice {
  /** Choice identifier. */
  id: string
  /** Choice display text. */
  text: string
  /** Conditions required for this choice to be available. */
  conditions?: Condition[]
  /** Quantity configuration used when the containing node has quantity mode. */
  quantity?: ChoiceQuantity | null
  /** Actions executed immediately after selecting this choice. */
  actions?: Action[]
  /** Node id entered after selecting this choice. */
  next?: string | null
}

/** Quantity controls for a selectable choice. */
export interface ChoiceQuantity {
  /** Minimum selectable quantity. */
  min: ValueExpression
  /** Maximum selectable quantity. */
  max: ValueExpression
  /** Quantity step. */
  step?: ValueExpression
  /** Default quantity shown before player input. */
  defaultValue?: ValueExpression
}

/** Any supported condition. */
export type Condition =
  | AttributeCondition
  | EffectCondition
  | EventCondition
  | TurnCondition
  | AggregateCondition
  | AndCondition
  | OrCondition
  | NotCondition

/** Collection selector used by aggregate conditions and aggregate value expressions. */
export interface Selector {
  /** Target collection to query. */
  target: SelectorTarget
  /** Optional id allow-list. */
  ids?: string[]
  /** Required effect tags; only applies when target is effect. */
  tags?: string[]
  /** Required effect kinds; only applies when target is effect. */
  kinds?: EffectKind[]
  /** Field-level selector rules. */
  fields?: FieldMatcher[]
}

/** Field comparison rule inside a selector. */
export interface FieldMatcher {
  /** Field path to read from the selected object. */
  field: string
  /** Comparison operator. */
  operator: ComparisonOperator
  /** Value to compare against. */
  value: ValueExpression
}

/** Character attribute condition. */
export interface AttributeCondition {
  /** Condition kind discriminator. */
  type: 'attribute'
  /** Attribute id to read. */
  attribute: string
  /** Comparison operator. */
  operator: ComparisonOperator
  /** Value to compare against. */
  value: ValueExpression
}

/** Effect field condition. */
export interface EffectCondition {
  /** Condition kind discriminator. */
  type: 'effect'
  /** Effect id to read. */
  effectId: string
  /** Effect field path to read. */
  field: string
  /** Comparison operator. */
  operator: ComparisonOperator
  /** Value to compare against. */
  value: ValueExpression
}

/** Event field condition. */
export interface EventCondition {
  /** Condition kind discriminator. */
  type: 'event'
  /** Event id to read. */
  eventId: string
  /** Event field path to read. */
  field: string
  /** Comparison operator. */
  operator: ComparisonOperator
  /** Value to compare against. */
  value: ValueExpression
}

/** Current turn condition. */
export interface TurnCondition {
  /** Condition kind discriminator. */
  type: 'turn'
  /** Comparison operator. */
  operator: ComparisonOperator
  /** Turn value to compare against. */
  value: ValueExpression
}

/** Aggregate condition over a selected effect or event collection. */
export interface AggregateCondition {
  /** Condition kind discriminator. */
  type: 'aggregate'
  /** Selector that chooses effects or events. */
  selector: Selector
  /** Aggregate operation to evaluate. */
  aggregate: AggregateFunction
  /** Field path used by non-count aggregates. */
  field?: string
  /** Comparison operator. */
  operator: ComparisonOperator
  /** Value to compare the aggregate result against. */
  value: ValueExpression
}

/** Logical AND condition. */
export interface AndCondition {
  /** Condition kind discriminator. */
  type: 'and'
  /** Child conditions; all must pass. */
  conditions: Condition[]
}

/** Logical OR condition. */
export interface OrCondition {
  /** Condition kind discriminator. */
  type: 'or'
  /** Child conditions; at least one must pass. */
  conditions: Condition[]
}

/** Logical NOT condition. */
export interface NotCondition {
  /** Condition kind discriminator. */
  type: 'not'
  /** Child conditions to invert. */
  conditions: Condition[]
}

/** Any supported action. */
export type Action =
  | ModifyAttributeAction
  | ModifyEffectAction
  | ModifyEventAction
  | DrawPoolAction

/** Common action fields. */
export interface BaseAction {
  /** Data scope modified by this action. */
  scope?: ActionScope
  /** Action kind. */
  type: ActionType
}

/** Character attribute modification action. */
export interface ModifyAttributeAction extends BaseAction {
  /** Action kind discriminator. */
  type: 'modify_attribute'
  /** Attribute id to modify. */
  attribute: string
  /** Modification mode. */
  mode: ActionMode
  /** Value used by the modification mode. */
  value: ValueExpression
}

/** Effect field modification action. */
export interface ModifyEffectAction extends BaseAction {
  /** Action kind discriminator. */
  type: 'modify_effect'
  /** Effect id to modify. */
  effectId: string
  /** Effect field path to modify. */
  field: string
  /** Modification mode. */
  mode: ActionMode
  /** Value used by the modification mode. */
  value: ValueExpression
}

/** Event field modification action. */
export interface ModifyEventAction extends BaseAction {
  /** Action kind discriminator. */
  type: 'modify_event'
  /** Event id to modify. */
  eventId: string
  /** Event field path to modify. */
  field: string
  /** Modification mode. */
  mode: ActionMode
  /** Value used by the modification mode. */
  value: ValueExpression
}

/** Action that draws a pool and handles drawn or empty results. */
export interface DrawPoolAction {
  /** Action kind discriminator. */
  type: 'draw_pool'
  /** Candidate pool identifier. */
  poolId: string
  /** Draw count override; defaults to the pool count. */
  count?: ValueExpression
  /** Actions executed once per candidate with `$drewId` bound to its id. */
  onDraw: Action[]
  /** Actions executed once when the draw returns no candidates. */
  onEmpty?: Action[]
}

/** Static JSON value or runtime expression used by conditions and actions. */
export type ValueExpression =
  | JsonValue
  | FieldValueExpression
  | CalculateValueExpression
  | RandomValueExpression
  | AggregateValueExpression

/** Value expression that reads model data or a temporary choice or pool candidate context. */
export interface FieldValueExpression {
  /** Expression kind discriminator. */
  type: 'field'
  /** Data scope to read; defaults to run data. */
  scope?: ActionScope
  /** Field path to read. */
  path: string
}

/** Value expression that calculates a value from child values. */
export interface CalculateValueExpression {
  /** Expression kind discriminator. */
  type: 'calculate'
  /** Arithmetic operation to apply. */
  operator: CalculateOperator
  /** Input values. */
  values: ValueExpression[]
}

/** Value expression that produces a random number. */
export interface RandomValueExpression {
  /** Expression kind discriminator. */
  type: 'random'
  /** Minimum random value. */
  min: number
  /** Maximum random value. */
  max: number
  /** Whether the result should be an integer. */
  integer?: boolean
}

/** Value expression that returns an aggregate over selected effects or events. */
export interface AggregateValueExpression {
  /** Expression kind discriminator. */
  type: 'aggregate_value'
  /** Selector that chooses effects or events. */
  selector: Selector
  /** Aggregate operation to evaluate. */
  aggregate: AggregateFunction
  /** Field path used by non-count aggregates. */
  field?: string
}

/** Per-turn run snapshot container. */
export interface RunSnapshotStore {
  /** Player save identifier. */
  saveId: string
  /** Current run data. */
  currentRun: GameModelData
  /** End-of-turn snapshots. */
  turnSnapshots: TurnSnapshot[]
}

/** Complete run data captured at the end of a turn. */
export interface TurnSnapshot {
  /** Snapshot turn number. */
  turn: number
  /** Full run data at the end of the turn. */
  data: GameModelData
}
