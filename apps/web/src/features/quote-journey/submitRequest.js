import { api } from '@/api';
import { useStore } from '@/store';
import { INSPECTION_KEYS } from '@/domain/inspection';
import { toUploadableFile } from '@/lib/files';
import { env } from '@/config/env';
import { submitWithRetry } from '@/api/idempotency';

/**
 * Sending the journey to every insurer.
 *
 * The captures live on the device as data URLs while the customer works
 * through the journey; they are uploaded here, immediately before the request
 * that references them, so a half-finished journey never leaves anything
 * behind on the server. The uploads run together because there are seven of
 * them and they are the slowest part of pressing Send.
 */
const uploadInspectionShots = async (documents) => {
  const captured = INSPECTION_KEYS.filter((key) => documents[key]);
  return Promise.all(
    captured.map(async (shotKey) => ({
      shotKey,
      documentId: (await api.documents.upload(await toUploadableFile(documents[shotKey], shotKey), 'INSPECTION_PHOTO')).id,
    })),
  );
};

const documentFingerprint = (value) => {
  if (typeof value === 'string') return `${value.slice(0, 64)}:${value.length}`;
  if (value && typeof value === 'object') return `${value.name ?? 'file'}:${value.size ?? 0}:${value.lastModified ?? 0}`;
  return null;
};

/**
 * Submits the current journey and returns the new request.
 *
 * The payload is the `QuoteRequest` shape from `api/contracts.js`, so the same
 * call works against the backend or browser storage. The store is updated from
 * the response, which is the server's version of the record rather than ours.
 */
export async function submitQuoteRequest({ customer, policyDates }) {
  const state = useStore.getState();
  const { vehicleDetails, documents } = state;
  const fingerprint = JSON.stringify({
    customer: customer?.email,
    vehicleDetails,
    documents: Object.fromEntries(Object.entries(documents).map(([key, value]) => [key, documentFingerprint(value)])),
    vehicleValue: state.vehicleValue,
    vehicleUsage: state.vehicleUsage,
    insuranceType: state.insuranceType,
    coverageDurationId: state.coverageDurationId,
    matchRtsaAnniversary: state.matchRtsaAnniversary,
    rtsaRegistrationDate: state.rtsaRegistrationDate,
    policyDates,
    ncdCode: state.ncdCodeValidated ? state.ncdCode : undefined,
  });

  try {
    const request = await submitWithRetry({
      operation: 'quote-request',
      fingerprint,
      prepare: async () => {
        const inspectionShots = await uploadInspectionShots(documents);
        const whiteBook = documents.whiteBook
          ? await api.documents.upload(await toUploadableFile(documents.whiteBook, 'white-book'), 'WHITE_BOOK')
          : null;
        return {
          customer,
          vehicleDetails: {
            plateNumber: vehicleDetails.plateNumber,
            make: vehicleDetails.make,
            model: vehicleDetails.model,
            year: String(vehicleDetails.year),
            color: vehicleDetails.color || undefined,
            chassisNumber: vehicleDetails.chassisNumber || undefined,
            engineNumber: vehicleDetails.engineNumber || undefined,
            registrationDate: vehicleDetails.registrationDate || undefined,
            registrationCountry: vehicleDetails.registrationCountry || undefined,
            rtsaAnniversaryDate: vehicleDetails.rtsaAnniversaryDate || undefined,
          },
          vehicleValue: state.vehicleValue,
          vehicleUsage: state.vehicleUsage,
          insuranceType: state.insuranceType,
          coverageDurationId: state.coverageDurationId,
          matchRtsaAnniversary: state.matchRtsaAnniversary,
          rtsaRegistrationDate: state.rtsaRegistrationDate || undefined,
          policyDates: policyDates?.startDate && policyDates?.endDate
            ? { startDate: policyDates.startDate, endDate: policyDates.endDate }
            : undefined,
          whiteBookDocumentId: whiteBook?.id,
          inspectionShots,
          photosCapturedAt: state.photosCapturedAt || undefined,
          ncdCode: state.ncdCodeValidated ? state.ncdCode : undefined,
        };
      },
      send: (payload, idempotencyKey) => api.quotes.submitRequest(payload, idempotencyKey),
    });

    useStore.getState().receiveQuoteRequest(request);
    return request;
  } catch (error) {
    // The local prototype must remain demonstrable when its optional Nest API
    // is not running. Production never creates a browser-only request: only
    // a development network outage falls back to the persisted demo record.
    if (!env.isProduction && env.apiMode === 'http' && error.code === 'NETWORK') {
      const id = useStore.getState().submitQuoteRequest({ customer, policyDates });
      return useStore.getState().quoteRequests.find((request) => request.id === id);
    }
    throw error;
  }
}
