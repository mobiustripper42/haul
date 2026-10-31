import { normalizeEmail } from "@core/members.js";
import { devEmail, isProduction } from "../../services";

/**
 * Dev only: what the dev `FakeEmail` has sent to an address, oldest first. It is how an e2e test
 * reads back the emailed sign-in code. In production it is a 404 that touches no email adapter.
 */
export function GET(request: Request): Response {
  if (isProduction()) return new Response(null, { status: 404 });

  const to = new URL(request.url).searchParams.get("to");
  if (!to || !normalizeEmail(to)) return new Response(null, { status: 400 });

  const wanted = normalizeEmail(to);
  const messages = devEmail()
    .sent.filter((message) => normalizeEmail(message.to) === wanted)
    .map(({ to, subject, text }) => ({ to, subject, text }));
  return Response.json({ messages });
}
