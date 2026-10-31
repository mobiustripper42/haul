import localFont from "next/font/local";

// Montserrat and Oswald, vendored under app/fonts/ and loaded from disk (DEC-020). Exposed as the CSS
// variables --font-montserrat and --font-oswald, which the @theme's --font-sans and --font-display in
// app/globals.css lead with.
//
// next/font/google downloads the files during `next build`, so a build can fail on a network it has
// nothing to do with; these load from the repo instead. The design README says "Load both from
// Google Fonts"; Eric decided on files instead (2026-10-30).
//
// Adding a weight means adding a file: a browser synthesizes a face it hasn't got rather than
// refusing. app/fonts.test.ts reads the src lists below and fails the gate on either half of that.
//
// Provenance: Google Fonts' family downloads for Montserrat and Oswald (SIL OFL 1.1, the licence
// beside each family in app/fonts/). Each file is one static weight cut to Google's latin range, with
// Spanish letters and the euro sign present, as woff2. To re-cut one, from the family download's
// static/ folder (fontTools):
//
//   pyftsubset Montserrat-Regular.ttf --flavor=woff2 --layout-features='*' \
//     --output-file=montserrat-400.woff2 \
//     --unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
//
// Montserrat-Medium.ttf is 500 and Montserrat-SemiBold.ttf 600; Oswald-Regular.ttf is 400 and
// Oswald-Medium.ttf 500.
const montserrat = localFont({
  src: [
    { path: "./fonts/montserrat-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/montserrat-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/montserrat-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-montserrat",
  display: "swap",
});
const oswald = localFont({
  src: [
    { path: "./fonts/oswald-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/oswald-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-oswald",
  display: "swap",
});

/** Both families' next/font variable class names, to set on <html>. */
export const fontVariables: string = `${montserrat.variable} ${oswald.variable}`;
