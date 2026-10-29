import { EmailSendError, type EmailMessage, type EmailPort, type EmailReceipt } from "../ports/email.js";

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** The slice of `fetch` this adapter uses, so a test can stub it. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Sends through Resend's REST API on plain `fetch`: one request per message, no SDK. */
export class ResendEmail implements EmailPort {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetch: FetchLike;
  private readonly now: () => Date;

  constructor(options: { apiKey: string; from: string; fetch?: FetchLike; now?: () => Date }) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.now = options.now ?? (() => new Date());
  }

  /** Throws `EmailSendError` on a non-2xx. A `fetch` that rejects rejects `send` with that same error. */
  async send(message: EmailMessage): Promise<EmailReceipt> {
    const response = await this.fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text }),
    });
    const body = await response.text().catch(() => "");
    if (!response.ok) throw new EmailSendError("Resend", response.status, body);
    const sentAt = this.now();
    const id = idFrom(body);
    return id === undefined ? { sentAt } : { sentAt, id };
  }
}

/** The string `id` of a JSON object body; anything else is no id, and the send still happened. */
function idFrom(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    const id = typeof parsed === "object" && parsed !== null ? (parsed as { id?: unknown }).id : undefined;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}
