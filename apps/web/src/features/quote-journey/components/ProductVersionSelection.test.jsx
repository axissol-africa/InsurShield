import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/api';
import ProductVersionSelection from './ProductVersionSelection';

vi.mock('@/api', () => ({ api: { products: { directory: vi.fn(), estimate: vi.fn() } } }));
const product = (id) => ({
  product: { id: `product-${id}` }, insurer: { name: 'Insurer' },
  version: { id, name: `Cover ${id}`, number: 1, allowedDurations: ['Q4'], requirements: [
    { key: 'driver', kind: 'QUESTION', label: 'Driver name', required: true, config: { inputType: 'TEXT' } },
  ] },
});
const firstPage = Array.from({ length: 100 }, (_, index) => product(`v${index}`));
beforeEach(() => vi.resetAllMocks());

it('hydrates an eligible preselection beyond the first 100 with its period and requirements', async () => {
  const renewal = product('renewal');
  api.products.directory.mockImplementation(async ({ productVersionId }) => productVersionId ? [renewal] : firstPage);
  const onSelectionChange = vi.fn();
  render(<ProductVersionSelection selectedProductVersionIds={['renewal']} selectedProductVersions={[]} onSelectionChange={onSelectionChange} />);
  expect(await screen.findByLabelText('Select Cover renewal from Insurer')).toBeChecked();
  expect(screen.getByLabelText(/Driver name/)).toBeVisible();
  expect(onSelectionChange).toHaveBeenCalledWith(['renewal'], [renewal]);
  expect(onSelectionChange).not.toHaveBeenCalledWith([], []);
  expect(api.products.directory).toHaveBeenCalledWith({ coverType: 'COMPREHENSIVE', productVersionId: 'renewal', limit: 1 });
}, 30_000);

it('removes a preselection only after the server confirms it is unavailable', async () => {
  let resolveLookup;
  api.products.directory.mockImplementation(({ productVersionId }) => productVersionId
    ? new Promise((resolve) => { resolveLookup = resolve; }) : Promise.resolve([]));
  const onSelectionChange = vi.fn();
  render(<ProductVersionSelection selectedProductVersionIds={['withdrawn']} onSelectionChange={onSelectionChange} />);
  await waitFor(() => expect(resolveLookup).toBeTypeOf('function'));
  expect(onSelectionChange).not.toHaveBeenCalled();
  resolveLookup([]);
  await waitFor(() => expect(onSelectionChange).toHaveBeenCalledWith([], []));
});

it('preserves a preselection and reports failure when its availability cannot be checked', async () => {
  api.products.directory.mockImplementation(async ({ productVersionId }) => {
    if (productVersionId) throw new Error('Availability check failed');
    return [];
  });
  const onSelectionChange = vi.fn();
  const onLoadStateChange = vi.fn();
  render(<ProductVersionSelection selectedProductVersionIds={['renewal']} onSelectionChange={onSelectionChange} onLoadStateChange={onLoadStateChange} />);
  expect(await screen.findByText('Availability check failed')).toBeVisible();
  expect(onSelectionChange).not.toHaveBeenCalled();
  expect(onLoadStateChange).toHaveBeenLastCalledWith('error');
});
