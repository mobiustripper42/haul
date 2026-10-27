/**
 * The Repository contract (AC7). One behavioural suite, run against both the in-memory adapter
 * and the Postgres adapter: if both pass it, the in-memory adapter is a faithful fake and the fast
 * tests that lean on it are honest (DEC-010).
 *
 * Not a test file itself: it registers describe/it blocks, and each adapter's test file calls it.
 * `reset`, when given, runs before every test and before `make` — the Postgres suite truncates
 * there, so each test starts from an empty database.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { LANGUAGES, type Language } from "../i18n.js";
import { DuplicateEmailError } from "../members.js";
import type { Repository } from "../ports/repository.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";

export function runRepositoryContract(
  name: string,
  make: () => Promise<Repository>,
  reset?: () => Promise<void>,
): void {
  describe(`Repository contract — ${name}`, () => {
    let repo: Repository;

    beforeEach(async () => {
      if (reset) await reset();
      repo = await make();
    });

    describe("createMember", () => {
      it("AC7: returns a member with a UUID id, the normalized email and a createdAt Date", async () => {
        const member = await repo.createMember({ email: "  Ada@Example.COM " });
        expect(member.id).toMatch(UUID);
        expect(member.email).toBe("ada@example.com");
        expect(member.createdAt).toBeInstanceOf(Date);
        expect(Number.isNaN(member.createdAt.getTime())).toBe(false);
      });

      it.each(["ada@example.com", "ADA@EXAMPLE.COM", "  Ada@example.com  "])(
        "AC7: a second createMember with %j throws DuplicateEmailError",
        async (again) => {
          const first = await repo.createMember({ email: "Ada@Example.com" });
          await expect(repo.createMember({ email: again })).rejects.toBeInstanceOf(DuplicateEmailError);
          expect(await repo.findMemberByEmail("ada@example.com")).toEqual(first);
        },
      );
    });

    describe("findMemberByEmail", () => {
      it.each(["ada@example.com", "ADA@EXAMPLE.COM", "  aDa@eXample.com\t"])(
        "AC7: finds the member by %j, regardless of case and surrounding whitespace",
        async (lookup) => {
          const created = await repo.createMember({ email: "  Ada@Example.COM " });
          expect(await repo.findMemberByEmail(lookup)).toEqual(created);
        },
      );

      it("AC7: returns null for an unknown email", async () => {
        await repo.createMember({ email: "ada@example.com" });
        expect(await repo.findMemberByEmail("grace@example.com")).toBeNull();
      });
    });

    describe("findMemberById", () => {
      it("AC7: returns each member by its own id", async () => {
        const ada = await repo.createMember({ email: "ada@example.com" });
        const grace = await repo.createMember({ email: "grace@example.com" });
        expect(ada.id).not.toBe(grace.id);
        expect(await repo.findMemberById(ada.id)).toEqual(ada);
        expect(await repo.findMemberById(grace.id)).toEqual(grace);
      });

      it("AC7: returns null for an unknown UUID", async () => {
        await repo.createMember({ email: "ada@example.com" });
        expect(await repo.findMemberById(UNKNOWN_UUID)).toBeNull();
      });

      it.each(["not-a-uuid", "", "12345"])(
        "AC7: returns null, and does not throw, for %j, which isn't a UUID",
        async (id) => {
          await repo.createMember({ email: "ada@example.com" });
          await expect(repo.findMemberById(id)).resolves.toBeNull();
        },
      );
    });

    describe("member language (issue 7)", () => {
      it('AC9 (issue 7): createMember without a language returns language "en"', async () => {
        const member = await repo.createMember({ email: "ada@example.com" });
        expect(member.language).toBe("en");
      });

      it('AC9 (issue 7): createMember with language "es" returns language "es"', async () => {
        const member = await repo.createMember({ email: "ada@example.com", language: "es" });
        expect(member.language).toBe("es");
      });

      it('AC9 (issue 7): createMember with language "en" returns language "en"', async () => {
        const member = await repo.createMember({ email: "ada@example.com", language: "en" });
        expect(member.language).toBe("en");
      });

      // LANGUAGES and the members.language check constraint must list the same codes; this is what
      // fails (SQLSTATE 23514 on Postgres) when a language is added to one and not the other.
      it.each(Object.keys(LANGUAGES) as Language[])(
        "AC9 (issue 7): createMember accepts every supported language — %j",
        async (code) => {
          const member = await repo.createMember({ email: "ada@example.com", language: code });
          expect(member.language).toBe(code);
        },
      );

      it("AC9 (issue 7): findMemberByEmail returns the stored language", async () => {
        await repo.createMember({ email: "ada@example.com", language: "es" });
        await repo.createMember({ email: "grace@example.com" });
        expect((await repo.findMemberByEmail("ada@example.com"))?.language).toBe("es");
        expect((await repo.findMemberByEmail("grace@example.com"))?.language).toBe("en");
      });

      it("AC9 (issue 7): findMemberById returns the stored language", async () => {
        const ada = await repo.createMember({ email: "ada@example.com", language: "es" });
        const grace = await repo.createMember({ email: "grace@example.com" });
        expect((await repo.findMemberById(ada.id))?.language).toBe("es");
        expect((await repo.findMemberById(grace.id))?.language).toBe("en");
      });
    });
  });
}
