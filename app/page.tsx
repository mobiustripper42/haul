import { formatUsd } from "@core/money.js";

// Developer placeholder, replaced when task 1.3 lands. It exists so `next build` resolves the
// core's `.js` specifiers through the @core/* alias.
export default function Home() {
  return (
    <main>
      <h1>Haul</h1>
      <p>Core check: {formatUsd(1234)}</p>
    </main>
  );
}
