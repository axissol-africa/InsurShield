import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RuleSettingsWorkspace from './RuleSettingsWorkspace';

const taxonomyTerm = {
  id: 'term-medical-limit',
  code: 'MEDICAL_LIMIT',
  label: 'Medical expenses limit',
  description: 'Maximum medical benefit per claim.',
  category: 'LIMIT',
  dataType: 'CURRENCY',
  unit: 'ZMW',
  allowedValues: [],
  displayRule: 'SHOW_WHEN_PROVIDED',
  displayOrder: 20,
  versionNumber: 1,
  status: 'ACTIVE',
};

const createApi = () => ({
  settings: {
    rules: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'rule-1' }),
      confirm: vi.fn().mockResolvedValue({ id: 'rule-1' }),
    },
    taxonomy: {
      list: vi.fn().mockResolvedValue([taxonomyTerm]),
      create: vi.fn().mockResolvedValue({ id: 'term-new' }),
      update: vi.fn().mockResolvedValue({ ...taxonomyTerm, versionNumber: 2 }),
    },
  },
});

describe('RuleSettingsWorkspace', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });

  it('sends the typed quote-deadline template as a provisional version', async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(<RuleSettingsWorkspace api={api} onBack={vi.fn()} onOpenPia={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Rules and comparison terms' });
    await user.click(screen.getByRole('button', { name: 'Save provisional version' }));

    await waitFor(() => expect(api.settings.rules.create).toHaveBeenCalledWith(
      'QUOTE_REPLY_DEADLINE',
      expect.objectContaining({ value: { days: 7 }, effectiveFrom: expect.any(String) }),
    ));
    expect(screen.getByRole('status')).toHaveTextContent('Quote reply deadline was saved as a provisional version.');
  });

  it('keeps a comparison code immutable when an administrator edits its version', async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(<RuleSettingsWorkspace api={api} onBack={vi.fn()} onOpenPia={vi.fn()} />);

    await screen.findByText('Medical expenses limit');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Customer label'));
    await user.type(screen.getByLabelText('Customer label'), 'Medical benefit limit');
    await user.click(screen.getByRole('button', { name: 'Update term' }));

    await waitFor(() => expect(api.settings.taxonomy.update).toHaveBeenCalledWith(
      'term-medical-limit',
      expect.objectContaining({ label: 'Medical benefit limit', category: 'LIMIT', dataType: 'CURRENCY' }),
    ));
    expect(api.settings.taxonomy.update.mock.calls[0][1]).not.toHaveProperty('code');
  });
});

it('offers the provisional claim reporting template', async () => {
  const user = userEvent.setup();
  const api = createApi();
  render(<RuleSettingsWorkspace api={api} onBack={vi.fn()} onOpenPia={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: /Claim reporting/ }));
  await user.click(screen.getByRole('button', { name: 'Save provisional version' }));
  await waitFor(() => expect(api.settings.rules.create).toHaveBeenCalledWith('CLAIM_REPORTING', expect.objectContaining({ value: {
    reportingDays: 14, responseDays: 7, excludedTypes: { COMPREHENSIVE: [], THIRD_PARTY: ['Theft', 'Fire Damage', 'Natural Disaster', 'Windscreen Damage'] }, requireAttachmentsFor: ['Theft'], requirePoliceReportFor: ['Theft'],
  } })));
});

it('offers the review policy and submits configurable private retention days', async () => {
  const user = userEvent.setup();
  const api = createApi();
  render(<RuleSettingsWorkspace api={api} onBack={vi.fn()} onOpenPia={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: /Review policy/ }));
  const value = screen.getByLabelText('Rule value');
  const template = { submissionDays: 90, editDays: 30, appealDays: 30, appealDecisionDays: 14, privateRetentionDays: 365 };
  expect(JSON.parse(value.value)).toEqual(template);
  await user.clear(value);
  await user.paste(JSON.stringify({ ...template, privateRetentionDays: 730 }));
  await user.click(screen.getByRole('button', { name: 'Save provisional version' }));
  await waitFor(() => expect(api.settings.rules.create).toHaveBeenCalledWith('REVIEW_POLICY', expect.objectContaining({
    value: { ...template, privateRetentionDays: 730 },
  })));
  expect(screen.getByRole('status')).toHaveTextContent('Review policy was saved as a provisional version.');
});

const reputationPolicy = { ratingWindowDays: 365, minimumReviews: 10, badgeWindowDays: 90, badgeMinimumPolicies: 30, badgeThresholdBps: 9000, badgeValidityHours: 48 };

it('offers the exact reputation template and saves a configurable provisional version', async () => {
  const user = userEvent.setup();
  const api = createApi();
  render(<RuleSettingsWorkspace api={api} onBack={vi.fn()} onOpenPia={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: /Reputation policy/ }));
  expect(screen.getAllByText(/Confirm only after Product and Compliance approval under DEC-014/).length).toBeGreaterThan(0);
  const input = screen.getByLabelText('Rule value');
  expect(JSON.parse(input.value)).toEqual(reputationPolicy);
  const value = { ...reputationPolicy, badgeThresholdBps: 9500 };
  await user.clear(input);
  await user.paste(JSON.stringify(value));
  await user.type(screen.getByLabelText(/Reason for this version/), 'Method approved under DEC-014');
  await user.click(screen.getByRole('button', { name: 'Save provisional version' }));
  await waitFor(() => expect(api.settings.rules.create).toHaveBeenCalledWith('REPUTATION_POLICY', expect.objectContaining({
    value, effectiveFrom: expect.any(String), note: 'Method approved under DEC-014',
  })));
  expect(api.settings.rules.confirm).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('Reputation policy was saved as a provisional version.');
});

it('confirms a saved reputation version through the existing admin workflow', async () => {
  const user = userEvent.setup();
  const api = createApi();
  const provisional = { id: 'reputation-1', key: 'REPUTATION_POLICY', versionNumber: 1, state: 'PROVISIONAL', value: reputationPolicy, effectiveFrom: '2026-11-26', createdAt: '2026-11-26T00:00:00Z' };
  api.settings.rules.list.mockResolvedValue([provisional]);
  render(<RuleSettingsWorkspace api={api} onBack={vi.fn()} onOpenPia={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: /Reputation policy/ }));
  const confirm = await screen.findByRole('button', { name: 'Confirm', exact: true });
  api.settings.rules.list.mockResolvedValue([{ ...provisional, id: 'reputation-2', versionNumber: 2, state: 'CONFIRMED' }]);
  await user.click(confirm);
  await waitFor(() => expect(api.settings.rules.confirm).toHaveBeenCalledWith('REPUTATION_POLICY', 'reputation-1'));
  expect(await screen.findByText('Confirmed', { exact: true })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm', exact: true })).not.toBeInTheDocument();
});

it('preserves reputation edits when the API rejects a value', async () => {
  const user = userEvent.setup();
  const api = createApi();
  api.settings.rules.create.mockRejectedValue(new Error('Correct the rule value before saving it.'));
  render(<RuleSettingsWorkspace api={api} onBack={vi.fn()} onOpenPia={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: /Reputation policy/ }));
  const input = screen.getByLabelText('Rule value');
  const invalid = JSON.stringify({ ...reputationPolicy, badgeThresholdBps: 10001 });
  await user.clear(input);
  await user.paste(invalid);
  await user.click(screen.getByRole('button', { name: 'Save provisional version' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Correct the rule value before saving it.');
  expect(input).toHaveValue(invalid);
  expect(api.settings.rules.confirm).not.toHaveBeenCalled();
});
