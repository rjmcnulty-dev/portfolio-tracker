import './TradeSchedulesTable.css'

function formatCurrency(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

const FREQUENCY_LABELS = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
}

export default function TradeSchedulesTable({ schedules, showAccount = true, onEdit, onDelete }) {
  if (!schedules.length) {
    return <div className="trade-schedules__empty">No recurring trades set up yet.</div>
  }

  return (
    <div className="trade-schedules-wrap">
      <table className="trade-schedules">
        <thead>
          <tr>
            {showAccount && <th>Account</th>}
            <th>Ticker</th>
            <th className="is-numeric">Amount</th>
            <th>Frequency</th>
            <th>Start</th>
            <th>End</th>
            <th>Status</th>
            <th>Notes</th>
            {(onEdit || onDelete) && <th></th>}
          </tr>
        </thead>
        <tbody>
          {schedules.map((schedule) => (
            <tr key={schedule.id}>
              {showAccount && (
                <td>
                  <span className="account-badge">{schedule.account}</span>
                </td>
              )}
              <td className="trade-schedules__ticker">{schedule.ticker}</td>
              <td className="is-numeric">{formatCurrency(schedule.dollar_amount)}</td>
              <td>{FREQUENCY_LABELS[schedule.frequency] ?? schedule.frequency}</td>
              <td>{schedule.start_date}</td>
              <td>{schedule.end_date ?? '—'}</td>
              <td>
                <span className={`source-badge ${schedule.active ? 'source-badge--recurring' : 'source-badge--manual'}`}>
                  {schedule.active ? 'Active' : 'Paused'}
                </span>
              </td>
              <td>{schedule.notes || '—'}</td>
              {(onEdit || onDelete) && (
                <td className="row-actions">
                  {onEdit && (
                    <button className="btn-link" onClick={() => onEdit(schedule)}>
                      Edit
                    </button>
                  )}
                  {onDelete && (
                    <button className="btn-link btn-link--danger" onClick={() => onDelete(schedule.id)}>
                      Delete
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
