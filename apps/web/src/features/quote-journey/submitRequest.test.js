import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/apiClient';
import { api } from '@/api';
import { useStore } from '@/store';
import { submitQuoteRequest } from './submitRequest';

// The journey stores captures as data URLs; reading them back is the browser's
// job and not what this test is about.
vi.mock('@/lib/files', () => ({
  toUploadableFile: vi.fn(async (_value, name) => new File(['bytes'], `${name}.pdf`, { type: 'application/pdf' })),
}));

vi.mock('@/api', () => ({
  api: {
    documents: { upload: vi.fn() },
    quotes: { submitRequest: vi.fn() },
  },
}));

const customer = { fullName: 'Mwiza Banda', phone: '0970123456', email: 'mwiza.banda@insurshield.zm' };
const policyDates = { startDate: '2026-11-01', endDate: '2027-10-31' };

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({
    customer,
    documents: { whiteBook: { name: 'white-book.pdf', type: 'application/pdf', size: 10, dataUrl: 'data:application/pdf;base64,JVBERi0=' } },
  });
});

describe('submitQuoteRequest when an upload is refused', () => {
  it('stops before the request is sent and keeps the reason the server gave', async () => {
    api.documents.upload.mockRejectedValue(
      new ApiError('That file was refused by the security scan. Upload a different file.', {
        status: 422,
        code: 'FILE_REJECTED',
      }),
    );

    await expect(submitQuoteRequest({ customer, policyDates })).rejects.toMatchObject({
      code: 'FILE_REJECTED',
      message: 'That file was refused by the security scan. Upload a different file.',
    });
    expect(api.quotes.submitRequest).not.toHaveBeenCalled();
  });

  it('passes a scanner outage through as its own message, so the customer is told to retry', async () => {
    api.documents.upload.mockRejectedValue(
      new ApiError('Files cannot be checked for viruses right now. Please try again shortly.', {
        status: 503,
        code: 'FILE_SCAN_UNAVAILABLE',
      }),
    );

    await expect(submitQuoteRequest({ customer, policyDates })).rejects.toMatchObject({
      code: 'FILE_SCAN_UNAVAILABLE',
      message: 'Files cannot be checked for viruses right now. Please try again shortly.',
    });
    expect(api.quotes.submitRequest).not.toHaveBeenCalled();
  });
});
