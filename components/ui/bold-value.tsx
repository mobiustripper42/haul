// A private-use character, which no sentence holds, stands where the value goes while the sentence is cut.
const MARK = "\uE000";

/**
 * The sentence `line(value)` with `value` in bold, in the place `line` puts it (issue 238), so a value whose words also occur
 * in the fixed text is bold once, in its own place. A sentence that does not hold the value is drawn plain.
 */
export function BoldValue({ line, value }: { line: (value: string) => string; value: string }) {
  const [before, after, ...more] = line(MARK).split(MARK);
  if (before === undefined || after === undefined || more.length > 0) return <>{line(value)}</>;
  return (
    <>
      {before}
      <strong className="font-semibold">{value}</strong>
      {after}
    </>
  );
}
