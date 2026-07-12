import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const output = fileURLToPath(new URL('../public/games/frostbound/1.0.0/config.json', import.meta.url))
const FINAL_TURN = 10

/** 创建 Config 中可序列化的 Action 调用描述。 */
const action = (key, ...args) => ({ key, args })
/** 创建 Config 中可序列化的 Rule 调用描述。 */
const rule = (key, ...args) => ({ key, args })
/** 仅供 authoring 过程组合字面基础值和派生 Rule。 */
const reactive = (value, key, ...args) => ({ value, rule: rule(key, ...args) })

/** 为字面基础值生成读取 State 基础字段的 Rule。 */
const stateValueRule = (path) => rule('state.value', ...path)

/** 生成带通用展示、排序和启用字段的 Config 对象。 */
function common(id, displayName, order, options = {}) {
  return {
    id,
    displayName,
    tags: options.tags ?? [],
    ...(options.description ? { description: options.description } : {}),
    order,
    weight: options.weight ?? 5,
    visible: options.visible ?? true,
    unlocked: options.unlocked ?? true,
    enabled: options.enabled ?? true,
  }
}

/** 生成数值属性定义。 */
const numberAttribute = (id, name, order, value, min, max, options = {}) => ({
  ...common(id, name, order, options),
  type: 'number',
  value,
  min,
  max,
})

/** 生成枚举属性定义。 */
const enumAttribute = (id, name, order, value, valueDisplay, options = {}) => ({
  ...common(id, name, order, options),
  type: 'enum',
  value,
  valueDisplay,
})

/** 生成带获得/激活状态、手动激活能力和 Reaction 列表的 Effect 定义。 */
function effect(id, name, order, description, options = {}) {
  return {
    ...common(id, name, order, { tags: options.tags ?? ['build'], description }),
    acquired: options.acquired ?? false,
    actived: options.actived ?? false,
    manuallyActivatable: options.manuallyActivatable ?? false,
    ...(options.bindCharacterId ? { bindCharacterId: options.bindCharacterId } : {}),
    reactionList: options.reactionList ?? [],
  }
}

/** 生成单选节点中的 Choice。 */
const choice = (id, name, order, call, options = {}) => ({
  ...common(id, name, order, options),
  action: call,
})

/** 生成多选节点中的可计数 Choice。 */
const multipleChoice = (id, name, order, value, maxCount, options = {}) => ({
  ...common(id, name, order, options),
  value,
  ...(maxCount !== undefined ? { maxCount } : {}),
})

/** 生成多选节点提交用的 NodeCommand。 */
const command = (id, name, order, call, options = {}) => ({
  ...common(id, name, order, options),
  action: call,
})

/** 生成单选叙事节点，并把 Choice 数组转换为 id 索引对象。 */
function singleNode(id, name, order, content, choices, options = {}) {
  return {
    ...common(id, name, order, options),
    type: 'single',
    content,
    required: options.required ?? true,
    ...(options.reactionList ? { reactionList: options.reactionList } : {}),
    choices: Object.fromEntries(choices.map((item) => [item.id, item])),
  }
}

/** 生成多选叙事节点及其提交命令。 */
function multipleNode(id, name, order, content, choices, commands, options = {}) {
  return {
    ...common(id, name, order, options),
    type: 'multiple',
    content,
    required: options.required ?? true,
    ...(options.reactionList ? { reactionList: options.reactionList } : {}),
    choices: Object.fromEntries(choices.map((item) => [item.id, item])),
    commands: Object.fromEntries(commands.map((item) => [item.id, item])),
  }
}

/** 生成隐藏的自动检查节点。 */
function checkNode(id, name, order, candidates, call) {
  return {
    ...common(id, name, order, { visible: false, tags: ['check'] }),
    type: 'check',
    candidateNodes: Object.fromEntries(candidates.map((candidate) => [candidate, true])),
    check: call,
  }
}

/** 生成一个带回合解锁条件的 EventConfig。 */
function gameEvent(id, name, order, minTurn, description, nodes, options = {}) {
  return {
    ...common(id, name, order, {
      tags: options.tags ?? ['expedition'],
      description,
      unlocked: reactive(minTurn <= 1 && !options.requiredEffect, 'event.unlocked', id, minTurn, options.requiredEffect ?? null),
      enabled: reactive(true, 'event.enabled', id),
    }),
    entryNodeId: options.entryNodeId ?? nodes[0].id,
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    ...(options.reactionList ? { reactionList: options.reactionList } : {}),
  }
}

function isReactiveValue(value) {
  return value !== null && typeof value === 'object' && 'value' in value && 'rule' in value
}

/** 将旧 authoring 便利写法统一为 xxxValue + xxx Rule。 */
function splitField(object, field, path, optional = false) {
  const authored = object[field]
  if (authored === undefined) {
    if (optional) return
    throw new Error(`Missing required derived field ${[...path, field].join('.')}`)
  }
  object[`${field}Value`] = isReactiveValue(authored)
    ? authored.value
    : authored
  object[field] = isReactiveValue(authored)
    ? authored.rule
    : stateValueRule([...path, `${field}Value`])
}

function normalizeCommon(object, path) {
  splitField(object, 'weight', path)
  splitField(object, 'unlocked', path)
  splitField(object, 'enabled', path)
}

/** 在写出 Config 前递归拆分 authoring 基础值，并为字面值接入 State Rule。 */
function normalizeConfig(config) {
  for (const character of Object.values(config.characters)) {
    normalizeCommon(character, ['characters', character.id])
    for (const attribute of Object.values(character.attributes)) {
      normalizeCommon(attribute, ['characters', character.id, 'attributes', attribute.id])
    }
  }
  for (const effect of Object.values(config.effects)) {
    normalizeCommon(effect, ['effects', effect.id])
    splitField(effect, 'acquired', ['effects', effect.id])
    splitField(effect, 'actived', ['effects', effect.id])
  }
  for (const event of Object.values(config.events)) {
    normalizeCommon(event, ['events', event.id])
    for (const node of Object.values(event.nodes)) {
      const nodePath = ['events', event.id, 'nodes', node.id]
      normalizeCommon(node, nodePath)
      if (node.type === 'check') continue
      splitField(node, 'required', nodePath, true)
      splitField(node, 'choices', nodePath)
      for (const choice of Object.values(node.choicesValue)) {
        const choicePath = [...nodePath, 'choicesValue', choice.id]
        normalizeCommon(choice, choicePath)
        if (node.type === 'multiple') splitField(choice, 'maxCount', choicePath, true)
      }
      if (node.type === 'multiple') {
        for (const command of Object.values(node.commands)) {
          normalizeCommon(command, [...nodePath, 'commands', command.id])
        }
      }
    }
  }
}

const deltaKeys = ['health', 'warmth', 'food', 'fuel', 'medicine', 'parts', 'morale', 'survivors', 'knowledge', 'signal']
/** 将稀疏属性变化转换为 event.resolve 的固定参数序列。 */
function resolve(eventId, effectId, deltas = {}) {
  return action('event.resolve', eventId, effectId ?? null, ...deltaKeys.map((key) => deltas[key] ?? 0))
}

/** 将路线值和稀疏属性变化转换为 event.resolve-route 调用。 */
function routeResolve(eventId, routeValue, effectId, deltas = {}) {
  return action('event.resolve-route', eventId, routeValue, effectId ?? null, ...deltaKeys.map((key) => deltas[key] ?? 0))
}

const characters = {
  survivor: {
    ...common('survivor', '曙光避难所', 1, {
      tags: ['player', 'settlement'],
      description: '你与同行者共同维持的移动避难所。',
    }),
    attributes: {
      health: numberAttribute('health', '健康', 1, 10, 0, 10, { tags: ['survival'] }),
      warmth: numberAttribute('warmth', '温暖', 2, 7, 0, 10, { tags: ['survival'] }),
      food: numberAttribute('food', '食物', 3, 7, 0, 30, { tags: ['resource'] }),
      fuel: numberAttribute('fuel', '燃料', 4, 6, 0, 30, { tags: ['resource'] }),
      medicine: numberAttribute('medicine', '药品', 5, 1, 0, 20, { tags: ['resource'] }),
      parts: numberAttribute('parts', '零件', 6, 0, 0, 30, { tags: ['resource'] }),
      morale: numberAttribute('morale', '士气', 7, 5, 0, 10, { tags: ['community'] }),
      survivors: numberAttribute('survivors', '幸存者', 8, 2, 1, 20, { tags: ['community'] }),
      knowledge: numberAttribute('knowledge', '极寒知识', 9, 0, 0, 20, { tags: ['progress'] }),
      signal: numberAttribute('signal', '无线电信号', 10, 0, 0, 10, { tags: ['progress'] }),
      route: enumAttribute('route', '已确认路线', 11, 0, ['未确认', '地下热源', '黑冰河道'], { tags: ['progress'] }),
      ending: enumAttribute('ending', '终局', 12, 0, ['尚未决定', '曙光列车', '地热城', '共同体远征', '孤身越过白夜'], { tags: ['ending'] }),
    },
  },
  world: {
    ...common('world', '冰封世界', 2, { tags: ['world'] }),
    attributes: {
      temperature: numberAttribute('temperature', '室外温度', 1, -28, -70, 0, { tags: ['climate'] }),
      storm: enumAttribute('storm', '风暴等级', 2, 0, ['寂静', '飘雪', '暴风', '终末白障'], { tags: ['climate'] }),
    },
  },
}

const effects = {
  'insulated-coat': effect('insulated-coat', '真空保温衣', 1, '降低每回合的失温速度。', { bindCharacterId: 'survivor' }),
  'coal-stove': effect('coal-stove', '铸铁煤炉', 2, '消耗燃料，为避难所维持稳定热量。', {
    bindCharacterId: 'survivor',
    reactionList: [{ watch: { source: 'self', path: ['acquired'] }, from: false, to: true, action: action('state.change', 'survivor', 'warmth', 2) }],
  }),
  'hand-crank-radio': effect('hand-crank-radio', '手摇无线电', 3, '接收远方幸存者与曙光列车的信号。', {
    reactionList: [{ watch: rule('turn.is-start'), from: false, to: true, action: action('radio.listen') }],
  }),
  'field-medicine': effect('field-medicine', '极地医疗箱', 4, '让有限的药品能处理冻伤与感染。'),
  sled: effect('sled', '加固雪橇', 5, '能够运输重型零件并穿过深雪。'),
  'loyal-dog': effect('loyal-dog', '雪原伙伴', 6, '在危险检查中预警，并维持士气。', {
    reactionList: [{ watch: rule('turn.is-start'), from: false, to: true, action: action('effect.turn-bonus', 'loyal-dog', 'morale', 1) }],
  }),
  'solar-battery': effect('solar-battery', '极光蓄电池', 7, '在极光下为无线电与设备供电。'),
  'geothermal-map': effect('geothermal-map', '地热管线图', 8, '标记通往城市地下热源的旧维护隧道。'),
  'seed-case': effect('seed-case', '休眠种子匣', 9, '携带文明重建所需的种子。'),
  community: effect('community', '共同体契约', 10, '幸存者承诺共享物资、风险与未来。', {
    reactionList: [{ watch: { source: 'self', path: ['acquired'] }, from: false, to: true, action: action('state.change', 'survivor', 'morale', 2) }],
  }),
  frostbite: effect('frostbite', '冻伤', 11, '温暖过低时出现，并在首次恶化时损伤健康。', {
    tags: ['condition'],
    acquired: reactive(false, 'status.at-most', 'survivor', 'warmth', 2),
    actived: reactive(false, 'status.at-most', 'survivor', 'warmth', 2),
    bindCharacterId: 'survivor',
    reactionList: [{ watch: { source: 'self', path: ['actived'] }, from: false, to: true, action: action('state.change', 'survivor', 'health', -2) }],
  }),
  starvation: effect('starvation', '饥饿', 12, '食物耗尽前的持续警告。', {
    tags: ['condition'],
    acquired: reactive(false, 'status.at-most', 'survivor', 'food', 1),
    actived: reactive(false, 'status.at-most', 'survivor', 'food', 1),
    bindCharacterId: 'survivor',
    reactionList: [{ watch: { source: 'self', path: ['actived'] }, from: false, to: true, action: action('state.change', 'survivor', 'morale', -2) }],
  }),
  'storm-warning': effect('storm-warning', '风暴预警', 13, '能够提前判断白障与安全窗口。'),
  hope: effect('hope', '白夜里的希望', 14, '当士气足够高时，所有人相信世界仍有明天。', {
    tags: ['condition', 'community'],
    acquired: reactive(false, 'status.at-least', 'survivor', 'morale', 8),
    actived: reactive(false, 'status.at-least', 'survivor', 'morale', 8),
    reactionList: [],
  }),
  'whiteout-cycle': effect('whiteout-cycle', '极寒循环', 15, '每回合开始推进气温、风暴和避难所消耗；前六回合气温下降 2 度，第七回合起下降 4 度。', {
    tags: ['world', 'condition'],
    acquired: true,
    actived: true,
    reactionList: [{ watch: rule('turn.is-start'), from: false, to: true, action: action('world.turn-start') }],
  }),
}

const events = {}
const addEvent = (event) => { events[event.id] = event }

addEvent(gameEvent(
  'shelter-maintenance',
  '避难所值夜',
  1,
  1,
  '每个回合都在这里决定如何抵抗寒潮。',
  [
    singleNode('watch', '炉火与铁皮', 1, '风从车厢接缝里灌入。你只能在燃料、修缮与睡眠之间选择一项。', [
      choice('light-stove', '安装铸铁煤炉', 1, resolve('shelter-maintenance', 'coal-stove', { fuel: -1, warmth: 3 }), { enabled: reactive(true, 'resource.at-least', 'survivor', 'fuel', 1) }),
      choice('patch-walls', '用零件封住裂缝', 2, resolve('shelter-maintenance', null, { parts: -1, warmth: 2, morale: 1 }), { enabled: reactive(false, 'resource.at-least', 'survivor', 'parts', 1) }),
      choice('sleep-close', '挤在一起熬过这一夜', 3, resolve('shelter-maintenance', null, { health: 1, warmth: -1, morale: -1 })),
    ]),
  ],
  {
    tags: ['home'],
  },
))

addEvent(gameEvent('frozen-supermarket', '冰封超市', 2, 1, '在倒塌货架间寻找第一批关键物资。', [
  checkNode('search', '搜索货架', 1, ['stocked', 'picked-clean'], action('event.random-goto', 'frozen-supermarket', 'stocked', 'picked-clean', 0.62)),
  singleNode('stocked', '冷库仍然完整', 2, '密封门后堆着冻硬的罐头，保安室里还挂着一件真空保温衣。', [
    choice('take-coat', '穿上保温衣', 1, resolve('frozen-supermarket', 'insulated-coat', { food: 2, warmth: 1 })),
    choice('take-food', '尽可能搬走食物', 2, resolve('frozen-supermarket', null, { food: 6 })),
  ]),
  singleNode('picked-clean', '只剩冰壳', 3, '这里早已被洗劫，只在收银台下找到一小包糖。', [
    choice('take-sugar', '把糖分给大家', 1, resolve('frozen-supermarket', null, { food: 1, morale: 1 })),
  ]),
], { entryNodeId: 'search' }))

addEvent(gameEvent('collapsed-pharmacy', '坍塌药房', 3, 1, '冰层下传来断续的求救声。', [
  singleNode('entrance', '药房废墟', 1, '药柜与承重梁叠在一起。救人会消耗体力，搜药则可能错过声音的主人。', [
    choice('rescue', '先救出被困者', 1, action('event.goto', 'collapsed-pharmacy', 'rescue-room')),
    choice('loot', '先取走能用的药', 2, resolve('collapsed-pharmacy', 'field-medicine', { medicine: 3, morale: -1 })),
  ]),
  singleNode('rescue-room', '冰下的医生', 2, '被困者是一名急救医生。她愿意带着医疗箱加入避难所。', [
    choice('welcome', '欢迎她同行', 1, resolve('collapsed-pharmacy', 'field-medicine', { medicine: 2, survivors: 1, morale: 1, health: -1 })),
  ]),
]))

addEvent(gameEvent('radio-tower', '倾斜的无线电塔', 4, 2, '塔顶天线仍在极光中闪烁。', [
  singleNode('base', '结冰的检修梯', 1, '检修梯随风摆动。爬上去能修复信号，也可能让你暴露在风中。', [
    choice('climb', '带零件爬上塔顶', 1, action('event.goto', 'radio-tower', 'signal-check'), { enabled: reactive(false, 'resource.at-least', 'survivor', 'parts', 1) }),
    choice('salvage', '拆下底部设备', 2, resolve('radio-tower', null, { parts: 2 })),
  ]),
  checkNode('signal-check', '校准频率', 2, ['clear-signal', 'static'], action('event.random-goto', 'radio-tower', 'clear-signal', 'static', 0.7)),
  singleNode('clear-signal', '来自南方的呼号', 3, '手摇机里有人重复播报：“曙光列车，第十日前穿越白障。”', [
    choice('record', '带走无线电与坐标', 1, resolve('radio-tower', 'hand-crank-radio', { parts: -1, signal: 3, knowledge: 1 })),
  ]),
  singleNode('static', '只有静电雪', 4, '天线在最后一次放电后熄灭，但你拆下了可用的调谐器。', [
    choice('salvage-tuner', '拆下调谐器', 1, resolve('radio-tower', 'hand-crank-radio', { parts: 1, signal: 1 })),
  ]),
]))

addEvent(gameEvent('buried-workshop', '雪下维修厂', 5, 2, '深雪掩埋了一间公共维修厂。', [
  multipleNode('bench', '散落的工作台', 1, '选择要从冰层里撬出的零件。至少找到三件材料，才能加固一辆雪橇。', [
    multipleChoice('runner', '钢制滑轨', 1, 'runner', 2),
    multipleChoice('rope', '耐寒绳索', 2, 'rope', 2),
    multipleChoice('bearing', '密封轴承', 3, 'bearing', 2),
  ], [
    command('craft', '组装加固雪橇', 1, action('event.selection-resolve', 'buried-workshop', 'bench', 'parts', 1, 'sled'), { enabled: reactive(false, 'selection.total-at-least', 'buried-workshop', 'bench', 3) }),
    command('carry', '只带走零件', 2, action('event.selection-resolve', 'buried-workshop', 'bench', 'parts', 1, null)),
  ]),
]))

addEvent(gameEvent('stranded-convoy', '搁浅车队', 6, 2, '一列客车被积雪困在高架路上。', [
  singleNode('meeting', '车窗后的目光', 1, '车队仍有燃料，也有十几名饥饿的人。他们不相信陌生人。', [
    choice('share', '分享食物并提出结盟', 1, action('event.goto', 'stranded-convoy', 'pact'), { enabled: reactive(false, 'resource.at-least', 'survivor', 'food', 3) }),
    choice('barter', '用药品换取燃料', 2, resolve('stranded-convoy', null, { medicine: -1, fuel: 5 }), { enabled: reactive(false, 'resource.at-least', 'survivor', 'medicine', 1) }),
  ]),
  singleNode('pact', '第一份共同体契约', 2, '车队领队把路线图摊在引擎盖上。物资与风险从此共同承担。', [
    choice('sign', '签下契约', 1, resolve('stranded-convoy', 'community', { food: -3, survivors: 2, morale: 2, fuel: 2 })),
  ]),
]))

addEvent(gameEvent('wolf-tracks', '雪狼足迹', 7, 3, '一串足迹绕着避难所走了整夜。', [
  checkNode('follow', '跟踪足迹', 1, ['injured-dog', 'wolf-pack'], action('event.random-goto', 'wolf-tracks', 'injured-dog', 'wolf-pack', 0.55)),
  singleNode('injured-dog', '并不是狼', 2, '脚印尽头是一只拖着断绳的雪橇犬。它警惕，却没有离开。', [
    choice('feed', '用一份食物换取信任', 1, resolve('wolf-tracks', 'loyal-dog', { food: -1, morale: 2 }), { enabled: reactive(false, 'resource.at-least', 'survivor', 'food', 1) }),
    choice('leave', '留下食物后离开', 2, resolve('wolf-tracks', null, { food: -1, morale: 1 })),
  ]),
  singleNode('wolf-pack', '灰影围拢', 3, '真正的狼群从雪坡后出现。你只能丢下食物撤退，或冒险驱赶。', [
    choice('distract', '丢下食物撤退', 1, resolve('wolf-tracks', null, { food: -2, warmth: -1 })),
    choice('drive-off', '点燃信号棒驱赶', 2, resolve('wolf-tracks', null, { health: -1, morale: 1 })),
  ]),
], { entryNodeId: 'follow' }))

addEvent(gameEvent('ice-fisher', '黑冰上的渔人', 8, 3, '孤独的渔人知道冰层下仍有活水。', [
  multipleNode('holes', '选择冰洞', 1, '浅洞安全但收获有限，深洞需要更多时间。选择尝试次数。', [
    multipleChoice('shallow', '浅水冰洞', 1, 'shallow', 3),
    multipleChoice('deep', '深水冰洞', 2, 'deep', 2),
  ], [
    command('fish', '收线并返回', 1, action('event.fish', 'ice-fisher', 'holes')),
    command('leave', '向渔人道谢', 2, resolve('ice-fisher', null, { knowledge: 1 })),
  ]),
]))

addEvent(gameEvent('geothermal-vent', '地热排气井', 9, 3, '融雪形成一条通往地下管线的黑色沟渠。', [
  checkNode('inspect', '检测蒸汽', 1, ['stable-vent', 'toxic-vent'], action('event.random-goto', 'geothermal-vent', 'stable-vent', 'toxic-vent', 0.66)),
  singleNode('stable-vent', '地下仍有热流', 2, '旧检修箱里保存着完整的地热管线图，远处隧道传来水泵声。', [
    choice('map', '抄录管线图', 1, resolve('geothermal-vent', 'geothermal-map', { warmth: 3, knowledge: 2 })),
  ]),
  singleNode('toxic-vent', '硫化物泄漏', 3, '蒸汽让人眩晕，但标牌仍指明了地下维护区的位置。', [
    choice('mark', '标记入口后撤离', 1, resolve('geothermal-vent', 'geothermal-map', { health: -1, knowledge: 1 })),
  ]),
], { entryNodeId: 'inspect' }))

addEvent(gameEvent('abandoned-school', '寂静学校', 10, 4, '体育馆曾是临时安置点，黑板上留着最后一课。', [
  singleNode('hall', '写满名字的体育馆', 1, '储藏室、图书馆和地下室分别传来不同的声音。', [
    choice('library', '搜索图书馆', 1, resolve('abandoned-school', null, { knowledge: 3, morale: 1 })),
    choice('basement', '打开地下室', 2, action('event.goto', 'abandoned-school', 'children')),
  ]),
  singleNode('children', '留下来的人', 2, '四名幸存者守着一台坏掉的发电机。他们只想加入一个不会抛下人的队伍。', [
    choice('welcome', '邀请他们加入', 1, resolve('abandoned-school', 'community', { survivors: 2, morale: 1, food: -2 })),
  ]),
]))

addEvent(gameEvent('fuel-depot', '军用燃料库', 11, 4, '仓库门被冰压住，警告灯仍在闪。', [
  checkNode('door', '撬开安全门', 1, ['sealed-tanks', 'leaking-tanks'], action('event.random-goto', 'fuel-depot', 'sealed-tanks', 'leaking-tanks', 0.6)),
  singleNode('sealed-tanks', '完好的低温燃料', 2, '罐体压力稳定，足够支持数日远行。', [
    choice('pump', '抽取燃料', 1, resolve('fuel-depot', null, { fuel: 8, parts: 1 })),
  ]),
  singleNode('leaking-tanks', '刺鼻的白雾', 3, '主罐已经泄漏，只能拆走报警器与少量燃料。', [
    choice('salvage', '拆走报警模块', 1, resolve('fuel-depot', 'storm-warning', { fuel: 2, parts: 2, health: -1 })),
  ]),
], { entryNodeId: 'door' }))

addEvent(gameEvent('weather-station', '高原气象站', 12, 4, '自动站仍在记录一场不断增长的超级风暴。', [
  singleNode('console', '十日预报', 1, '数据表明第十日将出现覆盖整个盆地的白障。屋顶太阳板还能修复。', [
    choice('forecast', '下载风暴模型', 1, resolve('weather-station', 'storm-warning', { knowledge: 3, signal: 1 })),
    choice('battery', '修复极光蓄电池', 2, resolve('weather-station', 'solar-battery', { parts: -2, knowledge: 1 }), { enabled: reactive(false, 'resource.at-least', 'survivor', 'parts', 2) }),
  ]),
]))

addEvent(gameEvent('seed-vault', '永冻种子库', 13, 5, '电子锁后保存着仍可发芽的旧世界作物。', [
  singleNode('lock', '备用电源接口', 1, '只有稳定电源能在不破坏低温密封的情况下打开库门。', [
    choice('power', '接入极光蓄电池', 1, action('event.goto', 'seed-vault', 'vault')),
  ]),
  singleNode('vault', '沉睡的春天', 2, '数千枚种子静静躺在银色匣中，等待一个尚不存在的春天。', [
    choice('carry', '带走核心种子匣', 1, resolve('seed-vault', 'seed-case', { morale: 2, knowledge: 2 })),
  ]),
], { requiredEffect: 'solar-battery' }))

addEvent(gameEvent('tunnel-entrance', '地热维护隧道', 14, 5, '管线图指向一扇埋在地铁站下的防爆门。', [
  checkNode('open', '启动老旧水泵', 1, ['warm-tunnel', 'cave-in'], action('event.random-goto', 'tunnel-entrance', 'warm-tunnel', 'cave-in', 0.72)),
  singleNode('warm-tunnel', '向下的暖风', 2, '隧道深处传来机器的低鸣。这里可能通往一座仍有热源的地下城。', [
    choice('mark-route', '确认地下路线', 1, routeResolve('tunnel-entrance', 1, null, { knowledge: 2, warmth: 2 })),
  ]),
  singleNode('cave-in', '塌方后的回声', 3, '入口暂时无法通过，但你确认了另一条绕行管线。', [
    choice('record-route', '记录绕行路线', 1, routeResolve('tunnel-entrance', 1, null, { parts: -1, knowledge: 1 }), { enabled: reactive(true, 'resource.at-least', 'survivor', 'parts', 1) }),
  ]),
], { entryNodeId: 'open', requiredEffect: 'geothermal-map' }))

addEvent(gameEvent('silent-chapel', '无声礼拜堂', 15, 5, '彩窗结满霜花，长椅上摆着陌生人留下的姓名牌。', [
  singleNode('altar', '为失去的人留一盏灯', 1, '这里没有物资，只有片刻安静。同行者等待你说些什么。', [
    choice('promise', '承诺把所有名字带到春天', 1, resolve('silent-chapel', null, { morale: 3 })),
    choice('rest', '安静休息一会儿', 2, resolve('silent-chapel', null, { health: 2, warmth: 1 })),
  ]),
]))

addEvent(gameEvent('aurora-night', '极光之夜', 16, 6, '无线电在极光干扰中捕捉到多个遥远呼号。', [
  singleNode('frequency', '谁在呼叫', 1, '北方地下城、南方列车与河谷营地同时占据频段。你只能优先确认一条消息。', [
    choice('train', '确认曙光列车坐标', 1, resolve('aurora-night', null, { signal: 4, knowledge: 1 })),
    choice('settlement', '联络河谷营地', 2, resolve('aurora-night', 'community', { signal: 2, morale: 2 })),
  ]),
], { requiredEffect: 'hand-crank-radio' }))

addEvent(gameEvent('drone-wreck', '勘探无人机残骸', 17, 6, '重型残骸卡在雪谷中，徒手无法运回。', [
  singleNode('cargo', '冻结的货舱', 1, '雪橇可以拖走电池或结构件，但超载会拖慢队伍。', [
    choice('battery', '拖走实验蓄电池', 1, resolve('drone-wreck', 'solar-battery', { parts: 2, warmth: -1 })),
    choice('frame', '拆解结构件', 2, resolve('drone-wreck', null, { parts: 6, warmth: -2 })),
  ]),
], { requiredEffect: 'sled' }))

addEvent(gameEvent('refugee-camp', '河谷难民营', 18, 7, '数十人挤在风障后等待一支愿意共享未来的队伍。', [
  multipleNode('allocation', '分配救援物资', 1, '选择交给营地的食物与药品。每一份物资都能让一名幸存者加入，但资源不足会让整个处理单元回滚。', [
    multipleChoice('food-aid', '一份食物', 1, 'food', 4),
    multipleChoice('medicine-aid', '一份药品', 2, 'medicine', 3),
  ], [
    command('recruit', '确认救援与合流', 1, action('event.recruit', 'refugee-camp', 'allocation')),
    command('promise', '只交换路线情报', 2, resolve('refugee-camp', null, { knowledge: 2, morale: -1 })),
  ]),
], { requiredEffect: 'community' }))

addEvent(gameEvent('black-ice-river', '黑冰河道', 19, 8, '气象模型显示河道可能在白障中形成唯一的低风速走廊。', [
  checkNode('crossing', '测试承重', 1, ['safe-channel', 'fracture'], action('event.random-goto', 'black-ice-river', 'safe-channel', 'fracture', 0.64)),
  singleNode('safe-channel', '冰下水声', 2, '雪橇能沿河道快速南下，黑冰也会把任何失误放大。', [
    choice('mark', '确认河道路线', 1, routeResolve('black-ice-river', 2, null, { knowledge: 2, morale: 1 })),
  ]),
  singleNode('fracture', '裂纹追着脚步', 3, '队伍及时撤回，但一部分补给沉入黑水。', [
    choice('retreat', '标记危险区后撤离', 1, routeResolve('black-ice-river', 2, null, { food: -1, health: -1, knowledge: 1 })),
  ]),
], { entryNodeId: 'crossing', requiredEffect: 'storm-warning' }))

addEvent(gameEvent('final-whiteout', '终末白障', 20, FINAL_TURN, '第十日，超级风暴吞没盆地。所有构建与关系在此汇成一条去路。', [
  singleNode('decision', '在白色世界中选择方向', 1, '无线电、地热图、共同体与河道都指向不同的未来。未满足条件的路线仍会显示，但无法选择。', [
    choice('train', '追上曙光列车', 1, action('ending.prepare', 'final-whiteout', 'train-ending', 1), { enabled: reactive(false, 'ending.available', 'train') }),
    choice('underground', '进入地热地下城', 2, action('ending.prepare', 'final-whiteout', 'underground-ending', 2), { enabled: reactive(false, 'ending.available', 'underground') }),
    choice('community', '带领共同体远征', 3, action('ending.prepare', 'final-whiteout', 'community-ending', 3), { enabled: reactive(false, 'ending.available', 'community') }),
    choice('alone', '独自越过白夜', 4, action('ending.prepare', 'final-whiteout', 'alone-ending', 4), { enabled: reactive(true, 'ending.available', 'alone') }),
  ]),
  singleNode('train-ending', '曙光列车', 2, '手摇无线电穿透静电雪，极光蓄电池让信号持续到最后一刻。钢轨震动起来，灯火从白障中一节节出现。', [
    choice('finish', '登上向南的列车', 1, action('ending.commit', 'final-whiteout')),
  ]),
  singleNode('underground-ending', '地热城', 3, '你沿管线图打开最后一道防爆门。暖湿空气涌出，地下泵站里的人为新来者腾出位置。', [
    choice('finish', '关上门，守住热源', 1, action('ending.commit', 'final-whiteout')),
  ]),
  singleNode('community-ending', '共同体远征', 4, '没有一辆车能独自穿过风暴，但车队首尾相连。种子、孩子、病人和地图都被放在队伍中央。', [
    choice('finish', '一起驶入白夜', 1, action('ending.commit', 'final-whiteout')),
  ]),
  singleNode('alone-ending', '白夜独行', 5, '你把剩余物资留给避难所，沿黑冰或记忆中的方向出发。身后的灯逐渐消失，前方仍没有答案。', [
    choice('finish', '越过最后一道雪脊', 1, action('ending.commit', 'final-whiteout')),
  ]),
]))

const config = {
  meta: {
    id: 'frostbound',
    name: '白夜余烬',
    version: '1.0.0',
    background: '极寒末日后的第十日，经营移动避难所、连接幸存者与设施，在终末白障到来前构建一条可活下去的路线。',
    maxTurnCountPerRun: 24,
  },
  characters,
  effects,
  events,
}

function authoredActions(node) {
  if (node.type === 'check') return [node.check]
  const calls = []
  if (node.type === 'single') {
    const choices = node.choicesValue
    for (const item of Object.values(choices)) calls.push(item.action)
  }
  if (node.type === 'multiple') for (const item of Object.values(node.commands)) calls.push(item.action)
  return calls
}

/** 审计 Frostbound 的规模、节点可达性和跨事件前置依赖。 */
function assertPackage() {
  if (Object.keys(config.effects).length < 10) throw new Error('Frostbound requires at least 10 Effects')
  if (Object.keys(config.events).length < 20) throw new Error('Frostbound requires at least 20 Events')
  if (FINAL_TURN < 10) throw new Error('Frostbound must span at least 10 turns')
  if (characters.survivor.attributes.ending.valueDisplay.length - 1 < 3) throw new Error('Frostbound requires at least 3 endings')

  const effectSources = new Map()
  for (const event of Object.values(config.events)) {
    const reached = new Set([event.entryNodeId])
    const pending = [event.entryNodeId]
    while (pending.length > 0) {
      const nodeId = pending.shift()
      const node = event.nodes[nodeId]
      const targets = node.type === 'check' ? Object.keys(node.candidateNodes) : []
      for (const call of authoredActions(node)) {
        if (call.key === 'event.goto') targets.push(call.args[1])
        if (call.key === 'ending.prepare') targets.push(call.args[1])
        const effectId = call.key === 'event.resolve'
          ? call.args[1]
          : call.key === 'event.resolve-route'
            ? call.args[2]
            : call.key === 'event.selection-resolve'
              ? call.args[4]
              : null
        if (typeof effectId === 'string') {
          const sources = effectSources.get(effectId) ?? new Set()
          sources.add(event.id)
          effectSources.set(effectId, sources)
        }
      }
      for (const target of targets) {
        if (!event.nodes[target]) throw new Error(`${event.id}.${node.id} points to missing node ${target}`)
        if (!reached.has(target)) { reached.add(target); pending.push(target) }
      }
    }
    const unreachable = Object.keys(event.nodes).filter((id) => !reached.has(id))
    if (unreachable.length > 0) throw new Error(`${event.id} has unreachable nodes: ${unreachable.join(', ')}`)
  }

  const reachableEvents = new Set()
  const reachableEffects = new Set(
    Object.values(config.effects)
      .filter((effect) => effect.acquiredValue === true)
      .map((effect) => effect.id),
  )
  reachableEffects.add('frostbite')
  reachableEffects.add('starvation')
  reachableEffects.add('hope')
  let changed = true
  while (changed) {
    changed = false
    for (const event of Object.values(config.events)) {
      const requiredEffect = event.unlocked.args[2]
      if (reachableEvents.has(event.id) || (requiredEffect !== null && !reachableEffects.has(requiredEffect))) continue
      reachableEvents.add(event.id)
      changed = true
      for (const [effectId, sources] of effectSources) {
        if (sources.has(event.id)) reachableEffects.add(effectId)
      }
    }
  }
  const unreachableEvents = Object.keys(config.events).filter((id) => !reachableEvents.has(id))
  const unreachableEffects = Object.keys(config.effects).filter((id) => !reachableEffects.has(id))
  if (unreachableEvents.length > 0) throw new Error(`Unreachable events: ${unreachableEvents.join(', ')}`)
  if (unreachableEffects.length > 0) throw new Error(`Unreachable effects: ${unreachableEffects.join(', ')}`)
}

normalizeConfig(config)
assertPackage()
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`)
console.log(`wrote ${output}: ${Object.keys(effects).length} effects, ${Object.keys(events).length} events, 4 endings, final turn ${FINAL_TURN}`)
