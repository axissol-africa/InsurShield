import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '@/store';
import VehicleUsagePage from './VehicleUsagePage';

const usages = ['Individual', 'Individual (Motorcycles)', 'Commercial (Motorcycles)', 'Commercial (Cars for Hire)', 'Commercial (Small Public Buses)', 'Commercial (Trucks, Horses & Trailers)', 'Commercial (Taxis & Yangos)'];
function renderPage() {
  return render(<MemoryRouter initialEntries={['/vehicle-usage']}><Routes>
    <Route path="/vehicle-usage" element={<VehicleUsagePage />} />
    <Route path="/quote-request" element={<h1>Quote request</h1>} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  useStore.setState({ vehicleUsage: null, vehicleDetails: { make: 'Toyota', model: 'Hilux', plateNumber: 'BAA 1234' } });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

it.each(usages)('preserves the %s selection value through Continue', async (usage) => {
  const user = userEvent.setup();
  renderPage();
  const radio = screen.getAllByRole('radio')[usages.indexOf(usage)];
  expect(radio).toHaveAccessibleName(new RegExp(usage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await user.click(radio);
  expect(radio).toBeChecked();
  expect(useStore.getState().vehicleUsage).toBeNull();
  await user.click(screen.getByRole('button', { name: /Continue to quote request/ }));
  expect(screen.getByRole('heading', { name: 'Quote request' })).toBeInTheDocument();
  expect(useStore.getState().vehicleUsage).toBe(usage);
});
it('defaults to Individual and restores saved use on revisit', () => {
  const { unmount } = renderPage();
  expect(screen.getAllByRole('radio')[0]).toBeChecked();
  unmount();
  useStore.setState({ vehicleUsage: usages[6] });
  renderPage();
  expect(screen.getAllByRole('radio')[6]).toBeChecked();
  expect(screen.getByText(/can invalidate your policy/)).toBeInTheDocument();
});
