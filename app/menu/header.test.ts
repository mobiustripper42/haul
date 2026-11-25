// Issue 260, AC3: the menu page's header marks This week's menu. The header is faked, so what is read is the call the page
// makes; which link `current` marks is app/site-header.test.ts's, and the rest of the page ./page.test.ts's.
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@core/adapters/in-memory-repository.js";
import { addSupperClub } from "../admin/subscribers-fixture";
import { emptyRequest } from "../next-headers-fake";
import { SiteHeader } from "../site-header";
import MenuPage from "./page";

const services = vi.hoisted(() => ({ repo: undefined as unknown as import("@core/adapters/in-memory-repository.js").InMemoryRepository }));

vi.mock("next/headers", async () => (await import("../next-headers-fake")).fakeNextHeaders(emptyRequest()));
vi.mock("next/navigation", async () => ({ redirect: (await import("../screen-test-helpers")).throwingRedirect }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("../services", () => ({ getRepository: () => services.repo, getSessionSecret: () => "test-session-secret-that-is-long-enough-0123456789" }));
vi.mock("../site-header", () => ({ SiteHeader: vi.fn(async () => createElement("header", null, "the header")) }));

beforeEach(() => {
  services.repo = new InMemoryRepository();
  addSupperClub(services.repo);
  vi.mocked(SiteHeader).mockClear();
});

describe("AC3 (issue 260) — the header on /menu", () => {
  it('AC3: the page asks for the header with current "menu"', async () => {
    await MenuPage();
    expect(SiteHeader).toHaveBeenCalledWith(expect.objectContaining({ current: "menu" }));
  });
});
