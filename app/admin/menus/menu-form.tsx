"use client";

// Issue 140: New menu and Edit menu's form. The app's first `useActionState`: a failed save returns the errors with
// everything typed, so nothing is kept in a cookie (two menu texts can outgrow its 4 KB).
import { useActionState } from "react";
import type { MenuErrors } from "@core/menus.js";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Field } from "../../../components/ui/field";
import { FieldError } from "../../../components/ui/field-error";
import { Hint } from "../../../components/ui/hint";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { fill } from "../../fill";
import { MENU_NAME_FIELD, menuTextField, type MenuFormState } from "./shared";

/** The words the page translates for the form. `textLabel`, `textRequired` and `textTooLong` hold `{option}`. */
export type MenuFormText = {
  name: string;
  nameHelp: string;
  textLabel: string;
  textHelp: string;
  save: string;
  errors: { nameRequired: string; nameTooLong: string; textRequired: string; textTooLong: string };
};

const NAME_ID = "menu-name";

/** The error words for a field's fault, with the option named where the words ask for it; null for no fault. */
const nameError = (errors: MenuErrors | null, text: MenuFormText): string | null =>
  errors?.name === "required" ? text.errors.nameRequired : errors?.name === "tooLong" ? text.errors.nameTooLong : null;

const textError = (errors: MenuErrors | null, text: MenuFormText, option: { id: string; name: string }): string | null => {
  const fault = errors?.texts[option.id];
  if (fault === "required") return fill(text.errors.textRequired, { option: option.name });
  return fault === "tooLong" ? fill(text.errors.textTooLong, { option: option.name }) : null;
};

/**
 * The menu's name and a text for each menu option, in the order given, then on the editor the weeks it is on and
 * Save. `state` is `useActionState`'s first state and what the fields and errors are drawn from; after a save the
 * action's returned state is, so a failed one shows its errors with everything as typed.
 */
export function MenuForm({
  action,
  state: initial,
  options,
  text,
  assigned,
}: {
  action: (state: MenuFormState, formData: FormData) => Promise<MenuFormState>;
  state: MenuFormState;
  options: { id: string; name: string }[];
  text: MenuFormText;
  assigned?: { line: string; help: string };
}) {
  const [state, formAction] = useActionState(action, initial);
  const nameFault = nameError(state.errors, text);
  return (
    <Card width="fill">
      <form action={formAction} className="flex flex-col gap-5">
        <Field label={text.name} htmlFor={NAME_ID} help={text.nameHelp}>
          <Input
            id={NAME_ID}
            name={MENU_NAME_FIELD}
            defaultValue={state.name}
            aria-invalid={nameFault !== null || undefined}
            aria-describedby={nameFault !== null ? `${NAME_ID}-error ${NAME_ID}-help` : `${NAME_ID}-help`}
          />
          {nameFault !== null && <FieldError id={`${NAME_ID}-error`}>{nameFault}</FieldError>}
        </Field>
        {options.map((option) => {
          const id = `menu-text-${option.id}`;
          const fault = textError(state.errors, text, option);
          return (
            <Field key={option.id} label={fill(text.textLabel, { option: option.name })} htmlFor={id} help={text.textHelp}>
              <Textarea
                id={id}
                name={menuTextField(option.id)}
                rows={8}
                defaultValue={state.texts[option.id] ?? ""}
                aria-invalid={fault !== null || undefined}
                aria-describedby={fault !== null ? `${id}-error ${id}-help` : `${id}-help`}
              />
              {fault !== null && <FieldError id={`${id}-error`}>{fault}</FieldError>}
            </Field>
          );
        })}
        {assigned && (
          <div className="flex flex-col gap-1">
            <Hint>{assigned.line}</Hint>
            <Hint>{assigned.help}</Hint>
          </div>
        )}
        <div className="flex">
          <Button kind="primary" type="submit">
            {text.save}
          </Button>
        </div>
      </form>
    </Card>
  );
}
