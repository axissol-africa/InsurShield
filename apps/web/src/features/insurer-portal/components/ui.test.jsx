import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Inbox } from 'lucide-react';
import { CaseProgress, ContactLinks, StepTrack, DocumentPicker, EmptyPanel, PageHeader, StatusBadge } from './ui';

describe('PageHeader', () => {
  it('names the page, describes it, and offers the way back when there is one', async () => {
    const onBack = vi.fn();
    render(<PageHeader title="Prepare quotation" description="Record the quotation from your system." onBack={onBack} backLabel="Back to overview"><span>1 open</span></PageHeader>);

    expect(screen.getByRole('heading', { level: 1, name: 'Prepare quotation' })).toBeVisible();
    expect(screen.getByText('Record the quotation from your system.')).toBeVisible();
    expect(screen.getByText('1 open')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Back to overview' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('has no back control on a top-level section', () => {
    render(<PageHeader title="Claims" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('StatusBadge', () => {
  it('always shows the status in words and marks only open work for attention', () => {
    render(<><StatusBadge status="Notified" /><StatusBadge status="Received by insurer" /><StatusBadge status="Rejected" /><StatusBadge status="Active">Paid · Active</StatusBadge></>);

    expect(screen.getByText('Notified')).toHaveAttribute('data-tone', 'open');
    expect(screen.getByText('Received by insurer')).toHaveAttribute('data-tone', 'settled');
    expect(screen.getByText('Rejected')).toHaveAttribute('data-tone', 'declined');
    expect(screen.getByText('Paid · Active')).toHaveAttribute('data-tone', 'settled');
  });
});

describe('EmptyPanel', () => {
  it('says what will appear and offers an action when there is one', () => {
    render(<EmptyPanel icon={Inbox} title="No claims yet" description="New notifications appear here."><button type="button">Refresh</button></EmptyPanel>);
    expect(screen.getByText('No claims yet')).toBeVisible();
    expect(screen.getByText('New notifications appear here.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeVisible();
  });
});

describe('DocumentPicker', () => {
  const file = { name: 'quote.pdf', type: 'application/pdf', size: 2048 };

  it('asks for a file and passes the choice on', async () => {
    const onPick = vi.fn();
    const { container } = render(<DocumentPicker id="quotation" prompt="Attach quotation from your system" onPick={onPick} onClear={vi.fn()} />);

    expect(screen.getByText('Attach quotation from your system')).toBeVisible();
    const input = container.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('accept', 'application/pdf,image/jpeg,image/png');
    await userEvent.upload(input, new File(['%PDF'], 'quote.pdf', { type: 'application/pdf' }));
    expect(onPick).toHaveBeenCalledOnce();
  });

  it('ties a problem to the file input', () => {
    const { container } = render(<DocumentPicker id="quotation" prompt="Attach" onPick={vi.fn()} onClear={vi.fn()} error="Attach the final quotation." />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Attach the final quotation.');
    const input = container.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', alert.id);
  });

  it('shows the chosen file and lets it be removed', async () => {
    const onClear = vi.fn();
    render(<DocumentPicker id="quotation" prompt="Attach" document={file} onPick={vi.fn()} onClear={onClear} />);

    expect(screen.getByText('quote.pdf')).toBeVisible();
    expect(screen.getByText('2 KB')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Remove quote.pdf' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});

describe('CaseProgress', () => {
  const steps = () => within(screen.getByRole('list', { name: 'Where this policy stands' })).getAllByRole('listitem');

  it('shows what is done, whose turn it is, and what follows', () => {
    render(<CaseProgress current="quoted" notes={{ requested: '2m ago' }} />);

    const [requested, quoted, paid, issued] = steps();
    expect(requested).toHaveTextContent('Done: Request received');
    expect(requested).toHaveTextContent('2m ago');
    expect(quoted).toHaveAttribute('aria-current', 'step');
    expect(quoted).toHaveTextContent('Send your quote');
    expect(quoted).toHaveTextContent('Your step');
    expect(paid).toHaveTextContent('Next: Customer pays');
    expect(issued).toHaveTextContent('Next: Issue the certificate');
    expect(paid).not.toHaveAttribute('aria-current');
  });

  it('reads the earlier steps as done once the customer has paid', () => {
    render(<CaseProgress current="issued" />);

    expect(steps().map((step) => step.textContent)).toEqual([
      'Done: Request received', 'Done: Quote sent', 'Done: Customer paid', expect.stringContaining('Issue the certificate'),
    ]);
    expect(steps()[3]).toHaveAttribute('aria-current', 'step');
  });
});

describe('ContactLinks', () => {
  it('lets the insurer call or write to the customer directly', () => {
    render(<ContactLinks phone="0970123456" email="mwiza.banda@insurshield.zm" />);
    expect(screen.getByRole('link', { name: '0970123456' })).toHaveAttribute('href', 'tel:0970123456');
    expect(screen.getByRole('link', { name: 'mwiza.banda@insurshield.zm' })).toHaveAttribute('href', 'mailto:mwiza.banda@insurshield.zm');
  });

  it('shows only the details the customer gave', () => {
    const { container, rerender } = render(<ContactLinks phone="0970123456" />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    rerender(<ContactLinks />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('StepTrack', () => {
  it('lays out any short process with each step’s state in words', () => {
    render(<StepTrack label="Where this claim stands" steps={[
      { id: 'a', label: 'Notified by the customer', state: 'done', note: '1d ago' },
      { id: 'b', label: 'Mark it received', state: 'current', note: 'Your step' },
      { id: 'c', label: 'Handled in your claims system', state: 'next' },
    ]} />);

    const steps = within(screen.getByRole('list', { name: 'Where this claim stands' })).getAllByRole('listitem');
    expect(steps[0]).toHaveTextContent('Done: Notified by the customer1d ago');
    expect(steps[1]).toHaveTextContent('Mark it receivedYour step');
    expect(steps[1]).not.toHaveTextContent(/Done|Next/);
    expect(steps[2]).toHaveTextContent('Next: Handled in your claims system');
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
  });
});
