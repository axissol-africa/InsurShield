import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { motion } from 'framer-motion';
import { calculatePolicyDates, calculatePremium, formatZMW } from '../utils/premiumEngine';
import { COVERAGE_DURATION_OPTIONS } from '../utils/insurerRates';
import JourneyProgress from '../components/JourneyProgress';

const INSPECTION_PHOTOS = [
  { key: 'insp_front', label: 'Front view', icon: 'directions_car' },
  { key: 'insp_back', label: 'Rear view', icon: 'directions_car' },
  { key: 'insp_left', label: 'Left side', icon: 'directions_car' },
  { key: 'insp_right', label: 'Right side', icon: 'directions_car' },
  { key: 'insp_mileage', label: 'Dashboard / mileage', icon: 'speed' },
];

export default function InsuranceCompaniesSelectionPage() {
  const navigate = useNavigate();
  const { insurersList, vehicleValue, vehicleUsage, vehicleDetails, documents, customer, addQuoteRequest, setDocument, setMockInsurers, setQuoteRulesAgreed, setQuoteStatus, coverageDurationId, setCoverageDuration, policyStartDate, setPolicyStartDate, setPolicyDates } = useStore();
  const [fullName, setFullName] = useState(customer?.fullName || '');
  const [phone, setPhone] = useState(customer?.phone || '');
  const [email, setEmail] = useState(customer?.email || '');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const activeInsurers = insurersList.filter(insurer => insurer.status !== 'Inactive');
  const inspectionComplete = INSPECTION_PHOTOS.every(photo => documents[photo.key]);
  const policyDates = useMemo(() => calculatePolicyDates(policyStartDate, coverageDurationId), [policyStartDate, coverageDurationId]);

  const handleRequestQuotes = (event) => {
    event.preventDefault();
    if (!documents.whiteBook || !inspectionComplete || !consent) {
      setError(!documents.whiteBook ? 'Please add your White Book before requesting quotes.' : !inspectionComplete ? 'Please add all five vehicle inspection photos before requesting quotes.' : 'Please accept the declaration to send your request.');
      return;
    }
    setQuoteRulesAgreed(true);
    setPolicyDates(policyDates);
    setMockInsurers(activeInsurers);
    setQuoteStatus('ready');
    addQuoteRequest({
      customer: { fullName, phone, email }, insurers: activeInsurers.map(insurer => insurer.name),
      vehicle: vehicleDetails ? `${vehicleDetails.year || ''} ${vehicleDetails.make || ''} ${vehicleDetails.model || ''}`.trim() : 'Vehicle details pending',
      vehicleDetails, vehicleValue, vehicleUsage, coverageDurationId, policyDates,
    });
    navigate('/quotes-comparison', { state: { fullName, phone, email } });
  };

  return <><JourneyProgress current={4} /><motion.main initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-6xl px-5 py-10 pb-24 sm:px-8">
    <div className="mb-7 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><span className="material-symbols-outlined">request_quote</span></span>
      <h1 className="mt-3 text-[34px] font-extrabold tracking-[-.04em] text-on-surface">Get quotes from all insurers</h1>
      <p className="mx-auto mt-2 max-w-2xl text-[14px] text-on-surface-variant">We will send one complete request to every insurer on InsurShield so you can compare their offers immediately.</p>
    </div>
    <div className="mb-8 rounded-xl border border-amber-300 bg-amber-50 p-4"><p className="text-[14px] text-amber-900"><span className="material-symbols-outlined mr-2 align-middle text-[18px]">info</span>Premium estimates use your declared vehicle value of <strong className="text-primary">{formatZMW(vehicleValue)}</strong>, the selected use of the vehicle, and each insurer's own rate.</p></div>
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {activeInsurers.map(insurer => {
        const quote = calculatePremium({ vehicleValueZMW: vehicleValue, insurer, vehicleUsage, coverageDurationId });
        return <div key={insurer.id} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><span className="material-symbols-outlined">{insurer.icon || 'business'}</span></div><div><h2 className="font-bold text-primary">{insurer.name}</h2><p className="text-[12px] text-secondary">{insurer.coverage}</p></div></div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-secondary">Estimated {quote.coverageDuration.toLowerCase()} premium</p><p className="mt-1 text-[23px] font-extrabold text-on-surface">{formatZMW(quote.finalPremium)}</p><p className="mt-1 text-[11px] text-secondary">Insurer rate {insurer.ratePercentage}% · tailored for {vehicleUsage || 'private'} use</p>
        </div>;
      })}
    </div>
    <form onSubmit={handleRequestQuotes} className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-8">
      <h2 className="text-[22px] font-extrabold">Send one request to {activeInsurers.length} insurers</h2><p className="mt-1 text-[14px] text-on-surface-variant">These details let insurers identify your request and contact you about a selected policy.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label><span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-secondary">Policy start date</span><input required type="date" min={new Date().toISOString().split('T')[0]} value={policyStartDate} onChange={e => setPolicyStartDate(e.target.value)} className="w-full rounded-xl border border-outline-variant bg-surface-container-low p-3 text-[15px] outline-none focus:ring-2 focus:ring-primary" /></label>
        <label><span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-secondary">Cover period</span><select value={coverageDurationId} onChange={e => setCoverageDuration(e.target.value)} className="w-full rounded-xl border border-outline-variant bg-surface-container-low p-3 text-[15px] outline-none focus:ring-2 focus:ring-primary">{COVERAGE_DURATION_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label className="md:col-span-2"><span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-secondary">Full name</span><input required value={fullName} onChange={e => setFullName(e.target.value)} placeholder="e.g. Mwiza Banda" className="w-full rounded-xl border border-outline-variant bg-surface-container-low p-3 text-[15px] outline-none focus:ring-2 focus:ring-primary" /></label>
        <label><span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-secondary">Mobile number</span><input required type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. 0970 123 456" className="w-full rounded-xl border border-outline-variant bg-surface-container-low p-3 text-[15px] outline-none focus:ring-2 focus:ring-primary" /></label>
        <label><span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-secondary">Email (optional)</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g. name@email.com" className="w-full rounded-xl border border-outline-variant bg-surface-container-low p-3 text-[15px] outline-none focus:ring-2 focus:ring-primary" /></label>
      </div>
      {policyDates && <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 rounded-xl bg-primary/5 px-4 py-3 text-[12px] text-primary"><span><strong>Starts:</strong> {policyDates.formattedStart}</span><span><strong>Ends:</strong> {policyDates.formattedEnd}</span><span><strong>Cover:</strong> {policyDates.daysTotal} days</span></div>}
      <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low p-4 hover:border-primary/40"><span className={`material-symbols-outlined text-2xl ${documents.whiteBook ? 'text-green-600' : 'text-primary'}`}>{documents.whiteBook ? 'check_circle' : 'upload_file'}</span><span className="flex-1"><span className="block text-[14px] font-bold text-primary">White Book</span><span className="text-[12px] text-secondary">{documents.whiteBook ? 'Added successfully' : 'Required to verify vehicle ownership'}</span></span><span className="rounded-lg bg-white px-3 py-2 text-[12px] font-bold text-primary shadow-sm">{documents.whiteBook ? 'Replace' : 'Upload'}</span><input className="hidden" type="file" accept="image/*,.pdf" onChange={e => e.target.files?.[0] && setDocument('whiteBook', URL.createObjectURL(e.target.files[0]))} /></label>
      <section className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
        <div className="mb-4 flex items-start gap-3"><span className="material-symbols-outlined text-indigo-700">photo_camera</span><div><h3 className="text-[14px] font-bold text-indigo-950">Vehicle inspection photos</h3><p className="text-[12px] text-indigo-900/80">Clear photos help insurers verify the vehicle and return complete quotes immediately.</p></div></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {INSPECTION_PHOTOS.map(photo => <label key={photo.key} className={`flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-3 text-center transition-colors ${documents[photo.key] ? 'border-green-400 bg-green-50 text-green-800' : 'border-indigo-200 bg-white text-indigo-900 hover:border-primary/50'}`}>
            {documents[photo.key] ? <><span className="material-symbols-outlined text-2xl">check_circle</span><span className="mt-1 text-[11px] font-bold">Added</span></> : <><span className="material-symbols-outlined text-2xl">{photo.icon}</span><span className="mt-1 text-[11px] font-bold">{photo.label}</span><span className="mt-0.5 text-[10px] text-secondary">Tap to upload</span></>}
            <input className="hidden" type="file" accept="image/*" capture="environment" onChange={e => e.target.files?.[0] && setDocument(photo.key, URL.createObjectURL(e.target.files[0]))} />
          </label>)}
        </div>
      </section>
      <label className={`mt-5 flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${consent ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white hover:border-primary/40'}`}><input className="mt-0.5 h-5 w-5 accent-red-600" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span className="text-[13px] leading-relaxed text-on-surface"><strong>I confirm</strong> the vehicle and contact information is accurate, I am authorised to request insurance for this vehicle, and I consent to InsurShield sharing this information with its listed insurers solely to generate quotations.</span></label>
      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">{error}</p>}
      <button type="submit" className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-4 text-[16px] font-bold text-white shadow-sm hover:bg-primary-container"><span className="material-symbols-outlined">send</span>Submit quote request</button>
    </form>
  </motion.main></>;
}
