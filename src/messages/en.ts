// English is the source catalog: every key exists here, and other languages may lack some.
export const en = {
  "home.title": "OCF Member Portal",
  "home.coreCheck": "Core check: {amount}",
  "language.label": "Language",
  "brand.name": "Ohio City Farm",
  "brand.byline": "by Re:Source Cleveland",
  "home.signIn": "Sign in",
  "home.signedInAs": "Signed in as {email}",
  "home.signOut": "Sign out",
  "home.adminPage": "Admin Page",
  "admin.title": "Admin Page",
  "admin.memberPage": "Member Page",
  "signIn.title": "Sign in",
  "signIn.limited": "Too many sign-in requests from this network. Try again in {minutes} min.",
  "signIn.stepExpired": "That sign-in step expired. Enter your email to get a new code.",
  "signIn.emailLabel": "Email",
  "signIn.sendCode": "Email me a code",
  "signIn.codeTitle": "Enter your code",
  "signIn.codeSent":
    "If {email} has an account, a 6-digit code is on its way. It expires in {minutes} minutes, and a new one can be sent after that.",
  "signIn.invalidCode":
    "That code didn't match, or it has expired. Check it and try again, or ask for a new one. After 5 wrong tries, check your email for a sign-in link.",
  "signIn.codeLabel": "6-digit code",
  "signIn.submitCode": "Sign in",
  "signIn.resend": "Send a new code",
  "signIn.differentEmail": "Use a different email",
  "signIn.linkPrompt": "Press the button to finish signing in.",
  "signIn.linkFailed":
    "That sign-in link didn't work. It may have expired or been used already. Enter your email to try again.",
  "email.signInCode.subject": "Your OCF Member Portal sign-in code",
  "email.signInCode.body":
    "Your sign-in code is {code}.\n\nIt expires in {minutes} minutes. If you didn't ask for it, you can ignore this email.",
  "email.signInLink.subject": "Your OCF Member Portal sign-in link",
  "email.signInLink.body":
    "Too many wrong codes were entered for your account, so sign-in by code is paused for up to 24 hours.\n\nUse this link to sign in instead:\n{link}\n\nIt works once and expires in {minutes} minutes. If you didn't try to sign in, you can ignore this email.",
  "email.signOff": "— Ohio City Farm",
} as const satisfies Record<string, string>;

export type MessageKey = keyof typeof en;
