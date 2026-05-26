import { Resend } from 'resend'
import { formatCurrency } from '@/lib/utils/formatCurrency'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'noreply@tlcmortgage.sg'
const FROM = `The Loan Connection <${FROM_EMAIL}>`
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://property.tlcmortgage.sg'

interface FollowUpReminderParams {
    agentEmail: string
    agentName: string
    clientName: string
    clientMobile: string
    caseId: string
    bankName?: string | null
    projectedAgentIncome?: number | null
    lockInPeriod?: number | null
}

export async function sendFollowUpReminder(params: FollowUpReminderParams): Promise<void> {
    const { agentEmail, agentName, clientName, clientMobile, caseId, bankName, projectedAgentIncome, lockInPeriod } = params

    const caseUrl = `${APP_URL}/property/cases/${caseId}`
    const followupUrl = `${APP_URL}/property/followup`

    const lockInText = lockInPeriod
        ? `Their <strong>${lockInPeriod}-year lock-in period</strong> is ending soon — now is the right time to reach out.`
        : "Their mortgage lock-in period is ending soon — now is the right time to reach out."

    const incomeText = projectedAgentIncome
        ? `Your estimated refinancing commission is <strong>${formatCurrency(projectedAgentIncome)}</strong>.`
        : 'This is a great opportunity to re-engage your client for refinancing.'

    await resend.emails.send({
        from: FROM,
        to: agentEmail,
        subject: `Follow-up reminder: Call ${clientName} today`,
        html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#059669,#047857);padding:32px 40px;">
            <p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Follow-Up Reminder</p>
            <h1 style="margin:8px 0 0;color:white;font-size:22px;font-weight:700;">Time to call ${clientName}</h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">Hi ${agentName},</p>
            <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
              Today is the follow-up date you set for your client <strong>${clientName}</strong>. ${lockInText}
            </p>
            <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">${incomeText}</p>

            <!-- Client details box -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:24px;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 12px;color:#065f46;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Client Details</p>
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="color:#374151;font-size:14px;padding-bottom:6px;padding-right:24px;"><strong>${clientName}</strong></td>
                    </tr>
                    <tr>
                      <td style="color:#6b7280;font-size:14px;padding-bottom:6px;">${clientMobile}</td>
                    </tr>
                    ${bankName ? `<tr><td style="color:#6b7280;font-size:13px;">${bankName} mortgage</td></tr>` : ''}
                  </table>
                  ${projectedAgentIncome ? `
                  <p style="margin:16px 0 0;color:#065f46;font-size:13px;">
                    Projected commission: <strong style="font-size:16px;">${formatCurrency(projectedAgentIncome)}</strong>
                  </p>` : ''}
                </td>
              </tr>
            </table>

            <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
              Once you've connected with ${clientName}, mark this follow-up as done in your portal.
            </p>

            <!-- CTAs -->
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-right:12px;">
                  <a href="${caseUrl}" style="display:inline-block;padding:12px 24px;background:#059669;color:white;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">
                    View Case &rarr;
                  </a>
                </td>
                <td>
                  <a href="${followupUrl}" style="display:inline-block;padding:12px 24px;background:#f0fdf4;color:#059669;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;border:1px solid #bbf7d0;">
                    My Follow-Ups
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">The TLC Team &middot; You set yourself as the follow-up owner for this case.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
    })
}
