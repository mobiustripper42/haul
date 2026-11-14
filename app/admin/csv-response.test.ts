// Issue 142: the one home of the CSV response the three spreadsheets send. Its full header set is owned here; each
// route's test checks only its filename and body.
import { describe, expect, it } from "vitest";
import { csvResponse } from "./csv-response";

describe("AC5, AC6 — csvResponse", () => {
  it("AC5: the CSV as the body, text/csv in UTF-8, an attachment under the exact filename, and never cached", async () => {
    const response = csvResponse("Meals\r\n3\r\n", "supper-club-pick-list-2027-02-14.csv");
    expect(response.status).toBe(200);
    expect(Object.fromEntries(["content-type", "content-disposition", "cache-control"].map((name) => [name, response.headers.get(name)]))).toEqual({
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="supper-club-pick-list-2027-02-14.csv"',
      "cache-control": "no-store",
    });
    expect(await response.text()).toBe("Meals\r\n3\r\n");
  });
});
