import Link from "next/link";
import { LinkLabel } from "./link-label";

/** The header's wordmark: the farm's name over its byline, one link to `href` (issue 245): the admin's page in the Admin interface, `/` otherwise (issue 266). */
export function Wordmark({ name, byline, href }: { name: string; byline: string; href: string }) {
  return (
    <Link href={href} className="flex flex-col text-teal">
      <LinkLabel>
        <span className="font-display text-wordmark text-teal uppercase">{name}</span>
        <span className="text-byline text-ink-muted">{byline}</span>
      </LinkLabel>
    </Link>
  );
}
