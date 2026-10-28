import type { EmailMessage, EmailPort, EmailReceipt } from "../ports/email.js";

/** The permanent fake (DEC-010): records what it is asked to send. The test substrate and the dev console. */
export class FakeEmail implements EmailPort {
  private readonly messages: EmailMessage[] = [];
  private sentCount = 0;
  private readonly now: () => Date;
  private readonly onSend: ((message: EmailMessage) => void) | undefined;

  constructor(options: { now?: () => Date; onSend?: (message: EmailMessage) => void } = {}) {
    this.now = options.now ?? (() => new Date());
    this.onSend = options.onSend;
  }

  /** A copy: changing it, or a message in it, changes nothing stored. */
  get sent(): EmailMessage[] {
    return this.messages.map((message) => ({ ...message }));
  }

  last(): EmailMessage | undefined {
    const message = this.messages.at(-1);
    return message && { ...message };
  }

  /** Empties `sent`. Ids keep counting. */
  clear(): void {
    this.messages.length = 0;
  }

  async send(message: EmailMessage): Promise<EmailReceipt> {
    this.messages.push({ ...message });
    const receipt: EmailReceipt = { sentAt: this.now(), id: `fake-${this.sentCount++}` };
    this.onSend?.({ ...message });
    return receipt;
  }
}
