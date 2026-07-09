import type { Effect, EffectKind } from '../types'

const kindLabels: Record<EffectKind, string> = {
  tag: '标签',
  counter: '计数',
  buff: '增益',
  debuff: '减益',
  equipment: '装备',
  building: '建筑',
  plant: '植物',
  pet: '灵宠',
  tech: '功法',
  passive: '被动',
}

interface EffectPanelProps {
  effects: Effect[]
}

export function EffectPanel({ effects }: EffectPanelProps) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">完整模型状态</p>
          <h2>效果</h2>
        </div>
        <span className="count">{effects.filter((effect) => effect.acquired).length} / {effects.length}</span>
      </div>
      <div className="effect-grid">
        {effects.map((effect) => (
          <article
            className={`effect-card kind-${effect.kind} ${effect.acquired ? 'is-acquired' : 'is-inactive'}`}
            key={effect.id}
          >
            <div className="effect-heading">
              <span className="kind-label">{kindLabels[effect.kind]}</span>
              <div className="status-dots" aria-label="效果状态">
                {!effect.unlocked && <span title="未解锁">锁</span>}
                {effect.appeared && <span title="已出现">现</span>}
                {effect.acquired && <span title="已获取">得</span>}
              </div>
            </div>
            <h3>{effect.name}</h3>
            <p>{effect.description}</p>
            <dl className="compact-data">
              <div><dt>等级</dt><dd>{effect.level}</dd></div>
              <div><dt>层数</dt><dd>{effect.stacks}</dd></div>
              <div><dt>数值</dt><dd>{effect.value}</dd></div>
              <div>
                <dt>持续</dt>
                <dd>
                  {effect.duration?.type ?? '—'}
                  {effect.duration?.remaining !== null && effect.duration?.remaining !== undefined
                    ? ` (${effect.duration.remaining})`
                    : ''}
                </dd>
              </div>
            </dl>
            <p className="id-text">{effect.id}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
