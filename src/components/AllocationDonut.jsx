import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

const COLORS = ['#F0A500', '#2a78d6', '#1baf7a', '#3B5068', '#e34948', '#8ab4d8', '#c98a1f', '#6b7280']
const CASH_COLOR = '#9aa5b1'

// Sized by original investment (cost basis), not current market value — see
// usePortfolio's investmentAllocation. Cash is always the first entry
// (usePortfolio puts it there), and startAngle/endAngle below make the pie
// start that first slice at 12 o'clock and sweep clockwise, so "first in the
// data" reliably means "drawn at the top" rather than depending on Recharts'
// less obvious default (3 o'clock, counterclockwise).
export default function AllocationDonut({ allocation }) {
  if (!allocation.length) {
    return (
      <div className="chart-card">
        <h3 className="chart-card__title">Allocation by Investment</h3>
        <p className="chart-card__empty">No holdings yet.</p>
      </div>
    )
  }

  return (
    <div className="chart-card">
      <h3 className="chart-card__title">Allocation by Investment</h3>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={allocation}
            dataKey="value"
            nameKey="ticker"
            innerRadius={70}
            outerRadius={110}
            paddingAngle={2}
            startAngle={90}
            endAngle={-270}
          >
            {allocation.map((entry, index) => (
              <Cell
                key={entry.ticker}
                fill={entry.ticker === 'Cash' ? CASH_COLOR : COLORS[(index - 1) % COLORS.length]}
              />
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
