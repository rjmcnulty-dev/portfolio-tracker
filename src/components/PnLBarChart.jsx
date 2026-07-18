import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

function formatCurrency(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function PnLBarChart({ data }) {
  if (!data.length) {
    return (
      <div className="chart-card">
        <h3 className="chart-card__title">Realized vs Unrealized P&L</h3>
        <p className="chart-card__empty">No trades yet.</p>
      </div>
    )
  }

  return (
    <div className="chart-card">
      <h3 className="chart-card__title">Realized vs Unrealized P&L</h3>
      <ResponsiveContainer width="100%" height={Math.max(280, data.length * 40)}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e9ee" horizontal={false} />
          <XAxis type="number" stroke="var(--text-muted)" fontSize={12} tickFormatter={formatCurrency} />
          <YAxis type="category" dataKey="ticker" stroke="var(--text-muted)" fontSize={12} width={64} />
          <Tooltip
            formatter={(value, name) => [formatCurrency(value), name]}
            contentStyle={{ background: 'var(--navy-mid)', border: 'none', borderRadius: 8, color: '#fff' }}
          />
          <Legend />
          <Bar dataKey="realized" name="Realized" fill="var(--blue)" radius={[0, 4, 4, 0]} />
          <Bar dataKey="unrealized" name="Unrealized" fill="var(--gold)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
