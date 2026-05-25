import { Resend } from 'resend'
import { formatCurrency } from '@/lib/utils/formatCurrency'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = process.env.RESEND_FROM_EMAIL ?? 'TLC <noreply@tlcmortgage.sg>'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://property.tlcmortgage.sg'

interface OpportunityAlertParams {
  agentEmail: string
  agentName: string
  clientName: string
  caseId: string
  projectedAgentIncome?: number | null
  lockinConfirmedDate?: string | null
}

export async function sendOpportunityAlert(params: OpportunityAlertParams): Promise<void> {
  const { agentEmail, agentName, clientName, caseId, projectedAgentIncome, lockinConfirmedDate } = params

  const caseUrl = `${APP_URL}/property/cases/${caseId}`
  const incomeText = projectedAgentIncome
    ? `Based on the projected remaining balance, your estimated refinancing commission is <strong>${formatCurrency(projectedAgentIncome)}</strong>.`
    : 'This is a great opportunity to re-engage your client for a refinancing.'

  const lockInText = lockinConfirmedDate
    ? `Their lock-in period ends on <strong>${new Date(lockinConfirmedDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.`
    : 'Their lock-in period is approaching its end.'


  await resend.emails.send({
    from: FROM,
    to: agentEmail,
    subject: `Action Required: ${clientName}'s lock-in is expiring soon`,
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#ea580c,#c2410c);padding:32px 40px;">
            <p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Opportunity Alert</p>
            <h1 style="margin:8px 0 0;color:white;font-size:22px;font-weight:700;">Time to Refinance ${clientName}</h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">Hi ${agentName},</p>
            <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
              Your client <strong>${clientName}</strong>'s mortgage lock-in period is approaching its end. ${lockInText}
            </p>
            <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">${incomeText}</p>

            <!-- Commission box -->
            ${projectedAgentIncome ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;margin-bottom:24px;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 4px;color:#9a3412;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Your Projected Commission</p>
                  <p style="margin:0;color:#c2410c;font-size:28px;font-weight:800;">${formatCurrency(projectedAgentIncome)}</p>
                </td>
              </tr>
            </table>` : ''}

            <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
              Reach out to ${clientName} now and submit a new refinancing case when they're ready.
            </p>

            <!-- CTA -->
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#ea580c;border-radius:8px;">
                  <a href="${caseUrl}" style="display:inline-block;padding:14px 28px;color:white;font-size:14px;font-weight:700;text-decoration:none;">
                    View Case &rarr;
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">The TLC Team &middot; This is an automated reminder from the TLC Partner Portal.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}
