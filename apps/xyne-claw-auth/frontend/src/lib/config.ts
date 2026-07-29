const SPACES_AUTH_BASE_URL = import.meta.env.VITE_SPACES_AUTH_BASE_URL
  || (import.meta.env.VITE_XYNE_BACKEND_URL || "");

const CLAW_API_BASE_URL = import.meta.env.VITE_CLAW_API_BASE_URL
  || import.meta.env.VITE_AUTH_API_URL
  || "/claw";

export const frontendConfig = {
  spacesAuthBaseUrl: SPACES_AUTH_BASE_URL,
  clawApiBaseUrl: CLAW_API_BASE_URL,
} as const;
