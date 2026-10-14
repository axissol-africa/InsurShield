import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import QuoteRequestForm from './QuoteRequestForm';
import { blankCoverGuide, COVER_GUIDE_SECTIONS } from '@/domain/coverGuide';
import { quoteOpenUntil } from '@/features/insurer-portal/portal';

/** A guide with every question answered, whatever the questions currently are. */
const completeGuide = () => {
  const guide = blankCoverGuide('Comprehensive');
  for (const field of COVER_GUIDE_SECTIONS.flatMap((section) => section.fields)) {
    if (field.kind === 'list') guide[field.key] = ['One line'];
    else if (field.kind === 'boolean') guide[field.key] = true;
    else if (field.kind === 'days') guide[field.key] = '7';
    else if (field.kind === 'choice') guide[field.key] = field.options[0];
    else guide[field.key] = 'Answered';
  }
  return { ...guide, planName: 'Comprehensive Gold Plan' };
};

const request = {
  id: 'QR-DOC', vehicle: '2020 Toyota Hilux', plate: 'BAA 1234', value: 'ZMW 250,000.00', vehicleValue: 250000, usage: 'Individual',
  vehicleUsage: 'Individual', coverage: 'Comprehensive', insuranceType: 'Comprehensive', period: '1 Year (12 Months)', dates: 'From payment date',
  client: 'Mwiza Banda', contact: '0970123456', photos: 7, time: '2h ago', coverageDurationId: '4q',
  customer: { fullName: 'Mwiza Banda', phone: '0970123456', email: 'mwiza.banda@insurshield.zm' },
  expiresAt: new Date(Date.now() + 14 * 86_400_000 - 60_000).toISOString(),
};
const insurer = { id: '1', name: 'Prestige Assurance', ratePercentage: 4.5 };

function show(props = {}) {
  const onSubmit = props.onSubmit || vi.fn().mockResolvedValue(undefined);
  const onBack = vi.fn();
  const view = render(
    <MemoryRouter>
      <QuoteRequestForm
        request={request}
        insurer={insurer}
        coverGuides={{ Comprehensive: completeGuide() }}
        piaRatePercentage={3}
        defaultValidityDays={5}
        onBack={onBack}
        {...props}
        onSubmit={onSubmit}
      />
    </MemoryRouter>,
  );
  return { ...view, onSubmit, onBack, fileInput: view.container.querySelector('input[type="file"]') };
}

const quotation = () => new File(['%PDF-1.4'], 'quote.pdf', { type: 'application/pdf' });
const send = () => screen.getByRole('button', { name: 'Send quote to customer' });
const customerView = () => screen.getByRole('region', { name: 'What the customer will see' });

describe('QuoteRequestForm', () => {
  it('shows what the customer asked for, how long is left to reply, and the way back', async () => {
    const { onBack } = show();

    expect(screen.getByRole('heading', { level: 1, name: 'Prepare quotation' })).toBeVisible();
    expect(screen.getByText('QR-DOC')).toBeVisible();
    expect(screen.getByText(/^Reply by .* · 14 days left$/)).toBeVisible();

    const asked = screen.getByRole('region', { name: 'What the customer asked for' });
    expect(within(asked).getByRole('heading', { level: 3, name: '2020 Toyota Hilux' })).toBeVisible();
    for (const text of ['BAA 1234', 'ZMW 250,000.00', 'Individual', 'Comprehensive', '1 Year (12 Months) · From payment date', 'Mwiza Banda', '7 live photos attached']) {
      expect(within(asked).getByText(text)).toBeVisible();
    }
    expect(within(asked).getByRole('link', { name: '0970123456' })).toHaveAttribute('href', 'tel:0970123456');

    await userEvent.click(screen.getByRole('button', { name: 'Back to overview' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('places the quote in the policy’s journey as the insurer’s step', () => {
    show();
    const steps = within(screen.getByRole('list', { name: 'Where this policy stands' })).getAllByRole('listitem');
    expect(steps[0]).toHaveTextContent('Done: Request received');
    expect(steps[0]).toHaveTextContent('2h ago');
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(steps[1]).toHaveTextContent('Send your quote');
  });

  it('shows the customer’s view of the quote as it is filled in', async () => {
    const user = userEvent.setup();
    const { fileInput } = show();

    // Before anything is entered it says what is still missing, and what goes out by default.
    expect(within(customerView()).getByText('Cover requested')).toBeVisible();
    expect(within(customerView()).getByText('Comprehensive')).toBeVisible();
    expect(within(customerView()).getByText('Not entered yet')).toBeVisible();
    expect(within(customerView()).getByText('Not attached yet')).toBeVisible();
    expect(within(customerView()).getByText(`${quoteOpenUntil(5)} · 5 days`)).toBeVisible();
    expect(within(customerView()).getByText('None')).toBeVisible();

    await user.type(screen.getByLabelText(/Premium on your quotation/), '10650');
    await user.type(screen.getByLabelText('Quote valid for (days)'), '10');
    await user.type(screen.getByLabelText('Special conditions / notes'), 'Tracker required');
    await user.upload(fileInput, quotation());

    expect(within(customerView()).getByText('ZMW 10,650.00')).toBeVisible();
    expect(within(customerView()).getByText(`${quoteOpenUntil(10)} · 10 days`)).toBeVisible();
    expect(within(customerView()).getByText('Tracker required')).toBeVisible();
    // The file's name means nothing to the customer; what matters is that the document is there.
    expect(await within(customerView()).findByText('Attached')).toBeVisible();
  });

  it('never sends a quote without a premium, even if the browser’s own check is bypassed', async () => {
    const user = userEvent.setup();
    const { onSubmit, fileInput } = show();
    await user.upload(fileInput, quotation());
    await screen.findByText('quote.pdf');

    const premium = screen.getByLabelText(/Premium on your quotation/);
    for (const amount of ['', '0']) {
      if (amount) await user.type(premium, amount);
      fireEvent.submit(premium.closest('form'));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(premium).toHaveFocus();
    }
  });

  it('still opens for a request whose cover type it does not recognise, priced as comprehensive', () => {
    show({ request: { ...request, insuranceType: 'Fleet' }, coverGuides: {} });
    expect(screen.getByText('Publish your comprehensive cover guide before sending this quote.')).toBeVisible();
  });

  it('keeps the form and says what is wrong when the validity is not a usable number of days', async () => {
    const user = userEvent.setup();
    const { onSubmit, fileInput } = show();
    const validity = screen.getByLabelText('Quote valid for (days)');

    for (const days of ['999999999', '31', '0']) {
      await user.clear(validity);
      await user.type(validity, days);
      expect(validity).toHaveAttribute('aria-invalid', 'true');
      expect(validity).toHaveAccessibleDescription(/Enter a whole number of days from 1 to 30\./);
      expect(within(customerView()).getByText('Enter 1 to 30 days')).toBeVisible();
    }

    await user.type(screen.getByLabelText(/Premium on your quotation/), '10650');
    await user.upload(fileInput, quotation());
    await screen.findByText('quote.pdf');
    await user.click(send());
    expect(onSubmit).not.toHaveBeenCalled();

    await user.clear(validity);
    await user.type(validity, '30');
    expect(validity).not.toHaveAttribute('aria-invalid');
    expect(within(customerView()).getByText(`${quoteOpenUntil(30)} · 30 days`)).toBeVisible();
  });

  it('questions a premium far from the estimate without stopping the insurer', async () => {
    const user = userEvent.setup();
    const { onSubmit, fileInput } = show();
    const premium = screen.getByLabelText(/Premium on your quotation/);

    await user.type(premium, '900');
    expect(screen.getByText(/^This is less than half InsurShield’s estimate of ZMW /)).toBeVisible();
    // It is a question, not an error: nothing here is announced as an alert.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.clear(premium);
    await user.click(screen.getByRole('button', { name: 'Use estimate' }));
    expect(screen.queryByText(/InsurShield’s estimate of ZMW .* Check/)).not.toBeInTheDocument();

    await user.clear(premium);
    await user.type(premium, '900');
    await user.upload(fileInput, quotation());
    await screen.findByText('quote.pdf');
    await user.click(send());
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('asks for the quotation document before sending', async () => {
    const user = userEvent.setup();
    const { onSubmit } = show();

    await user.type(screen.getByLabelText(/Premium on your quotation/), '10650');
    await user.click(send());
    expect(screen.getByRole('alert')).toHaveTextContent('Attach the final quotation from your system before sending it.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sends the insurer quotation and its premium without attaching the cover guide', async () => {
    const user = userEvent.setup();
    const { onSubmit, fileInput } = show();

    await user.upload(fileInput, quotation());
    expect(await screen.findByText('quote.pdf')).toBeVisible();
    await user.type(screen.getByLabelText('Your internal quote reference'), ' PA-Q-2026-00412 ');
    await user.type(screen.getByLabelText(/Premium on your quotation/), '10650');
    await user.type(screen.getByLabelText('Special conditions / notes'), ' Tracker required ');
    await user.click(send());

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      premium: 10650,
      notes: 'Tracker required',
      validityDays: 5,
      insurerReference: 'PA-Q-2026-00412',
      document: { name: 'quote.pdf', type: 'application/pdf' },
    });
    expect(onSubmit.mock.calls[0][0].coverGuide).toBeUndefined();
  });

  it('uses the validity the insurer enters and the estimate when asked', async () => {
    const user = userEvent.setup();
    const { onSubmit, fileInput } = show();

    await user.upload(fileInput, quotation());
    await screen.findByText('quote.pdf');
    await user.click(screen.getByRole('button', { name: 'Use estimate' }));
    const premium = Number(screen.getByLabelText(/Premium on your quotation/).value);
    expect(premium).toBeGreaterThan(0);
    await user.type(screen.getByLabelText('Quote valid for (days)'), '10');
    await user.click(send());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ premium, validityDays: 10, insurerReference: null });
  });

  it('is busy while sending, then explains a failure and keeps what was entered', async () => {
    const user = userEvent.setup();
    let fail;
    const onSubmit = vi.fn()
      .mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }))
      .mockResolvedValueOnce(undefined);
    const { fileInput } = show({ onSubmit });

    await user.upload(fileInput, quotation());
    await screen.findByText('quote.pdf');
    await user.type(screen.getByLabelText(/Premium on your quotation/), '10650');
    await user.click(send());

    const sending = screen.getByRole('button', { name: 'Sending…' });
    expect(sending).toBeDisabled();
    expect(sending).toHaveAttribute('aria-busy', 'true');

    await act(async () => { fail(new Error('ECONNRESET')); });
    const failure = await screen.findByRole('alert');
    expect(failure).toHaveTextContent('This quote could not be sent. Check your connection and try again.');
    // A lost reply looks the same as a refused one, so the screen does not say what the customer did or did not receive.
    expect(failure).toHaveTextContent('What you entered is still here.');
    expect(failure).not.toHaveTextContent(/Nothing was sent/);
    expect(screen.getByLabelText(/Premium on your quotation/)).toHaveValue(10650);
    expect(screen.getByText('quote.pdf')).toBeVisible();

    await user.click(send());
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('cannot send until the cover guide for this cover type is published, and says where to do it', () => {
    const { onSubmit } = show({ coverGuides: {} });

    expect(screen.getByRole('alert')).toHaveTextContent('Publish your comprehensive cover guide before sending this quote.');
    expect(screen.getByRole('link', { name: 'Open cover guides' })).toHaveAttribute('href', '/insurer?view=guides');
    expect(send()).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('names the country of a vehicle registered abroad', () => {
    show({ request: { ...request, registrationCountry: 'Malawi' } });
    expect(screen.getByText('Malawi — not on the RTSA register')).toBeVisible();
  });
});
