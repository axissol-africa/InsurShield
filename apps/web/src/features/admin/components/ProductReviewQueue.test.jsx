import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '@/store';
import * as mock from '@/api/mock';
import ProductReviewQueue from './ProductReviewQueue';

vi.mock('@/config/env', () => ({ env: { apiMode: 'mock', apiBaseUrl: '/api/v1', mockLatencyMs: 0, appName: 'InsurShield', isProduction: false } }));

const initial = useStore.getInitialState();
const guide = {
  planName: 'Comprehensive Select', summary: 'A full motor policy for private vehicles.', coveredItems: ['Own damage'], exclusions: ['Driving without a valid licence'],
  notifyWithinDays: 7, howToNotify: 'Call the claims line.', documentsRequired: ['Police report'], claimsContact: '+260 211 255 100',
  settlementTime: '14 working days', territorialLimit: 'Zambia', ncdAccepted: true, quoteValidityDays: 7,
};

beforeEach(() => {
  localStorage.removeItem('insurshield.mock.products.v1');
  useStore.setState({ ...initial, staffSession: { role: 'insurer', staffRole: 'INSURER_ADMIN', name: 'Prestige Assurance' } }, true);
});

describe('ProductReviewQueue', () => {
  it('lets an administrator approve the submitted version and removes it from the review queue', async () => {
    const product = await mock.products.insurer.create({ code: 'MOTOR-COMP-02', name: 'Comprehensive Select', coverType: 'COMPREHENSIVE', coverGuide: guide, inspectionRule: 'NOT_REQUIRED', effectiveFrom: '2026-11-13' });
    await mock.products.insurer.submit(product.product.id, product.id);
    useStore.getState().startStaffSession({ id: 'reviewer', role: 'admin', staffRole: 'SUPER_ADMIN', isSuperAdmin: true, name: 'Reviewer' });
    const user = userEvent.setup();

    render(<ProductReviewQueue api={mock} onBack={vi.fn()} />);
    expect((await screen.findAllByText('Comprehensive Select')).at(0)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Approve version' }));

    expect(await screen.findByText('Approved Prestige Assurance’s version 1.')).toBeVisible();
    await waitFor(async () => expect(await mock.products.admin.list({ status: 'SUBMITTED' })).toEqual([]));
  });
});
