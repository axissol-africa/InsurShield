import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSessionSlice } from './slices/session';
import { createJourneySlice } from './slices/journey';
import { createCatalogueSlice } from './slices/catalogue';
import { createRecordsSlice } from './slices/records';
import { STORAGE_KEY, STORAGE_VERSION, merge, migrate, partialize } from './persistence';

/**
 * InsurShield application store.
 *
 * One persisted Zustand store composed of four slices:
 *  - session   – customer accounts, staff session, consent
 *  - journey   – the quote journey in progress
 *  - catalogue – insurers and platform configuration (admin-owned)
 *  - records   – quote requests, policies, claims, NCD, inspections
 *
 * In the prototype the store is also the persistence layer (browser storage).
 * With a backend it becomes the client-side cache: the `api/` modules fetch and
 * mutate records and the slices are hydrated from their responses.
 */
export const useStore = create(
  persist(
    (set, get) => ({
      ...createSessionSlice(set, get),
      ...createJourneySlice(set, get),
      ...createCatalogueSlice(set, get),
      ...createRecordsSlice(set, get),
    }),
    { name: STORAGE_KEY, version: STORAGE_VERSION, merge, migrate, partialize },
  ),
);
