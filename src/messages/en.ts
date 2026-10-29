// English is the source catalog: every key exists here, and other languages may lack some.
export const en = {
  "home.title": "OCF Member Portal",
  "home.coreCheck": "Core check: {amount}",
  "language.label": "Language",
  "home.signIn": "Sign in",
  "home.signedInAs": "Signed in as {email}",
  "home.signOut": "Sign out",
  "signIn.title": "Sign in",
  "signIn.limited": "Too many sign-in requests from this network. Try again in {minutes} min.",
  "signIn.stepExpired": "That sign-in step expired. Enter your email to get a new code.",
  "signIn.emailLabel": "Email",
  "signIn.sendCode": "Email me a code",
  "signIn.codeTitle": "Enter your code",
  "signIn.codeSent": "If {email} has an account, a 6-digit code is on its way. It expires in {minutes} minutes.",
  "signIn.invalidCode": "That code didn't match, or it has expired. Check it and try again, or ask for a new one.",
  "signIn.codeLabel": "6-digit code",
  "signIn.submitCode": "Sign in",
  "signIn.resend": "Send a new code",
  "signIn.differentEmail": "Use a different email",
  "email.signInCode.subject": "Your OCF Member Portal sign-in code",
  "email.signInCode.body":
    "Your sign-in code is {code}.\n\nIt expires in {minutes} minutes. If you didn't ask for it, you can ignore this email.",
  "email.signOff": "— Ohio City Farm",
} as const satisfies Record<string, string>;

export type MessageKey = keyof typeof en;
