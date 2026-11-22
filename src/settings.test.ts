// Issue 231, AC9: wholeNumberSetting, the one parse every settings row is read through, over an InMemoryRepository whose
// rows are set with its test seam. The parse's edges are owned here; each reminder that reads a setting has one case
// through a seeded row (src/menu-run.test.ts), and readSetting found and not found is the repository contract's.
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "./adapters/in-memory-repository.js";
import { wholeNumberSetting } from "./settings.js";

const KEY = "probe_days";
const FALLBACK = 9;

let repo: InMemoryRepository;
let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  repo = new InMemoryRepository();
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AC9 (issue 231) — wholeNumberSetting", () => {
  it("AC9: with no row for the key, it is the fallback, and nothing is logged", async () => {
    expect(await wholeNumberSetting(repo, KEY, FALLBACK)).toBe(FALLBACK);
    expect(logged).not.toHaveBeenCalled();
  });

  it.each([
    ["3", 3],
    ["14", 14],
    ["0", 0],
    ["007", 7],
    [" 3", 3],
    ["3 ", 3],
    ["  21  ", 21],
  ])("AC9: a row holding %j is %i, and nothing is logged", async (value, number) => {
    repo.setSetting(KEY, value);
    expect(await wholeNumberSetting(repo, KEY, FALLBACK)).toBe(number);
    expect(logged).not.toHaveBeenCalled();
  });

  it.each(["+3", "-1", "1.5", "1 4", "", "   ", "three", "3 days"])(
    "AC9: a row holding %j is the fallback, with one log line naming the key",
    async (value) => {
      repo.setSetting(KEY, value);
      expect(await wholeNumberSetting(repo, KEY, FALLBACK)).toBe(FALLBACK);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(inspect(logged.mock.calls[0], { depth: 5 })).toContain(KEY);
    },
  );
});
