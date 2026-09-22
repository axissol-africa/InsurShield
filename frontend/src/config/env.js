/**
 * Runtime configuration. Values come from Vite environment variables
 * (`.env`, `.env.local`, or the hosting platform); see `.env.example`.
 */
export const env = Object.freeze({
  appName: 'InsurShield',
  /** `mock` keeps every record in browser storage; `http` talks to the backend. */
  apiMode: import.meta.env.VITE_API_MODE === 'http' ? 'http' : 'mock',
  /** Base URL of the backend REST API when `apiMode` is `http`. */
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  /** Milliseconds a mock call takes, so loading states are visible in demos. */
  mockLatencyMs: Number(import.meta.env.VITE_MOCK_LATENCY_MS ?? 600),
  isProduction: import.meta.env.PROD,
});
