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

export default function KPIRow({ kpis }) {
  const cards = [
    { label: 'Invested', value: kpis.invested },
    { label: 'Market Value', value: kpis.marketValue },
    { label: 'Unrealized P&L', value: kpis.unrealizedPnl, signed: true },
    { label: 'Realized P&L', value: kpis.realizedPnl, signed: true },
    { label: 'Total P&L', value: kpis.totalPnl, signed: true },
  ]

  return (
    <div className="kpi-row">
      {cards.map((card) => (
        <div className="kpi-card" key={card.label}>
          <span className="kpi-card__label">{card.label}</span>
          <span className={`kpi-card__value ${card.signed ? pnlClass(card.value) : ''}`}>
            {formatCurrency(card.value)}
          </span>
        </div>
      ))}
    </div>
  )
}
