// Test-only: a stand-in for `next/headers`, which only works inside a Next request. A test file
// owns the `RequestState` (through `vi.hoisted`, so it survives `vi.resetModules`) and mocks the
// module with `vi.mock("next/headers", async () => (await import("./next-headers-fake")).fakeNextHeaders(state))`.
// Nothing that ships imports this.

export type CookieSet = { name: string; value: string; [option: string]: unknown };

export type RequestState = {
  /** Cookies the request arrives with. */
  cookies: Record<string, string>;
  /** Request headers. */
  headers: Record<string, string>;
  /** Every `cookies().set(...)`, normalized to one object whichever call shape was used. */
  sets: CookieSet[];
};

export const emptyRequest = (): RequestState => ({ cookies: {}, headers: {}, sets: [] });

export function fakeNextHeaders(state: RequestState) {
  const entry = (name: string) =>
    name in state.cookies ? { name, value: state.cookies[name] as string } : undefined;
  const nameOf = (arg: string | { name: string }) => (typeof arg === "string" ? arg : arg.name);

  const store = {
    get: (arg: string | { name: string }) => entry(nameOf(arg)),
    getAll: (arg?: string | { name: string }) =>
      Object.keys(state.cookies)
        .filter((name) => arg === undefined || name === nameOf(arg))
        .map((name) => entry(name)),
    has: (name: string) => name in state.cookies,
    get size() {
      return Object.keys(state.cookies).length;
    },
    set(...args: unknown[]) {
      const [first, value, options] = args;
      const cookie =
        typeof first === "string"
          ? ({ ...(options as object | undefined), name: first, value: value as string } as CookieSet)
          : ({ ...(first as CookieSet) } as CookieSet);
      state.sets.push(cookie);
      state.cookies[cookie.name] = cookie.value;
      return store;
    },
    delete(name: string) {
      delete state.cookies[name];
      return store;
    },
    [Symbol.iterator]() {
      const entries = Object.keys(state.cookies).map((name) => [name, entry(name)] as const);
      return entries[Symbol.iterator]();
    },
  };

  return {
    cookies: async () => store,
    headers: async () => new Headers(state.headers),
  };
}
