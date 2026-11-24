/**
 * Earnings statement (PDF) for one month or year: commission earned on cases closed
 * in the period, and what TLC actually paid in the period (the payout ledger).
 * The two differ whenever a case is paid in a later period, so both are shown.
 * Pure — tested in __tests__/earningsStatement.test.ts.
 */

export interface StatementCase { client: string; caseType: string; closedOn: string; loan: number; gross: number; fee: number; share: number; paid: number }
export interface StatementPayout { client: string; paidOn: string; amount: number; reference: string | null; reversal: boolean }
export interface StatementInput {
    agentName: string
    period: string          // 'YYYY-MM' | 'YYYY'
    preparedOn: string      // YYYY-MM-DD
    cases: StatementCase[]
    payouts: StatementPayout[]
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const isPeriod = (s: string) => /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(s)
export const periodLabel = (p: string) => (p.length === 4 ? p : `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`)
/** First and last day of the period. */
export function periodRange(p: string): { from: string; to: string } {
    if (p.length === 4) return { from: `${p}-01-01`, to: `${p}-12-31` }
    const last = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5)), 0)).getUTCDate()
    return { from: `${p}-01`, to: `${p}-${String(last).padStart(2, '0')}` }
}

const cents = (n: number) => Math.round(n * 100) / 100
export function statementTotals(s: Pick<StatementInput, 'cases' | 'payouts'>) {
    const earned = cents(s.cases.reduce((a, c) => a + c.share, 0))
    const received = cents(s.payouts.reduce((a, p) => a + p.amount, 0))
    const awaiting = cents(s.cases.reduce((a, c) => a + (c.share - c.paid), 0))
    return { earned, received, awaiting }
}

const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

export function statementHtml(s: StatementInput): string {
    const t = statementTotals(s)
    const label = periodLabel(s.period)
    const none = (cols: number, text: string) => `<tr><td colspan="${cols}" class="none">${text}</td></tr>`
    const cases = s.cases.map(c => `<tr><td>${esc(c.client)}</td><td>${esc(c.caseType)}</td><td>${dmy(c.closedOn)}</td><td class="r">${money(c.loan)}</td><td class="r">${money(c.gross)}</td><td class="r">${c.fee > 0 ? money(-c.fee) : '-'}</td><td class="r b">${money(c.share)}</td></tr>`).join('')
    const pays = s.payouts.map(p => `<tr><td>${dmy(p.paidOn)}</td><td>${esc(p.client)}${p.reversal ? ' (reversal)' : ''}</td><td>${esc(p.reference ?? '-')}</td><td class="r b">${money(p.amount)}</td></tr>`).join('')
    return `<!doctype html><html><head><meta charset="utf-8"><title>Earnings statement</title><style>
*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:11px;margin:0}
h1{font-size:20px;color:#052d4a;margin:0 0 4px}h2{font-size:13px;color:#052d4a;margin:22px 0 6px}
.sub{color:#64748b;margin:0}.top{display:flex;justify-content:space-between;border-bottom:2px solid #052d4a;padding-bottom:12px}
.tiles{display:flex;gap:10px;margin-top:14px}.tile{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:10px}
.tile b{display:block;font-size:16px;color:#052d4a;margin-top:3px}.tile span{color:#64748b}
table{width:100%;border-collapse:collapse}th{text-align:left;background:#f1f5f9;color:#475569;font-size:9px;text-transform:uppercase;padding:6px}
td{padding:6px;border-bottom:1px solid #e2e8f0}tr{page-break-inside:avoid}.r{text-align:right}.b{font-weight:bold}.none{color:#94a3b8;text-align:center;padding:14px}
.note{color:#64748b;margin-top:22px;line-height:1.5}</style></head><body>
<div class="top"><div><h1>Earnings statement</h1><p class="sub">${esc(s.agentName)}</p></div><div class="r"><p class="b" style="margin:0;font-size:13px">${label}</p><p class="sub">The Loan Connection · TLC HUB</p></div></div>
<div class="tiles"><div class="tile"><span>Commission earned</span><b>${money(t.earned)}</b><span>${s.cases.length} case${s.cases.length === 1 ? '' : 's'} closed</span></div>
<div class="tile"><span>Received from TLC</span><b>${money(t.received)}</b><span>paid in this period</span></div>
<div class="tile"><span>Awaiting payout</span><b>${money(t.awaiting)}</b><span>on the cases listed, as at ${dmy(s.preparedOn)}</span></div></div>
<h2>Cases closed in ${label}</h2><table><thead><tr><th>Client</th><th>Type</th><th>Closed</th><th class="r">Loan</th><th class="r">Gross</th><th class="r">Correction fee</th><th class="r">Your share</th></tr></thead><tbody>${cases || none(7, 'No cases closed in this period.')}</tbody></table>
<h2>Payouts received in ${label}</h2><table><thead><tr><th>Paid on</th><th>Client</th><th>Reference</th><th class="r">Amount</th></tr></thead><tbody>${pays || none(4, 'No payouts in this period.')}</tbody></table>
<p class="note">Earned counts cases by the date they were marked Closed Won. Received counts payouts by the date TLC paid them, so a case can be earned in one period and received in another. Gross is 0.15% of the loan; your share is 90% of gross, less any correction fee. Prepared ${dmy(s.preparedOn)}.</p>
</body></html>`
}
