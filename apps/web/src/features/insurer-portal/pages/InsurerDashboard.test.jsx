import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import InsurerDashboard from './InsurerDashboard';
import { toast } from 'sonner';
import { useStore } from '@/store';
import { api } from '@/api';
import { hydrateInsurerPortal } from '@/api/sync';
import { AWAITING_CERTIFICATE } from '@/features/insurer-portal/portal';
import { TooltipProvider } from '@/components/ui/primitives/tooltip';

vi.mock('@/api', () => ({
  api: {
    quotes: { reply: vi.fn(), extend: vi.fn() },
    policies: { issueCertificate: vi.fn() },
    insurers: { update: vi.fn() },
  },
}));
vi.mock('@/api/sync', () => ({ hydrateInsurerPortal: vi.fn().mockResolvedValue(undefined) }));
vi.mock('sonner', async (original) => ({ ...(await original()), toast: { success: vi.fn(), info: vi.fn() } }));

// The screens opened from a section are tested on their own; here they only
// need to show which record they were given and hand back their outcome.
vi.mock('@/features/insurer-portal/components/QuoteRequestForm', () => ({
  default: ({ request, onSubmit, onBack }) => (
    <div>
      <p>Quote form for {request.id}</p>
      <input aria-label="Draft premium" />
      <button type="button" onClick={() => onSubmit({ premium: 10650 }).catch(() => {})}>Submit quote</button>
      <button type="button" onClick={onBack}>Leave quote</button>
    </div>
  ),
}));
vi.mock('@/features/insurer-portal/components/PolicyIssuePanel', () => ({
  default: ({ policy, onIssued, onBack }) => (
    <div>
      <p>Issue panel for {policy.policyNumber}</p>
      <input aria-label="Draft policy number" />
      <button type="button" onClick={() => onIssued(policy.policyNumber, { insurerPolicyNumber: 'PA-1' }).catch(() => {})}>Issue</button>
      <button type="button" onClick={onBack}>Leave issue</button>
    </div>
  ),
}));

const INSURER = 'Prestige Assurance';
const request = (id, insurerQuotes = {}) => ({
  id, submittedAt: '2026-10-10T10:00:00Z', insurers: [INSURER], insurerQuotes,
  vehicle: '2020 Toyota Hilux', vehicleValue: 250000, insuranceType: 'Comprehensive', customer: { fullName: 'Mwiza Banda' },
});

function Address() {
  const location = useLocation();
  return <p data-testid="address">{location.pathname}{location.search}</p>;
}

/** Stands in for anything that changes the address while a screen is open, such as an earlier toast's "next" action. */
function Jump({ to }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(to)}>Jump to {to}</button>;
}

function open(address, { jumpTo = '/insurer' } = {}) {
  render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[address]}>
        <Routes><Route path="/insurer" element={<><InsurerDashboard /><Address /><Jump to={jumpTo} /></>} /></Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

const address = () => screen.getByTestId('address').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('scrollTo', () => {});
  useStore.setState({
    staffSession: { role: 'insurer', name: INSURER },
    insurersList: [{ id: '1', name: INSURER, coverGuides: {} }],
    quoteRequests: [request('QR-OPEN'), request('QR-SENT', { [INSURER]: { premium: 9000 } })],
    policies: [
      { policyNumber: 'PA-WAITING', insurer: INSURER, status: AWAITING_CERTIFICATE, receivedAt: '2026-10-11T10:00:00Z' },
      { policyNumber: 'PA-ACTIVE', insurer: INSURER, status: 'Active', receivedAt: '2026-10-09T10:00:00Z' },
      { policyNumber: 'PA-OTHER', insurer: 'Global Guard Insurance', status: AWAITING_CERTIFICATE, receivedAt: '2026-10-08T10:00:00Z' },
    ],
    claims: [],
    ncdApplications: [],
  });
});

describe('quote screen', () => {
  it('opens from the queue at its own address and returns to the overview once the quote is sent', async () => {
    const user = userEvent.setup();
    api.quotes.reply.mockResolvedValue(undefined);
    open('/insurer');

    await user.click(within(screen.getByRole('table', { name: 'Quote requests' })).getByRole('button', { name: 'Send quote' }));
    expect(address()).toBe('/insurer?quote=QR-OPEN');
    expect(screen.getByText('Quote form for QR-OPEN')).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Quote requests' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submit quote' }));
    await waitFor(() => expect(address()).toBe('/insurer'));
    expect(api.quotes.reply).toHaveBeenCalledExactlyOnceWith('QR-OPEN', { premium: 10650 });
    expect(hydrateInsurerPortal).toHaveBeenCalledTimes(2); // once on open, once after the reply
  });

  it('stays open with its address when the quote could not be sent', async () => {
    const user = userEvent.setup();
    api.quotes.reply.mockRejectedValue(new Error('offline'));
    open('/insurer?quote=QR-OPEN');

    await user.click(screen.getByRole('button', { name: 'Submit quote' }));
    await waitFor(() => expect(api.quotes.reply).toHaveBeenCalledOnce());
    expect(address()).toBe('/insurer?quote=QR-OPEN');
    expect(screen.getByText('Quote form for QR-OPEN')).toBeVisible();
    // A request can fail after the server acted on it, so the lists are reloaded either way.
    await waitFor(() => expect(hydrateInsurerPortal).toHaveBeenCalledTimes(2));
  });

  it('goes back to the overview without sending anything', async () => {
    open('/insurer?quote=QR-OPEN');
    await userEvent.click(screen.getByRole('button', { name: 'Leave quote' }));
    expect(address()).toBe('/insurer');
    expect(api.quotes.reply).not.toHaveBeenCalled();
  });

  it.each(['QR-SENT', 'QR-UNKNOWN'])('shows the overview for %s, which is not waiting for a quote', (id) => {
    open(`/insurer?quote=${id}`);
    expect(screen.queryByText(/Quote form for/)).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Quote requests' })).toBeVisible();
  });
});

describe('certificate screen', () => {
  it('opens at its own address and returns to paid policies once the policy is issued', async () => {
    const user = userEvent.setup();
    api.policies.issueCertificate.mockResolvedValue(undefined);
    open('/insurer?view=policies&issue=PA-WAITING');

    expect(screen.getByText('Issue panel for PA-WAITING')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Issue' }));
    await waitFor(() => expect(address()).toBe('/insurer?view=policies'));
    expect(api.policies.issueCertificate).toHaveBeenCalledExactlyOnceWith('PA-WAITING', { insurerPolicyNumber: 'PA-1' });
  });

  it('stays open when the policy could not be issued', async () => {
    api.policies.issueCertificate.mockRejectedValue(new Error('offline'));
    open('/insurer?view=policies&issue=PA-WAITING');

    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    await waitFor(() => expect(api.policies.issueCertificate).toHaveBeenCalledOnce());
    expect(address()).toBe('/insurer?view=policies&issue=PA-WAITING');
  });

  it.each(['PA-ACTIVE', 'PA-UNKNOWN', 'PA-OTHER'])('shows the paid policies list for %s, which is not this insurer’s certificate to issue', (policyNumber) => {
    open(`/insurer?view=policies&issue=${policyNumber}`);
    expect(screen.queryByText(/Issue panel for/)).not.toBeInTheDocument();
  });
});

describe('keyboard and screen-reader position', () => {
  const content = () => document.getElementById('insurer-content');

  it('starts each new screen at its content, because the control that opened it is gone', async () => {
    const user = userEvent.setup();
    open('/insurer');
    expect(content()).not.toHaveFocus();

    await user.click(within(screen.getByRole('table', { name: 'Quote requests' })).getByRole('button', { name: 'Send quote' }));
    expect(screen.getByText('Quote form for QR-OPEN')).toBeVisible();
    expect(content()).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Leave quote' }));
    expect(screen.getByRole('table', { name: 'Quote requests' })).toBeVisible();
    expect(content()).toHaveFocus();
  });

  it('says how much work each section holds, not only shows it', () => {
    open('/insurer');
    const navigation = screen.getByRole('navigation', { name: 'Insurer navigation' });
    expect(within(navigation).getByRole('link', { name: 'Paid policies' })).toHaveAccessibleDescription('1 to do');
    expect(within(navigation).getByRole('link', { name: 'Claims' })).toHaveAccessibleDescription('');
  });
});

describe('workspace header', () => {
  it('shows where the screen sits and links back to its section', () => {
    open('/insurer?quote=QR-OPEN');
    const trail = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/insurer');
    expect(within(trail).getByText('Prepare quotation')).toHaveAttribute('aria-current', 'page');
  });
});

describe('overview', () => {
  it('makes each number the way into the work it counts', () => {
    open('/insurer');
    const summary = screen.getByRole('region', { name: 'Operational summary' });

    expect(within(summary).getByRole('link', { name: /Awaiting quotes/ })).toHaveAttribute('href', '#quote-requests');
    expect(within(summary).getByRole('link', { name: /Certificates to issue/ })).toHaveAttribute('href', '/insurer?view=policies');
    expect(within(summary).getByRole('link', { name: /New claims/ })).toHaveAttribute('href', '/insurer?view=claims');
    expect(within(summary).getByRole('link', { name: /Claims received/ })).toHaveAttribute('href', '/insurer?view=claims');
  });
});

describe('carrying on to the next item', () => {
  const lastToast = () => toast.success.mock.calls.at(-1);

  it('offers the next waiting request once a quote is sent', async () => {
    const user = userEvent.setup();
    api.quotes.reply.mockResolvedValue(undefined);
    useStore.setState({ quoteRequests: [request('QR-OPEN'), request('QR-ALSO-OPEN')] });
    open('/insurer?quote=QR-OPEN');

    await user.click(screen.getByRole('button', { name: 'Submit quote' }));
    await waitFor(() => expect(address()).toBe('/insurer'));
    expect(lastToast()[0]).toBe('Quote sent');
    expect(lastToast()[1].action.label).toBe('Next request');
    // Long enough to reach with a keyboard; the default is gone in a few seconds.
    expect(lastToast()[1].duration).toBeGreaterThanOrEqual(20_000);

    act(() => lastToast()[1].action.onClick());
    expect(address()).toBe('/insurer?quote=QR-ALSO-OPEN');
  });

  it('says so when the next request was answered by someone else in the meantime', async () => {
    const user = userEvent.setup();
    api.quotes.reply.mockResolvedValue(undefined);
    useStore.setState({ quoteRequests: [request('QR-OPEN'), request('QR-ALSO-OPEN')] });
    open('/insurer?quote=QR-OPEN');

    await user.click(screen.getByRole('button', { name: 'Submit quote' }));
    await waitFor(() => expect(address()).toBe('/insurer'));
    act(() => useStore.setState({ quoteRequests: [request('QR-OPEN'), request('QR-ALSO-OPEN', { [INSURER]: { premium: 9000 } })] }));

    act(() => lastToast()[1].action.onClick());
    expect(address()).toBe('/insurer');
    expect(toast.info).toHaveBeenCalledExactlyOnceWith('That request has already been answered.');
  });

  it('offers nothing more when that was the last request', async () => {
    const user = userEvent.setup();
    api.quotes.reply.mockResolvedValue(undefined);
    open('/insurer?quote=QR-OPEN');

    await user.click(screen.getByRole('button', { name: 'Submit quote' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(lastToast()[1].action).toBeUndefined();
    expect(lastToast()[1].duration).toBeUndefined();
  });

  it('offers the customer who has waited longest once a policy is issued', async () => {
    const user = userEvent.setup();
    api.policies.issueCertificate.mockResolvedValue(undefined);
    useStore.setState({ policies: [
      { policyNumber: 'PA-WAITING', insurer: INSURER, status: AWAITING_CERTIFICATE, receivedAt: '2026-10-11T10:00:00Z' },
      { policyNumber: 'PA-RECENT', insurer: INSURER, status: AWAITING_CERTIFICATE, receivedAt: '2026-10-11T12:00:00Z' },
      { policyNumber: 'PA-OLDEST', insurer: INSURER, status: AWAITING_CERTIFICATE, receivedAt: '2026-10-09T10:00:00Z' },
    ] });
    open('/insurer?view=policies&issue=PA-WAITING');

    await user.click(screen.getByRole('button', { name: 'Issue' }));
    await waitFor(() => expect(address()).toBe('/insurer?view=policies'));
    expect(lastToast()[0]).toBe('Official policy issued');
    expect(lastToast()[1].action.label).toBe('Next policy');
    expect(lastToast()[1].duration).toBeGreaterThanOrEqual(20_000);

    act(() => lastToast()[1].action.onClick());
    expect(address()).toBe('/insurer?view=policies&issue=PA-OLDEST');

    // Offered again later, after a colleague has issued it, it no longer opens.
    act(() => useStore.setState({ policies: [{ policyNumber: 'PA-OLDEST', insurer: INSURER, status: 'Active', receivedAt: '2026-10-09T10:00:00Z' }] }));
    act(() => lastToast()[1].action.onClick());
    expect(toast.info).toHaveBeenCalledExactlyOnceWith('That policy has already been issued.');
  });
});

describe('moving between records', () => {
  it('starts a fresh quotation for each request, so one customer’s draft never goes to another', async () => {
    const user = userEvent.setup();
    useStore.setState({ quoteRequests: [request('QR-OPEN'), request('QR-ALSO-OPEN')] });
    open('/insurer?quote=QR-OPEN', { jumpTo: '/insurer?quote=QR-ALSO-OPEN' });

    await user.type(screen.getByLabelText('Draft premium'), '10650');
    await user.click(screen.getByRole('button', { name: /Jump to/ }));
    expect(screen.getByText('Quote form for QR-ALSO-OPEN')).toBeVisible();
    expect(screen.getByLabelText('Draft premium')).toHaveValue('');
  });

  it('starts a fresh certificate for each policy', async () => {
    const user = userEvent.setup();
    useStore.setState({ policies: [
      { policyNumber: 'PA-WAITING', insurer: INSURER, status: AWAITING_CERTIFICATE, receivedAt: '2026-10-11T10:00:00Z' },
      { policyNumber: 'PA-OLDEST', insurer: INSURER, status: AWAITING_CERTIFICATE, receivedAt: '2026-10-09T10:00:00Z' },
    ] });
    open('/insurer?view=policies&issue=PA-WAITING', { jumpTo: '/insurer?view=policies&issue=PA-OLDEST' });

    await user.type(screen.getByLabelText('Draft policy number'), 'PA-2026-00412');
    await user.click(screen.getByRole('button', { name: /Jump to/ }));
    expect(screen.getByText('Issue panel for PA-OLDEST')).toBeVisible();
    expect(screen.getByLabelText('Draft policy number')).toHaveValue('');
  });
});
