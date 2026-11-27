/**
 * Backend access for the whole app. Import `api` and call a resource:
 *
 *   import { api } from '@/api';
 *   const vehicle = await api.vehicles.lookupPlate('BAA 1234');
 *
 * `VITE_API_MODE=http` selects the real backend (`api/http`); anything else
 * uses browser storage (`api/mock`). Both implement `api/contracts.js`.
 */
export { api } from '@/api/adapter';
export { ApiError } from '@/lib/ApiError';
export { captureApi } from './capture';
