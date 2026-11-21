import { Button, type ButtonKind } from "./button";
import { MenuGroup } from "./menu-group";

/** One action in a list row: a link, or a form posting `fields` to a server action. */
export type RowAction = { label: string; href: string } | { label: string; action: (data: FormData) => Promise<void>; fields: Record<string, string> };

/** `action` drawn as a `kind` button: a link, or a form of its own whose hidden fields are `fields`. */
function Drawn({ action, kind, full }: { action: RowAction; kind: ButtonKind; full?: boolean }) {
  if ("href" in action) {
    return (
      <Button kind={kind} href={action.href} full={full}>
        {action.label}
      </Button>
    );
  }
  return (
    <form action={action.action}>
      {Object.entries(action.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button kind={kind} type="submit" full={full}>
        {action.label}
      </Button>
    </form>
  );
}

/**
 * A list row's actions (issue 220, DEC-048): `main` alone, beside one other as a quiet button, or with two or more
 * others as menu rows under More, a `MenuGroup` in its button look. `moreName` is More's name for a screen reader.
 */
export function RowActions({ main, others, moreLabel, moreName }: { main: RowAction; others: RowAction[]; moreLabel: string; moreName: string }) {
  const [only] = others;
  return (
    <div className="flex items-center gap-x-2">
      <Drawn action={main} kind="secondary" />
      {others.length === 1 && only && <Drawn action={only} kind="quiet" />}
      {others.length >= 2 && (
        <MenuGroup label={moreLabel} name={moreName} look="button" active={false}>
          {others.map((action) => (
            <Drawn key={action.label} action={action} kind="menu" full />
          ))}
        </MenuGroup>
      )}
    </div>
  );
}
