import { InMemoryRepository } from "./in-memory-repository.js";
import { runProductContract } from "./product-contract.js";
import { runSignupContract } from "./signup-contract.js";

// Issue 55, AC1: findProductByName against the fake, its products stored through the test seam.
let repo: InMemoryRepository;
runProductContract(
  "in-memory",
  async () => (repo = new InMemoryRepository()),
  async (input) => repo.addProduct(input),
);

// Issue 56: the signup rows against the fake, which need its products.
let signupRepo: InMemoryRepository;
runSignupContract(
  "in-memory",
  async () => (signupRepo = new InMemoryRepository()),
  async (input) => signupRepo.addProduct(input),
);
