// Issue 71, AC14: one shared function logs an event that fails to record. A failure goes no further
// than the log, which names the event and the member, never the client address a refusal carries.
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "./adapters/in-memory-repository.js";
import { EmailSendError } from "./ports/email.js";
import { errorFields, recordEventSafely } from "./record-event.js";

const NOT_RECORDED = "audit event not recorded";
const ADDRESS = "203.0.113.7";

/** A failure as `pg` raises one: named "error", its code a SQLSTATE, its message carrying what a log must not. */
const pgError = (code: string): Error =>
  Object.assign(new Error("could not reach postgres://haul:hunter2@db/haul"), { name: "error", code });

const silenceErrors = () => vi.spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AC14 — recordEventSafely", () => {
  it("AC14: records the event through the repository it is given", async () => {
    const repo = new InMemoryRepository();
    const ada = await repo.createMember({ email: "ada@example.com" });
    await recordEventSafely(repo, { kind: "lock", memberId: ada.id });
    expect(repo.events()).toEqual([expect.objectContaining({ kind: "lock", memberId: ada.id })]);
  });

  it('AC14: a member\'s event that fails to record resolves, and logs "audit event not recorded" once with the event, the member id and errorFields — never the error\'s message', async () => {
    const repo = new InMemoryRepository();
    const ada = await repo.createMember({ email: "ada@example.com" });
    vi.spyOn(repo, "recordEvent").mockRejectedValue(pgError("57P01"));
    const errors = silenceErrors();

    await expect(recordEventSafely(repo, { kind: "sign_in_by_code", memberId: ada.id })).resolves.toBeUndefined();
    expect(errors.mock.calls).toEqual([[NOT_RECORDED, { event: "sign_in_by_code", memberId: ada.id, error: "error", code: "57P01" }]]);
  });

  it('AC14: a refusal that fails to record logs "audit event not recorded" with the event and errorFields — no member id, never the client address', async () => {
    const repo = new InMemoryRepository();
    vi.spyOn(repo, "recordEvent").mockRejectedValue(pgError("57P01"));
    const errors = silenceErrors();

    await expect(
      recordEventSafely(repo, {
        kind: "rate_limit_refusal",
        bucket: "sign-in-request",
        key: ADDRESS,
        windowStart: new Date("2026-10-28T14:00:00.000Z"),
      }),
    ).resolves.toBeUndefined();
    expect(errors.mock.calls).toEqual([[NOT_RECORDED, { event: "rate_limit_refusal", error: "error", code: "57P01" }]]);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(ADDRESS);
  });
});

describe("AC14 — errorFields, moved with it", () => {
  it("AC14: an error with a string code gives its name and its code, never its message", () => {
    expect(errorFields(pgError("53300"))).toEqual({ error: "error", code: "53300" });
  });

  it("AC14: a failed send gives its name and its status, never its message", () => {
    expect(errorFields(new EmailSendError("Resend", 422, "resend-reply-body"))).toEqual({ error: "EmailSendError", status: 422 });
  });

  it("AC14: a code that is not a string is left out, and a thrown non-Error gives its type", () => {
    expect(errorFields(Object.assign(new Error("boom"), { code: 42 }))).toEqual({ error: "Error" });
    expect(errorFields("boom")).toEqual({ error: "string" });
  });
});
