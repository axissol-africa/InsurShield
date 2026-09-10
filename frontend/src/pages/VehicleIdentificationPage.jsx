import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { motion, AnimatePresence } from 'framer-motion';
import { formatZMW } from '../utils/premiumEngine';
import JourneyProgress from '../components/JourneyProgress';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 40 }, (_, i) => CURRENT_YEAR - i);

// ─── Vehicle Value Warning Component ──────────────────────────────────────────
function VehicleValueWarning() {
  return (
    <div className="bg-primary text-white rounded-2xl p-5 shadow-sm">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
        </div>
        <div>
          <h4 className="font-extrabold text-[15px] uppercase tracking-wide">⚠️ Critical: Accurate Vehicle Valuation Required</h4>
          <p className="text-white/90 text-[13px] mt-1 leading-relaxed">
            Enter the vehicle’s current fair market value. It affects your premium and the maximum amount payable for a claim.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <div className="bg-white/10 border border-white/20 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="material-symbols-outlined text-yellow-300 text-[18px]">trending_down</span>
            <span className="font-bold text-[12px] uppercase tracking-wider">Under-Valuing</span>
          </div>
          <p className="text-[12px] text-white/85 leading-relaxed">A lower declared value may reduce your premium, but any payout is limited to that declared value. You pay the difference yourself.</p>
        </div>
        <div className="bg-white/10 border border-white/20 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="material-symbols-outlined text-orange-300 text-[18px]">trending_up</span>
            <span className="font-bold text-[12px] uppercase tracking-wider">Over-Valuing</span>
          </div>
          <p className="text-[12px] text-white/85 leading-relaxed">Declaring more than the market value does not increase a payout and may be treated as insurance fraud.</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 bg-white/15 rounded-xl px-3 py-2">
        <span className="material-symbols-outlined text-yellow-300 text-[16px]">lightbulb</span>
        <p className="text-[12px] text-white/90"><strong>Tip:</strong> Use recent market listings or a professional valuation.</p>
      </div>
    </div>
  );
}

export default function VehicleIdentificationPage() {
  const [mode, setMode] = useState('search');
  const [plateNumber, setPlateNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retrievedVehicle, setRetrievedVehicle] = useState(null);
  const [includeRoadTax, setIncludeRoadTax] = useState(false);
  const [vehicleValueInput, setVehicleValueInput] = useState('');
  const [valueWarningAcknowledged, setValueWarningAcknowledged] = useState(false);

  const [manual, setManual] = useState({
    plateNumber: '', chassisNumber: '', engineNumber: '',
    make: '', model: '', year: String(CURRENT_YEAR), color: '',
  });

  const navigate = useNavigate();
  const { setVehicleDetails, setVehicleValue } = useStore();

  const handleSearch = (e) => {
    e.preventDefault();
    if (!plateNumber) return;
    setLoading(true);
    setError('');
    setTimeout(() => {
      setLoading(false);
      if (plateNumber.length > 4) {
        setRetrievedVehicle({
          plateNumber: plateNumber.toUpperCase(),
          make: 'Toyota', model: 'Hilux', year: '2020', color: 'White',
          chassisNumber: 'JTEH1234560012345',
          engineNumber: '2GD-FTV-12345',
          roadTaxExpiry: '31-10-2023',
          roadTaxStatus: 'Expired',
          roadTaxAmount: 'ZMW 500',
        });
        setIncludeRoadTax(true);
        setMode('confirm');
      } else {
        setError('Vehicle not found in RTSA database. Please check the plate number or enter details manually.');
      }
    }, 1500);
  };

  const handleConfirmRTSA = () => {
    if (!vehicleValueInput || parseFloat(vehicleValueInput) <= 0) {
      setError('Please enter the current market value of your vehicle in ZMW.');
      return;
    }
    if (!valueWarningAcknowledged) {
      setError('Please acknowledge the vehicle valuation warning before continuing.');
      return;
    }
    const val = parseFloat(vehicleValueInput.replace(/,/g, ''));
    setVehicleDetails({ ...retrievedVehicle, includeRoadTax });
    setVehicleValue(val);
    navigate('/vehicle-usage');
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manual.chassisNumber || !manual.make || !manual.model) {
      setError('Chassis Number, Make, and Model are required.');
      return;
    }
    if (!vehicleValueInput || parseFloat(vehicleValueInput) <= 0) {
      setError('Please enter the current market value of your vehicle in ZMW.');
      return;
    }
    if (!valueWarningAcknowledged) {
      setError('Please acknowledge the vehicle valuation warning before continuing.');
      return;
    }
    const val = parseFloat(vehicleValueInput.replace(/,/g, ''));
    setVehicleDetails({
      plateNumber: manual.plateNumber.toUpperCase(),
      chassisNumber: manual.chassisNumber.toUpperCase(),
      engineNumber: manual.engineNumber.toUpperCase(),
      make: manual.make, model: manual.model,
      year: manual.year, color: manual.color,
      includeRoadTax: false,
    });
    setVehicleValue(val);
    navigate('/vehicle-usage');
  };

  const setManualField = (field, val) => setManual(prev => ({ ...prev, [field]: val }));
  const handleValueChange = (e) => setVehicleValueInput(e.target.value.replace(/[^0-9.]/g, ''));
  const vehicleValueZMW = parseFloat(vehicleValueInput) || 0;

  return (
    <><JourneyProgress current={2} /><div className="flex justify-center items-start bg-slate-50/70 py-12 px-4 w-full min-h-[calc(100vh-64px)]">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-primary text-3xl">directions_car</span>
          </div>
          <h1 className="text-[34px] font-extrabold tracking-[-.04em] text-on-surface">Vehicle Identification</h1>
          <p className="text-[17px] text-secondary mt-2">Retrieve your vehicle details securely from the RTSA database.</p>
        </div>

        {/* Mode Tabs (only on search/manual) */}
        {mode !== 'confirm' && (
          <div className="flex border-b border-slate-200 mb-6">
            {['search', 'manual'].map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(''); }}
                className={`flex-1 border-b-4 py-3 text-[14px] font-bold transition-all flex items-center justify-center gap-2 ${mode === m ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-primary'}`}
              >
                <span className="material-symbols-outlined text-[16px]">{m === 'search' ? 'search' : 'edit'}</span>
                {m === 'search' ? 'RTSA Lookup' : 'Manual Entry'}
              </button>
            ))}
          </div>
        )}

        <AnimatePresence mode="wait">

          {/* ── RTSA Lookup ── */}
          {mode === 'search' && (
            <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card className="border border-slate-200 shadow-sm">
                <CardContent className="p-6">
                  <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl mb-6">
                    <div className="flex items-start gap-3">
                      <span className="material-symbols-outlined text-amber-600 mt-0.5 text-[20px]">info</span>
                      <div>
                        <h4 className="text-[14px] font-bold text-amber-900">What to Have Ready</h4>
                        <p className="text-[12px] text-amber-800 mt-1">Have your <strong>White Book</strong> ready for upload. You'll also need the <strong>current market value</strong> of your vehicle.</p>
                      </div>
                    </div>
                  </div>
                  <form onSubmit={handleSearch} className="space-y-4">
                    <div>
                      <label className="text-[12px] font-bold tracking-[0.05em] text-on-surface-variant uppercase mb-2 block">License Plate Number</label>
                      <input
                        type="text"
                        placeholder="e.g. BAA 1234"
                        value={plateNumber}
                        onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                        required
                        className="w-full bg-white border border-slate-200 rounded-xl p-4 text-center text-2xl tracking-widest font-bold uppercase focus:ring-2 focus:ring-primary outline-none"
                      />
                    </div>
                    {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                    <Button type="submit" className="w-full" size="lg" disabled={!plateNumber || loading}>
                      {loading ? 'Searching RTSA...' : 'Find Vehicle'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── RTSA Confirm ── */}
          {mode === 'confirm' && retrievedVehicle && (
            <motion.div key="confirm" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="space-y-5">
                <Card className="border-2 border-green-700 shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-green-600" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                      <CardTitle className="text-green-800 text-[18px]">Vehicle Found — Verify Details</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6 space-y-5">
                    <div className="bg-surface-container-low p-4 rounded-xl border border-gray-100">
                      <div className="grid grid-cols-2 gap-4">
                        <div><p className="text-[11px] text-on-surface-variant font-bold uppercase">Plate</p><p className="font-bold text-xl text-primary tracking-widest">{retrievedVehicle.plateNumber}</p></div>
                        <div><p className="text-[11px] text-on-surface-variant font-bold uppercase">Make & Model</p><p className="font-semibold">{retrievedVehicle.make} {retrievedVehicle.model}</p></div>
                        <div><p className="text-[11px] text-on-surface-variant font-bold uppercase">Year</p><p className="font-semibold">{retrievedVehicle.year}</p></div>
                        <div><p className="text-[11px] text-on-surface-variant font-bold uppercase">Color</p><p className="font-semibold">{retrievedVehicle.color}</p></div>
                        <div className="col-span-2 pt-2 border-t border-gray-100">
                          <p className="text-[11px] text-on-surface-variant font-bold uppercase">Chassis Number (VIN)</p>
                          <p className="font-mono text-sm font-semibold">{retrievedVehicle.chassisNumber}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-[11px] text-on-surface-variant font-bold uppercase">Engine Number</p>
                          <p className="font-mono text-sm font-semibold">{retrievedVehicle.engineNumber}</p>
                        </div>
                      </div>
                    </div>

                    {/* Road Tax */}
                    <div className="flex items-center justify-between">
                      <p className="text-[12px] text-on-surface-variant font-bold uppercase">Road Tax Status</p>
                      <span className={`px-2 py-1 rounded-full text-[10px] uppercase tracking-wider font-bold ${retrievedVehicle.roadTaxStatus === 'Expired' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {retrievedVehicle.roadTaxStatus} (Exp: {retrievedVehicle.roadTaxExpiry})
                      </span>
                    </div>

                    {retrievedVehicle.roadTaxStatus === 'Expired' && (
                      <div className={`p-4 rounded-xl border cursor-pointer transition-colors ${includeRoadTax ? 'bg-primary/5 border-primary/30' : 'bg-surface border-gray-200'}`} onClick={() => setIncludeRoadTax(!includeRoadTax)}>
                        <div className="flex items-start gap-3">
                          <input type="checkbox" checked={includeRoadTax} onChange={() => setIncludeRoadTax(!includeRoadTax)} className="w-5 h-5 mt-0.5 rounded border-gray-300 text-primary focus:ring-primary" />
                          <div>
                            <p className="font-semibold text-sm text-primary">Renew Road Tax with Insurance</p>
                            <p className="text-[12px] text-on-surface-variant mt-1">Pay road tax ({retrievedVehicle.roadTaxAmount}) together with your premium.</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* ── VEHICLE VALUE — STRONG WARNING ── */}
                <VehicleValueWarning />

                {/* Value Input */}
                <Card className="border border-slate-200 shadow-sm">
                  <CardContent className="p-6 space-y-4">
                    <div>
                      <label className="text-[13px] font-extrabold tracking-[0.05em] text-primary uppercase mb-2 block flex items-center gap-2">
                        <span className="material-symbols-outlined text-[18px]">payments</span>
                        Current Market Value (ZMW) <span className="text-red-600">*Required</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant font-bold text-[14px]">ZMW</span>
                        <input
                          type="number"
                          min="1"
                          placeholder="Enter fair market value, e.g. 200000"
                          value={vehicleValueInput}
                          onChange={handleValueChange}
                          className="w-full bg-surface-container-low border-2 border-primary/30 rounded-xl pl-16 pr-4 py-4 text-[18px] font-bold focus:ring-2 focus:ring-primary outline-none"
                          required
                        />
                      </div>
                      {vehicleValueZMW > 0 && (
                        <div className="mt-2">
                          <div className="bg-primary/5 border border-primary/20 rounded-lg p-2 text-center">
                            <p className="text-[10px] font-bold uppercase text-primary mb-0.5">Entered Value</p>
                            <p className="text-[14px] font-extrabold text-primary">{formatZMW(vehicleValueZMW)}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Acknowledgement Checkbox */}
                    <div
                      className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${valueWarningAcknowledged ? 'bg-green-50 border-green-400' : 'bg-white border-gray-200 hover:border-primary/40'}`}
                      onClick={() => setValueWarningAcknowledged(!valueWarningAcknowledged)}
                    >
                      <div className={`w-6 h-6 rounded-md border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${valueWarningAcknowledged ? 'bg-green-500 border-green-500' : 'border-gray-300'}`}>
                        {valueWarningAcknowledged && <span className="material-symbols-outlined text-white text-[14px]">check</span>}
                      </div>
                      <p className="text-[13px] text-on-surface leading-relaxed">
                        <strong>I confirm</strong> that the value I have entered is the true and accurate current market value of this vehicle. I understand that under-valuing or over-valuing my vehicle will affect my claim payouts and may constitute insurance fraud.
                      </p>
                    </div>

                    {error && <p className="text-red-500 text-sm text-center">{error}</p>}

                    <div className="flex gap-3">
                      <Button variant="outline" className="flex-1" onClick={() => { setMode('search'); setRetrievedVehicle(null); setError(''); }}>
                        Wrong Vehicle
                      </Button>
                      <Button className="flex-[2]" onClick={handleConfirmRTSA}>
                        Confirm & Continue
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </motion.div>
          )}

          {/* ── Manual Entry ── */}
          {mode === 'manual' && (
            <motion.div key="manual" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card className="shadow-lg border-t-4 border-t-primary">
                <CardHeader className="pb-2">
                  <CardTitle className="text-[18px]">Manual Vehicle Entry</CardTitle>
                  <CardDescription>Fields marked with * are mandatory.</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                  <form onSubmit={handleManualSubmit} className="space-y-5">
                    <div>
                      <label className="text-[12px] font-bold tracking-[0.05em] text-on-surface-variant uppercase mb-1.5 block">Registration Number (Plate)</label>
                      <input value={manual.plateNumber} onChange={e => setManualField('plateNumber', e.target.value.toUpperCase())} className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] focus:ring-2 focus:ring-primary outline-none uppercase tracking-widest font-bold" placeholder="e.g. BAA 1234" />
                    </div>

                    <div>
                      <label className="text-[12px] font-bold tracking-[0.05em] text-on-surface-variant uppercase mb-1.5 block">Chassis Number (VIN) <span className="text-red-600">*</span></label>
                      <input required value={manual.chassisNumber} onChange={e => setManualField('chassisNumber', e.target.value.toUpperCase())} className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 font-mono text-[15px] focus:ring-2 focus:ring-primary outline-none uppercase" placeholder="e.g. JTEH1234560012345 (17 chars)" maxLength={17} />
                      <p className="text-[11px] text-on-surface-variant mt-1">Found on the dashboard, door jamb, or vehicle registration document.</p>
                    </div>

                    <div>
                      <label className="text-[12px] font-bold tracking-[0.05em] text-on-surface-variant uppercase mb-1.5 block">Engine Number</label>
                      <input value={manual.engineNumber} onChange={e => setManualField('engineNumber', e.target.value.toUpperCase())} className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 font-mono text-[15px] focus:ring-2 focus:ring-primary outline-none uppercase" placeholder="e.g. 2GD-FTV-12345" />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[12px] font-bold tracking-[0.05em] text-on-surface-variant uppercase mb-1.5 block">Make <span className="text-red-600">*</span></label>
                        <input required value={manual.make} onChange={e => setManualField('make', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] focus:ring-2 focus:ring-primary outline-none" placeholder="e.g. Toyota" />
                      </div>
                      <div>
                        <label className="text-[12px] font-bold tracking-[0.05em] text-on-surface-variant uppercase mb-1.5 block">Model <span className="text-red-600">*</span></label>
                        <input required value={manual.model} onChange={e => setManualField('model', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] focus:ring-2 focus:ring-primary outline-none" placeholder="e.g. Hilux" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[12px] font-bold tracking-[0.05em] text-on-surface-variant uppercase mb-1.5 block">Year of Manufacture</label>
                        <select value={manual.year} onChange={e => setManualField('year', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] focus:ring-2 focus:ring-primary outline-none">
                          {YEAR_OPTIONS.map(y => <option key={y}>{y}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[12px] font-bold tracking-[0.05em] text-on-surface-variant uppercase mb-1.5 block">Color</label>
                        <input value={manual.color} onChange={e => setManualField('color', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] focus:ring-2 focus:ring-primary outline-none" placeholder="e.g. White" />
                      </div>
                    </div>

                    {/* ── VEHICLE VALUE — STRONG WARNING ── */}
                    <VehicleValueWarning />

                    <div>
                      <label className="text-[13px] font-extrabold tracking-[0.05em] text-primary uppercase mb-2 block">Current Market Value (ZMW) <span className="text-red-600">*</span></label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant font-bold text-[14px]">ZMW</span>
                        <input type="number" min="1" required placeholder="e.g. 200000" value={vehicleValueInput} onChange={handleValueChange} className="w-full bg-surface-container-low border-2 border-primary/30 rounded-xl pl-16 pr-4 py-4 text-[18px] font-bold focus:ring-2 focus:ring-primary outline-none" />
                      </div>
                      {vehicleValueZMW > 0 && (
                        <div className="mt-2">
                          <div className="bg-primary/5 border border-primary/20 rounded-lg p-2 text-center">
                            <p className="text-[10px] font-bold uppercase text-primary mb-0.5">Entered Value</p>
                            <p className="text-[14px] font-extrabold text-primary">{formatZMW(vehicleValueZMW)}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Acknowledgement */}
                    <div className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${valueWarningAcknowledged ? 'bg-green-50 border-green-400' : 'bg-white border-gray-200 hover:border-primary/40'}`} onClick={() => setValueWarningAcknowledged(!valueWarningAcknowledged)}>
                      <div className={`w-6 h-6 rounded-md border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${valueWarningAcknowledged ? 'bg-green-500 border-green-500' : 'border-gray-300'}`}>
                        {valueWarningAcknowledged && <span className="material-symbols-outlined text-white text-[14px]">check</span>}
                      </div>
                      <p className="text-[13px] text-on-surface leading-relaxed">
                        <strong>I confirm</strong> that the value entered is the true current market value of this vehicle. I understand the consequences of under-valuing or over-valuing.
                      </p>
                    </div>

                    {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                    <Button type="submit" className="w-full" size="lg">Save & Continue</Button>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div></>
  );
}
