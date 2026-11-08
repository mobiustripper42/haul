import { Card } from "../../components/ui/card";
import { Shell } from "../../components/ui/shell";
import { CREATE_ACCOUNT_PAGES } from "../paths";
import { requestCode } from "./actions";
import { SignInForm } from "./sign-in-form";
import { titled } from "../page-title";

export const generateMetadata = titled("signIn.title");

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ limited?: string; error?: string }>;
}) {
  const { limited, error } = await searchParams;
  return (
    <Shell>
      <Card>{await SignInForm({ action: requestCode, limited, error, createHref: CREATE_ACCOUNT_PAGES.start })}</Card>
    </Shell>
  );
}
