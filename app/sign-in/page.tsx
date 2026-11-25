import { redirect } from "next/navigation";
import { Card } from "../../components/ui/card";
import { Shell } from "../../components/ui/shell";
import { ACCOUNT_PATH, CREATE_ACCOUNT_PAGES } from "../paths";
import { getSignedInMember } from "../session";
import { requestCode } from "./actions";
import { SignInForm } from "./sign-in-form";
import { titled } from "../page-title";

export const generateMetadata = titled("signIn.title");

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ limited?: string; error?: string }>;
}) {
  // Issue 219: a member already signed in has no use for the form; the account page is where one lands whether or not they have a subscription (issue 260).
  if (await getSignedInMember()) redirect(ACCOUNT_PATH);
  const { limited, error } = await searchParams;
  return (
    <Shell>
      <Card>{await SignInForm({ action: requestCode, limited, error, createHref: CREATE_ACCOUNT_PAGES.start })}</Card>
    </Shell>
  );
}
