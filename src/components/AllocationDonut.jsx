import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

const COLORS = ['#F0A500', '#2a78d6', '#1baf7a', '#3B5068', '#e34948', '#8ab4d8', '#c98a1f', '#6b7280']

export default function AllocationDonut({ allocation }) {
  if (!allocation.length) {
    return (
      <div className="chart-card">
        <h3 className="chart-card__title">Allocation by Ticker</h3>
        <p className="chart-card__empty">No holdings yet.</p>
      </div>
    )
  }

  return (
    <div className="chart-card">
      <h3 className="chart-card__title">Allocation by Ticker</h3>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie data={allocation} dataKey="value" nameKey="ticker" innerRadius={70} outerRadius={110} paddingAngle={2}>
            {allocation.map((entry, index) => (
              <Cell key={entry.ticker} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name, props) => [`${props.payload.pct.toFixed(1)}%`, name]}
            contentStyle={{ background: 'var(--navy-mid)', border: 'none', borderRadius: 8, color: '#fff' }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
