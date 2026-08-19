import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

function formatCurrency(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// Recharts' default Legend derives one swatch per <Bar> from its own `fill`,
// which can't represent per-row sign-based coloring. The `payload` prop is
// meant to override that, but Recharts still merges it with its own
// auto-generated payload in some versions — rendering our own markup via
// `content` sidesteps that entirely.
function PnLLegend() {
  const items = [
    { label: 'Realized (gain)', color: 'var(--blue)' },
    { label: 'Realized (loss)', color: '#000' },
    { label: 'Unrealized (gain)', color: 'var(--gold)' },
    { label: 'Unrealized (loss)', color: 'var(--red)' },
  ]
  return (
    <ul
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 16,
        padding: 0,
        margin: '8px 0 0',
        listStyle: 'none',
      }}
    >
      {items.map((item) => (
        <li key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-primary)' }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  )
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
          <Legend content={<PnLLegend />} />
          <Bar dataKey="realized" name="Realized" fill="var(--blue)" radius={[0, 4, 4, 0]}>
            {data.map((entry) => (
              <Cell key={entry.ticker} fill={entry.realized < 0 ? '#000' : 'var(--blue)'} />
            ))}
          </Bar>
          <Bar dataKey="unrealized" name="Unrealized" fill="var(--gold)" radius={[0, 4, 4, 0]}>
            {data.map((entry) => (
              <Cell key={entry.ticker} fill={entry.unrealized < 0 ? 'var(--red)' : 'var(--gold)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
