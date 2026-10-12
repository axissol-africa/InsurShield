import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CoverGuideLibrary from './CoverGuideLibrary';

const guide = {
  coverType: 'Comprehensive',
  planName: 'Comprehensive Gold Plan',
  summary: 'Full cover for your vehicle and for damage you cause to others.',
  coveredItems: ['Own damage — Market value', 'Theft and fire'],
  exclusions: ['Driving without a valid licence'],
  notifyWithinDays: '7',
  howToNotify: 'Call the claims line.',
  documentsRequired: ['Police report'],
  claimsContact: '+260 211 255 100',
  settlementTime: '14 working days',
  territorialLimit: 'Zambia',
  ncdAccepted: true,
  quoteValidityDays: '7',
};
const insurer = { id: '1', name: 'Prestige Assurance', coverGuides: { Comprehensive: guide } };

function show(props = {}) {
  const onSave = props.onSave || vi.fn().mockResolvedValue(undefined);
  render(<CoverGuideLibrary insurer={insurer} {...props} onSave={onSave} />);
  return { onSave };
}

beforeEach(() => {
  // The switch measures itself; jsdom has nothing to measure with.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

describe('CoverGuideLibrary', () => {
  it('opens a published guide complete, and says which cover types still need one', () => {
    show();

    expect(screen.getByRole('heading', { level: 1, name: 'Cover guides' })).toBeVisible();
    expect(screen.getByText('1 of 2 published')).toBeVisible();
    expect(screen.getByRole('tab', { name: /Comprehensive.*Published/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Third party only.*Needed/ })).toBeVisible();
    expect(screen.getByText('11 of 11 answered')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Questions answered' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByLabelText('Plan name *')).toHaveValue('Comprehensive Gold Plan');
    expect(screen.getByRole('switch', { name: 'No-claim discount accepted' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Update the guide' })).toBeVisible();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('previews exactly the document a customer reads', async () => {
    const user = userEvent.setup();
    show();

    await user.clear(screen.getByLabelText('Plan name *'));
    await user.type(screen.getByLabelText('Plan name *'), 'Comprehensive Platinum');
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Preview as a customer' }));
    expect(screen.getByRole('heading', { name: 'Comprehensive Platinum' })).toBeVisible();
    expect(screen.queryByLabelText('Plan name *')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to the form' }));
    expect(screen.getByLabelText('Plan name *')).toHaveValue('Comprehensive Platinum');
  });

  it('publishes the tidied answers and confirms it', async () => {
    const user = userEvent.setup();
    let finish;
    const onSave = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    show({ onSave });

    await user.type(screen.getByLabelText('Claims contact *'), '  ');
    await user.click(screen.getByRole('switch', { name: 'No-claim discount accepted' }));
    await user.click(screen.getByRole('button', { name: 'Update the guide' }));

    const publishing = screen.getByRole('button', { name: 'Publishing…' });
    expect(publishing).toBeDisabled();
    expect(publishing).toHaveAttribute('aria-busy', 'true');
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Comprehensive', { ...guide, ncdAccepted: false });

    await act(async () => { finish(); });
    expect(screen.getByRole('status')).toHaveTextContent('Published. Customers comparing comprehensive quotes see this guide.');
  });

  it('points at the first unanswered question instead of publishing', async () => {
    const user = userEvent.setup();
    const { onSave } = show();

    await user.clear(screen.getByLabelText('Claims contact *'));
    expect(screen.getByText('10 of 11 answered')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Update the guide' }));

    expect(screen.getByText('Answer the highlighted questions before publishing this guide.')).toBeVisible();
    const contact = screen.getByLabelText('Claims contact *');
    expect(contact).toHaveAttribute('aria-invalid', 'true');
    expect(contact).toHaveAccessibleDescription('“Claims contact” is needed.');
    await waitFor(() => expect(contact).toHaveFocus());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('says why a guide could not be saved and keeps the answers', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('Your insurer profile could not be found.'));
    show({ onSave });

    await user.click(screen.getByRole('button', { name: 'Update the guide' }));
    expect(await screen.findByText('Your insurer profile could not be found.')).toBeVisible();
    expect(screen.getByLabelText('Plan name *')).toHaveValue('Comprehensive Gold Plan');
    expect(screen.getByRole('button', { name: 'Update the guide' })).toBeEnabled();
  });

  it('saves one guide at a time, so a second save cannot overwrite the first', async () => {
    const user = userEvent.setup();
    let finish;
    const onSave = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const thirdParty = { ...guide, coverType: 'ThirdParty', planName: 'Third Party Basic' };
    show({ onSave, insurer: { ...insurer, coverGuides: { Comprehensive: guide, ThirdParty: thirdParty } } });

    // Enter held down submits the form again before the button has been disabled.
    const form = screen.getByLabelText('Plan name *').closest('form');
    act(() => {
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(onSave).toHaveBeenCalledOnce();

    // Each save sends the whole set of guides, so the other cover type waits its turn.
    await user.click(screen.getByRole('tab', { name: /Third party only/ }));
    const waiting = screen.getByRole('button', { name: 'Update the guide' });
    expect(waiting).toBeDisabled();
    expect(screen.getByText('Your comprehensive guide is still publishing.')).toBeVisible();
    await user.click(waiting);
    expect(onSave).toHaveBeenCalledOnce();

    await act(async () => { finish(); });
    expect(screen.getByRole('button', { name: 'Update the guide' })).toBeEnabled();
    expect(screen.queryByText('Your comprehensive guide is still publishing.')).not.toBeInTheDocument();
  });

  it('starts the other cover type from the same blank questions', async () => {
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole('tab', { name: /Third party only/ }));
    expect(await screen.findByLabelText('Plan name *')).toHaveValue('');
    expect(screen.getByText('0 of 11 answered')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Publish the guide' })).toBeVisible();
    expect(screen.getByText('Quotes for this cover type cannot be sent until this is published.')).toBeVisible();
  });

  it('adds and removes lines in a list answer', async () => {
    const user = userEvent.setup();
    show();
    const benefits = () => screen.getAllByRole('textbox', { name: /Covered benefits/ });

    expect(benefits().map((input) => input.value)).toEqual(['Own damage — Market value', 'Theft and fire']);
    const section = screen.getByRole('group', { name: 'What is covered' });
    await user.click(within(section).getByRole('button', { name: 'Add another' }));
    await user.type(benefits()[2], 'Windscreen cover');
    await user.click(within(section).getByRole('button', { name: 'Remove Covered benefits line 1' }));
    expect(benefits().map((input) => input.value)).toEqual(['Theft and fire', 'Windscreen cover']);
  });
});
