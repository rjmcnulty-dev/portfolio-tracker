import { useState } from 'react'
import WatchlistCard from './WatchlistCard'
import './TickerLink.css'

// Turns a plain ticker cell into a quick-look popup — WatchlistCard's
// modalOnly mode renders it straight into its expanded chart modal, so this
// gets the exact same chart/indicator toolkit as Stock Watch and Portfolio
// Stocks for free, not a second implementation.
export default function TickerLink({ ticker, className }) {
  const [showModal, setShowModal] = useState(false)

  return (
    <>
      <button type="button" className={`ticker-link ${className ?? ''}`} onClick={() => setShowModal(true)}>
        {ticker}
      </button>
      {showModal && <WatchlistCard item={{ id: ticker, ticker }} modalOnly onClose={() => setShowModal(false)} />}
    </>
  )
}
