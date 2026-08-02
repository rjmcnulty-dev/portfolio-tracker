import { Fragment, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import './DepositsTable.css'

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

export default function DepositSchedulesTable({ schedules, deposits = [], showAccount = true, onEdit, onDelete }) {
  const [confirmingSchedule, setConfirmingSchedule] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  if (!schedules.length) {
    return <div className="deposits-table__empty">No recurring deposits set up yet.</div>
  }

  const columnCount = (showAccount ? 1 : 0) + 7 + (onEdit || onDelete ? 1 : 0)

  return (
    <div className="deposits-table-wrap">
      <table className="deposits-table">
        <thead>
          <tr>
            {showAccount && <th>Account</th>}
            <th className="is-numeric">Amount</th>
            <th>Frequency</th>
            <th>Start</th>
            <th>End</th>
            <th>Type</th>
            <th>Status</th>
            <th>Notes</th>
            {(onEdit || onDelete) && <th></th>}
          </tr>
        </thead>
        <tbody>
          {schedules.map((schedule) => {
            const isExpanded = expandedId === schedule.id
            const occurrences = isExpanded
              ? deposits
                  .filter((d) => d.schedule_id === schedule.id)
                  .sort((a, b) => a.deposit_date.localeCompare(b.deposit_date))
              : []

            return (
              <Fragment key={schedule.id}>
                <tr>
                  {showAccount && (
                    <td>
                      <span className="account-badge">{schedule.account}</span>
                    </td>
                  )}
                  <td className="is-numeric">{formatCurrency(schedule.amount)}</td>
                  <td>{FREQUENCY_LABELS[schedule.frequency] ?? schedule.frequency}</td>
                  <td>{schedule.start_date}</td>
                  <td>{schedule.end_date ?? '—'}</td>
                  <td>{schedule.deposit_type ?? '—'}</td>
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
                  <tr className="deposits-table__detail-row">
                    <td colSpan={columnCount}>
                      {occurrences.length ? (
                        <div className="deposits-table__detail">
                          <table className="deposits-table__detail-table">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th className="is-numeric">Amount</th>
                                <th>Type</th>
                                <th>Notes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {occurrences.map((deposit) => (
                                <tr key={deposit.id}>
                                  <td>{deposit.deposit_date}</td>
                                  <td className="is-numeric">{formatCurrency(deposit.amount)}</td>
                                  <td>{deposit.deposit_type ?? '—'}</td>
                                  <td>{deposit.notes || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="deposits-table__detail-summary">
                            {occurrences.length} deposit{occurrences.length === 1 ? '' : 's'} materialized, totaling{' '}
                            {formatCurrency(occurrences.reduce((sum, d) => sum + (Number(d.amount) || 0), 0))}
                          </p>
                        </div>
                      ) : (
                        <p className="deposits-table__detail-empty">No deposits materialized from this schedule yet.</p>
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
          title="Delete recurring deposit?"
          message={`Delete the ${formatCurrency(confirmingSchedule.amount)} ${FREQUENCY_LABELS[confirmingSchedule.frequency]?.toLowerCase() ?? confirmingSchedule.frequency} schedule for ${confirmingSchedule.account}? Already-materialized deposits are not affected.`}
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
