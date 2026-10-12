/** Helpers shared by the store slices. */
import { INSPECTION_KEYS } from '@/domain/inspection';

export const TODAY = () => new Date().toISOString().split('T')[0];
export const NOW = () => new Date().toISOString();

/** Document slots on a quote request: the White Book plus the seven live inspection photos. */
export const EMPTY_DOCUMENTS = { whiteBook: null, ...Object.fromEntries(INSPECTION_KEYS.map((key) => [key, null])) };

/** Unique, human-readable reference: prefix + timestamp + random suffix (two records in the same instant never collide). */
export const newReference = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

export const withTimestamp = (record, key = 'updatedAt') => ({ ...record, [key]: NOW() });

export const updateById = (items, id, updater) => items.map((item) => (item.id === id ? updater(item) : item));

/** Deactivated and removed insurers keep their history but receive no new quote requests. */
export const insurerReceivesRequests = (insurer) => !['Inactive', 'Deleted'].includes(insurer.status);
