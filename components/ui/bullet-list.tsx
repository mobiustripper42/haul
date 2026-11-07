/** A bulleted list: discs, 4px apart, 20px in. One home for the look the Supper Club page and the legal pages share. */
export function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
