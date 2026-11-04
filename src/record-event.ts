import { EmailSendError } from "./ports/email.js";
import type { AuditEvent, Repository } from "./ports/repository.js";

/**
 * What a log says about an error: its name, its `code` when that is a string (a Postgres SQLSTATE,
 * or a Node system code like ECONNREFUSED) and a failed send's status. Never its message: Resend's
 * carries its whole reply and a connection error's carries the connection string.
 */
export function errorFields(error: unknown): { error: string; code?: string; status?: number } {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return {
    error: error instanceof Error ? error.name : typeof error,
    ...(typeof code === "string" ? { code } : {}),
    ...(error instanceof EmailSendError ? { status: error.status } : {}),
  };
}

/**
 * Records an audit event. A failure is logged and goes no further: what the caller was doing goes
 * ahead, so `audit_log` can have gaps that only the server log shows. The log names the event and
 * the member, never the client address a refusal carries.
 */
export async function recordEventSafely(repo: Repository, event: AuditEvent): Promise<void> {
  try {
    await repo.recordEvent(event);
  } catch (error) {
    console.error("audit event not recorded", {
      event: event.kind,
      ...(event.kind === "rate_limit_refusal" ? {} : { memberId: event.memberId }),
      ...errorFields(error),
    });
  }
}
