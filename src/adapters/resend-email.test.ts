// Issue 9, AC1, AC3 and AC4: the email contract against ResendEmail over a stubbed fetch, then
// the request it makes and how it reads Resend's reply. Nothing here reaches the network.
import { describe, expect, it } from "vitest";
import { EmailSendError, type EmailMessage } from "../ports/email.js";
import { runEmailContract } from "./email-contract.js";
import { RESEND_ENDPOINT, ResendEmail, type FetchLike } from "./resend-email.js";

type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string } };
type Reply = { ok: boolean; status: number; text(): Promise<string> };

/** A fetch that records each call and answers with `reply`. */
function stubFetch(reply: () => Reply | Promise<Reply>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return reply();
  };
  return { fetch, calls };
}

const answer = (status: number, body: string): Reply => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

const API_KEY = "re_test_key_123";
const FROM = "Ohio City Farm <members@ohiocityfarm.com>";
const message: EmailMessage = {
  to: "ada@example.com",
  subject: "Your OCF Member Portal sign-in code",
  text: "Your sign-in code is 042517.",
};

const resend = (fetch: FetchLike): ResendEmail => new ResendEmail({ apiKey: API_KEY, from: FROM, fetch });

runEmailContract("resend over a stubbed fetch", (now) => {
  const { fetch } = stubFetch(() => answer(200, '{"id":"re_123"}'));
  return new ResendEmail({ apiKey: API_KEY, from: FROM, fetch, now });
});

describe("AC3 (issue 9) — ResendEmail's request", () => {
  it("AC3: RESEND_ENDPOINT is https://api.resend.com/emails", () => {
    expect(RESEND_ENDPOINT).toBe("https://api.resend.com/emails");
  });

  it("AC3: makes exactly one POST to https://api.resend.com/emails", async () => {
    const { fetch, calls } = stubFetch(() => answer(200, '{"id":"re_123"}'));
    await resend(fetch).send(message);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    expect(calls[0]?.init.method).toBe("POST");
  });

  it("AC3: sends Authorization: Bearer <apiKey> and Content-Type: application/json", async () => {
    const { fetch, calls } = stubFetch(() => answer(200, '{"id":"re_123"}'));
    await resend(fetch).send(message);
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    });
  });

  it("AC3: the body is JSON { from, to: [to], subject, text } and no other field", async () => {
    const { fetch, calls } = stubFetch(() => answer(200, '{"id":"re_123"}'));
    await resend(fetch).send(message);
    const body: unknown = JSON.parse(calls[0]?.init.body ?? "null");
    expect(body).toEqual({ from: FROM, to: [message.to], subject: message.subject, text: message.text });
  });
});

describe("AC3 (issue 9) — ResendEmail reads a 2xx reply", () => {
  it.each([200, 201, 202])("AC3: a %i body's string id becomes the receipt's id", async (status) => {
    const { fetch } = stubFetch(() => answer(status, '{"id":"re_123"}'));
    const receipt = await resend(fetch).send(message);
    expect(receipt.id).toBe("re_123");
  });

  it.each([
    ["a body that is not JSON", "ok"],
    ["an empty body", ""],
    ["JSON without an id", '{"object":"email"}'],
    ["JSON whose id is a number", '{"id": 123}'],
    ["JSON whose id is null", '{"id": null}'],
    ["JSON whose id is an object", '{"id": {"value": "re_123"}}'],
    ["a JSON array", '["re_123"]'],
    ["JSON null", "null"],
  ])("AC3: a 200 with %s still resolves, with no id key on the receipt", async (_what, body) => {
    const { fetch } = stubFetch(() => answer(200, body));
    const receipt = await resend(fetch).send(message);
    expect(receipt.sentAt).toBeInstanceOf(Date);
    expect(Object.hasOwn(receipt, "id")).toBe(false);
  });
});

describe("AC4 (issue 9) — ResendEmail on a failure", () => {
  it.each([
    [400, '{"name":"validation_error","message":"Invalid `to` field"}'],
    [422, "Unprocessable"],
    [500, ""],
  ])("AC4: a %i throws EmailSendError carrying the status and the body", async (status, body) => {
    const { fetch } = stubFetch(() => answer(status, body));
    const error: unknown = await resend(fetch).send(message).then(
      () => new Error("send resolved"),
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EmailSendError);
    expect(error).toMatchObject({
      name: "EmailSendError",
      status,
      message: `Resend send failed (${status}): ${body}`,
    });
  });

  it("AC4: a non-2xx whose body cannot be read throws EmailSendError with an empty detail", async () => {
    const { fetch } = stubFetch(() => ({
      ok: false,
      status: 503,
      text: () => Promise.reject(new Error("socket hang up")),
    }));
    const error: unknown = await resend(fetch).send(message).then(
      () => new Error("send resolved"),
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EmailSendError);
    expect(error).toMatchObject({ status: 503, message: "Resend send failed (503): " });
  });

  it("AC4: a fetch that rejects makes send reject with the very same error object", async () => {
    const failure = new TypeError("fetch failed");
    const fetch: FetchLike = () => Promise.reject(failure);
    const error: unknown = await resend(fetch).send(message).then(
      () => new Error("send resolved"),
      (e: unknown) => e,
    );
    expect(error).toBe(failure);
    expect(error).not.toBeInstanceOf(EmailSendError);
  });
});
