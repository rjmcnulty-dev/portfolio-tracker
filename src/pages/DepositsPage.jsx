import { useMemo, useState } from 'react'
import { useDeposits } from '../hooks/useDeposits'
import { useDepositSchedules } from '../hooks/useDepositSchedules'
import { useAccounts } from '../hooks/useAccounts'
import DepositsTable from '../components/DepositsTable'
import DepositSchedulesTable from '../components/DepositSchedulesTable'
import DepositForm from '../components/DepositForm'
import DepositScheduleForm from '../components/DepositScheduleForm'

function formatCurrency(value) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function DepositsPage() {
  const [accountFilter, setAccountFilter] = useState('All')
  const [showDepositForm, setShowDepositForm] = useState(false)
  const [editingDeposit, setEditingDeposit] = useState(null)
  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState(null)
  const [syncMessage, setSyncMessage] = useState(null)

  const { accounts } = useAccounts()

  const {
    deposits,
    loading: depositsLoading,
    error: depositsError,
    refetch: refetchDeposits,
    deleteDeposit,
  } = useDeposits(accountFilter)

  const {
    schedules,
    loading: schedulesLoading,
    error: schedulesError,
    refetch: refetchSchedules,
    deleteSchedule,
    materializeNow,
  } = useDepositSchedules(accountFilter)

  const totalDeposited = useMemo(
    () => deposits.reduce((sum, d) => sum + (Number(d.amount) || 0), 0),
    [deposits],
  )
  const activeScheduleCount = useMemo(() => schedules.filter((s) => s.active).length, [schedules])

  function openAddDeposit() {
    setEditingDeposit(null)
    setShowDepositForm(true)
  }

  function openEditDeposit(deposit) {
    setEditingDeposit(deposit)
    setShowDepositForm(true)
  }

  function openAddSchedule() {
    setEditingSchedule(null)
    setShowScheduleForm(true)
  }

  function openEditSchedule(schedule) {
    setEditingSchedule(schedule)
    setShowScheduleForm(true)
  }

  async function handleSyncNow() {
    setSyncing(true)
    setSyncError(null)
    setSyncMessage(null)
    try {
      const result = await materializeNow()
      setSyncMessage(result?.message ?? 'Recurring deposits synced.')
      await refetchDeposits()
    } catch (err) {
      setSyncError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="page">
      <header className="page__header page__header--row">
        <div>
          <h1>Deposits</h1>
          <p className="page__subtitle">
            Cash deposits across accounts, including auto-generated recurring contributions.
          </p>
        </div>
        <div className="filters">
          <label>
            Account
            <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
              <option value="All">All</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="kpi-row">
        <div className="kpi-card">
          <span className="kpi-card__label">Total Deposited</span>
          <span className="kpi-card__value">{formatCurrency(totalDeposited)}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card__label">Active Recurring Schedules</span>
          <span className="kpi-card__value">{activeScheduleCount}</span>
        </div>
      </div>

      <section className="page__section">
        <header className="page__header page__header--row">
          <h2>Recurring Schedules</h2>
          <div className="filters">
            <button className="btn btn--ghost" disabled={syncing} onClick={handleSyncNow}>
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
            <button className="btn btn--primary" onClick={openAddSchedule}>
              + Add Recurring Deposit
            </button>
          </div>
        </header>
        {syncError && <p className="page__error">{syncError}</p>}
        {syncMessage && !syncError && <p className="success-message">{syncMessage}</p>}
        {schedulesError && <p className="page__error">Error: {schedulesError}</p>}
        {schedulesLoading ? (
          <p className="page__loading">Loading schedules…</p>
        ) : (
          <DepositSchedulesTable
            schedules={schedules}
            showAccount={accountFilter === 'All'}
            onEdit={openEditSchedule}
            onDelete={deleteSchedule}
          />
        )}
      </section>

      <section className="page__section">
        <header className="page__header page__header--row">
          <h2>Deposit History</h2>
          <button className="btn btn--primary" onClick={openAddDeposit}>
            + Add One-Time Deposit
          </button>
        </header>
        {depositsError && <p className="page__error">Error: {depositsError}</p>}
        {depositsLoading ? (
          <p className="page__loading">Loading deposits…</p>
        ) : (
          <DepositsTable
            deposits={deposits}
            showAccount={accountFilter === 'All'}
            onEdit={openEditDeposit}
            onDelete={deleteDeposit}
          />
        )}
      </section>

      {showDepositForm && (
        <DepositForm deposit={editingDeposit} onClose={() => setShowDepositForm(false)} onSaved={refetchDeposits} />
      )}
      {showScheduleForm && (
        <DepositScheduleForm
          schedule={editingSchedule}
          onClose={() => setShowScheduleForm(false)}
          onSaved={refetchSchedules}
        />
      )}
    </div>
  )
}
