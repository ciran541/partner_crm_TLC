import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'noreply@tlcmortgage.sg'
const FROM = `The Loan Connection <${FROM_EMAIL}>`

interface SendPackageComparisonParams {
    clientEmail: string
    clientName?: string
    agentEmail?: string
    agentName?: string
    packageCount: number
    pdfBuffer: Buffer
}

export async function sendPackageComparison(params: SendPackageComparisonParams): Promise<void> {
    const { clientEmail, clientName, agentEmail, agentName, packageCount, pdfBuffer } = params

    const filename = clientName
        ? `${clientName.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-')}-package-comparison.pdf`
        : 'mortgage-package-comparison.pdf'

    const agentSignature = agentName ? agentName : 'Your advisor'
    const greeting = clientName ? `Hi ${clientName},` : 'Hi,'
    const cc = agentEmail ? [agentEmail] : undefined

    const { data, error } = await resend.emails.send({
        from: FROM,
        to: clientEmail,
        cc,
        subject: `Your mortgage package comparison from ${agentSignature}`,
        attachments: [{ filename, content: pdfBuffer }],
        html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#052d4a,#0f4a75);padding:32px 40px;">
            <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Mortgage Advisory</p>
            <h1 style="margin:8px 0 0;color:white;font-size:22px;font-weight:700;">Your Package Comparison</h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">${greeting}</p>
            <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
              ${agentSignature} has put together a side-by-side comparison of <strong>${packageCount} mortgage package${packageCount !== 1 ? 's' : ''}</strong> for you. Please find it attached as a PDF.
            </p>
            <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
              It lays out the rate schedule, lock-in, and estimated monthly repayments for each option so you can weigh them together. If you have any questions, please reach out to your advisor directly.
            </p>

            <!-- Disclaimer box -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
                    All figures in the attached comparison are estimates for discussion purposes only and are subject to the bank's formal assessment and approval. They do not constitute a formal offer of credit.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">The TLC Team &middot; This comparison was prepared by ${agentSignature}.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
    })

    // Resend returns { data, error } rather than throwing — surface the real failure.
    if (error) {
        const detail = typeof error === 'object' ? JSON.stringify(error) : String(error)
        console.error('[sendPackageComparison] Resend send failed:', detail)
        throw new Error(`Email could not be sent: ${detail}`)
    }
    console.log('[sendPackageComparison] Resend accepted email, id:', data?.id, '→', clientEmail)
}
