// Issue 9: the sign-in store contract (AC16–AC19) against MemorySignInStore, the folder's own
// permanent fake. Any string is a subject id, so a subject is a fresh UUID.
import { randomUUID } from "node:crypto";
import { MemorySignInStore } from "./memory-store.js";
import { runSignInStoreContract } from "./store-contract.js";

runSignInStoreContract("memory", async () => ({
  store: new MemorySignInStore(),
  makeSubject: async () => randomUUID(),
}));
