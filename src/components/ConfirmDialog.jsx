import './ConfirmDialog.css'

export default function ConfirmDialog({ title = 'Are you sure?', message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        // Stop here even though this overlay's own click closes the dialog —
        // ConfirmDialog is sometimes nested inside another modal's overlay
        // (e.g. ManageAccountsForm), and without this the click would bubble
        // up and close that parent modal too.
        event.stopPropagation()
        onCancel()
      }}
    >
      <div className="modal confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal__title">{title}</h2>
        {message && <p className="confirm-dialog__message">{message}</p>}
        <div className="confirm-dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
