import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly", URL: "readonly" } },
  },
  {
    // The core is framework-free (DEC-001): nothing under src/ may reach Next, React or the app.
    files: ["src/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react/*", "react-dom", "react-dom/*"],
              message: "The core under src/ is framework-free (DEC-001).",
            },
            {
              group: ["**/app", "**/app/*", "@/app", "@/app/*"],
              message: "The core under src/ may not import the app (DEC-001).",
            },
          ],
        },
      ],
    },
  },
);
