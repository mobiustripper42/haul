import { InMemoryRepository } from "./in-memory-repository.js";
import { runProductContract } from "./product-contract.js";

// Issue 55, AC1: findProductByName against the fake, its products stored through the test seam.
let repo: InMemoryRepository;
runProductContract(
  "in-memory",
  async () => (repo = new InMemoryRepository()),
  async (input) => repo.addProduct(input),
);
