import { Link, useNavigate } from 'react-router-dom';
import { useStore, belongsToCustomer, DEMO_CUSTOMER_ACCOUNT } from '../store/useStore';
import { formatZMW, formatDate } from '../utils/premiumEngine';
import { requestStatus } from '../utils/quoteValidity';
import { downloadPolicyCertificate, downloadRtsaDisc } from '../utils/policyDocuments';
import { openDocument } from '../utils/files';

/** The insurer's uploaded certificate; policies issued before certificates were uploaded get a generated summary. */
const openCertificate = (policy) => (policy.certificateDocument ? openDocument(policy.certificateDocument) : downloadPolicyCertificate(policy));

const cardClass = 'rounded-2xl border border-slate-200 bg-white p-6 shadow-sm';

export default function CustomerAccountPage() {
  const navigate = useNavigate();
  const { customer, policies, quoteRequests, claims, setActiveQuoteRequest, deleteCurrentAccount, requoteFromRequest } = useStore();
  const isDemoAccount = customer?.email === DEMO_CUSTOMER_ACCOUNT.email;

  const mine = belongsToCustomer(customer);
  const myPolicies = policies.filter((policy) => mine(policy) && policy.status === 'Active');
  const pendingPolicies = policies.filter((policy) => mine(policy) && policy.status === 'Awaiting insurer certificate');
  const myRequests = quoteRequests.filter(mine);
  const myClaims = claims.filter(mine);

  const openRequest = (request) => {
    setActiveQuoteRequest(request.id);
    navigate('/quotes-comparison');
  };
  const requote = (request) => {
    requoteFromRequest(request.id);
    navigate('/quote-request');
  };

  const removeAccount = () => {
    if (!window.confirm(`Remove the account for ${customer?.email}? You can register again with the same details.`)) return;
    deleteCurrentAccount(); // CustomerRoute sends the visitor home once the session ends
  };

  return (
    <main className="mx-auto w-full max-w-[1500px] px-5 py-10 pb-24 sm:px-8 lg:py-12">
      <section className="rounded-2xl bg-primary p-7 text-white md:p-10">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/70">My InsurShield</p>
        <h1 className="mt-3 text-[38px] font-extrabold tracking-[-.04em] sm:text-[48px]">Welcome back, {customer?.fullName?.split(' ')[0] || 'there'}.</h1>
        <p className="mt-3 max-w-3xl text-[17px] text-white/90">Your policies, quote requests, renewals and claims — all in one place.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/insurance-type" className="rounded-lg bg-white px-5 py-3 text-sm font-bold text-primary hover:bg-white/90">Get quotes</Link>
          <Link to="/renewal" className="rounded-lg border-2 border-white px-5 py-3 text-sm font-bold text-white hover:bg-white/10">Renew a policy</Link>
          <Link to="/claims" className="rounded-lg border-2 border-white px-5 py-3 text-sm font-bold text-white hover:bg-white/10">Claims & NCD</Link>
        </div>
      </section>

      <section aria-label="Summary" className="mt-6 grid gap-4 sm:grid-cols-3">
        {[['Active policies', myPolicies.length, 'verified_user'], ['Quote requests', myRequests.length, 'send'], ['Claims', myClaims.length, 'report_problem']].map(([label, value, icon]) => (
          <div key={label} className={cardClass}>
            <span className="material-symbols-outlined text-primary" aria-hidden="true">{icon}</span>
            <p className="mt-4 text-4xl font-extrabold tracking-[-.04em] text-on-surface">{value}</p>
            <p className="mt-1 text-[15px] text-secondary">{label}</p>
          </div>
        ))}
      </section>

      {pendingPolicies.length > 0 && (
        <section className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-primary" aria-hidden="true">pending_actions</span>
            <div>
              <h2 className="font-bold text-on-surface">Policy certificate being prepared</h2>
              {pendingPolicies.map((policy) => <p key={policy.policyNumber} className="mt-1 text-sm text-secondary">{policy.insurer} is preparing the certificate for paid quote <span className="font-mono font-semibold text-on-surface">{policy.quoteRequestId}</span>. It will appear under Policies when issued.</p>)}
            </div>
          </div>
        </section>
      )}

      <section className="mt-7 grid gap-5 lg:grid-cols-2">
        <div className={cardClass}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[22px] font-extrabold">Policies</h2>
            {myPolicies.length > 0 && <Link to="/renewal" className="text-sm font-bold text-primary hover:underline">Renew</Link>}
          </div>
          {myPolicies.length ? (
            <ul className="mt-4 space-y-3">
              {myPolicies.map((policy) => (
                <li key={policy.policyNumber} className="rounded-xl bg-slate-50 p-4">
                  <div className="flex justify-between gap-3">
                    <div>
                      <p className="font-bold text-primary">{policy.insurer}</p>
                      <p className="text-xs text-secondary">{policy.policyNumber} · {policy.vehicle}{policy.vehicleDetails?.plateNumber ? ` · ${policy.vehicleDetails.plateNumber}` : ''}</p>
                    </div>
                    <span className="h-fit rounded-md bg-primary/10 px-2 py-1 text-xs font-bold text-primary">Active</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="text-xs text-secondary">Cover</dt><dd className="font-semibold">{policy.coverage || 'Comprehensive'}</dd></div>
                    <div><dt className="text-xs text-secondary">Premium</dt><dd className="font-semibold">{formatZMW(policy.premium || 0)}</dd></div>
                    <div><dt className="text-xs text-secondary">Valid until</dt><dd className="font-semibold">{policy.policyDates?.formattedEnd || '—'}</dd></div>
                    <div><dt className="text-xs text-secondary">Issued</dt><dd className="font-semibold">{formatDate(policy.issuedAt)}</dd></div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-3">
                    <button type="button" onClick={() => openCertificate(policy)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-primary px-3 text-xs font-bold text-primary hover:bg-primary/5"><span className="material-symbols-outlined text-[16px]" aria-hidden="true">{policy.certificateDocument ? 'open_in_new' : 'download'}</span>Policy certificate</button>
                    {policy.rtsaAnniversaryFee > 0 && <button type="button" onClick={() => downloadRtsaDisc(policy)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-primary px-3 text-xs font-bold text-primary hover:bg-primary/5"><span className="material-symbols-outlined text-[16px]" aria-hidden="true">download</span>RTSA disc</button>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="Policies you buy through InsurShield will appear here." />
          )}
        </div>

        <div className={cardClass}>
          <h2 className="text-[22px] font-extrabold">Quote requests</h2>
          {myRequests.length ? (
            <ul className="mt-4 space-y-3">
              {myRequests.map((request) => {
                const total = request.insurers?.length || 0;
                const status = requestStatus(request);
                const badge = {
                  expired: ['bg-slate-200 text-slate-700', 'Expired'],
                  expiring: ['bg-amber-100 text-amber-800', `Expiring soon · ${status.validQuotes} valid`],
                  quoted: ['bg-primary/10 text-primary', `${status.replies}/${total} replied`],
                  pending: ['bg-amber-100 text-amber-800', `${status.replies}/${total} replied`],
                }[status.status];
                return (
                  <li key={request.id} className={`rounded-xl p-4 ${status.status === 'expired' ? 'bg-slate-100' : 'bg-slate-50'}`}>
                    <div className="flex justify-between gap-3">
                      <div>
                        <p className="font-bold text-primary">{request.vehicle}</p>
                        <p className="text-xs text-secondary">{request.id} · sent {formatDate(request.submittedAt)} to {total} insurers{request.requotedAs ? ` · re-requested as ${request.requotedAs}` : ''}</p>
                      </div>
                      <span className={`h-fit whitespace-nowrap rounded-md px-2 py-1 text-xs font-bold ${badge[0]}`}>{badge[1]}</span>
                    </div>
                    {status.status === 'expired' ? (
                      request.requotedAs ? (
                        <p className="mt-3 text-[13px] text-secondary">These quotes lapsed; the new request carries your details.</p>
                      ) : (
                        <button type="button" onClick={() => requote(request)} className="mt-3 inline-flex min-h-10 items-center gap-1 text-sm font-bold text-primary hover:underline">
                          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>Request new quotes
                        </button>
                      )
                    ) : (
                      <button type="button" onClick={() => openRequest(request)} className="mt-3 inline-flex min-h-10 items-center text-sm font-bold text-primary hover:underline">
                        Compare quotes <span className="material-symbols-outlined ml-1 text-[16px]" aria-hidden="true">arrow_forward</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty text="Send one request and every insurer on InsurShield will reply here." action={<Link to="/insurance-type" className="font-bold text-primary hover:underline">Start a quote</Link>} />
          )}
        </div>
      </section>

      <section className={`mt-5 ${cardClass}`}>
        <h2 className="text-[22px] font-extrabold">Claims & NCD</h2>
        <p className="mt-2 text-sm text-secondary">{myClaims.length ? `${myClaims.length} claim${myClaims.length === 1 ? '' : 's'} linked to this account.` : 'No claims yet. If you ever need to, you can notify your insurer from here.'}</p>
        <Link to="/claims" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-primary/10 px-4 text-sm font-bold text-primary hover:bg-primary/15">Manage claims</Link>
      </section>

      {!isDemoAccount && (
        <section className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-slate-300 p-5">
          <div>
            <h2 className="text-[15px] font-bold">Account details</h2>
            <p className="mt-1 text-sm text-secondary">{customer?.fullName} · {customer?.email} · {customer?.phone}</p>
          </div>
          <button type="button" onClick={removeAccount} className="text-sm font-bold text-red-700 hover:underline">Remove this account</button>
        </section>
      )}
    </main>
  );
}

function Empty({ text, action }) {
  return <p className="mt-4 rounded-xl bg-surface-container-low p-4 text-sm text-secondary">{text}{action && <> {action}</>}</p>;
}
