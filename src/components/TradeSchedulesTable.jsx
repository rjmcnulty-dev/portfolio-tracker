import { Fragment, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
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

export default function TradeSchedulesTable({ schedules, trades = [], showAccount = true, onEdit, onDelete }) {
  const [confirmingSchedule, setConfirmingSchedule] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  if (!schedules.length) {
    return <div className="trade-schedules__empty">No recurring trades set up yet.</div>
  }

  const columnCount = (showAccount ? 1 : 0) + 6 + (onEdit || onDelete ? 1 : 0)

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
          {schedules.map((schedule) => {
            const isExpanded = expandedId === schedule.id
            const occurrences = isExpanded
              ? trades
                  .filter((t) => t.schedule_id === schedule.id)
                  .sort((a, b) => a.trade_date.localeCompare(b.trade_date))
              : []

            return (
              <Fragment key={schedule.id}>
                <tr>
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
                      <button
                        className="btn-link"
                        onClick={() => setExpandedId(isExpanded ? null : schedule.id)}
                      >
                        {isExpanded ? 'Hide' : 'Details'}
                      </button>
                      {onEdit && (
                        <button className="btn-link" onClick={() => onEdit(schedule)}>
                          Edit
                        </button>
                      )}
                      {onDelete && (
                        <button className="btn-link btn-link--danger" onClick={() => setConfirmingSchedule(schedule)}>
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                {isExpanded && (
                  <tr className="trade-schedules__detail-row">
                    <td colSpan={columnCount}>
                      {occurrences.length ? (
                        <div className="trade-schedules__detail">
                          <table className="trade-schedules__detail-table">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th className="is-numeric">Quantity</th>
                                <th className="is-numeric">Price</th>
                                <th className="is-numeric">Cost Basis</th>
                                <th>Notes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {occurrences.map((trade) => (
                                <tr key={trade.id}>
                                  <td>{trade.trade_date}</td>
                                  <td className="is-numeric">{trade.quantity}</td>
                                  <td className="is-numeric">{formatCurrency(trade.price)}</td>
                                  <td className="is-numeric">{formatCurrency(trade.cost_basis)}</td>
                                  <td>{trade.notes || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="trade-schedules__detail-summary">
                            {occurrences.length} trade{occurrences.length === 1 ? '' : 's'} materialized, totaling{' '}
                            {formatCurrency(occurrences.reduce((sum, t) => sum + (Number(t.cost_basis) || 0), 0))}
                          </p>
                        </div>
                      ) : (
                        <p className="trade-schedules__detail-empty">No trades materialized from this schedule yet.</p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {confirmingSchedule && (
        <ConfirmDialog
          title="Delete recurring trade?"
          message={`Delete the ${formatCurrency(confirmingSchedule.dollar_amount)} ${FREQUENCY_LABELS[confirmingSchedule.frequency]?.toLowerCase() ?? confirmingSchedule.frequency} ${confirmingSchedule.ticker} schedule for ${confirmingSchedule.account}? Already-materialized trades are not affected.`}
          onCancel={() => setConfirmingSchedule(null)}
          onConfirm={() => {
            onDelete(confirmingSchedule.id)
            setConfirmingSchedule(null)
          }}
        />
      )}
    </div>
  )
}
