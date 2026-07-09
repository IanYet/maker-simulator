---
name: write-game-story
description: Create or extend story JSON under docs/example for maker-simulator. Use when writing events, nodes, effects, character data, pools, or other story content that must follow docs/system and the type declarations in src/types.
---

# Write Game Story

## Source boundaries

- Use only `docs/system/` for game rules and narrative-model semantics.
- Use only type declaration files under `src/types/` for data shapes and field types.
- Do not use existing demos or other files under `docs/example/` as references. Reading the target story file to continue editing it is allowed.
- Do not inspect implementation files such as `src/game/`, React components, or application code.
- Do not infer behavior from the current implementation. If the framework documentation and type declarations conflict or leave required behavior undefined, report the gap before encoding it.

## Workflow

1. Read only the relevant files in `docs/system/` and `src/types/`.
2. Read the target story file to understand the content already established in the current story.
3. Implement only the content requested in the current step. Do not add future events, branches, attributes, effects, rewards, or mechanics unless requested.
4. Infer and fill omitted schema fields with reasonable values consistent with the established story, framework documentation, and type declarations.
5. Ask the user before proceeding when an uncertainty would materially change chronology, story meaning, player choices, costs, rewards, consequences, or game mechanics. Do not ask about routine schema fields that have a clear neutral default.
6. Preserve established story facts and IDs. Use `snake_case` for content IDs and discriminator values.
7. Express rules through the documented discriminated unions and fields. Do not invent fields or implicit execution behavior.
8. Keep narrative classification fields such as `kind` and `visibility` separate from execution logic.
9. Check that edited JSON parses. When the story is complete enough to satisfy the full model shape, also check it against the declared types and repository-required validation commands.

## Incremental story editing

- Treat each user instruction as the authoritative scope for that step.
- Expand prose without changing the supplied premise, chronology, relationships, or intended uncertainty.
- Do not create choices or consequences for a background-only event.
- When a requested graph shape conflicts with a node type contract, choose a contract-valid node shape that preserves the requested number of nodes and explain the representation briefly.
- Do not update `public/example/`, system documentation, types, or application code unless the user explicitly asks for those changes.
