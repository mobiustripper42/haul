/**
 * The settings `npm run test:square` builds `SquarePayments` from (issue 54, AC22). Always the
 * sandbox, whatever else `env` holds, and from the sandbox's own variables, so the production
 * credentials 1.4 wires into the app can never feed the run. A missing variable throws: the run fails
 * rather than skips.
 */
export function squareSandboxSettings(env: Record<string, string | undefined>): {
  accessToken: string;
  locationId: string;
  environment: "sandbox";
} {
  return {
    accessToken: required(env, "SQUARE_SANDBOX_ACCESS_TOKEN"),
    locationId: required(env, "SQUARE_SANDBOX_LOCATION_ID"),
    environment: "sandbox",
  };
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set; npm run test:square reads it from .env.local`);
  }
  return value;
}
