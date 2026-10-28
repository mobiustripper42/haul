import { runSignInStoreContract } from "../sign-in/store-contract.js";
import { InMemoryRepository } from "./in-memory-repository.js";
import { runRepositoryContract } from "./repository-contract.js";

runRepositoryContract("in-memory", async () => new InMemoryRepository());

// Issue 9, AC16–AC19: the repository is a sign-in store too, and a subject is a member.
runSignInStoreContract("in-memory repository", async () => {
  const repo = new InMemoryRepository();
  return { store: repo, makeSubject: async (email) => (await repo.createMember({ email })).id };
});
