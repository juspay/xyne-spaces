const CLAW_AUTH_URL_DEFAULT = "http://localhost:3003";

export function clawAuthUrl(): string {
  return (process.env["XYNE_CLAW_AUTH_URL"] ?? CLAW_AUTH_URL_DEFAULT).replace(/\/+$/, "");
}
