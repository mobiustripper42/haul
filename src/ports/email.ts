/**
 * The email port (DEC-010). `FakeEmail` is the permanent fake and the test substrate; `ResendEmail`
 * is the real adapter; one contract suite runs against both (`src/adapters/email-contract.ts`).
 */
export type EmailMessage = { to: string; subject: string; text: string };

/** `sentAt` is when the adapter handed the message over; `id` is the provider's, when it gave one. */
export type EmailReceipt = { sentAt: Date; id?: string };

export interface EmailPort {
  send(message: EmailMessage): Promise<EmailReceipt>;
}

/** A provider refused the message. `detail` is the provider's reply, so keep the message out of logs. */
export class EmailSendError extends Error {
  readonly status: number;

  constructor(provider: string, status: number, detail: string) {
    super(`${provider} send failed (${status}): ${detail}`);
    this.name = "EmailSendError";
    this.status = status;
  }
}
