# 角色模型

角色只包含内容声明的属性及其当前状态。不同内容可以声明完全不同的属性集合。

## Character 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 角色 ID |
| `attributes` | object | 属性表 |

## Attribute 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `displayName` | string | 展示名称 |
| `enabled` | boolean | 当前是否向玩家展示 |
| `value` | string/number/boolean/null | 当前值 |
| `min` | number | 可选；数值属性的最小值 |
| `max` | number | 可选；数值属性的最大值 |

`attributes` 在默认数据中声明本内容可能使用的全部属性。游戏过程中不新增或删除键，而是通过
`modify_attribute.field=enabled` 切换展示状态。`enabled=false` 只影响 UI 展示；条件和值表达式仍可读取，
动作仍可修改该属性。

字符串等非数值属性不得声明 `min` 或 `max`。数值属性可以只声明一侧边界；写入 `value` 后，引擎按已声明
的边界限制结果。

## 角色不保存的内容

| 内容 | 保存位置 |
| --- | --- |
| 标签 | 效果 |
| 剧情状态 | 事件 |
| 计数器 | 效果 |
| 已完成事件 | 对应事件字段 |
| 已解锁内容 | 对应效果或事件字段 |

## 通用资源

生命、能量、金币、行动点等通用资源属于角色属性。

| 资源 | 保存位置 |
| --- | --- |
| 生命 | `character.attributes.health` |
| 能量 | `character.attributes.energy` |
| 金币 | `character.attributes.coin` |
| 行动点 | `character.attributes.action_point` |
