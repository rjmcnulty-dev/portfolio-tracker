function formatCurrency(value) {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function pnlClass(value) {
  if (value > 0) return 'kpi-card__value--positive'
  if (value < 0) return 'kpi-card__value--negative'
  return ''
}

export default function KPIRow({ kpis, cashPosition }) {
  const cards = [
    { label: 'Cash Position', value: cashPosition, colorClass: pnlClass(cashPosition) },
    { label: 'Invested', value: kpis.invested },
    { label: 'Market Value', value: kpis.marketValue },
    { label: 'Unrealized P&L', value: kpis.unrealizedPnl, colorClass: pnlClass(kpis.unrealizedPnl) },
    { label: 'Realized P&L', value: kpis.realizedPnl, colorClass: pnlClass(kpis.realizedPnl) },
    { label: 'Total P&L', value: kpis.totalPnl, colorClass: pnlClass(kpis.totalPnl) },
  ]

  return (
    <div className="kpi-row">
      {cards.map((card) => (
        <div className="kpi-card" key={card.label}>
          <span className="kpi-card__label">{card.label}</span>
          <span className={`kpi-card__value ${card.colorClass ?? ''}`}>{formatCurrency(card.value)}</span>
        </div>
      ))}
    </div>
  )
}
