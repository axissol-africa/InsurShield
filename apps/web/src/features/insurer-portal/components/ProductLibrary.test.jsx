import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '@/store';
import { api } from '@/api';
import ProductLibrary from './ProductLibrary';

vi.mock('@/config/env', () => ({ env: { apiMode: 'mock', apiBaseUrl: '/api/v1', mockLatencyMs: 0, appName: 'InsurShield', isProduction: false } }));

const initial = useStore.getInitialState();

beforeEach(() => {
  localStorage.removeItem('insurshield.mock.products.v1');
  useStore.setState({ ...initial, staffSession: { role: 'insurer', staffRole: 'INSURER_ADMIN', name: 'Prestige Assurance' } }, true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

describe('ProductLibrary', () => {
  it('starts a versioned draft without changing the existing customer guide cache', async () => {
    const user = userEvent.setup();
    const insurer = useStore.getState().insurersList.find((entry) => entry.name === 'Prestige Assurance');
    const previousGuide = insurer.coverGuides.Comprehensive;
    render(<ProductLibrary insurer={insurer} canManage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Product terms' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'New product' }));
    await user.type(screen.getByLabelText('Product code'), 'motor-comp-02');
    await user.type(screen.getByLabelText('Product name'), 'Comprehensive Select');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByText('MOTOR-COMP-02')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeVisible();
    await waitFor(async () => expect((await api.products.insurer.list()).some((product) => product.code === 'MOTOR-COMP-02')).toBe(true));
    expect(useStore.getState().insurersList.find((entry) => entry.id === insurer.id).coverGuides.Comprehensive).toEqual(previousGuide);
  });

  it('saves only API-owned cover-guide terms and does not confirm a failed save', async () => {
    const user = userEvent.setup();
    const insurer = useStore.getState().insurersList.find((entry) => entry.name === 'Prestige Assurance');
    render(<ProductLibrary insurer={insurer} canManage />);

    await user.click(await screen.findByRole('button', { name: 'New product' }));
    await user.type(screen.getByLabelText('Product code'), 'motor-comp-03');
    await user.type(screen.getByLabelText('Product name'), 'Comprehensive Essential');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await user.click(await screen.findByRole('button', { name: 'Save guide draft' }));

    await waitFor(async () => {
      const product = (await api.products.insurer.list()).find((entry) => entry.code === 'MOTOR-COMP-03');
      expect(product.versions[0].coverGuide).not.toHaveProperty('coverType');
    });

    const save = vi.spyOn(api.products.insurer, 'updateDraft').mockRejectedValueOnce(new Error('Network unavailable'));
    await user.click(screen.getByRole('button', { name: 'Save guide draft' }));
    expect(await screen.findByText('The cover guide could not be saved.')).toBeVisible();
    expect(screen.queryByText('Cover guide draft saved. Submit when every answer is ready for review.')).not.toBeInTheDocument();
    save.mockRestore();
  });
});
