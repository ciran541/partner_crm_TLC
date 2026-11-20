import { Resend } from 'resend'

/**
 * The client reminder email — sent by the daily insurance follow-up job, ONLY
 * for a Closed Won case whose agent ticked "Client agreed to receive a
 * reminder", once, on the follow-up date (see reminderDue() in
 * lib/insurance/followUps.ts).
 *
 * Goes to the AGENT'S client, from TLC's address, with the agent as reply-to,
 * so the client's reply reaches the person who looks after them.
 *
 * Wording: draft for business sign-off (2026-11-20). It avoids promising
 * savings or that a review is free — keep it that way unless the business
 * approves the claim.
 */

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'noreply@tlcmortgage.sg'
const FROM = `The Loan Connection <${FROM_EMAIL}>`

export interface ClientLoanReminderParams {
    to: string
    clientName: string
    agentName: string
    agentMobile?: string | null
    agentEmail?: string | null
    bank?: string | null
    /** YYYY-MM-DD, when known. */
    lockInEnd?: string | null
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export function clientLoanReminderContent(p: ClientLoanReminderParams): { subject: string; html: string; text: string } {
    const first = p.clientName.trim().split(/\s+/)[0] || 'there'
    const agent = p.agentName.trim() || 'Your loan specialist'
    const loanWith = p.bank ? ` with ${p.bank}` : ''
    const lockIn = p.lockInEnd ? ` Your current lock-in period ends on ${fmtDate(p.lockInEnd)}.` : ''

    const subject = `Time to review your home loan, ${first}`
    const intro = `When you took up your home loan${loanWith}, you asked us to remind you when it was time to review it.${lockIn}`
    const why = 'Once a lock-in period ends, the interest rate on many loans goes up. Reviewing your loan before then gives you time to compare what banks are offering and decide whether to reprice or refinance.'
    const next = `${agent} will be in touch to go through your options. If you'd like to talk sooner, you can reach them directly:`
    const contact = [p.agentMobile && `Mobile: ${p.agentMobile}`, p.agentEmail && `Email: ${p.agentEmail}`].filter(Boolean) as string[]
    const footer = `You're receiving this because you agreed to a reminder from ${agent} at The Loan Connection. If you'd rather not get these, just reply and let us know.`

    const text = [`Hi ${first},`, '', intro, '', why, '', next, ...contact, '', 'The Loan Connection', '', footer].join('\n')

    const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#052d4a;padding:28px 36px;">
          <p style="margin:0;color:rgba(255,255,255,0.75);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">The Loan Connection</p>
          <h1 style="margin:8px 0 0;color:white;font-size:21px;font-weight:700;">Time to review your home loan</h1>
        </td></tr>
        <tr><td style="padding:28px 36px;color:#334155;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 14px;">Hi ${esc(first)},</p>
          <p style="margin:0 0 14px;">${esc(intro)}</p>
          <p style="margin:0 0 14px;">${esc(why)}</p>
          <p style="margin:0 0 10px;">${esc(next)}</p>
          ${contact.length ? `<table cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:#f1f5f9;border-radius:8px;width:100%;"><tr><td style="padding:14px 16px;">
            <p style="margin:0 0 4px;font-weight:700;color:#052d4a;">${esc(agent)}</p>
            ${contact.map(c => `<p style="margin:0;color:#475569;font-size:14px;">${esc(c)}</p>`).join('')}
          </td></tr></table>` : ''}
          <p style="margin:0;">The Loan Connection</p>
        </td></tr>
        <tr><td style="padding:16px 36px 24px;border-top:1px solid #f1f5f9;color:#94a3b8;font-size:12px;line-height:1.5;">${esc(footer)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

    return { subject, html, text }
}

/** Throws on failure, so the caller can leave the reminder un-marked and retry tomorrow. */
export async function sendClientLoanReminder(p: ClientLoanReminderParams): Promise<void> {
    const { subject, html, text } = clientLoanReminderContent(p)
    const { error } = await resend.emails.send({
        from: FROM,
        to: p.to,
        replyTo: p.agentEmail || undefined,
        subject,
        html,
        text,
    })
    if (error) throw new Error(error.message)
}
