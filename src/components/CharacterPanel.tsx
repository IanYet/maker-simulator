import type { Character } from '../types'

/** 角色属性面板组件参数。 */
interface CharacterPanelProps {
  /** 当前局内角色数据。 */
  character: Character
}

/**
 * 展示当前启用的角色属性。
 *
 * @param props - 角色属性面板组件参数。
 * @param props.character - 当前局内角色数据。
 * @returns 角色属性面板。
 */
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
        {Object.entries(character.attributes)
          .filter(([, attribute]) => attribute.enabled)
          .map(([id, attribute]) => {
            const hasRange = typeof attribute.value === 'number'
              && attribute.min !== undefined
              && attribute.max !== undefined
            const hasBounds = attribute.min !== undefined || attribute.max !== undefined
            const range = hasRange ? attribute.max! - attribute.min! : 0
            const progress = hasRange
              ? (range === 0 ? 100 : ((attribute.value as number) - attribute.min!) / range * 100)
              : 0
            const bounds = attribute.min === undefined
              ? `≤ ${attribute.max}`
              : attribute.max === undefined
                ? `≥ ${attribute.min}`
                : `${attribute.min} — ${attribute.max}`

            return (
              <article className="attribute-card" key={id}>
                <div className="attribute-title">
                  <span>{attribute.displayName}</span>
                  <strong>{String(attribute.value)}</strong>
                </div>
                {hasRange && (
                  <div className="meter" aria-label={`${attribute.displayName}: ${attribute.value}`}>
                    <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
                  </div>
                )}
                {hasBounds && <small>{bounds}</small>}
                <p className="id-text">{id}</p>
              </article>
            )
          })}
      </div>
    </section>
  )
}
