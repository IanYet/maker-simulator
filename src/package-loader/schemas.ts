import { z } from 'zod'
import type {
	GameCatalog,
	GameConfig,
	GamePackageManifest,
	Profile,
} from '../types'

export const idSchema = z
	.string()
	.min(1)
	.regex(/^[A-Za-z0-9._-]+$/)
	.refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value), {
		message: 'Reserved identifier',
	})

const primitiveSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()])
const ruleSchema = z.strictObject({ key: idSchema, args: z.array(primitiveSchema) })
const actionSchema = z.strictObject({ key: idSchema, args: z.array(primitiveSchema) })

const reactive = <T extends z.ZodType>(value: T) =>
	z.union([value, z.strictObject({ value, rule: ruleSchema })])

const valueRefSchema = z.strictObject({
	source: z.enum(['self', 'profileState', 'runState', 'turnState']),
	path: z.tuple([z.string().min(1)], z.string().min(1)),
})

const reactionSchema = z.strictObject({
	watch: z.union([valueRefSchema, ruleSchema]),
	from: primitiveSchema.optional(),
	to: primitiveSchema.optional(),
	action: actionSchema,
})

const commonShape = {
	id: idSchema,
	displayName: z.string().min(1),
	tags: z.array(z.string()).refine((tags) => new Set(tags).size === tags.length, {
		message: 'Tags must be unique',
	}),
	description: z.string().optional(),
	order: z.number().finite(),
	weight: reactive(z.number().finite().min(0).max(10)),
	visible: z.boolean(),
	unlocked: reactive(z.boolean()),
	enabled: reactive(z.boolean()),
}

const numberAttributeSchema = z.strictObject({
	...commonShape,
	type: z.literal('number'),
	value: z.number().finite(),
	min: z.number().finite().optional(),
	max: z.number().finite().optional(),
})

const enumAttributeSchema = z.strictObject({
	...commonShape,
	type: z.literal('enum'),
	value: z.number().int().nonnegative(),
	valueDisplay: z.array(z.string()).min(1),
})

const characterSchema = z.strictObject({
	...commonShape,
	attributes: z.record(idSchema, z.union([numberAttributeSchema, enumAttributeSchema])),
})

const effectSchema = z.strictObject({
	...commonShape,
	acquired: reactive(z.boolean()),
	actived: reactive(z.boolean()),
	bindCharacterId: idSchema.optional(),
	reactionList: z.array(reactionSchema),
})

const singleChoiceSchema = z.strictObject({ ...commonShape, action: actionSchema })
const multipleChoiceSchema = z.strictObject({
	...commonShape,
	value: primitiveSchema,
	maxCount: reactive(z.number().int().nonnegative()).optional(),
})
const nodeCommandSchema = z.strictObject({ ...commonShape, action: actionSchema })
const textNodeShape = {
	...commonShape,
	content: z.string(),
	reactionList: z.array(reactionSchema).optional(),
	required: reactive(z.boolean()).optional(),
}
const singleNodeSchema = z.strictObject({
	...textNodeShape,
	type: z.literal('single'),
	choices: reactive(z.record(idSchema, singleChoiceSchema)),
})
const multipleNodeSchema = z.strictObject({
	...textNodeShape,
	type: z.literal('multiple'),
	choices: reactive(z.record(idSchema, multipleChoiceSchema)),
	commands: z.record(idSchema, nodeCommandSchema),
})
const checkNodeSchema = z.strictObject({
	...commonShape,
	type: z.literal('check'),
	candidateNodes: z.record(idSchema, z.literal(true)),
	check: actionSchema,
})
const eventNodeSchema = z.discriminatedUnion('type', [
	singleNodeSchema,
	multipleNodeSchema,
	checkNodeSchema,
])
const eventSchema = z.strictObject({
	...commonShape,
	entryNodeId: idSchema,
	nodes: z.record(idSchema, eventNodeSchema),
	reactionList: z.array(reactionSchema).optional(),
})

export const gameConfigSchema = z.strictObject({
	meta: z.strictObject({
		id: idSchema,
		name: z.string().min(1),
		version: z.string().min(1),
		background: z.string(),
		maxTurnCountPerRun: z.number().int().positive(),
	}),
	characters: z.record(idSchema, characterSchema),
	effects: z.record(idSchema, effectSchema),
	events: z.record(idSchema, eventSchema),
})

export const catalogSchema = z.strictObject({
	schemaVersion: z.literal(1),
	games: z.array(
		z.strictObject({
			id: idSchema,
			version: z.string().min(1),
			name: z.string().min(1),
			background: z.string().optional(),
			manifest: z.string().min(1),
			cover: z.string().min(1).optional(),
		}),
	),
	defaultVersions: z.record(idSchema, z.string().min(1)),
})

export const manifestSchema = z.strictObject({
	schemaVersion: z.literal(1),
	id: idSchema,
	version: z.string().min(1),
	name: z.string().min(1),
	entries: z.strictObject({
		config: z.string().min(1),
		rules: z.string().min(1),
		actions: z.string().min(1),
	}),
	assets: z.string().min(1).optional(),
})

const commonStateShape = {
	id: idSchema,
	weight: z.number().finite().optional(),
	visible: z.boolean().optional(),
	unlocked: z.boolean().optional(),
	enabled: z.boolean().optional(),
}
const attributeStateSchema = z.strictObject({
	...commonStateShape,
	value: z.number().finite().optional(),
})
const characterStateSchema = z.strictObject({
	...commonStateShape,
	attributes: z.record(idSchema, attributeStateSchema).optional(),
})
const effectStateSchema = z.strictObject({
	...commonStateShape,
	acquired: z.boolean().optional(),
	actived: z.boolean().optional(),
	bindCharacterId: idSchema.optional(),
	acquiredTurn: z.number().int().nonnegative().optional(),
	activedTurn: z.number().int().nonnegative().optional(),
})
const choiceStateSchema = z.strictObject({
	...commonStateShape,
	maxCount: z.number().int().nonnegative().optional(),
})
const selectionSchema = z.strictObject({
	eventInstanceId: idSchema,
	choices: z.record(
		idSchema,
		z.strictObject({ id: idSchema, value: primitiveSchema, count: z.number().int().nonnegative() }),
	),
})
const nodeStateSchema = z.strictObject({
	...commonStateShape,
	required: z.boolean().optional(),
	choices: z.record(idSchema, choiceStateSchema).optional(),
	commands: z.record(idSchema, z.strictObject(commonStateShape)).optional(),
	selections: z.record(idSchema, selectionSchema).optional(),
})
const instanceSchema = z.strictObject({
	instanceId: idSchema,
	eventId: idSchema,
	status: z.enum(['active', 'completed', 'abandoned']),
	currentNodeId: idSchema,
	nodePath: z.array(idSchema).min(1),
	startedTurn: z.number().int().nonnegative(),
	endedTurn: z.number().int().nonnegative().optional(),
})
const eventStateSchema = z.strictObject({
	...commonStateShape,
	nodes: z.record(idSchema, nodeStateSchema).optional(),
	instances: z.record(idSchema, instanceSchema).optional(),
	activeInstanceId: idSchema.optional(),
})
const gameStateShape = {
	characters: z.record(idSchema, characterStateSchema),
	effects: z.record(idSchema, effectStateSchema),
	events: z.record(idSchema, eventStateSchema),
}
const gameStateSchema = z.strictObject(gameStateShape)
const turnStateSchema = z.strictObject({
	...gameStateShape,
	turnNumber: z.number().int().nonnegative(),
	phase: z.enum(['initializing', 'turn_start', 'event_handle', 'turn_end']),
})
const randomStateSchema = z.strictObject({
	seed: z.string().min(1),
	cursor: z.number().int().nonnegative().safe(),
})
const snapshotSchema = z.strictObject({
	profileState: gameStateSchema,
	runState: gameStateSchema,
	turnState: turnStateSchema,
	randomState: randomStateSchema,
})
const turnBaseShape = {
	turnId: idSchema,
	createdAt: z.string().datetime({ offset: true }),
	pinned: z.boolean(),
	snapshot: snapshotSchema,
}
const turnDataSchema = z.discriminatedUnion('kind', [
	z.strictObject({ ...turnBaseShape, kind: z.literal('initial') }),
	z.strictObject({ ...turnBaseShape, kind: z.literal('turn_end') }),
	z.strictObject({ ...turnBaseShape, kind: z.literal('abandoned') }),
	z.strictObject({
		...turnBaseShape,
		kind: z.literal('terminal'),
		endingEventInstanceId: idSchema.optional(),
	}),
])
const runDataSchema = z.strictObject({
	runId: idSchema,
	origin: z
		.strictObject({
			kind: z.enum(['branch', 'restart']),
			source: z.strictObject({ runId: idSchema, turnId: idSchema }),
		})
		.optional(),
	status: z.enum(['active', 'ended', 'abandoned']),
	createdAt: z.string().datetime({ offset: true }),
	updatedAt: z.string().datetime({ offset: true }),
	endedAt: z.string().datetime({ offset: true }).optional(),
	maxTurnCount: z.number().int().positive(),
	randomState: randomStateSchema,
	state: gameStateSchema,
	turnState: turnStateSchema,
	currentTurnId: idSchema,
	turnOrder: z.array(idSchema).min(1),
	turnDatas: z.record(idSchema, turnDataSchema),
})

export const profileSchema = z.strictObject({
	profileId: idSchema,
	label: z.string().min(1).optional(),
	stateVersion: z.literal(1),
	configId: idSchema,
	configVersion: z.string().min(1),
	createdAt: z.string().datetime({ offset: true }),
	updatedAt: z.string().datetime({ offset: true }),
	state: gameStateSchema,
	runDatas: z.record(idSchema, runDataSchema),
	current: z.strictObject({ runId: idSchema, turnId: idSchema }),
})

export function parseCatalog(input: unknown): GameCatalog {
	return catalogSchema.parse(input) as GameCatalog
}

export function parseManifest(input: unknown): GamePackageManifest {
	return manifestSchema.parse(input) as GamePackageManifest
}

export function parseConfig(input: unknown): GameConfig {
	return gameConfigSchema.parse(input) as GameConfig
}

export function parseProfile(input: unknown): Profile {
	return profileSchema.parse(input) as Profile
}
