// -----------------------------------------------------------
// EmailSender — thin swappable interface (CTO decision: Resend as the
// transactional provider). Prod uses ResendEmailSender; local dev uses
// ConsoleEmailSender; tests inject a mock. Nothing else in the POD flow
// knows which provider is active.
// -----------------------------------------------------------

export type EmailMessage = {
  to: string
  subject: string
  html: string
  text: string
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>
}

/** Production sender: Resend transactional email API. */
export class ResendEmailSender implements EmailSender {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(msg: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    })
    if (!res.ok) {
      throw new Error(`Resend send failed: ${res.status} ${await res.text().catch(() => '')}`)
    }
  }
}

/** Local-dev sender: logs the message instead of hitting a provider. */
export class ConsoleEmailSender implements EmailSender {
  async send(msg: EmailMessage): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[DEV EMAIL] to=${msg.to} subject="${msg.subject}"\n${msg.text}`)
  }
}

/** Pick the sender from env: Resend when a key is present, else dev console. */
export function defaultEmailSender(): EmailSender {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.POD_EMAIL_FROM ?? 'BharatTruck POD <pod@bharattruck.in>'
  return apiKey ? new ResendEmailSender(apiKey, from) : new ConsoleEmailSender()
}

/** Build the delivery-confirmation email body for a POD OTP. */
export function buildOtpEmail(to: string, otp: string, ttlMinutes: number): EmailMessage {
  const subject = 'Your BharatTruck delivery confirmation code'
  const text =
    `Your BharatTruck delivery confirmation code is ${otp}.\n` +
    `Share it with the driver to confirm you received the shipment.\n` +
    `It expires in ${ttlMinutes} minutes. If you did not expect this, ignore this email.`
  const html =
    `<p>Your BharatTruck delivery confirmation code is <strong style="font-size:20px">${otp}</strong>.</p>` +
    `<p>Share it with the driver to confirm you received the shipment. ` +
    `It expires in ${ttlMinutes} minutes.</p>` +
    `<p>If you did not expect this, please ignore this email.</p>`
  return { to, subject, html, text }
}
