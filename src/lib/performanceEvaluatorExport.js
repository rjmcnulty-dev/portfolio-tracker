// Renders the Performance Evaluator's result rows to a downloadable PDF or
// Word (.docx) file, entirely client-side (no Edge Function involved).
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  WidthType,
  ShadingType,
} from 'docx'

const NAVY_RGB = [31, 45, 61]
const GREEN_RGB = [27, 175, 122]
const RED_RGB = [227, 73, 72]
const MUTED_RGB = [107, 114, 128]

const NAVY_HEX = '1F2D3D'
const GREEN_HEX = '1BAF7A'
const RED_HEX = 'E34948'
const MUTED_HEX = '6B7280'

const DISCLAIMER =
  'A rule of thumb combining your price targets with SMA20/50/200 trend and support/resistance — not investment advice.'

const COLUMNS = ['Ticker', 'Price', 'Target', 'Upside', '1mo', '3mo', '6mo', '12mo', 'Trend', 'Suggestion', 'Reasons']
const SUGGESTION_COLUMN_INDEX = 9

function formatCurrency(value) {
  const num = Number(value)
  if (Number.isNaN(num) || value == null) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function formatPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function suggestionColor(suggestion, palette) {
  if (suggestion === 'Buy') return palette.green
  if (suggestion === 'Sell') return palette.red
  return palette.muted
}

function rowToCells(row) {
  return [
    row.ticker,
    formatCurrency(row.currentPrice),
    formatCurrency(row.targetPrice),
    formatPct(row.upsidePct),
    formatPct(row.returns?.['1m']),
    formatPct(row.returns?.['3m']),
    formatPct(row.returns?.['6m']),
    formatPct(row.returns?.['12m']),
    row.trend,
    row.suggestion,
    row.reasons.join('; '),
  ]
}

function buildFilename(title, ext) {
  const stamp = new Date().toISOString().slice(0, 10)
  const safeTitle = title ? `-${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')}` : ''
  return `performance-evaluation${safeTitle}-${stamp}.${ext}`
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function exportPerformanceEvaluatorPdf(rows, title) {
  const doc = new jsPDF({ orientation: 'landscape' })

  doc.setFontSize(16)
  doc.setTextColor(...NAVY_RGB)
  doc.text(`Performance Evaluator${title ? ` — ${title}` : ''}`, 14, 16)

  doc.setFontSize(9)
  doc.setTextColor(...MUTED_RGB)
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 22)
  doc.text(DISCLAIMER, 14, 27)

  autoTable(doc, {
    startY: 32,
    head: [COLUMNS],
    body: rows.map(rowToCells),
    styles: { fontSize: 8, cellPadding: 2, valign: 'middle' },
    headStyles: { fillColor: NAVY_RGB, textColor: 255 },
    columnStyles: { [SUGGESTION_COLUMN_INDEX]: { fontStyle: 'bold' }, 10: { cellWidth: 80 } },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === SUGGESTION_COLUMN_INDEX) {
        data.cell.styles.textColor = suggestionColor(data.cell.raw, { green: GREEN_RGB, red: RED_RGB, muted: MUTED_RGB })
      }
    },
  })

  doc.save(buildFilename(title, 'pdf'))
}

function headerCell(text) {
  return new TableCell({
    shading: { fill: NAVY_HEX, type: ShadingType.CLEAR, color: 'auto' },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 16 })] })],
  })
}

function bodyCell(text, { color, bold } = {}) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: text || '—', color, bold, size: 18 })] })],
  })
}

export async function exportPerformanceEvaluatorDocx(rows, title) {
  const headerRow = new TableRow({ tableHeader: true, children: COLUMNS.map(headerCell) })
  const bodyRows = rows.map((row) => {
    const cells = rowToCells(row)
    return new TableRow({
      children: cells.map((value, index) =>
        index === SUGGESTION_COLUMN_INDEX
          ? bodyCell(value, { color: suggestionColor(row.suggestion, { green: GREEN_HEX, red: RED_HEX, muted: MUTED_HEX }), bold: true })
          : bodyCell(value),
      ),
    })
  })

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`Performance Evaluator${title ? ` — ${title}` : ''}`)] }),
          new Paragraph({
            children: [new TextRun({ text: `Generated ${new Date().toLocaleString()}`, italics: true, color: MUTED_HEX, size: 18 })],
          }),
          new Paragraph({
            children: [new TextRun({ text: DISCLAIMER, italics: true, color: MUTED_HEX, size: 16 })],
            spacing: { after: 200 },
          }),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] }),
        ],
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  downloadBlob(blob, buildFilename(title, 'docx'))
}
