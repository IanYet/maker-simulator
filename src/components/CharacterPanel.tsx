import type { Character } from '../types'

const attributeNames: Record<string, string> = {
  health: '生命',
  spiritual_power: '灵力',
  body: '体魄',
  comprehension: '悟性',
  karma: '因果',
  reputation: '声望',
  spirit_stones: '灵石',
  action_point: '行动点',
}

interface CharacterPanelProps {
  character: Character
}

export function CharacterPanel({ character }: CharacterPanelProps) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">角色 · {character.id}</p>
          <h2>当前属性</h2>
        </div>
      </div>
      <div className="attribute-grid">
        {Object.entries(character.attributes).map(([id, attribute]) => {
          const range = attribute.max - attribute.min
          const progress = range === 0 ? 100 : ((attribute.value - attribute.min) / range) * 100
          return (
            <article className="attribute-card" key={id}>
              <div className="attribute-title">
                <span>{attributeNames[id] ?? id}</span>
                <strong>{attribute.value}</strong>
              </div>
              <div className="meter" aria-label={`${id}: ${attribute.value}`}>
                <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
              </div>
              <small>{attribute.min} — {attribute.max}</small>
            </article>
          )
        })}
      </div>
    </section>
  )
}
