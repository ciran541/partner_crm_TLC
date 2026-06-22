import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'noreply@tlcmortgage.sg'
const FROM = `The Loan Connection <${FROM_EMAIL}>`

interface SendWorkflowReportParams {
    clientEmail: string
    clientName?: string
    agentEmail?: string
    agentName?: string
    caseType: 'Refinancing' | 'Purchase' | 'Decouple'
    pdfBuffer: Buffer
}

const REPORT_LABELS: Record<SendWorkflowReportParams['caseType'], string> = {
    Refinancing: 'Refinancing Plan',
    Purchase:    'Home Financing Plan',
    Decouple:    'Decoupling Plan',
}

const REPORT_FILENAMES: Record<SendWorkflowReportParams['caseType'], string> = {
    Refinancing: 'refinancing-plan.pdf',
    Purchase:    'home-financing-plan.pdf',
    Decouple:    'decoupling-plan.pdf',
}

export async function sendWorkflowReport(params: SendWorkflowReportParams): Promise<void> {
    const { clientEmail, clientName, agentEmail, agentName, caseType, pdfBuffer } = params

    const reportLabel = REPORT_LABELS[caseType]
    const filename = clientName
        ? `${clientName.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-')}-${REPORT_FILENAMES[caseType]}`
        : REPORT_FILENAMES[caseType]

    const agentSignature = agentName ? agentName : 'Your advisor'
    const greeting = clientName ? `Hi ${clientName},` : 'Hi,'

    const cc = agentEmail ? [agentEmail] : undefined

    await resend.emails.send({
        from: FROM,
        to: clientEmail,
        cc,
        subject: `Your ${reportLabel} from ${agentSignature}`,
        attachments: [
            {
                filename,
                content: pdfBuffer,
            },
        ],
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
            <h1 style="margin:8px 0 0;color:white;font-size:22px;font-weight:700;">Your ${reportLabel}</h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">${greeting}</p>
            <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
              ${agentSignature} has prepared your personalised <strong>${reportLabel}</strong>. Please find it attached as a PDF.
            </p>
            <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
              The report includes a summary of your mortgage options, key figures, and important things to note. If you have any questions, please reach out to your advisor directly.
            </p>

            <!-- Disclaimer box -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
                    All figures in the attached report are estimates for discussion purposes only and are subject to the bank's formal assessment and approval. They do not constitute a formal offer of credit.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">The TLC Team &middot; This report was prepared by ${agentSignature}.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
    })
}
