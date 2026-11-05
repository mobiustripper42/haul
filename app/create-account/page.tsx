import { Card } from "../../components/ui/card";
import { Shell } from "../../components/ui/shell";
import { SIGN_IN_PAGES } from "../paths";
import { AccountForm } from "./account-form";
import { requestAccountCode } from "./actions";

export default async function CreateAccount({
  searchParams,
}: {
  searchParams: Promise<{ limited?: string; error?: string }>;
}) {
  const { limited, error } = await searchParams;
  return (
    <Shell>
      <Card>{await AccountForm({ action: requestAccountCode, limited, error, signInHref: SIGN_IN_PAGES.start })}</Card>
    </Shell>
  );
}
