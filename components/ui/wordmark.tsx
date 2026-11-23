import Link from "next/link";

/** The header's wordmark: the farm's name over its byline, one link to `/` (issue 245). */
export function Wordmark({ name, byline }: { name: string; byline: string }) {
  return (
    <Link href="/" className="flex flex-col">
      <span className="font-display text-wordmark text-teal uppercase">{name}</span>
      <span className="text-byline text-ink-muted">{byline}</span>
    </Link>
  );
}
