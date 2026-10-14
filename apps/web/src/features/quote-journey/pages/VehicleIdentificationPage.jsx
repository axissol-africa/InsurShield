import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Info, Search, TriangleAlert } from 'lucide-react';
import { api } from '@/api';
import { useStore } from '@/store';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/primitives/card';
import { Input } from '@/components/ui/primitives/input';
import { Label } from '@/components/ui/primitives/label';
import { Checkbox } from '@/components/ui/primitives/checkbox';
import { NativeSelect, NativeSelectOption, NativeSelectOptGroup } from '@/components/ui/primitives/native-select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/primitives/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/primitives/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/primitives/popover';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import { COUNTRY_GROUPS, DEFAULT_COUNTRY, MAX_COUNTRY_LENGTH, OTHER, resolveCountry } from '@/domain/countries';
import JourneyLayout from '@/features/quote-journey/components/JourneyLayout';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 40 }, (_, i) => CURRENT_YEAR - i);

export default function VehicleIdentificationPage() {
  const navigate = useNavigate();
  const { setVehicleDetails, setVehicleValue } = useStore();

  const [mode, setMode] = useState('search');
  const valueRef = useRef(null);
  const acknowledgementRef = useRef(null);
  const otherCountryRef = useRef(null);
  const [plateNumber, setPlateNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retrievedVehicle, setRetrievedVehicle] = useState(null);
  const [manual, setManual] = useState({
    plateNumber: '', chassisNumber: '', engineNumber: '', make: '', model: '',
    year: String(CURRENT_YEAR), color: '', registrationDate: '',
    registrationCountry: DEFAULT_COUNTRY, otherCountry: '',
  });
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
    if (validationError) {
      setError(validationError);
      (declaredValue <= 0 ? valueRef : acknowledgementRef).current?.focus();
      return;
    }
    setVehicleDetails(details);
    setVehicleValue(declaredValue);
    navigate('/vehicle-usage');
  };

  const handleConfirmRtsa = () =>
    saveAndContinue({ ...retrievedVehicle, registrationCountry: retrievedVehicle?.registrationCountry || DEFAULT_COUNTRY });

  const handleManualSubmit = (event) => {
    event.preventDefault();
    if (!manual.chassisNumber || !manual.make || !manual.model) { setError('Chassis number, make and model are required.'); return; }
    const { country, error: countryError } = resolveCountry(manual.registrationCountry, manual.otherCountry);
    if (countryError) { setError(countryError); otherCountryRef.current?.focus(); return; }
    saveAndContinue({
      plateNumber: manual.plateNumber.toUpperCase(),
      chassisNumber: manual.chassisNumber.toUpperCase(),
      engineNumber: manual.engineNumber.toUpperCase(),
      make: manual.make, model: manual.model, year: manual.year, color: manual.color,
      registrationDate: manual.registrationDate,
      registrationCountry: country,
    });
  };

  /**
   * Leaving "Other" drops whatever was typed there, so a country abandoned
   * half way through cannot be submitted behind a listed one.
   */
  const setCountry = (event) => {
    const registrationCountry = event.target.value;
    setManual((previous) => ({
      ...previous,
      registrationCountry,
      otherCountry: registrationCountry === OTHER ? previous.otherCountry : '',
    }));
    setError('');
  };

  const setManualField = (field) => (event) => {
    setManual((previous) => ({ ...previous, [field]: event.target.value }));
    setError('');
  };

  return (
    <JourneyLayout step={2} title="Your vehicle" description="Look it up on the RTSA register, or enter the details yourself." className="max-w-3xl">
      <Alert role="note" className="mb-6 border-primary/20 bg-primary/[0.045]">
        <Info aria-hidden="true" className="text-primary" />
        <AlertTitle className="text-primary">Have ready</AlertTitle>
        <AlertDescription>Your White Book and the vehicle's current market value. You'll upload the White Book and seven vehicle photos when you request quotes.</AlertDescription>
      </Alert>

      {mode === 'confirm' && retrievedVehicle ? (
        <div className="space-y-6">
          <Card className="border border-primary/20 shadow-sm">
            <CardHeader className="border-b border-primary/10 bg-primary/[0.025]">
              <CardTitle className="flex items-center gap-2 text-primary"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">verified</span><h2>Vehicle found — check the details</h2></CardTitle>
              <CardDescription>Make sure these details match your White Book.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <dl className="grid grid-cols-2 gap-x-5 gap-y-4">
                <Detail label="Plate" value={retrievedVehicle.plateNumber} />
                <Detail label="Make & model" value={`${retrievedVehicle.make} ${retrievedVehicle.model}`} />
                <Detail label="Year" value={retrievedVehicle.year} />
                <Detail label="Colour" value={retrievedVehicle.color} />
                <Detail label="Chassis number (VIN)" value={retrievedVehicle.chassisNumber} span />
                <Detail label="Engine number" value={retrievedVehicle.engineNumber} span />
                <Detail label="RTSA registration date" value={formatDate(retrievedVehicle.registrationDate)} span />
                <Detail label="RTSA anniversary" value={formatDate(retrievedVehicle.rtsaAnniversaryDate)} span />
              </dl>
              <p className="text-sm leading-relaxed text-muted-foreground">Use the RTSA anniversary to align the policy start date when requesting quotes.</p>
              <Button variant="outline" className="min-h-11 border-primary text-primary hover:bg-primary/10 hover:text-primary" onClick={() => { setMode('search'); setRetrievedVehicle(null); setError(''); }}>Wrong vehicle</Button>
            </CardContent>
          </Card>
          <Card className="border border-primary/15 shadow-sm">
            <CardContent>
              <Valuation valuation={valuation} onChange={updateValuation} declaredValue={declaredValue} valueRef={valueRef} acknowledgementRef={acknowledgementRef} />
            </CardContent>
          </Card>
          <ErrorText text={error} />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button asChild variant="ghost" className="min-h-11"><Link to="/insurance-type"><ArrowLeft aria-hidden="true" />Back</Link></Button>
            <Button size="lg" className="min-h-11" onClick={handleConfirmRtsa}>Confirm & continue</Button>
          </div>
        </div>
      ) : (
        <Tabs value={mode} onValueChange={switchMode} className="flex-col gap-5">
          <TabsList aria-label="Vehicle entry method" className="grid h-auto w-full grid-cols-2 rounded-2xl border border-primary/15 bg-primary/[0.045] p-1">
            <TabsTrigger value="search" disabled={loading} className="min-h-11 data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm">RTSA lookup</TabsTrigger>
            <TabsTrigger value="manual" disabled={loading} className="min-h-11 data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm">Manual entry</TabsTrigger>
          </TabsList>
          <TabsContent value="search">
            <Card className="border border-primary/15 shadow-sm">
              <CardHeader className="border-b border-primary/10 bg-primary/[0.025]">
                <CardTitle className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Search className="size-4" aria-hidden="true" /></span><h2>Find your vehicle</h2></CardTitle>
                <CardDescription>Enter the registration number shown on your White Book.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSearch} className="space-y-5">
                  <FormInput label="Licence plate number" id="lookup-plate" placeholder="e.g. BAA 1234" value={plateNumber} onChange={(event) => { setPlateNumber(event.target.value.toUpperCase()); setError(''); }} required autoComplete="off" className="uppercase tracking-wider" />
                  <ErrorText text={error} />
                  {error && <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => switchMode('manual')}>Enter details manually</Button>}
                  <Button type="submit" className="min-h-11 w-full" size="lg" disabled={!plateNumber.trim() || loading}><Search aria-hidden="true" />{loading ? 'Searching RTSA…' : 'Find vehicle'}</Button>
                </form>
              </CardContent>
            </Card>
            <Button asChild variant="ghost" className="mt-5 min-h-11"><Link to="/insurance-type"><ArrowLeft aria-hidden="true" />Back</Link></Button>
          </TabsContent>
          <TabsContent value="manual">
            <form onSubmit={handleManualSubmit} className="space-y-6">
              <Card className="border border-primary/15 shadow-sm">
                <CardHeader className="border-b border-primary/10 bg-primary/[0.025]">
                  <CardTitle className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">directions_car</span></span><h2>Enter vehicle details</h2></CardTitle>
                  <CardDescription>Fields marked * are required. Use the details on your White Book.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-7">
                  <fieldset className="min-w-0 space-y-5">
                    <legend className="mb-4 text-base font-semibold">Vehicle identity</legend>
                    <FormInput label="Registration number (plate)" id="manual-plate" value={manual.plateNumber} onChange={setManualField('plateNumber')} placeholder="e.g. BAA 1234" className="uppercase" />
                    <div className="space-y-2">
                      <FormInput label="Chassis number (VIN) *" id="manual-chassis" required value={manual.chassisNumber} onChange={setManualField('chassisNumber')} placeholder="17 characters" maxLength={17} aria-describedby="chassis-help" className="font-mono uppercase" />
                      <p id="chassis-help" className="text-xs text-muted-foreground">Found on the dashboard, door jamb or registration document.</p>
                    </div>
                    <FormInput label="Engine number" id="manual-engine" value={manual.engineNumber} onChange={setManualField('engineNumber')} placeholder="e.g. 2GD-FTV-12345" className="uppercase" />
                    <div className="grid gap-5 sm:grid-cols-2">
                      <FormInput label="Make *" id="manual-make" required value={manual.make} onChange={setManualField('make')} placeholder="e.g. Toyota" />
                      <FormInput label="Model *" id="manual-model" required value={manual.model} onChange={setManualField('model')} placeholder="e.g. Hilux" />
                      <div className="space-y-2">
                        <Label htmlFor="manual-year">Year of manufacture</Label>
                        <NativeSelect id="manual-year" value={manual.year} onChange={setManualField('year')} className="w-full [&_select]:min-h-11 [&_select]:text-base md:[&_select]:text-sm">
                          {YEAR_OPTIONS.map((year) => <NativeSelectOption key={year}>{year}</NativeSelectOption>)}
                        </NativeSelect>
                      </div>
                      <FormInput label="Colour" id="manual-colour" value={manual.color} onChange={setManualField('color')} placeholder="e.g. White" />
                    </div>
                  </fieldset>
                  <fieldset className="min-w-0 space-y-5 border-t border-border pt-5">
                    <legend className="pr-2 text-base font-semibold">Registration</legend>
                    <div className="space-y-2">
                      <Label htmlFor="registration-country">Country of registration *</Label>
                      <NativeSelect id="registration-country" required value={manual.registrationCountry} onChange={setCountry} className="w-full [&_select]:min-h-11 [&_select]:text-base md:[&_select]:text-sm">
                        {COUNTRY_GROUPS.map((group) => (
                          <NativeSelectOptGroup key={group.label} label={group.label}>
                            {group.countries.map((country) => <NativeSelectOption key={country} value={country}>{country}</NativeSelectOption>)}
                          </NativeSelectOptGroup>
                        ))}
                        <NativeSelectOption value={OTHER}>Other — not listed</NativeSelectOption>
                      </NativeSelect>
                    </div>
                    {manual.registrationCountry === OTHER && (
                      <FormInput label="Type the country *" id="other-country" ref={otherCountryRef} required autoFocus value={manual.otherCountry} onChange={setManualField('otherCountry')} maxLength={MAX_COUNTRY_LENGTH} placeholder="e.g. Western Sahara" />
                    )}
                    <FormInput label="RTSA registration date" id="registration-date" type="date" max={new Date().toISOString().split('T')[0]} value={manual.registrationDate} onChange={setManualField('registrationDate')} />
                  </fieldset>
                </CardContent>
              </Card>
              <Card className="border border-primary/15 shadow-sm">
                <CardContent>
                  <Valuation valuation={valuation} onChange={updateValuation} declaredValue={declaredValue} valueRef={valueRef} acknowledgementRef={acknowledgementRef} />
                </CardContent>
              </Card>
              <ErrorText text={error} />
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                <Button asChild variant="ghost" className="min-h-11"><Link to="/insurance-type"><ArrowLeft aria-hidden="true" />Back</Link></Button>
                <Button type="submit" size="lg" className="min-h-11">Save & continue</Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      )}
    </JourneyLayout>
  );
}

function FormInput({ label, id, className = '', ...props }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className={`min-h-11 ${className}`} {...props} />
    </div>
  );
}

function Valuation({ valuation, onChange, declaredValue, valueRef, acknowledgementRef }) {
  return (
    <fieldset className="min-w-0 space-y-5">
      <legend className="mb-4 text-base font-semibold">Vehicle value</legend>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="vehicle-value" className="text-primary">Current market value (ZMW) *</Label>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                <Info aria-hidden="true" className="size-3.5" />
                Why important?
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] border border-primary/20 p-4">
              <p className="font-semibold text-primary">Why accurate valuation matters</p>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
                <p><strong className="text-primary">Under-valuing:</strong> a lower value may reduce your premium, but a payout is capped at the declared value. You carry the difference.</p>
                <p><strong className="text-primary">Over-valuing:</strong> declaring more than the market value does not increase a payout and may be treated as fraud.</p>
                <p>Use recent market listings or a professional valuation.</p>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <Input id="vehicle-value" ref={valueRef} className="min-h-11" inputMode="decimal" required placeholder="e.g. 200000" value={valuation.value} onChange={(event) => onChange({ ...valuation, value: event.target.value.replace(/[^0-9.]/g, '') })} aria-describedby="valuation-help" />
        <p id="valuation-help" className="text-sm text-muted-foreground">{declaredValue > 0 ? <>Declared: <strong className="text-foreground">{formatZMW(declaredValue)}</strong></> : 'This sets your premium and the most a claim can pay out.'}</p>
      </div>
      <div className="flex items-start gap-3">
        <Checkbox id="valuation-acknowledgement" ref={acknowledgementRef} checked={valuation.acknowledged} onCheckedChange={(checked) => onChange({ ...valuation, acknowledged: checked === true })} className="mt-1 size-5 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
        <Label htmlFor="valuation-acknowledgement" className="cursor-pointer text-sm font-normal leading-relaxed">I confirm this is the true current market value of the vehicle, and I understand that under- or over-valuing it affects any claim payout.</Label>
      </div>
    </fieldset>
  );
}

function Detail({ label, value, span = false }) {
  return (
    <div className={span ? 'col-span-2 border-t border-border pt-3' : 'min-w-0'}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

function ErrorText({ text }) {
  return text ? <Alert variant="destructive"><TriangleAlert aria-hidden="true" /><AlertDescription>{text}</AlertDescription></Alert> : null;
}
