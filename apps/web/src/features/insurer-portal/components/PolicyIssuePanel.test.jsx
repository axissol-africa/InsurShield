import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PolicyIssuePanel from './PolicyIssuePanel';
import { openDocument } from '@/lib/files';

vi.mock('@/lib/files', async (original) => ({ ...(await original()), openDocument: vi.fn() }));

const policy = {
  policyNumber: 'PA-2026-011293', quoteRequestId: 'QR-774510', insurerQuoteReference: 'PA-Q-2026-00412', status: 'Awaiting insurer certificate',
  customerName: 'Mwiza Banda', customerPhone: '0970123456', customerEmail: 'mwiza.banda@insurshield.zm',
  vehicle: '2020 Toyota Hilux', vehicleDetails: { plateNumber: 'BAA 1234' }, plan: 'Comprehensive Gold Plan', coverage: 'Comprehensive',
  premium: 10650, policyDates: { formattedStart: '12 Oct 2026', formattedEnd: '11 Oct 2027' },
  paymentProof: { status: 'Confirmed', transactionId: 'TXN-MTN-1789714666139', method: 'MTN Mobile Money', amount: 10650, confirmedAt: new Date(Date.now() - 18 * 60_000).toISOString() },
  quoteDocument: { name: 'quote.pdf', type: 'application/pdf', size: 2048, dataUrl: 'data:application/pdf;base64,AAAA' },
};

function show(props = {}) {
  const onIssued = props.onIssued || vi.fn().mockResolvedValue(undefined);
  const onBack = vi.fn();
  const view = render(<PolicyIssuePanel policy={policy} onBack={onBack} {...props} onIssued={onIssued} />);
  return { onIssued, onBack, fileInput: view.container.querySelector('input[type="file"]') };
}

const certificate = () => new File(['%PDF-1.4'], 'certificate.pdf', { type: 'application/pdf' });
const issue = () => screen.getByRole('button', { name: 'Issue active policy & send certificate' });

beforeEach(() => vi.clearAllMocks());

describe('PolicyIssuePanel', () => {
  it('opens on a customer who has paid and is waiting, with what they bought and the payment behind it', async () => {
    const { onBack } = show();

    expect(screen.getByRole('heading', { level: 1, name: 'Issue policy certificate' })).toBeVisible();
    expect(screen.getByText('Paid 18m ago · waiting for cover')).toBeVisible();
    expect(screen.getByText('QR-774510')).toBeVisible();

    const bought = screen.getByRole('region', { name: 'What the customer bought' });
    expect(within(bought).getByRole('heading', { level: 3, name: 'Comprehensive Gold Plan' })).toBeVisible();
    for (const text of ['ZMW 10,650.00', 'Mwiza Banda', '2020 Toyota Hilux', 'BAA 1234', '12 Oct 2026 – 11 Oct 2027', 'PA-Q-2026-00412', 'TXN-MTN-1789714666139', 'MTN Mobile Money', 'Confirmed']) {
      expect(within(bought).getAllByText(text)[0]).toBeVisible();
    }
    expect(within(bought).getByRole('link', { name: '0970123456' })).toHaveAttribute('href', 'tel:0970123456');

    await userEvent.click(within(bought).getByRole('button', { name: /View the quotation you sent/ }));
    expect(openDocument).toHaveBeenCalledExactlyOnceWith(policy.quoteDocument);
    await userEvent.click(screen.getByRole('button', { name: 'Back to paid policies' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('places the certificate as the last step of the policy’s journey', () => {
    show();
    const steps = within(screen.getByRole('list', { name: 'Where this policy stands' })).getAllByRole('listitem');
    expect(steps.slice(0, 3).map((step) => step.textContent)).toEqual(['Done: Request received', 'Done: Quote sent', expect.stringContaining('Done: Customer paid')]);
    expect(steps[2]).toHaveTextContent('18m ago');
    expect(steps[3]).toHaveAttribute('aria-current', 'step');
  });

  it('asks for the certificate first and says what issuing does', () => {
    show();
    const work = screen.getByRole('region', { name: 'Your certificate' });
    const fields = [within(work).getByLabelText('Official policy certificate *'), within(work).getByLabelText('Your policy number')];
    expect(fields[0].compareDocumentPosition(fields[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const next = within(work).getByRole('region', { name: 'What happens when you issue' });
    expect(next).toHaveTextContent('PA-2026-011293 becomes active');
    expect(next).toHaveTextContent('Mwiza Banda can open the certificate from their account');
  });

  it('falls back to the request number when the gateway gave no transaction reference', () => {
    show({ policy: { ...policy, paymentProof: undefined, quoteDocument: undefined } });
    expect(screen.getByText('TXN-QR-774510')).toBeVisible();
    expect(screen.queryByRole('button', { name: /View the quotation you sent/ })).not.toBeInTheDocument();
  });

  it('asks for the certificate before issuing', async () => {
    const { onIssued } = show();
    await userEvent.click(issue());
    expect(screen.getByRole('alert')).toHaveTextContent('Upload the official policy certificate before issuing the active policy.');
    expect(onIssued).not.toHaveBeenCalled();
  });

  it('issues the policy with the certificate and the insurer’s own policy number', async () => {
    const user = userEvent.setup();
    const { onIssued, fileInput } = show();

    await user.type(screen.getByLabelText('Your policy number'), ' PA-2026-00412 ');
    await user.upload(fileInput, certificate());
    expect(await screen.findByText('certificate.pdf')).toBeVisible();
    await user.click(issue());

    expect(onIssued).toHaveBeenCalledExactlyOnceWith('PA-2026-011293', {
      certificateDocument: expect.objectContaining({ name: 'certificate.pdf', type: 'application/pdf' }),
      insurerPolicyNumber: 'PA-2026-00412',
    });
  });

  it('is busy while issuing, then explains a failure and can be retried', async () => {
    const user = userEvent.setup();
    let fail;
    const onIssued = vi.fn()
      .mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }))
      .mockResolvedValueOnce(undefined);
    const { fileInput } = show({ onIssued });

    await user.upload(fileInput, certificate());
    await screen.findByText('certificate.pdf');
    await user.click(issue());
    const issuing = screen.getByRole('button', { name: 'Issuing policy…' });
    expect(issuing).toBeDisabled();
    expect(issuing).toHaveAttribute('aria-busy', 'true');

    await act(async () => { fail(new Error('ECONNRESET')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('This policy could not be issued. Check your connection and try again.');
    expect(screen.getByText('certificate.pdf')).toBeVisible();

    await user.click(issue());
    expect(onIssued).toHaveBeenCalledTimes(2);
  });
});
