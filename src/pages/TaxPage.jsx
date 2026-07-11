import TaxHeadroom from '../components/TaxHeadroom'
import RothProgress from '../components/RothProgress'

export default function TaxPage() {
  return (
    <div className="page">
      <header className="page__header">
        <h1>Tax &amp; Roth Conversion</h1>
        <p className="page__subtitle">Track bracket headroom and multi-year Roth conversion progress.</p>
      </header>
      <div className="tax-grid">
        <TaxHeadroom />
        <RothProgress />
      </div>
    </div>
  )
}
