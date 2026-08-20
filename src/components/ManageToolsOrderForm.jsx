import './TradeForm.css'
import './ManageToolsOrderForm.css'

// Reordering only — unlike ManageAccountsForm, the Tools list is a fixed set
// of app routes, not user-created rows, so there's nothing to add or delete
// here, and the reorder itself is a synchronous local/localStorage update
// (see Layout's handleMoveTool), not an async DB call — no loading/error
// state needed around it.
export default function ManageToolsOrderForm({ tools, onClose, onMove }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal__title">Manage Tools Order</h2>

        <ul className="manage-tools__list">
          {tools.map((tool, index) => (
            <li key={tool.key} className="manage-tools__item">
              <div className="manage-tools__reorder">
                <button
                  type="button"
                  className="manage-tools__reorder-btn"
                  disabled={index === 0}
                  onClick={() => onMove(tool.key, 'up')}
                  aria-label={`Move ${tool.label} up`}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="manage-tools__reorder-btn"
                  disabled={index === tools.length - 1}
                  onClick={() => onMove(tool.key, 'down')}
                  aria-label={`Move ${tool.label} down`}
                >
                  ▼
                </button>
              </div>
              <span className="manage-tools__name">{tool.label}</span>
            </li>
          ))}
        </ul>

        <div className="trade-form__actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
