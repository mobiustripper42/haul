import { InMemoryRepository } from "./in-memory-repository.js";
import { runMenuContract } from "./menu-contract.js";
import { runProductContract } from "./product-contract.js";
import { runSignupContract } from "./signup-contract.js";

// Issue 55, AC1: findProductByName against the fake, its products stored through the test seam.
let repo: InMemoryRepository;
runProductContract(
  "in-memory",
  async () => (repo = new InMemoryRepository()),
  async (input) => repo.addProduct(input),
);

// Issue 140: the menu library against the fake, which needs its products.
let menuRepo: InMemoryRepository;
runMenuContract(
  "in-memory",
  async () => (menuRepo = new InMemoryRepository()),
  async (input) => menuRepo.addProduct(input),
);

// Issue 56: the signup rows against the fake, which need its products. Issue 194: a comp through the fake's seam, and a
// fake built with the cap's comp option, which the seams then act on.
let signupRepo: InMemoryRepository;
runSignupContract(
  "in-memory",
  async () => (signupRepo = new InMemoryRepository()),
  async (input) => signupRepo.addProduct(input),
  (subscriptionId) => signupRepo.markComped(subscriptionId),
  async (options) => (signupRepo = new InMemoryRepository(options)),
);
