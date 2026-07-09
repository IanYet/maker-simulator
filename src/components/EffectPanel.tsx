import type { Effect, EffectKindDefinition } from '../types'

interface EffectPanelProps {
  effects: Effect[]
  effectKinds: EffectKindDefinition[]
}

export function EffectPanel({ effects, effectKinds }: EffectPanelProps) {
  const kindLabels = new Map(effectKinds.map((kind) => [kind.id, kind.displayName]))

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
              <span className="kind-label">{kindLabels.get(effect.kind) ?? effect.kind}</span>
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
