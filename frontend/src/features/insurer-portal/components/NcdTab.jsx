import { useState } from 'react';
import { useStore } from '@/store';
import { isOpenNcdApplication, statusStyle } from '@/features/insurer-portal/portal';
import Meta from '@/components/ui/Meta';
import { EmptyState, Fact, Icon } from './ui';

const newNcdCode = () => `NCD-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

/** No-claim-discount applications: approve (issuing a code), hold for review, or reject. */
export default function NcdTab({ applications }) {
  const updateNcdApplicationStatus = useStore((state) => state.updateNcdApplicationStatus);
  const [busyId, setBusyId] = useState(null);

  const decide = (id, status) => {
    setBusyId(id);
    setTimeout(() => {
      updateNcdApplicationStatus(id, status, status === 'Approved' ? newNcdCode() : null);
      setBusyId(null);
    }, 700);
  };

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <Meta className="text-primary">NCD applications</Meta>
          <span className="h-px w-12 bg-line" aria-hidden="true" />
        </div>
        <Meta className="text-ink-faint">{applications.length} total</Meta>
      </div>

      {applications.length === 0 ? (
        <EmptyState icon="sell" title="No NCD applications yet." />
      ) : (
        <div className="border border-line">
          {applications.map((application, index) => (
            <NcdApplicationRow
              key={application.id}
              application={application}
              isFirst={index === 0}
              busy={busyId === application.id}
              onDecide={(status) => decide(application.id, status)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Approving issues a discount code, so it is the only filled action; the other
 * two are outlined. Rejection is deliberately not styled as an emergency — it
 * is a routine outcome.
 */
const DECISIONS = [
  { status: 'Approved', label: 'Approve & issue code', icon: 'check', filled: true },
  { status: 'Under Review', label: 'Mark under review', icon: 'pending', filled: false },
  { status: 'Rejected', label: 'Reject', icon: 'close', filled: false },
];

function NcdApplicationRow({ application, isFirst, busy, onDecide }) {
  const style = statusStyle(application.status);

  return (
    <div className={`group relative p-5 transition-colors duration-200 ease-out hover:bg-canvas-2 ${isFirst ? '' : 'border-t border-dashed border-line'}`}>
      <span className="beam pointer-events-none absolute left-0 top-0 h-px w-1/4 bg-primary" aria-hidden="true" />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[16px] font-medium tracking-[-0.015em] text-ink">{application.fullName}</span>
            <Meta className={`rounded-[1px] border px-2 py-1 ${style.badge}`}>{application.status}</Meta>
          </div>
          <Meta className="mt-2 block text-primary">{application.applicationNumber || application.id}</Meta>

          <dl className="mt-5 grid max-w-xl grid-cols-3 gap-x-6 gap-y-4">
            <Fact label="Policy no." value={<span className="font-mono">{application.policyNumber}</span>} />
            <Fact label="Years claim-free" value={`${application.yearsClaimFree} yr${application.yearsClaimFree === 1 ? '' : 's'}`} />
            <Fact
              label="Expected discount"
              value={<span className="text-primary">{application.yearsClaimFree * 10}%</span>}
            />
          </dl>

          {application.approvedCode && (
            <div className="mt-5 inline-flex items-center gap-3 rounded-[1px] border border-primary bg-primary/[0.03] px-4 py-3">
              <Icon name="check_circle" className="text-[18px] text-primary" />
              <div>
                <Meta className="text-ink-muted">Code issued</Meta>
                <p className="mt-1.5 font-mono text-[15px] tracking-[0.04em] text-primary">{application.approvedCode}</p>
              </div>
            </div>
          )}
        </div>

        {isOpenNcdApplication(application) && (
          <div className="flex shrink-0 flex-col gap-2">
            {DECISIONS.map((decision) => (
              <button
                key={decision.status}
                type="button"
                disabled={busy}
                onClick={() => onDecide(decision.status)}
                className={`inline-flex min-h-10 items-center gap-2 rounded-[1px] px-4 text-[13px] font-medium transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:border disabled:border-dashed disabled:border-line-strong disabled:bg-canvas disabled:text-ink-faint disabled:hover:bg-canvas ${
                  decision.filled
                    ? 'bg-primary text-white hover:bg-[#b91c1c]'
                    : 'border border-dashed border-line-strong text-ink hover:border-primary hover:text-primary'
                }`}
              >
                <Icon name={decision.icon} className="text-[16px]" />
                {decision.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
