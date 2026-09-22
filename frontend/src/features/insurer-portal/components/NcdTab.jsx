import { useState } from 'react';
import { useStore } from '@/store';
import { isOpenNcdApplication, statusStyle } from '@/features/insurer-portal/portal';
import { EmptyState, Icon } from './ui';

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
    <div className="space-y-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[18px] font-bold text-primary">NCD Applications</h3>
        <span className="text-[13px] text-secondary">{applications.length} total</span>
      </div>
      {applications.length === 0 && <EmptyState icon="sell" title="No NCD applications yet." />}
      {applications.map((application) => (
        <NcdApplicationCard key={application.id} application={application} busy={busyId === application.id} onDecide={(status) => decide(application.id, status)} />
      ))}
    </div>
  );
}

const DECISIONS = [
  { status: 'Approved', label: 'Approve & Issue Code', icon: 'check', className: 'bg-primary text-white hover:bg-primary-container' },
  { status: 'Under Review', label: 'Mark Under Review', icon: 'pending', className: 'bg-amber-100 text-amber-800 hover:bg-amber-200' },
  { status: 'Rejected', label: 'Reject', icon: 'close', className: 'bg-red-50 text-red-700 hover:bg-red-100' },
];

function NcdApplicationCard({ application, busy, onDecide }) {
  const style = statusStyle(application.status);
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-bold text-primary">{application.fullName}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${style.badge}`}>{application.status}</span>
          </div>
          <p className="font-mono text-[12px] text-secondary">{application.applicationNumber || application.id}</p>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <div><dt className="text-[10px] font-bold uppercase text-secondary">Policy No.</dt><dd className="font-mono text-[13px] font-semibold">{application.policyNumber}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase text-secondary">Years Claim-Free</dt><dd className="text-[13px] font-semibold">{application.yearsClaimFree} yr{application.yearsClaimFree === 1 ? '' : 's'}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase text-secondary">Expected Discount</dt><dd className="text-[13px] font-bold text-primary">{application.yearsClaimFree * 10}%</dd></div>
          </dl>
          {application.approvedCode && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
              <Icon name="check_circle" className="text-[18px] text-primary" />
              <div>
                <p className="text-[12px] font-semibold text-primary">Approved — NCD Code Issued</p>
                <p className="font-mono text-[14px] font-bold text-on-primary-container">{application.approvedCode}</p>
              </div>
            </div>
          )}
        </div>
        {isOpenNcdApplication(application) && (
          <div className="flex flex-shrink-0 flex-col gap-2">
            {DECISIONS.map((decision) => (
              <button key={decision.status} type="button" disabled={busy} onClick={() => onDecide(decision.status)} className={`flex items-center gap-1 rounded-xl px-4 py-2 text-[13px] font-bold disabled:opacity-50 ${decision.className}`}>
                <Icon name={decision.icon} className="text-[16px]" />{decision.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
