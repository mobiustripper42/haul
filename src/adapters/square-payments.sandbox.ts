/**
 * The payments contract (issue 54, AC1–AC9) against `SquarePayments` on Square's REAL sandbox.
 *
 *   npm run test:square
 *
 * Not in `npm run test` or `verify` (AC23): the default include is `*.test.ts` and this is
 * `*.sandbox.ts`. It needs the network, and every run leaves customers, cards and payments in the
 * sandbox account. Run by hand at `/build-task`'s verify step and again before the cutover (1.9).
 *
 * Settings come from `SQUARE_SANDBOX_ACCESS_TOKEN` and `SQUARE_SANDBOX_LOCATION_ID` in `.env.local`
 * through `squareSandboxSettings`, which pins the environment to sandbox and throws when either is
 * missing — so a run without them fails rather than skips (AC22).
 */
import { existsSync } from "node:fs";
import { runPaymentsContract } from "./payments-contract.js";
import { SquarePayments } from "./square-payments.js";
import { squareSandboxSettings } from "./square-sandbox-settings.js";

// Vitest loads only `VITE_`-prefixed variables on its own.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const settings = squareSandboxSettings(process.env);

// Square's search lags a create by up to a minute.
runPaymentsContract("square sandbox", () => new SquarePayments(settings), { searchWaitMs: 60_000 });
