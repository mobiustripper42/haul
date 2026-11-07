/**
 * The payments contract (issue 54, AC1–AC9) against `SquarePayments` on Square's REAL sandbox.
 *
 *   npm run test:square
 *
 * Not in `npm run test` or `verify` (AC23): the default include is `*.test.ts` and this is
 * `*.sandbox.ts`. It needs the network. Every run leaves cards and payments in the sandbox account,
 * but deletes the customers it created (issue 86). Run by hand at `/build-task`'s verify step and again
 * before the cutover (1.9).
 *
 * Settings come from `SQUARE_SANDBOX_ACCESS_TOKEN` and `SQUARE_SANDBOX_LOCATION_ID` in `.env.local`
 * through `squareSandboxSettings`, which pins the environment to sandbox and throws when either is
 * missing — so a run without them fails rather than skips (AC22).
 */
import { existsSync } from "node:fs";
import { afterAll } from "vitest";
import { runPaymentsContract } from "./payments-contract.js";
import { SquarePayments } from "./square-payments.js";
import { deleteSandboxCustomers, recordingCustomers } from "./square-sandbox-cleanup.js";
import { squareSandboxSettings } from "./square-sandbox-settings.js";

// Vitest loads only `VITE_`-prefixed variables on its own.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const settings = squareSandboxSettings(process.env);

// Every customer the run creates, deleted below whether the tests passed or failed.
const created = new Set<string>();

// Square's search lags a create by up to a minute.
runPaymentsContract("square sandbox", () => recordingCustomers(new SquarePayments(settings), created), { searchWaitMs: 60_000 });

// 300 seconds: above the worst case of 15 customers at SQUARE_TIMEOUT_MS (15 seconds) each, so the count
// of customers left still appears when every delete hangs. Vitest's default of 10 seconds is too short.
afterAll(() => deleteSandboxCustomers(settings, [...created]), 300_000);
