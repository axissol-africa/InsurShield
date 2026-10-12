import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { useStore } from '@/store';
import VehicleIdentificationPage from './VehicleIdentificationPage';

const vehicle = { plateNumber: 'BAA 1234', chassisNumber: 'VIN123', engineNumber: 'ENGINE1', make: 'Toyota', model: 'Hilux', year: '2020', color: 'White', registrationDate: '2020-05-01', rtsaAnniversaryDate: '2026-05-01' };
function renderPage() {
  return render(<MemoryRouter initialEntries={['/vehicle-identification']}><Routes>
    <Route path="/vehicle-identification" element={<VehicleIdentificationPage />} />
    <Route path="/vehicle-usage" element={<h1>Vehicle use</h1>} />
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  useStore.setState({ vehicleDetails: null, vehicleValue: 0 });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('looks up a vehicle and requires a positive value plus acknowledgement before saving', async () => {
  vi.spyOn(api.vehicles, 'lookupPlate').mockResolvedValue(vehicle);
  const user = userEvent.setup();
  renderPage();
  await user.type(screen.getByPlaceholderText('e.g. BAA 1234'), 'baa 1234');
  await user.click(screen.getByRole('button', { name: 'Find vehicle' }));
  await screen.findByText('Vehicle found — check the details');
  expect(api.vehicles.lookupPlate).toHaveBeenCalledWith('BAA 1234');
  await user.click(screen.getByRole('button', { name: 'Confirm & continue' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter the current market value');
  expect(screen.getByPlaceholderText('e.g. 200000')).toHaveFocus();
  expect(useStore.getState().vehicleDetails).toBeNull();
  await user.type(screen.getByPlaceholderText('e.g. 200000'), '250000');
  await user.click(screen.getByRole('button', { name: 'Confirm & continue' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Confirm that the declared value is accurate');
  expect(screen.getByRole('checkbox')).toHaveFocus();
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Confirm & continue' }));
  expect(screen.getByRole('heading', { name: 'Vehicle use' })).toBeInTheDocument();
  expect(useStore.getState().vehicleDetails).toEqual({ ...vehicle, registrationCountry: 'Zambia' });
  expect(useStore.getState().vehicleValue).toBe(250000);
});

it('allows manual recovery after lookup failure and normalizes an Other country', async () => {
  vi.spyOn(api.vehicles, 'lookupPlate').mockRejectedValue(new Error('RTSA is unavailable'));
  const user = userEvent.setup();
  renderPage();
  await user.type(screen.getByPlaceholderText('e.g. BAA 1234'), 'BAA 1234');
  await user.click(screen.getByRole('button', { name: 'Find vehicle' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('RTSA is unavailable');
  await user.click(screen.getByRole('tab', { name: 'Manual entry' }));
  await user.type(await screen.findByLabelText(/Chassis number/), 'vin123');
  await user.type(screen.getByLabelText(/^Make/), 'Toyota');
  await user.type(screen.getByLabelText(/^Model/), 'Hilux');
  await user.selectOptions(screen.getByLabelText(/Country of registration/), 'Other');
  await user.type(screen.getByLabelText(/Type the country/), '  western   sahara  ');
  await user.type(screen.getByLabelText('RTSA registration date'), '2020-05-01');
  await user.type(screen.getByPlaceholderText('e.g. 200000'), '100000');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Save & continue' }));
  expect(screen.getByRole('heading', { name: 'Vehicle use' })).toBeInTheDocument();
  expect(useStore.getState().vehicleDetails).toMatchObject({ chassisNumber: 'VIN123', registrationCountry: 'western sahara', registrationDate: '2020-05-01' });
  expect(useStore.getState().vehicleValue).toBe(100000);
});

it('clears abandoned Other country text and keeps identity fields required', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole('tab', { name: 'Manual entry' }));
  expect(await screen.findByLabelText(/Chassis number/)).toBeRequired();
  expect(screen.getByLabelText(/^Make/)).toBeRequired();
  expect(screen.getByLabelText(/^Model/)).toBeRequired();
  await user.selectOptions(screen.getByLabelText(/Country of registration/), 'Other');
  await user.type(screen.getByLabelText(/Type the country/), 'Atlantis');
  await user.selectOptions(screen.getByLabelText(/Country of registration/), 'Zambia');
  expect(screen.queryByLabelText(/Type the country/)).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText(/Country of registration/), 'Other');
  expect(screen.getByLabelText(/Type the country/)).toHaveValue('');
});
