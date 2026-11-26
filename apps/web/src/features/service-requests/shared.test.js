import { afterEach, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { openAttachment } from './shared';
vi.mock('@/api', () => ({ api: { documents: { get: vi.fn() } } }));
afterEach(() => vi.restoreAllMocks());
it('isolates the popup before loading a fresh signed URL', async () => {
  const popup = { opener: window, location: { href: '' }, close: vi.fn() };
  const open = vi.spyOn(window, 'open').mockReturnValue(popup);
  api.documents.get.mockImplementation(async () => {
    expect(popup.opener).toBeNull();
    return { url: 'https://documents.example.test/fresh' };
  });
  await expect(openAttachment({ id: 'DOC-1' })).resolves.toBeNull();
  expect(open).toHaveBeenCalledWith('', '_blank');
  expect(popup.location.href).toBe('https://documents.example.test/fresh');
});
it('returns a fresh fallback link when a popup is blocked without navigating the app', async () => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  api.documents.get.mockResolvedValue({ url: 'https://documents.example.test/fresh' });
  const location = window.location.href;
  await expect(openAttachment({ id: 'DOC-1' })).resolves.toBe('https://documents.example.test/fresh');
  expect(window.location.href).toBe(location);
});
it('closes the blank popup when obtaining a download URL fails', async () => {
  const popup = { opener: window, location: { href: '' }, close: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(popup);
  api.documents.get.mockRejectedValue(new Error('Not available.'));
  await expect(openAttachment({ id: 'DOC-1' })).rejects.toThrow('Not available.');
  expect(popup.close).toHaveBeenCalledOnce();
});
