import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'noreply@tlcmortgage.sg'
const FROM = `The Loan Connection <${FROM_EMAIL}>`

function renderAuthEmail(params: {
    heading: string
    bodyHtml: string
    ctaLabel: string
    ctaUrl: string
    footerNote?: string
}): string {
    const { heading, bodyHtml, ctaLabel, ctaUrl, footerNote } = params
    return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

        <tr>
          <td style="background:linear-gradient(135deg,#03a9e7,#0398d1);padding:32px 40px;">
            <p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">TLC Insurance Agent Platform</p>
            <h1 style="margin:8px 0 0;color:white;font-size:22px;font-weight:700;">${heading}</h1>
          </td>
        </tr>

        <tr>
          <td style="padding:32px 40px;">
            ${bodyHtml}

            <table cellpadding="0" cellspacing="0" style="margin-top:8px;">
              <tr>
                <td>
                  <a href="${ctaUrl}" style="display:inline-block;padding:12px 24px;background:#03a9e7;color:white;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">
                    ${ctaLabel} &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">
              If the button doesn't work, copy and paste this link into your browser:<br/>
              <span style="word-break:break-all;">${ctaUrl}</span>
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">${footerNote ?? 'The TLC Team'}</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

interface SendAgentInviteEmailParams {
    to: string
    name?: string | null
    inviteUrl: string
}

export async function sendAgentInviteEmail({ to, name, inviteUrl }: SendAgentInviteEmailParams): Promise<void> {
    const greeting = name ? `Hi ${name},` : 'Hi,'
    const html = renderAuthEmail({
        heading: "You're invited to join TLC",
        bodyHtml: `
            <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">${greeting}</p>
            <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
              You've been invited to join TLC's Insurance Agent Platform. Click below to complete your sign up —
              you'll choose your own email and password. This link is single-use and will expire, so complete
              your sign up soon.
            </p>
        `,
        ctaLabel: 'Complete Your Sign Up',
        ctaUrl: inviteUrl,
        footerNote: "The TLC Team · If you weren't expecting this invite, you can safely ignore this email.",
    })

    await resend.emails.send({
        from: FROM,
        to,
        subject: "You're invited to join TLC's Insurance Agent Platform",
        html,
    })
}

interface SendAgentWelcomeEmailParams {
    to: string
    name?: string | null
    setPasswordUrl: string
    pendingActivation: boolean
}

export async function sendAgentWelcomeEmail({ to, name, setPasswordUrl, pendingActivation }: SendAgentWelcomeEmailParams): Promise<void> {
    const greeting = name ? `Hi ${name},` : 'Hi,'
    const activationNote = pendingActivation
        ? `<p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
             Your account will be activated once your admin confirms everything is in order — you can set your
             password now so you're ready to go as soon as that happens.
           </p>`
        : ''

    const html = renderAuthEmail({
        heading: 'Welcome to TLC',
        bodyHtml: `
            <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">${greeting}</p>
            <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
              An account has been created for you on TLC's Insurance Agent Platform. Click below to set your
              own password and sign in.
            </p>
            ${activationNote}
        `,
        ctaLabel: 'Set Your Password',
        ctaUrl: setPasswordUrl,
        footerNote: 'The TLC Team',
    })

    await resend.emails.send({
        from: FROM,
        to,
        subject: 'Welcome to TLC — set up your account',
        html,
    })
}

interface SendPasswordResetEmailParams {
    to: string
    name?: string | null
    resetUrl: string
}

export async function sendPasswordResetEmail({ to, name, resetUrl }: SendPasswordResetEmailParams): Promise<void> {
    const greeting = name ? `Hi ${name},` : 'Hi,'
    const html = renderAuthEmail({
        heading: 'Reset your password',
        bodyHtml: `
            <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">${greeting}</p>
            <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
              We received a request to reset your password. Click below to choose a new one. If you didn't
              request this, you can safely ignore this email — your password won't change.
            </p>
        `,
        ctaLabel: 'Reset Your Password',
        ctaUrl: resetUrl,
        footerNote: 'The TLC Team',
    })

    await resend.emails.send({
        from: FROM,
        to,
        subject: 'Reset your TLC password',
        html,
    })
}
