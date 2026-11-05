import { Card } from "../../components/ui/card";
import { Shell } from "../../components/ui/shell";
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
      <Card>{await AccountForm({ action: requestAccountCode, limited, error, signInHref: "/sign-in" })}</Card>
    </Shell>
  );
}
