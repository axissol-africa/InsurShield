/**
 * Backend access for the whole app. Import `api` and call a resource:
 *
 *   import { api } from '@/api';
 *   const vehicle = await api.vehicles.lookupPlate('BAA 1234');
 *
 * `VITE_API_MODE=http` selects the real backend (`api/http`); anything else
 * uses browser storage (`api/mock`). Both implement `api/contracts.js`.
 */
import { env } from '@/config/env';
import * as http from './http';
import * as mock from './mock';

export const api = env.apiMode === 'http' ? http : mock;
export { ApiError } from '@/lib/apiClient';
export { captureApi } from './capture';
