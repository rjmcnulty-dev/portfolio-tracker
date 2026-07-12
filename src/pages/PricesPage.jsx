import TickerPrices from '../components/TickerPrices'

export default function PricesPage() {
  return (
    <div className="page">
      <header className="page__header">
        <h1>Prices</h1>
        <p className="page__subtitle">
          Prices refresh automatically on weekdays via Twelve Data. Use Update Price to set one
          manually — for example, right after adding a trade or for a ticker Twelve Data doesn't cover.
        </p>
      </header>
      <TickerPrices />
    </div>
  )
}
