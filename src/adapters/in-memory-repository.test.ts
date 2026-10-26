import { InMemoryRepository } from "./in-memory-repository.js";
import { runRepositoryContract } from "./repository-contract.js";

runRepositoryContract("in-memory", async () => new InMemoryRepository());
