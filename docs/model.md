# 回合制事件驱动效果构建 Roguelike 网状叙事游戏模型

本文基于 `idea.md` 扩展为一份可落地的数据模型说明。玩家在游戏中构建的是一组不断获得、失去、升级、变异、组合的效果。Roguelike 的构筑深度来自效果之间的联动，以及随机事件对效果组合路线的塑造。

## 1. 核心定位

这是一个回合制、事件驱动、效果构建、网状叙事的 Roguelike 系统。

系统中的主要对象是：

1. **角色（Character）**：玩家控制的主体，拥有属性、标签和当前状态。
2. **效果（Effect）**：构筑的核心。装备、建筑、植物、宠物、buff、debuff、区域特性、长期承诺、临时状态都属于效果。
3. **事件（Event）**：叙事与选择的载体。事件根据条件和概率出现，并通过结果改变角色、世界、效果组合和后续事件分支。
4. **条件（Condition）**：所有出现、触发、分支、结束、组合判定的统一表达。
5. **结算变更（Change）**：引擎内部用于修改状态的最小描述，是 JSON 数据驱动所需的状态变更语言。

玩家每回合查看当前可处理事件，选择事件选项，接受或拒绝效果变化，围绕已有效果组合继续塑造角色和局势。

## 2. 设计目标

1. **数据驱动**：角色、属性、效果、事件、条件、概率、结果都可以用 JSON 描述。
2. **可换皮**：同一套引擎可以承载不同题材，只替换内容包即可。
3. **可追踪**：任意时刻的游戏状态都可以序列化为 JSON，用于存档、回放和调试。
4. **效果构筑**：Roguelike 的核心来自效果组合、叠加、互斥、升级、变异与协同。
5. **网状叙事**：事件结果写入标记、计数器、历史和效果实例，从而影响后续事件池。

## 3. 数据分层

系统分为静态内容定义与运行时状态。

### 3.1 静态内容定义

静态内容不随单局游戏变化。

```json
{
  "version": "1.0.0",
  "attributes": [],
  "characters": [],
  "effects": [],
  "effectPools": [],
  "events": [],
  "eventPools": []
}
```

静态内容包括：

- 属性定义。
- 角色模板。
- 效果定义。
- 效果池与奖励规则。
- 事件定义。
- 事件池。

### 3.2 运行时状态

运行时状态描述某一局游戏在某一时刻的完整状态。

```json
{
  "runId": "run_001",
  "contentVersion": "1.0.0",
  "turn": 4,
  "phase": "player_choice",
  "rng": {},
  "flags": {},
  "counters": {},
  "character": {},
  "effects": [],
  "events": {},
  "history": []
}
```

运行时状态包括：

- 当前回合和阶段。
- 随机数状态。
- 全局标记和计数器。
- 角色当前属性。
- 当前已拥有的效果实例。
- 可处理事件和进行中事件。
- 历史记录。

## 4. 回合流程

单回合由固定阶段构成。效果和事件都可以监听阶段并进行结算。

```json
{
  "turnPhases": [
    "turn_start",
    "effect_upkeep",
    "event_pool_refresh",
    "player_choice",
    "event_resolution",
    "effect_resolution",
    "turn_end"
  ]
}
```

阶段说明：

1. `turn_start`：进入新回合，刷新本回合临时状态。
2. `effect_upkeep`：结算已有持续效果的回合开始触发。
3. `event_pool_refresh`：根据条件与概率刷新本回合可处理事件。
4. `player_choice`：玩家处理事件，选择事件选项，接受或拒绝效果变化。
5. `event_resolution`：结算事件阶段、判定与结果。
6. `effect_resolution`：结算由效果获得、失去、升级、组合触发的连锁变化。
7. `turn_end`：扣减持续时间、处理超时事件、写入日志，等待下一回合。

## 5. 通用约定

### 5.1 ID 与实例

静态定义使用稳定 ID。

```json
{
  "id": "effect_wet_tools",
  "name": "潮湿工具"
}
```

运行时对象引用静态定义时使用 `definitionId`。

```json
{
  "instanceId": "eff_inst_12",
  "definitionId": "effect_wet_tools"
}
```

### 5.2 标签

标签用于分类、条件判断、互斥、协同和事件解锁。

```json
{
  "tags": ["weather", "tool", "debuff"]
}
```

### 5.3 作用域

条件与结算变更需要明确读写范围。

常用作用域：

- `character`：当前角色。
- `state`：全局运行状态。
- `event`：当前事件实例。
- `effect`：当前效果实例。
- `effects`：当前效果集合。
- `history`：历史记录。

## 6. 属性模型

角色属性是事件判定、效果触发和失败条件的基础。

### 6.1 属性定义

```json
{
  "id": "health",
  "name": "生命",
  "kind": "resource",
  "defaultValue": 10,
  "min": 0,
  "max": 10,
  "visible": true,
  "description": "角色的生存能力。"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 属性 ID |
| `name` | string | 是 | 展示名称 |
| `kind` | string | 是 | `base` / `resource` / `derived` / `hidden` |
| `defaultValue` | number | 是 | 默认值 |
| `min` | number | 否 | 最小值 |
| `max` | number | 否 | 最大值 |
| `visible` | boolean | 否 | 是否对玩家可见 |
| `description` | string | 否 | 描述 |

### 6.2 角色定义

```json
{
  "id": "char_maker",
  "name": "造物者",
  "attributes": {
    "health": 10,
    "energy": 3,
    "inspiration": 0,
    "stress": 0
  },
  "startingEffects": ["effect_beginner_luck"],
  "tags": ["human", "maker"]
}
```

### 6.3 运行时角色状态

```json
{
  "definitionId": "char_maker",
  "attributes": {
    "health": { "base": 10, "current": 8, "max": 10 },
    "energy": { "base": 3, "current": 2, "max": 3 },
    "inspiration": { "base": 0, "current": 4 },
    "stress": { "base": 0, "current": 2 }
  },
  "tags": ["human", "maker"],
  "status": "alive"
}
```

## 7. 条件模型

所有判定都基于条件。条件用于事件出现、效果触发、效果组合、选项可见、结果分支、事件结束和失败判定。

### 7.1 原子条件

```json
{
  "type": "compare",
  "left": { "path": "character.attributes.health.current" },
  "operator": "<=",
  "right": 3
}
```

支持的 `operator`：

- `==`
- `!=`
- `>`
- `>=`
- `<`
- `<=`
- `in`
- `not_in`
- `contains`
- `not_contains`

### 7.2 逻辑条件

```json
{
  "type": "and",
  "conditions": [
    {
      "type": "compare",
      "left": { "path": "state.turn" },
      "operator": ">=",
      "right": 3
    },
    {
      "type": "flag",
      "key": "met_old_engineer",
      "value": true
    }
  ]
}
```

支持的逻辑类型：

- `and`
- `or`
- `not`

### 7.3 效果条件

效果条件用于判断玩家是否拥有某个效果、某类标签、某个层数，或者是否满足组合关系。

```json
{
  "type": "effect",
  "selector": {
    "definitionId": "effect_wet_tools",
    "target": "character"
  },
  "operator": "exists"
}
```

```json
{
  "type": "effect_count",
  "selector": {
    "tags": ["plant"]
  },
  "operator": ">=",
  "value": 3
}
```

```json
{
  "type": "effect_stack",
  "selector": {
    "definitionId": "effect_focus"
  },
  "operator": ">=",
  "value": 5
}
```

### 7.4 历史条件

```json
{
  "type": "history",
  "eventId": "event_first_storm",
  "resultId": "repair_success",
  "operator": "occurred"
}
```

## 8. 概率模型

概率判定由基础概率、条件修正和随机数源组成。

```json
{
  "baseChance": 0.25,
  "modifiers": [
    {
      "condition": {
        "type": "effect",
        "selector": {
          "definitionId": "effect_weather_tower"
        },
        "operator": "exists"
      },
      "mode": "multiply",
      "value": 0.5
    },
    {
      "condition": {
        "type": "compare",
        "left": { "path": "character.attributes.stress.current" },
        "operator": ">=",
        "right": 5
      },
      "mode": "add",
      "value": 0.2
    }
  ],
  "minChance": 0,
  "maxChance": 1,
  "rngKey": "event_pool"
}
```

## 9. 结算变更模型

结算变更是引擎内部的数据语言，用于描述事件结果和效果触发后状态如何变化。它服务于效果和事件的结算。

### 9.1 修改属性

```json
{
  "type": "attribute",
  "target": "character",
  "attribute": "health",
  "field": "current",
  "mode": "add",
  "value": -2,
  "clamp": true
}
```

### 9.2 设置标记

```json
{
  "type": "flag",
  "key": "storm_seen",
  "value": true
}
```

### 9.3 修改计数器

```json
{
  "type": "counter",
  "key": "storms_survived",
  "mode": "add",
  "value": 1
}
```

### 9.4 获得效果

```json
{
  "type": "gain_effect",
  "effectId": "effect_wet_tools",
  "target": "character",
  "duration": 3,
  "stackingOverride": {
    "mode": "refresh_duration"
  }
}
```

### 9.5 失去效果

```json
{
  "type": "lose_effect",
  "selector": {
    "definitionId": "effect_wet_tools",
    "target": "character"
  }
}
```

### 9.6 升级效果

```json
{
  "type": "upgrade_effect",
  "selector": {
    "definitionId": "effect_workbench"
  },
  "upgradeId": "reinforced"
}
```

### 9.7 替换效果

```json
{
  "type": "replace_effect",
  "from": {
    "definitionId": "effect_wet_tools"
  },
  "to": {
    "effectId": "effect_rusted_tools",
    "duration": 5
  }
}
```

### 9.8 推进事件

```json
{
  "type": "advance_event",
  "eventInstanceId": "$current",
  "phaseId": "phase_after_repair"
}
```

### 9.9 生成事件

```json
{
  "type": "spawn_event",
  "eventId": "event_roof_leak",
  "mode": "available"
}
```

## 10. 效果模型

效果是本系统的核心构筑单位。一个效果可以是临时状态，也可以是长期建设；可以是正面、负面或中性；可以单独生效，也可以和其他效果形成组合。

### 10.1 效果定义

```json
{
  "id": "effect_wet_tools",
  "name": "潮湿工具",
  "kind": "debuff",
  "rarity": "common",
  "tags": ["tool", "weather", "negative"],
  "duration": {
    "type": "turns",
    "value": 3,
    "tickTiming": "turn_end"
  },
  "stacking": {
    "mode": "refresh_duration",
    "maxStacks": 1
  },
  "slots": [],
  "triggers": [
    {
      "timing": "turn_start",
      "condition": {
        "type": "compare",
        "left": { "path": "character.attributes.energy.current" },
        "operator": ">",
        "right": 0
      },
      "changes": [
        {
          "type": "attribute",
          "target": "character",
          "attribute": "energy",
          "field": "current",
          "mode": "add",
          "value": -1,
          "clamp": true
        }
      ]
    }
  ],
  "onGain": [],
  "onExpire": [],
  "description": "每回合开始时失去 1 点能量。"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 效果 ID |
| `name` | string | 是 | 展示名称 |
| `kind` | string | 是 | `buff` / `debuff` / `equipment` / `building` / `pet` / `plant` / `area` / `passive` |
| `rarity` | string | 否 | `common` / `rare` / `epic` / `legendary` / `story` |
| `tags` | array | 否 | 标签 |
| `duration` | object | 否 | 持续时间，不填表示永久 |
| `stacking` | object | 否 | 叠加规则 |
| `slots` | array | 否 | 占用的效果槽位 |
| `triggers` | array | 否 | 触发器 |
| `onGain` | array | 否 | 获得时的结算变更 |
| `onExpire` | array | 否 | 结束时的结算变更 |
| `description` | string | 否 | 描述 |

### 10.2 效果类型

```json
{
  "kind": "building"
}
```

推荐效果类型：

- `buff`：正面状态。
- `debuff`：负面状态。
- `equipment`：装备或工具。
- `building`：区域建设。
- `pet`：宠物或随从。
- `plant`：种植对象。
- `area`：区域环境。
- `passive`：抽象被动特性。
- `story`：叙事性状态。

### 10.3 持续时间

```json
{
  "type": "turns",
  "value": 3,
  "tickTiming": "turn_end"
}
```

持续时间类型：

- `instant`：获得后立即结算并消失。
- `turns`：持续若干回合。
- `event_bound`：绑定到某事件实例。
- `condition_bound`：直到满足结束条件。
- `permanent`：永久。

### 10.4 叠加规则

```json
{
  "mode": "stack",
  "maxStacks": 5,
  "onOverflow": "convert",
  "overflowEffectId": "effect_overcharged"
}
```

叠加模式：

- `ignore`：已有同类效果时忽略。
- `refresh_duration`：刷新持续时间。
- `stack`：增加层数。
- `replace`：替换旧实例。
- `independent`：创建独立实例。
- `merge`：与已有实例合并，并触发组合规则。

### 10.5 效果槽位

效果槽位用于限制构筑容量，制造取舍。

```json
{
  "slots": [
    {
      "type": "tool",
      "size": 1
    }
  ]
}
```

角色运行时可以定义槽位上限：

```json
{
  "effectSlots": {
    "tool": 2,
    "building": 4,
    "pet": 1,
    "plant": 6
  }
}
```

槽位不是必须系统。如果某个题材不需要容量限制，可以完全省略。

### 10.6 效果升级

```json
{
  "id": "effect_workbench",
  "name": "工作台",
  "kind": "building",
  "tags": ["building", "craft"],
  "upgrades": [
    {
      "id": "reinforced",
      "name": "加固工作台",
      "condition": {
        "type": "compare",
        "left": { "path": "character.attributes.inspiration.current" },
        "operator": ">=",
        "right": 3
      },
      "addTags": ["stable"],
      "addTriggers": [
        {
          "timing": "event_resolution",
          "condition": {
            "type": "effect",
            "selector": {
              "tags": ["tool"]
            },
            "operator": "exists"
          },
          "changes": [
            {
              "type": "counter",
              "key": "craft_bonus",
              "mode": "add",
              "value": 1
            }
          ]
        }
      ]
    }
  ]
}
```

升级可以改变：

- 标签。
- 触发器。
- 持续时间。
- 叠加上限。
- 槽位占用。
- 与其他效果的组合关系。

### 10.7 运行时效果实例

```json
{
  "instanceId": "eff_inst_12",
  "definitionId": "effect_wet_tools",
  "target": {
    "scope": "character",
    "id": "player"
  },
  "remainingTurns": 2,
  "stacks": 1,
  "upgrades": [],
  "createdTurn": 4,
  "source": {
    "type": "event",
    "id": "event_first_storm"
  },
  "localFlags": {},
  "localCounters": {}
}
```

## 11. 效果组合模型

效果组合是 Roguelike 构筑的核心。组合规则用于表达“当玩家同时拥有某些效果时，产生额外效果、替换为新效果、提升触发概率或解锁事件”。

### 11.1 组合规则

```json
{
  "id": "combo_greenhouse_rain_barrel",
  "name": "温室雨水循环",
  "condition": {
    "type": "and",
    "conditions": [
      {
        "type": "effect",
        "selector": { "definitionId": "effect_greenhouse" },
        "operator": "exists"
      },
      {
        "type": "effect",
        "selector": { "definitionId": "effect_rain_barrel" },
        "operator": "exists"
      }
    ]
  },
  "timing": "effect_resolution",
  "mode": "grant_virtual_effect",
  "effectId": "effect_water_cycle",
  "repeat": {
    "mode": "while_condition_true"
  }
}
```

### 11.2 组合模式

推荐组合模式：

- `grant_virtual_effect`：条件满足时授予虚拟效果，条件失效时移除。
- `grant_real_effect`：条件满足时获得一个真实效果。
- `replace_effects`：将多个效果合成为一个新效果。
- `modify_trigger`：修改已有触发器的概率或数值。
- `unlock_event`：解锁新的事件链。
- `convert_stack`：将层数转换为另一个效果。

### 11.3 虚拟效果

虚拟效果不直接来自事件奖励，而是由组合规则临时生成。

```json
{
  "instanceId": "eff_virtual_3",
  "definitionId": "effect_water_cycle",
  "virtual": true,
  "source": {
    "type": "combo",
    "id": "combo_greenhouse_rain_barrel"
  }
}
```

虚拟效果适合表达套装、协同、环境联动。它不占用奖励池，也通常不占用槽位。

## 12. 效果池与奖励模型

随机奖励表现为效果候选。事件可以从效果池中抽取若干候选，让玩家选择获得、替换、升级或放弃。

### 12.1 效果池定义

```json
{
  "id": "pool_workshop_common",
  "name": "工坊常见效果",
  "condition": {
    "type": "flag",
    "key": "act",
    "value": 1
  },
  "effects": [
    {
      "effectId": "effect_workbench",
      "weight": 10,
      "rarity": "common"
    },
    {
      "effectId": "effect_rain_barrel",
      "weight": 6,
      "rarity": "rare"
    }
  ],
  "rules": {
    "excludeOwnedUnique": true,
    "maxCandidates": 3
  }
}
```

### 12.2 效果奖励

```json
{
  "type": "effect_reward",
  "poolId": "pool_workshop_common",
  "count": 3,
  "pick": 1,
  "allowSkip": true,
  "presentation": "choose_one"
}
```

奖励可以出现在事件结果中，也可以由效果触发生成。

### 12.3 效果变异

```json
{
  "type": "effect_mutation",
  "selector": {
    "tags": ["tool"]
  },
  "candidates": [
    {
      "mutationId": "lighter",
      "name": "轻量化",
      "addTags": ["light"],
      "changeSlots": [{ "type": "tool", "delta": -1 }]
    },
    {
      "mutationId": "unstable",
      "name": "不稳定",
      "addTags": ["volatile"],
      "addTriggers": [
        {
          "timing": "turn_start",
          "chance": { "baseChance": 0.2 },
          "changes": [
            {
              "type": "attribute",
              "target": "character",
              "attribute": "stress",
              "field": "current",
              "mode": "add",
              "value": 1,
              "clamp": true
            }
          ]
        }
      ]
    }
  ],
  "pick": 1
}
```

变异让同一个效果实例在不同局中产生差异，是效果构筑 Roguelike 的重要手段。

## 13. 事件模型

事件包含出现、开始、过程、阶段、判定与结果。事件是玩家做选择和改变效果组合的主要入口。

### 13.1 事件定义

```json
{
  "id": "event_first_storm",
  "name": "第一场风暴",
  "kind": "narrative",
  "tags": ["weather", "danger"],
  "availability": {
    "condition": {
      "type": "and",
      "conditions": [
        {
          "type": "compare",
          "left": { "path": "state.turn" },
          "operator": ">=",
          "right": 2
        },
        {
          "type": "flag",
          "key": "storm_seen",
          "value": false
        }
      ]
    },
    "chance": {
      "baseChance": 0.4,
      "rngKey": "event_pool"
    }
  },
  "startMode": "auto",
  "repeat": {
    "mode": "once"
  },
  "duration": {
    "maxTurns": 3,
    "onTimeoutResult": "ignored_storm"
  },
  "entryPhase": "phase_warning",
  "phases": [
    {
      "id": "phase_warning",
      "title": "乌云逼近",
      "body": "远处的风声穿过未完工的墙缝。你需要决定是否立刻加固工坊。",
      "choices": [
        {
          "id": "choice_repair",
          "text": "加固屋顶",
          "condition": {
            "type": "compare",
            "left": { "path": "character.attributes.energy.current" },
            "operator": ">=",
            "right": 1
          },
          "cost": [
            {
              "type": "attribute",
              "target": "character",
              "attribute": "energy",
              "field": "current",
              "mode": "add",
              "value": -1,
              "clamp": true
            }
          ],
          "checks": [
            {
              "id": "repair_check",
              "chance": {
                "baseChance": 0.65,
                "modifiers": [
                  {
                    "condition": {
                      "type": "effect",
                      "selector": {
                        "definitionId": "effect_workbench"
                      },
                      "operator": "exists"
                    },
                    "mode": "add",
                    "value": 0.15
                  }
                ]
              },
              "successResult": "repair_success",
              "failureResult": "repair_failure"
            }
          ]
        },
        {
          "id": "choice_ignore",
          "text": "继续手头工作",
          "result": "ignored_storm"
        }
      ]
    }
  ],
  "results": [
    {
      "id": "repair_success",
      "text": "你赶在暴雨前封住了最危险的裂缝。",
      "changes": [
        {
          "type": "flag",
          "key": "storm_seen",
          "value": true
        },
        {
          "type": "counter",
          "key": "storms_survived",
          "mode": "add",
          "value": 1
        },
        {
          "type": "gain_effect",
          "effectId": "effect_reinforced_roof",
          "target": "character"
        }
      ],
      "endsEvent": true
    },
    {
      "id": "repair_failure",
      "text": "屋顶仍然漏水，工具被雨水浸湿。",
      "changes": [
        {
          "type": "flag",
          "key": "storm_seen",
          "value": true
        },
        {
          "type": "gain_effect",
          "effectId": "effect_wet_tools",
          "target": "character",
          "duration": 3
        }
      ],
      "endsEvent": true
    },
    {
      "id": "ignored_storm",
      "text": "风暴没有被处理，它留下了一些麻烦。",
      "changes": [
        {
          "type": "attribute",
          "target": "character",
          "attribute": "stress",
          "field": "current",
          "mode": "add",
          "value": 2,
          "clamp": true
        }
      ],
      "endsEvent": true
    }
  ]
}
```

### 13.2 事件字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 事件 ID |
| `name` | string | 是 | 展示名称 |
| `kind` | string | 是 | `narrative` / `crisis` / `reward` / `rest` / `system` |
| `tags` | array | 否 | 标签 |
| `availability` | object | 是 | 出现条件与概率 |
| `startMode` | string | 是 | `auto` / `manual` |
| `repeat` | object | 是 | 重复规则 |
| `duration` | object | 否 | 持续与超时规则 |
| `entryPhase` | string | 是 | 初始阶段 ID |
| `phases` | array | 是 | 阶段列表 |
| `results` | array | 是 | 结果列表 |

### 13.3 选择结算顺序

1. 检查选项 `condition`。
2. 结算 `cost`。
3. 执行 `checks`。
4. 根据成功、失败或直接结果进入 `results`。
5. 结算结果中的 `changes`。
6. 写入历史记录。
7. 触发效果组合检查。

### 13.4 运行时事件状态

```json
{
  "available": [
    {
      "eventId": "event_first_storm",
      "generatedTurn": 2,
      "expiresTurn": 2,
      "priority": 10
    }
  ],
  "active": [
    {
      "instanceId": "evt_inst_42",
      "definitionId": "event_first_storm",
      "currentPhase": "phase_warning",
      "startedTurn": 2,
      "phaseStartedTurn": 2,
      "remainingTurns": 3,
      "localFlags": {},
      "localCounters": {},
      "status": "active"
    }
  ],
  "cooldowns": {
    "event_first_storm": 4
  },
  "occurrences": {
    "event_first_storm": 1
  }
}
```

## 14. 事件池模型

事件池用于控制一组事件的出现范围、权重和上限。不同章节、区域或叙事阶段可以使用不同事件池。

```json
{
  "id": "pool_act_1_workshop",
  "name": "第一章：工坊",
  "condition": {
    "type": "flag",
    "key": "act",
    "value": 1
  },
  "events": [
    {
      "eventId": "event_first_storm",
      "weight": 10,
      "priority": 20
    },
    {
      "eventId": "event_find_seedling",
      "weight": 5,
      "priority": 10
    }
  ],
  "rules": {
    "maxAvailablePerTurn": 3,
    "allowDuplicateTags": false
  }
}
```

事件池刷新流程：

1. 找出满足 `condition` 的事件池。
2. 合并候选事件。
3. 检查事件自身的重复规则、冷却、最大实例数和互斥限制。
4. 检查事件 `availability.condition`。
5. 根据事件 `availability.chance` 进行概率判定。
6. 根据权重、优先级和上限筛选本回合展示事件。

## 15. 历史记录

历史记录是网状叙事的重要输入。事件不应只改变数值，还应记录关键事实。

```json
{
  "turn": 2,
  "type": "event_result",
  "eventId": "event_first_storm",
  "eventInstanceId": "evt_inst_42",
  "phaseId": "phase_warning",
  "choiceId": "choice_repair",
  "resultId": "repair_success",
  "checks": [
    {
      "id": "repair_check",
      "chance": 0.8,
      "roll": 0.34,
      "success": true
    }
  ],
  "effectChanges": [
    {
      "type": "gain_effect",
      "effectId": "effect_reinforced_roof",
      "instanceId": "eff_inst_20"
    }
  ]
}
```

历史记录可用于：

- 判断事件是否出现过。
- 判断某个结果是否发生过。
- 判断玩家曾经获得、失去或升级过哪些效果。
- 统计玩家构筑路线。
- 解锁后续事件。
- 调试随机判定。

## 16. 随机数状态

为了支持回放和可复现调试，随机状态应该进入存档。

```json
{
  "rng": {
    "seed": "run_seed_12345",
    "streams": {
      "event_pool": {
        "state": "opaque_state_1",
        "calls": 18
      },
      "checks": {
        "state": "opaque_state_2",
        "calls": 6
      },
      "effect_reward": {
        "state": "opaque_state_3",
        "calls": 12
      }
    }
  }
}
```

建议至少拆分这些随机流：

- `event_pool`：事件池刷新。
- `checks`：事件和效果判定。
- `effect_reward`：效果奖励候选生成。
- `mutation`：效果变异。

## 17. 存档结构

完整运行时状态示例：

```json
{
  "runId": "run_001",
  "contentVersion": "1.0.0",
  "turn": 4,
  "phase": "player_choice",
  "rng": {
    "seed": "run_seed_12345",
    "streams": {}
  },
  "flags": {
    "act": 1,
    "storm_seen": true
  },
  "counters": {
    "storms_survived": 1
  },
  "character": {
    "definitionId": "char_maker",
    "attributes": {
      "health": { "base": 10, "current": 8, "max": 10 },
      "energy": { "base": 3, "current": 2, "max": 3 },
      "inspiration": { "base": 0, "current": 4 },
      "stress": { "base": 0, "current": 2 }
    },
    "effectSlots": {
      "tool": 2,
      "building": 4,
      "pet": 1,
      "plant": 6
    },
    "tags": ["human", "maker"],
    "status": "alive"
  },
  "effects": [
    {
      "instanceId": "eff_inst_12",
      "definitionId": "effect_wet_tools",
      "target": {
        "scope": "character",
        "id": "player"
      },
      "remainingTurns": 2,
      "stacks": 1,
      "upgrades": [],
      "createdTurn": 4,
      "source": {
        "type": "event",
        "id": "event_first_storm"
      },
      "localFlags": {},
      "localCounters": {}
    }
  ],
  "events": {
    "available": [],
    "active": [],
    "cooldowns": {
      "event_first_storm": 4
    },
    "occurrences": {
      "event_first_storm": 1
    }
  },
  "history": []
}
```

## 18. 内容包结构

推荐把可编辑内容拆成多个 JSON 文件，最终加载时合并。

```json
{
  "version": "1.0.0",
  "metadata": {
    "title": "工坊纪事",
    "author": "content-team"
  },
  "attributes": ["attributes/core.json"],
  "characters": ["characters/maker.json"],
  "effects": ["effects/weather.json", "effects/buildings.json", "effects/plants.json"],
  "effectPools": ["effect_pools/workshop.json"],
  "events": ["events/act_1.json"],
  "eventPools": ["event_pools/act_1.json"]
}
```

## 19. 结算规则建议

为了避免数据驱动系统出现歧义，建议固定以下规则：

1. 同一阶段内，先结算 `priority` 高的触发器；相同优先级按创建时间排序。
2. 每个结算变更都应该生成日志，便于调试和回放。
3. 属性修改默认受 `min` / `max` 限制，除非显式设置 `clamp: false`。
4. 事件结果先结算 `changes`，再写入历史记录。
5. 获得或失去效果后，立即进入一次 `effect_resolution`，检查组合规则。
6. 效果过期时先结算 `onExpire`，再移除实例。
7. 自动事件如果创建后立即结束，也必须进入历史记录。
8. 玩家选择只允许在 `player_choice` 阶段发生。
9. 跨回合事件在 `turn_end` 扣减剩余回合，并在扣减后检查超时。
10. 虚拟效果由组合规则维护，不应该被普通事件直接移除，除非事件显式破坏该组合来源。

## 20. 最小可用实现范围

第一版系统可以只实现以下能力：

1. 属性定义与角色状态。
2. 条件判断：`compare`、`and`、`or`、`not`、`flag`、`history`、`effect`、`effect_count`。
3. 概率判定：基础概率与条件修正。
4. 结算变更：属性、标记、计数器、获得效果、失去效果、升级效果、替换效果、生成事件、推进事件。
5. 效果：获得、回合触发、过期、叠加、升级。
6. 效果组合：至少支持 `grant_virtual_effect` 和 `grant_real_effect`。
7. 效果池：随机候选、三选一、跳过。
8. 事件：出现判定、手动/自动开始、阶段、选择、结果、持续回合、重复规则。
9. 存档：完整运行时状态 JSON 序列化。

## 21. 一个完整小样例

下面是一个极小内容包，展示属性、角色、效果、效果池和事件如何互相连接。

```json
{
  "version": "1.0.0",
  "attributes": [
    {
      "id": "health",
      "name": "生命",
      "kind": "resource",
      "defaultValue": 10,
      "min": 0,
      "max": 10,
      "visible": true
    },
    {
      "id": "energy",
      "name": "能量",
      "kind": "resource",
      "defaultValue": 3,
      "min": 0,
      "max": 3,
      "visible": true
    },
    {
      "id": "stress",
      "name": "压力",
      "kind": "resource",
      "defaultValue": 0,
      "min": 0,
      "max": 10,
      "visible": true
    }
  ],
  "characters": [
    {
      "id": "char_maker",
      "name": "造物者",
      "attributes": {
        "health": 10,
        "energy": 3,
        "stress": 0
      },
      "startingEffects": ["effect_old_workbench"],
      "tags": ["human", "maker"]
    }
  ],
  "effects": [
    {
      "id": "effect_old_workbench",
      "name": "旧工作台",
      "kind": "building",
      "rarity": "story",
      "tags": ["building", "craft"],
      "duration": {
        "type": "permanent"
      },
      "triggers": [
        {
          "timing": "event_resolution",
          "condition": {
            "type": "history",
            "eventId": "event_rain_leak",
            "resultId": "fixed",
            "operator": "occurred_this_turn"
          },
          "changes": [
            {
              "type": "attribute",
              "target": "character",
              "attribute": "stress",
              "field": "current",
              "mode": "add",
              "value": -1,
              "clamp": true
            }
          ]
        }
      ]
    },
    {
      "id": "effect_wet_tools",
      "name": "潮湿工具",
      "kind": "debuff",
      "rarity": "common",
      "tags": ["tool", "weather", "negative"],
      "duration": {
        "type": "turns",
        "value": 2
      },
      "stacking": {
        "mode": "refresh_duration",
        "maxStacks": 1
      },
      "triggers": [
        {
          "timing": "turn_start",
          "changes": [
            {
              "type": "attribute",
              "target": "character",
              "attribute": "energy",
              "field": "current",
              "mode": "add",
              "value": -1,
              "clamp": true
            }
          ]
        }
      ]
    },
    {
      "id": "effect_rain_barrel",
      "name": "接雨桶",
      "kind": "building",
      "rarity": "common",
      "tags": ["building", "water"],
      "duration": {
        "type": "permanent"
      }
    },
    {
      "id": "effect_greenhouse",
      "name": "简易温室",
      "kind": "building",
      "rarity": "rare",
      "tags": ["building", "plant"],
      "duration": {
        "type": "permanent"
      }
    },
    {
      "id": "effect_water_cycle",
      "name": "雨水循环",
      "kind": "passive",
      "rarity": "story",
      "tags": ["combo", "water", "plant"],
      "duration": {
        "type": "condition_bound"
      },
      "triggers": [
        {
          "timing": "turn_start",
          "changes": [
            {
              "type": "attribute",
              "target": "character",
              "attribute": "stress",
              "field": "current",
              "mode": "add",
              "value": -1,
              "clamp": true
            }
          ]
        }
      ]
    }
  ],
  "effectCombos": [
    {
      "id": "combo_greenhouse_rain_barrel",
      "name": "温室雨水循环",
      "condition": {
        "type": "and",
        "conditions": [
          {
            "type": "effect",
            "selector": { "definitionId": "effect_greenhouse" },
            "operator": "exists"
          },
          {
            "type": "effect",
            "selector": { "definitionId": "effect_rain_barrel" },
            "operator": "exists"
          }
        ]
      },
      "timing": "effect_resolution",
      "mode": "grant_virtual_effect",
      "effectId": "effect_water_cycle",
      "repeat": {
        "mode": "while_condition_true"
      }
    }
  ],
  "effectPools": [
    {
      "id": "pool_workshop_common",
      "effects": [
        {
          "effectId": "effect_rain_barrel",
          "weight": 10
        },
        {
          "effectId": "effect_greenhouse",
          "weight": 3
        }
      ],
      "rules": {
        "excludeOwnedUnique": true,
        "maxCandidates": 3
      }
    }
  ],
  "events": [
    {
      "id": "event_rain_leak",
      "name": "雨夜漏水",
      "kind": "narrative",
      "availability": {
        "condition": {
          "type": "compare",
          "left": { "path": "state.turn" },
          "operator": ">=",
          "right": 2
        },
        "chance": {
          "baseChance": 0.5
        }
      },
      "startMode": "manual",
      "repeat": {
        "mode": "limited",
        "maxOccurrences": 2,
        "cooldownTurns": 3
      },
      "entryPhase": "start",
      "phases": [
        {
          "id": "start",
          "title": "屋顶滴水",
          "body": "雨水落在工作台上，工具开始受潮。",
          "choices": [
            {
              "id": "fix",
              "text": "花费能量修补",
              "condition": {
                "type": "compare",
                "left": { "path": "character.attributes.energy.current" },
                "operator": ">=",
                "right": 1
              },
              "cost": [
                {
                  "type": "attribute",
                  "target": "character",
                  "attribute": "energy",
                  "field": "current",
                  "mode": "add",
                  "value": -1,
                  "clamp": true
                }
              ],
              "result": "fixed"
            },
            {
              "id": "ignore",
              "text": "暂时不管",
              "result": "ignored"
            }
          ]
        }
      ],
      "results": [
        {
          "id": "fixed",
          "text": "你修好了漏水处，并找到了一些可用材料。",
          "reward": {
            "type": "effect_reward",
            "poolId": "pool_workshop_common",
            "count": 2,
            "pick": 1,
            "allowSkip": true
          },
          "changes": [
            {
              "type": "counter",
              "key": "leaks_fixed",
              "mode": "add",
              "value": 1
            }
          ],
          "endsEvent": true
        },
        {
          "id": "ignored",
          "text": "工具被雨水浸湿了。",
          "changes": [
            {
              "type": "gain_effect",
              "effectId": "effect_wet_tools",
              "target": "character",
              "duration": 2
            }
          ],
          "endsEvent": true
        }
      ]
    }
  ],
  "eventPools": [
    {
      "id": "pool_default",
      "events": [
        {
          "eventId": "event_rain_leak",
          "weight": 1,
          "priority": 1
        }
      ],
      "rules": {
        "maxAvailablePerTurn": 2,
        "allowDuplicateTags": false
      }
    }
  ]
}
```
