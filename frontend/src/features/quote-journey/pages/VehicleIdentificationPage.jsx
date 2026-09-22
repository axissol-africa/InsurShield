import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/api';
import { useStore } from '@/store';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import JourneyProgress from '@/features/quote-journey/components/JourneyProgress';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 40 }, (_, i) => CURRENT_YEAR - i);

const fieldClass = 'w-full rounded-lg border border-outline-variant bg-surface-container-low p-3 text-[16px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';
const labelClass = 'mb-1.5 block text-[12px] font-bold uppercase tracking-[0.05em] text-on-surface-variant';

export default function VehicleIdentificationPage() {
  const navigate = useNavigate();
  const { setVehicleDetails, setVehicleValue } = useStore();

  const [mode, setMode] = useState('search'); // 'search' | 'confirm' | 'manual'
  const [plateNumber, setPlateNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retrievedVehicle, setRetrievedVehicle] = useState(null);
  const [manual, setManual] = useState({ plateNumber: '', chassisNumber: '', engineNumber: '', make: '', model: '', year: String(CURRENT_YEAR), color: '', registrationDate: '' });
  const [valuation, setValuation] = useState({ value: '', acknowledged: false });

  const declaredValue = parseFloat(valuation.value) || 0;
  const updateValuation = (next) => { setValuation(next); setError(''); };

  const switchMode = (nextMode) => { setMode(nextMode); setError(''); };

  const handleSearch = async (event) => {
    event.preventDefault();
    if (!plateNumber.trim()) return;
    setLoading(true);
    setError('');
    try {
      setRetrievedVehicle(await api.vehicles.lookupPlate(plateNumber));
      setMode('confirm');
    } catch (caught) {
      setError(caught.message || 'The RTSA lookup is unavailable right now. Enter the details manually instead.');
    } finally {
      setLoading(false);
    }
  };

  const validateValuation = () => {
    if (declaredValue <= 0) return 'Enter the current market value of your vehicle in ZMW.';
    if (!valuation.acknowledged) return 'Confirm that the declared value is accurate before continuing.';
    return '';
  };

  const saveAndContinue = (details) => {
    const validationError = validateValuation();
    if (validationError) { setError(validationError); return; }
    setVehicleDetails(details);
    setVehicleValue(declaredValue);
    navigate('/vehicle-usage');
  };

  const handleConfirmRtsa = () => saveAndContinue(retrievedVehicle);

  const handleManualSubmit = (event) => {
    event.preventDefault();
    if (!manual.chassisNumber || !manual.make || !manual.model) { setError('Chassis number, make and model are required.'); return; }
    saveAndContinue({
      plateNumber: manual.plateNumber.toUpperCase(),
      chassisNumber: manual.chassisNumber.toUpperCase(),
      engineNumber: manual.engineNumber.toUpperCase(),
      make: manual.make, model: manual.model, year: manual.year, color: manual.color,
      registrationDate: manual.registrationDate,
    });
  };

  const setManualField = (field) => (event) => setManual((previous) => ({ ...previous, [field]: event.target.value }));

  return (
    <>
      <JourneyProgress current={2} />
      <div className="flex min-h-[calc(100vh-80px)] w-full items-start justify-center bg-slate-50/70 px-4 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-xl">
          <header className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10"><span className="material-symbols-outlined text-3xl text-primary" aria-hidden="true">directions_car</span></div>
            <h1 className="text-[34px] font-extrabold tracking-[-.04em] text-on-surface">Your vehicle</h1>
            <p className="mt-2 text-[17px] text-secondary">Look it up on the RTSA register, or enter the details yourself.</p>
          </header>

          {mode !== 'confirm' && (
            <div role="tablist" aria-label="Vehicle entry method" className="mb-6 flex border-b border-slate-200">
              {[['search', 'search', 'RTSA lookup'], ['manual', 'edit', 'Manual entry']].map(([id, icon, label]) => (
                <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => switchMode(id)} className={`flex flex-1 items-center justify-center gap-2 border-b-4 py-3 text-[14px] font-bold transition-all ${mode === id ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-primary'}`}>
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{icon}</span>{label}
                </button>
              ))}
            </div>
          )}

          <AnimatePresence mode="wait">
            {mode === 'search' && (
              <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Card className="border border-slate-200 shadow-sm">
                  <CardContent className="p-6">
                    <p className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
                      <span className="material-symbols-outlined mt-0.5 text-[20px] text-amber-600" aria-hidden="true">info</span>
                      <span><strong>Have ready:</strong> your White Book and the vehicle's current market value. You'll upload the White Book and seven vehicle photos when you request quotes.</span>
                    </p>
                    <form onSubmit={handleSearch} className="space-y-4">
                      <label className="block">
                        <span className={labelClass}>Licence plate number</span>
                        <input type="text" placeholder="e.g. BAA 1234" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value.toUpperCase())} required autoComplete="off" className="w-full rounded-xl border border-slate-200 bg-white p-4 text-center text-2xl font-bold uppercase tracking-widest outline-none focus:ring-2 focus:ring-primary" />
                      </label>
                      <ErrorText text={error} />
                      <Button type="submit" className="w-full" size="lg" disabled={!plateNumber || loading}>{loading ? 'Searching RTSA…' : 'Find vehicle'}</Button>
                    </form>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {mode === 'confirm' && retrievedVehicle && (
              <motion.div key="confirm" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
                <Card className="border-2 border-primary shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">check_circle</span>
                      <CardTitle className="text-[18px] text-primary">Vehicle found — check the details</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5 p-6">
                    <dl className="grid grid-cols-2 gap-4 rounded-xl border border-gray-100 bg-surface-container-low p-4">
                      <Detail label="Plate" value={retrievedVehicle.plateNumber} className="text-xl tracking-widest text-primary" />
                      <Detail label="Make & model" value={`${retrievedVehicle.make} ${retrievedVehicle.model}`} />
                      <Detail label="Year" value={retrievedVehicle.year} />
                      <Detail label="Colour" value={retrievedVehicle.color} />
                      <Detail label="Chassis number (VIN)" value={retrievedVehicle.chassisNumber} className="font-mono text-sm" span />
                      <Detail label="Engine number" value={retrievedVehicle.engineNumber} className="font-mono text-sm" span />
                      <Detail label="RTSA registration date" value={formatDate(retrievedVehicle.registrationDate)} span />
                    </dl>
                    <div className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="font-bold uppercase text-on-surface-variant">RTSA anniversary</span>
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">{formatDate(retrievedVehicle.rtsaAnniversaryDate)}</span>
                    </div>
                    <p className="text-[12px] text-on-surface-variant">Use this date to align the policy start date with the vehicle’s RTSA anniversary when requesting quotes.</p>
                  </CardContent>
                </Card>

                <Card className="border border-slate-200 shadow-sm">
                  <CardContent className="space-y-4 p-6">
                    <Valuation valuation={valuation} onChange={updateValuation} declaredValue={declaredValue} />
                    <ErrorText text={error} />
                    <div className="flex gap-3">
                      <Button variant="outline" className="flex-1" onClick={() => { setMode('search'); setRetrievedVehicle(null); setError(''); }}>Wrong vehicle</Button>
                      <Button className="flex-[2]" onClick={handleConfirmRtsa}>Confirm & continue</Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {mode === 'manual' && (
              <motion.div key="manual" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Card className="border-t-4 border-t-primary shadow-lg">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-[18px]">Enter vehicle details</CardTitle>
                    <CardDescription>Fields marked * are required.</CardDescription>
                  </CardHeader>
                  <CardContent className="p-6">
                    <form onSubmit={handleManualSubmit} className="space-y-5">
                      <label className="block"><span className={labelClass}>Registration number (plate)</span><input value={manual.plateNumber} onChange={setManualField('plateNumber')} className={`${fieldClass} font-bold uppercase tracking-widest`} placeholder="e.g. BAA 1234" /></label>
                      <label className="block">
                        <span className={labelClass}>Chassis number (VIN) <span className="text-red-600">*</span></span>
                        <input required value={manual.chassisNumber} onChange={setManualField('chassisNumber')} className={`${fieldClass} font-mono uppercase`} placeholder="17 characters" maxLength={17} />
                        <span className="mt-1 block text-[11px] text-on-surface-variant">Found on the dashboard, door jamb or registration document.</span>
                      </label>
                      <label className="block"><span className={labelClass}>Engine number</span><input value={manual.engineNumber} onChange={setManualField('engineNumber')} className={`${fieldClass} font-mono uppercase`} placeholder="e.g. 2GD-FTV-12345" /></label>
                      <div className="grid grid-cols-2 gap-4">
                        <label className="block"><span className={labelClass}>Make <span className="text-red-600">*</span></span><input required value={manual.make} onChange={setManualField('make')} className={fieldClass} placeholder="e.g. Toyota" /></label>
                        <label className="block"><span className={labelClass}>Model <span className="text-red-600">*</span></span><input required value={manual.model} onChange={setManualField('model')} className={fieldClass} placeholder="e.g. Hilux" /></label>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <label className="block"><span className={labelClass}>Year of manufacture</span><select value={manual.year} onChange={setManualField('year')} className={fieldClass}>{YEAR_OPTIONS.map((year) => <option key={year}>{year}</option>)}</select></label>
                        <label className="block"><span className={labelClass}>Colour</span><input value={manual.color} onChange={setManualField('color')} className={fieldClass} placeholder="e.g. White" /></label>
                      </div>
                      <label className="block">
                        <span className={labelClass}>RTSA registration date</span>
                        <input type="date" max={new Date().toISOString().split('T')[0]} value={manual.registrationDate} onChange={setManualField('registrationDate')} className={fieldClass} />
                        <span className="mt-1 block text-[11px] text-on-surface-variant">Optional — lets you align your cover with the road-tax anniversary when requesting quotes.</span>
                      </label>
                      <Valuation valuation={valuation} onChange={updateValuation} declaredValue={declaredValue} />
                      <ErrorText text={error} />
                      <Button type="submit" className="w-full" size="lg">Save & continue</Button>
                    </form>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  );
}

/** Declared market value plus the accuracy acknowledgement, shared by both entry modes. */
function Valuation({ valuation, onChange, declaredValue }) {
  const [showGuidance, setShowGuidance] = useState(false);
  return (
    <div className="space-y-4">
      <div>
        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-[13px] font-extrabold uppercase tracking-[0.05em] text-primary"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">payments</span>Current market value (ZMW) *</span>
          <span className="relative block">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-bold text-on-surface-variant" aria-hidden="true">ZMW</span>
            <input type="text" inputMode="decimal" required placeholder="e.g. 200000" value={valuation.value} onChange={(e) => onChange({ ...valuation, value: e.target.value.replace(/[^0-9.]/g, '') })} className="w-full rounded-xl border-2 border-primary/30 bg-surface-container-low py-4 pl-16 pr-4 text-[18px] font-bold outline-none focus:ring-2 focus:ring-primary" />
          </span>
        </label>
        <div className="mt-2 flex items-center justify-between gap-3 text-[12px]">
          <span className="text-on-surface-variant">{declaredValue > 0 ? <>Declared: <strong className="text-primary">{formatZMW(declaredValue)}</strong></> : 'This sets your premium and the most a claim can pay out.'}</span>
          <button type="button" onClick={() => setShowGuidance((open) => !open)} aria-expanded={showGuidance} className="shrink-0 font-bold text-primary hover:underline">{showGuidance ? 'Hide guidance' : 'Why this matters'}</button>
        </div>
        {showGuidance && (
          <div className="mt-3 grid gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4 text-[12px] text-on-surface sm:grid-cols-2">
            <p><strong className="block text-primary">Under-valuing</strong>A lower value may reduce your premium, but any payout is capped at the declared value — you carry the difference.</p>
            <p><strong className="block text-primary">Over-valuing</strong>Declaring more than the market value does not increase a payout and may be treated as fraud.</p>
            <p className="sm:col-span-2 text-on-surface-variant">Tip: use recent market listings or a professional valuation.</p>
          </div>
        )}
      </div>

      <label className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-all ${valuation.acknowledged ? 'border-primary/40 bg-primary/5' : 'border-gray-200 bg-white hover:border-primary/40'}`}>
        <input type="checkbox" checked={valuation.acknowledged} onChange={(e) => onChange({ ...valuation, acknowledged: e.target.checked })} className="mt-0.5 h-5 w-5 accent-red-600" />
        <span className="text-[13px] leading-relaxed text-on-surface"><strong>I confirm</strong> this is the true current market value of the vehicle, and I understand that under- or over-valuing it affects any claim payout.</span>
      </label>
    </div>
  );
}

function Detail({ label, value, className = '', span = false }) {
  return (
    <div className={span ? 'col-span-2 border-t border-gray-100 pt-2' : ''}>
      <dt className="text-[11px] font-bold uppercase text-on-surface-variant">{label}</dt>
      <dd className={`font-semibold ${className}`}>{value}</dd>
    </div>
  );
}

function ErrorText({ text }) {
  return text ? <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-center text-sm font-medium text-red-700">{text}</p> : null;
}
