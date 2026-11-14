/**
 * What the repository contract suites share: the uuid shapes they check ids against, and BOX, the product the
 * signup and week credit suites sign members up to.
 */
import type { ProductInput } from "../products.js";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";

export const BOX: ProductInput = {
  name: "Box",
  cap: 50,
  firstPickupDate: "2027-01-03",
  cutoffWeekday: 1,
  cutoffTime: "24:00:00",
  optionTypes: [
    {
      name: "How many people?",
      position: 1,
      options: [
        { name: "2 people", priceCents: 5000, position: 1 },
        { name: "3–4 people", priceCents: 8000, position: 2 },
      ],
    },
    {
      name: "Which menu?",
      position: 2,
      options: [
        { name: "Standard", priceCents: 0, position: 1 },
        { name: "Vegan", priceCents: 0, position: 2 },
      ],
    },
  ],
};
