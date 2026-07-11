export const ACCOUNTS = [
  { slug: 'robinhood', label: 'Robinhood' },
  { slug: 'traditional-ira', label: 'Traditional IRA' },
  { slug: 'roth-ira', label: 'Roth IRA' },
]

export function accountLabelFromSlug(slug) {
  const found = ACCOUNTS.find((account) => account.slug === slug)
  return found ? found.label : 'All'
}
