/**
 * Runtime configuration. Values come from Vite environment variables
 * (`.env`, `.env.local`, or the hosting platform); see `.env.example`.
 */
/** A variable left blank in a `.env` file counts as unset, not as an empty value. */
const read = (value, fallback) => (value === undefined || value === null || value === '' ? fallback : value);

export const env = Object.freeze({
  appName: 'InsurShield',
  /** `mock` keeps every record in browser storage; `http` talks to the backend. */
  apiMode: import.meta.env.VITE_API_MODE === 'http' ? 'http' : 'mock',
  /** Base URL of the backend REST API when `apiMode` is `http`. */
  apiBaseUrl: read(import.meta.env.VITE_API_BASE_URL, '/api/v1'),
  /** Milliseconds a mock call takes, so loading states are visible in demos. */
  mockLatencyMs: Number(read(import.meta.env.VITE_MOCK_LATENCY_MS, 600)),

  /**
   * Keycloak handles sign-in and sign-up regardless of `apiMode`: identity is
   * always real, even while quote data is still served from browser storage.
   */
  keycloakUrl: read(import.meta.env.VITE_KEYCLOAK_URL, 'http://localhost:8080'),
  keycloakRealm: read(import.meta.env.VITE_KEYCLOAK_REALM, 'insurshield'),
  keycloakClientId: read(import.meta.env.VITE_KEYCLOAK_CLIENT_ID, 'insurshield-web'),
  isProduction: import.meta.env.PROD,
});
