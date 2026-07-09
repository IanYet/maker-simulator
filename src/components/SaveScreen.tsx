import type { ValidationWarning } from '../game/validation'
import type { SaveRecord } from '../game/persistence'

interface SaveScreenProps {
  contentId: string
  contentVersion: string
  saves: SaveRecord[]
  warnings: ValidationWarning[]
  busy: boolean
  onCreate: (name: string) => void
  onOpen: (record: SaveRecord) => void
  onDelete: (record: SaveRecord) => void
}

export function SaveScreen({
  contentId,
  contentVersion,
  saves,
  warnings,
  busy,
  onCreate,
  onOpen,
  onDelete,
}: SaveScreenProps) {
  const createSave = (formData: FormData) => {
    const name = String(formData.get('name') ?? '').trim()
    onCreate(name || `修行存档 ${saves.length + 1}`)
  }

  return (
    <main className="page save-page">
      <header className="hero">
        <p className="eyebrow">回合制玩法验证</p>
        <h1>Maker Simulator</h1>
        <p className="muted">
          内容 <code>{contentId}</code> · 版本 {contentVersion}
        </p>
      </header>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">开始</p>
            <h2>创建玩家存档</h2>
          </div>
        </div>
        <form action={createSave} className="create-save-form">
          <label>
            <span>存档名称</span>
            <input name="name" maxLength={40} placeholder="例如：第一次修行" disabled={busy} />
          </label>
          <button className="primary" disabled={busy}>创建存档</button>
        </form>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">本机数据</p>
            <h2>已有存档</h2>
          </div>
          <span className="count">{saves.length}</span>
        </div>
        {saves.length === 0 ? (
          <p className="empty-state">还没有存档。创建后会保存到当前浏览器。</p>
        ) : (
          <div className="save-list">
            {saves.map((record) => {
              const compatible = record.contentVersion === contentVersion
              return (
                <article className="save-card" key={record.saveId}>
                  <div>
                    <h3>{record.name}</h3>
                    <p className="muted">
                      已开始 {record.saveData.meta.runs ?? 0} 局 ·
                      {' '}{new Date(record.updatedAt).toLocaleString('zh-CN')}
                    </p>
                    {!compatible && <p className="warning-text">内容版本不兼容：{record.contentVersion}</p>}
                  </div>
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={busy || !compatible}
                      onClick={() => onOpen(record)}
                    >
                      进入
                    </button>
                    <button className="danger-quiet" disabled={busy} onClick={() => onDelete(record)}>
                      删除
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {warnings.length > 0 && (
        <details className="panel warning-panel">
          <summary>内容警告（{warnings.length}）</summary>
          <ul>
            {warnings.map((warning) => (
              <li key={`${warning.path}:${warning.message}`}>
                <code>{warning.path}</code>：{warning.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  )
}
