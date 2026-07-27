import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'noreply@tlcmortgage.sg'
const FROM = `The Loan Connection <${FROM_EMAIL}>`

interface SendDocRequestParams {
    clientEmail: string
    clientName?: string
    agentEmail?: string
    agentName?: string
    /** Public URL of the tailored document checklist. */
    url: string
}

/**
 * Emails the client a link to their tailored "documents to prepare" page. No
 * attachment — the page is interactive (tap-through retrieval steps), so the email
 * is just a friendly wrapper around the link.
 */
export async function sendDocRequest(params: SendDocRequestParams): Promise<void> {
    const { clientEmail, clientName, agentEmail, agentName, url } = params
    const agentSignature = agentName || 'Your advisor'
    const greeting = clientName ? `Hi ${clientName},` : 'Hi,'
    const cc = agentEmail ? [agentEmail] : undefined

    const { data, error } = await resend.emails.send({
        from: FROM,
        to: clientEmail,
        cc,
        subject: `Documents to prepare for your loan application`,
        html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

        <tr>
          <td style="background:linear-gradient(135deg,#052d4a,#0f4a75);padding:32px 40px;">
            <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Loan Application</p>
            <h1 style="margin:8px 0 0;color:white;font-size:22px;font-weight:700;">Documents to prepare</h1>
          </td>
        </tr>

        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">${greeting}</p>
            <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
              To move your loan application forward, please prepare the documents listed at the link below.
              It shows exactly what's needed for your case, with step-by-step guides (including screenshots)
              for retrieving the HDB, CPF and IRAS documents from the official portals.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${url}" style="display:inline-block;background:#03a9e7;color:white;text-decoration:none;font-size:15px;font-weight:600;padding:13px 28px;border-radius:8px;">
                  View my document checklist
                </a>
              </td></tr>
            </table>

            <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;word-break:break-all;">
              Or paste this link into your browser:<br>${url}
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">The TLC Team &middot; Sent on behalf of ${agentSignature}.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
    })

    if (error) {
        const detail = typeof error === 'object' ? JSON.stringify(error) : String(error)
        console.error('[sendDocRequest] Resend send failed:', detail)
        throw new Error(`Email could not be sent: ${detail}`)
    }
    console.log('[sendDocRequest] Resend accepted email, id:', data?.id, '→', clientEmail)
}
