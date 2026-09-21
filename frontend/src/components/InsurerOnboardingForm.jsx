import { useState } from 'react';
import { imageToDataUrl } from '../utils/files';
import { DEFAULT_QUOTE_VALIDITY_DAYS } from '../utils/quoteValidity';

const INSPECTION_OPTIONS = [
  ['NOT REQUIRED', 'Not required'],
  ['OPTIONAL', 'May be requested'],
  ['REQUIRED', 'Required before policy issue'],
];

const EMPTY = {
  name: '', tradingName: '', registrationNumber: '', tpin: '', licenceNumber: '', licenceExpiry: '', address: '', website: '',
  contactPerson: '', contactRole: '', phone: '', mobile: '', email: '', hours: 'Mon–Fri 08:00–17:00',
  coverage: '', ratePercentage: '', quoteValidityDays: String(DEFAULT_QUOTE_VALIDITY_DAYS), inspectionRules: 'NOT REQUIRED', ncdAccepted: true,
  logoUrl: '',
};

const field = 'w-full rounded-xl border border-outline-variant bg-surface-container-low p-3 text-[15px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';
const label = 'mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-secondary';

/**
 * Super-admin onboarding of an insurance company: legal identity, PIA
 * licence, claims-desk contact, first product/rate, and an uploaded logo.
 * Submits the shape the insurer catalogue and contact directory expect.
 */
export default function InsurerOnboardingForm({ piaRatePercentage, onSubmit, onCancel }) {
  const [form, setForm] = useState(EMPTY);
  const [logoError, setLogoError] = useState('');
  const [error, setError] = useState('');

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  const handleLogo = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLogoError('');
    try {
      const logoUrl = await imageToDataUrl(file);
      setForm((current) => ({ ...current, logoUrl }));
    } catch (caught) {
      setLogoError(caught.message);
    } finally {
      event.target.value = '';
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!form.name.trim() || !form.licenceNumber.trim() || !form.phone.trim() || !form.email.trim() || !form.ratePercentage) {
      setError('Company name, PIA licence number, claims-desk phone and email, and the premium rate are required.');
      return;
    }
    onSubmit({
      name: form.name.trim(),
      tradingName: form.tradingName.trim() || form.name.trim(),
      registrationNumber: form.registrationNumber.trim(),
      tpin: form.tpin.trim(),
      licenceNumber: form.licenceNumber.trim(),
      licenceExpiry: form.licenceExpiry,
      website: form.website.trim(),
      logoUrl: form.logoUrl,
      coverage: form.coverage.trim() || 'Comprehensive',
      ratePercentage: parseFloat(form.ratePercentage),
      quoteValidityDays: Math.max(1, parseInt(form.quoteValidityDays, 10) || DEFAULT_QUOTE_VALIDITY_DAYS),
      inspectionRules: form.inspectionRules,
      ncdAccepted: form.ncdAccepted,
      timing: 'AFTER PAYMENT', method: 'SELF-CAPTURE', icon: 'business', isBestValue: false,
      benefits: ['Third Party Property Damage'],
      status: 'Active',
      onboardedAt: new Date().toISOString(),
      contact: {
        tagline: '',
        contactPerson: form.contactPerson.trim(), role: form.contactRole.trim(),
        phone: form.phone.trim(), mobile: form.mobile.trim() || form.phone.trim(),
        whatsapp: (form.mobile || form.phone).replace(/[^\d]/g, ''),
        email: form.email.trim(), address: form.address.trim(), hours: form.hours.trim(),
      },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <Section title="Company" hint="Legal identity as it appears on the PIA register.">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block md:col-span-2"><span className={label}>Registered company name *</span><input required value={form.name} onChange={set('name')} className={field} placeholder="e.g. Prestige Assurance Limited" /></label>
          <label className="block"><span className={label}>Trading name</span><input value={form.tradingName} onChange={set('tradingName')} className={field} placeholder="Name shown to customers" /></label>
          <label className="block"><span className={label}>PACRA registration no.</span><input value={form.registrationNumber} onChange={set('registrationNumber')} className={field} placeholder="e.g. 120210012345" /></label>
          <label className="block"><span className={label}>TPIN</span><input value={form.tpin} onChange={set('tpin')} className={field} placeholder="10-digit ZRA TPIN" /></label>
          <label className="block"><span className={label}>Website</span><input type="url" value={form.website} onChange={set('website')} className={field} placeholder="https://" /></label>
          <label className="block md:col-span-2"><span className={label}>Head office address</span><input value={form.address} onChange={set('address')} className={field} placeholder="Building, street, city" /></label>
        </div>
      </Section>

      <Section title="Licence" hint="Insurers cannot receive quote requests once the licence has lapsed.">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block"><span className={label}>PIA licence number *</span><input required value={form.licenceNumber} onChange={set('licenceNumber')} className={field} placeholder="e.g. PIA/GI/2026/017" /></label>
          <label className="block"><span className={label}>Licence expiry</span><input type="date" value={form.licenceExpiry} onChange={set('licenceExpiry')} className={field} /></label>
        </div>
      </Section>

      <Section title="Claims desk and customer contact" hint="Shown to customers in the insurer directory and after a claim notification.">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block"><span className={label}>Contact person</span><input value={form.contactPerson} onChange={set('contactPerson')} className={field} placeholder="e.g. Mrs. Chanda Mwale" /></label>
          <label className="block"><span className={label}>Role</span><input value={form.contactRole} onChange={set('contactRole')} className={field} placeholder="e.g. Motor Claims Manager" /></label>
          <label className="block"><span className={label}>Office phone *</span><input required type="tel" value={form.phone} onChange={set('phone')} className={field} placeholder="+260 211 …" /></label>
          <label className="block"><span className={label}>Mobile / WhatsApp</span><input type="tel" value={form.mobile} onChange={set('mobile')} className={field} placeholder="+260 97 …" /></label>
          <label className="block"><span className={label}>Claims email *</span><input required type="email" value={form.email} onChange={set('email')} className={field} placeholder="claims@insurer.zm" /></label>
          <label className="block"><span className={label}>Operating hours</span><input value={form.hours} onChange={set('hours')} className={field} /></label>
        </div>
      </Section>

      <Section title="Product and quoting" hint="The first motor product; more can be added from the insurer profile.">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block md:col-span-2"><span className={label}>Coverage plan name</span><input value={form.coverage} onChange={set('coverage')} className={field} placeholder="e.g. Comprehensive Gold Plan" /></label>
          <label className="block">
            <span className={label}>Premium rate (% of vehicle value) *</span>
            <input required type="number" step="0.1" min="0.1" max="20" value={form.ratePercentage} onChange={set('ratePercentage')} className={field} placeholder="e.g. 4.0" />
            <span className="mt-1 block text-[11px] text-secondary">Used for the indicative estimate; the PIA floor of {piaRatePercentage}% applies automatically.</span>
          </label>
          <label className="block">
            <span className={label}>Default quote validity (days)</span>
            <input type="number" min="1" max="30" value={form.quoteValidityDays} onChange={set('quoteValidityDays')} className={field} />
            <span className="mt-1 block text-[11px] text-secondary">How long the insurer's final quote stays open unless it sets a different period per quote.</span>
          </label>
          <label className="block"><span className={label}>Vehicle inspection</span><select value={form.inspectionRules} onChange={set('inspectionRules')} className={field}>{INSPECTION_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
          <label className="flex items-center gap-3 self-end rounded-xl border border-outline-variant bg-surface-container-low p-3"><input type="checkbox" checked={form.ncdAccepted} onChange={set('ncdAccepted')} className="h-5 w-5 accent-red-600" /><span className="text-[14px] font-semibold">Accepts No Claim Discount codes</span></label>
        </div>
      </Section>

      <Section title="Logo" hint="Shown in the partner strip on the home page and on the insurer's quotes.">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-24 w-40 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-3">
            {form.logoUrl ? <img src={form.logoUrl} alt="Company logo preview" className="max-h-16 max-w-[130px] object-contain" /> : <span className="text-[12px] text-secondary">No logo yet</span>}
          </div>
          <div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 border-primary px-4 py-2.5 text-[14px] font-bold text-primary hover:bg-primary/5">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">upload</span>{form.logoUrl ? 'Replace logo' : 'Upload logo'}
              <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="sr-only" onChange={handleLogo} />
            </label>
            <p className="mt-2 text-[11px] text-secondary">PNG, JPG or SVG. Resized automatically; transparent PNG works best.</p>
            {logoError && <p role="alert" className="mt-1 text-[12px] font-medium text-red-700">{logoError}</p>}
          </div>
        </div>
      </Section>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">{error}</p>}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="submit" className="flex-1 rounded-xl bg-primary py-4 font-bold text-white shadow-sm hover:bg-primary-container">Onboard insurance company</button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-outline-variant px-6 py-4 font-semibold text-secondary hover:bg-gray-50">Cancel</button>
      </div>
    </form>
  );
}

function Section({ title, hint, children }) {
  return (
    <section>
      <h3 className="text-[16px] font-extrabold text-on-surface">{title}</h3>
      {hint && <p className="mb-4 mt-0.5 text-[12px] text-secondary">{hint}</p>}
      {children}
    </section>
  );
}
