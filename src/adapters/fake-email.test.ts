// Issue 9, AC1 and AC2: the email contract against FakeEmail, then the fake's own surface.
import { describe, expect, it } from "vitest";
import type { EmailMessage } from "../ports/email.js";
import { runEmailContract } from "./email-contract.js";
import { FakeEmail } from "./fake-email.js";

runEmailContract("fake", (now) => new FakeEmail({ now }));

const first: EmailMessage = { to: "ada@example.com", subject: "One", text: "First message" };
const second: EmailMessage = { to: "grace@example.com", subject: "Two", text: "Second message" };
const third: EmailMessage = { to: "lin@example.com", subject: "Three", text: "Third message" };

describe("AC2 (issue 9) — FakeEmail", () => {
  it("AC2: sent lists every message in send order", async () => {
    const fake = new FakeEmail();
    await fake.send(first);
    await fake.send(second);
    expect(fake.sent).toEqual([first, second]);
  });

  it("AC2: sent is empty before anything is sent", () => {
    expect(new FakeEmail().sent).toEqual([]);
  });

  it("AC2: changing the returned array changes nothing stored", async () => {
    const fake = new FakeEmail();
    await fake.send(first);
    const returned = fake.sent;
    returned.push(second);
    returned.splice(0, 1);
    expect(fake.sent).toEqual([first]);
  });

  it("AC2: changing a message in the returned array changes nothing stored", async () => {
    const fake = new FakeEmail();
    await fake.send(first);
    const [message] = fake.sent;
    if (!message) throw new Error("nothing was recorded");
    message.to = "mallory@example.com";
    message.subject = "Changed";
    message.text = "Changed";
    expect(fake.sent).toEqual([first]);
    expect(fake.last()).toEqual(first);
  });

  it("AC2: last() is undefined when nothing has been sent", () => {
    expect(new FakeEmail().last()).toBeUndefined();
  });

  it("AC2: last() is the latest message", async () => {
    const fake = new FakeEmail();
    await fake.send(first);
    expect(fake.last()).toEqual(first);
    await fake.send(second);
    expect(fake.last()).toEqual(second);
  });

  it("AC2: clear() empties sent, and last() is then undefined", async () => {
    const fake = new FakeEmail();
    await fake.send(first);
    await fake.send(second);
    fake.clear();
    expect(fake.sent).toEqual([]);
    expect(fake.last()).toBeUndefined();
  });

  it("AC2: ids are fake-0, fake-1, … in send order", async () => {
    const fake = new FakeEmail();
    expect((await fake.send(first)).id).toBe("fake-0");
    expect((await fake.send(second)).id).toBe("fake-1");
    expect((await fake.send(third)).id).toBe("fake-2");
  });

  it("AC2: ids keep counting after clear()", async () => {
    const fake = new FakeEmail();
    await fake.send(first);
    await fake.send(second);
    fake.clear();
    expect((await fake.send(third)).id).toBe("fake-2");
    expect(fake.sent).toEqual([third]);
  });

  it("AC2: onSend is called with each message, after it is recorded", async () => {
    const seen: Array<{ message: EmailMessage; recorded: EmailMessage[] }> = [];
    const fake: FakeEmail = new FakeEmail({
      onSend: (message) => seen.push({ message, recorded: fake.sent }),
    });
    await fake.send(first);
    await fake.send(second);
    expect(seen).toEqual([
      { message: first, recorded: [first] },
      { message: second, recorded: [first, second] },
    ]);
  });
});
