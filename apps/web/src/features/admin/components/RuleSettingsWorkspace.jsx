import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, FilePlus2, Gavel, RefreshCw, Settings2, SlidersHorizontal, Tags, TriangleAlert } from 'lucide-react';
import { api as defaultApi } from '@/api';
import { Alert, AlertTitle } from '@/components/ui/primitives/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Field, FieldDescription, FieldLabel, FieldSet } from '@/components/ui/primitives/field';
import { Input } from '@/components/ui/primitives/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/primitives/native-select';
import { Spinner } from '@/components/ui/primitives/spinner';
import { Textarea } from '@/components/ui/primitives/textarea';

const RULES = [
  { key: 'QUOTE_REPLY_DEADLINE', label: 'Quote reply deadline', description: 'How long an insurer has to reply to a request.', template: { days: 7 } },
  { key: 'NCD_POLICY', label: 'No Claim Discount policy', description: 'NCD eligibility, validity and tiers applied across channels.', template: { validityDays: 365, tiers: [{ yearsClaimFree: 1, percentage: 10 }] } },
  { key: 'DRIVER_QUESTIONS', label: 'Driver questions', description: 'Questions requested before an insurer can assess risk.', template: { questions: [{ code: 'DRIVER_AGE', label: 'Driver age', helpText: 'Age of the main driver.', required: true }] } },
  { key: 'RISK_QUESTIONS', label: 'Risk questions', description: 'Additional risk questions shared by eligible products.', template: { questions: [{ code: 'OVERNIGHT_PARKING', label: 'Where is the vehicle parked overnight?', required: false }] } },
  { key: 'ADD_ON_CATALOGUE', label: 'Add-on catalogue', description: 'Reusable optional benefits that products may offer.', template: { addOns: [{ code: 'ROADSIDE', label: 'Roadside assistance', description: 'Emergency assistance after a breakdown.' }] } },
  { key: 'USAGE_LOADINGS', label: 'Vehicle use loadings', description: 'Rate adjustments for each declared vehicle use.', template: { loadings: { INDIVIDUAL: 10000, DEFAULT: 10000 } } },
  { key: 'DOCUMENT_RETENTION', label: 'Document retention', description: 'Retention periods for each evidence class.', template: { daysByClass: { UNDERWRITING_EVIDENCE: 2555, POLICY_EVIDENCE: 2555, CLAIM_EVIDENCE: 2555, BRAND_ASSET: 365, COMPLIANCE_EVIDENCE: 2555 } } },
];
const CATEGORIES = ['COVERAGE', 'EXCLUSION', 'LIMIT', 'EXCESS', 'ADD_ON'];
const DATA_TYPES = ['TEXT', 'NUMBER', 'BOOLEAN', 'CURRENCY', 'LIST'];
const DISPLAY_RULES = ['ALWAYS_SHOW', 'SHOW_WHEN_PROVIDED'];
const today = () => new Date().toISOString().slice(0, 10);

const emptyTaxonomy = () => ({ code: '', label: '', description: '', category: 'COVERAGE', dataType: 'TEXT', unit: '', allowedValues: '', displayRule: 'SHOW_WHEN_PROVIDED', displayOrder: '0' });

/**
 * The settings workspace makes administrative changes intentionally explicit:
 * a rule is proposed first, then confirmed as an immutable new version. PIA is
 * deliberately excluded because its existing independent approval workflow is
 * the stronger financial-control path.
 */
export default function RuleSettingsWorkspace({ api = defaultApi, onBack, onOpenPia }) {
  const [rules, setRules] = useState([]);
  const [taxonomy, setTaxonomy] = useState([]);
  const [selectedKey, setSelectedKey] = useState(RULES[0].key);
  const [valueText, setValueText] = useState(() => JSON.stringify(RULES[0].template, null, 2));
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [effectiveUntil, setEffectiveUntil] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [taxonomyForm, setTaxonomyForm] = useState(emptyTaxonomy);
  const [editingTerm, setEditingTerm] = useState(null);

  const selectedRule = useMemo(() => RULES.find((rule) => rule.key === selectedKey) || RULES[0], [selectedKey]);
  const ruleHistory = useMemo(() => rules.filter((rule) => rule.key === selectedKey).sort((first, second) => second.versionNumber - first.versionNumber), [rules, selectedKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ruleVersions, terms] = await Promise.all([api.settings.rules.list(), api.settings.taxonomy.list()]);
      setRules(Array.isArray(ruleVersions) ? ruleVersions : []);
      setTaxonomy(Array.isArray(terms) ? terms : []);
    } catch (caught) {
      setRules([]);
      setTaxonomy([]);
      setError(caught instanceof Error ? caught.message : 'Rule settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectRule = (key) => {
    const rule = RULES.find((item) => item.key === key) || RULES[0];
    setSelectedKey(rule.key);
    setValueText(JSON.stringify(rule.template, null, 2));
    setEffectiveFrom(today());
    setEffectiveUntil('');
    setNote('');
    setError('');
    setNotice('');
  };

  const proposeRule = async (event) => {
    event.preventDefault();
    let value;
    try {
      value = JSON.parse(valueText);
    } catch {
      setError('Rule value must be valid JSON. Use the example shape shown for this setting.');
      return;
    }
    setBusy('propose-rule');
    setError('');
    setNotice('');
    try {
      await api.settings.rules.create(selectedKey, { value, effectiveFrom, effectiveUntil: effectiveUntil || undefined, note: note || undefined });
      setNotice(`${selectedRule.label} was saved as a provisional version. Confirm it when it has been reviewed.`);
      setNote('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The rule version could not be saved.');
    } finally {
      setBusy('');
    }
  };

  const confirmRule = async (rule) => {
    setBusy(`confirm:${rule.id}`);
    setError('');
    setNotice('');
    try {
      await api.settings.rules.confirm(rule.key, rule.id);
      setNotice(`Version ${rule.versionNumber} was confirmed as a new active rule version.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The rule could not be confirmed.');
    } finally {
      setBusy('');
    }
  };

  const saveTaxonomy = async (event) => {
    event.preventDefault();
    const input = {
      label: taxonomyForm.label,
      description: taxonomyForm.description || undefined,
      category: taxonomyForm.category,
      dataType: taxonomyForm.dataType,
      unit: taxonomyForm.unit || null,
      allowedValues: taxonomyForm.allowedValues.split(',').map((value) => value.trim()).filter(Boolean),
      displayRule: taxonomyForm.displayRule,
      displayOrder: Number(taxonomyForm.displayOrder),
    };
    // A taxonomy code identifies its historical series. It is immutable once
    // created, so an edit must not accidentally send it as a mutable field.
    if (!editingTerm) input.code = taxonomyForm.code;
    setBusy('save-taxonomy');
    setError('');
    setNotice('');
    try {
      if (editingTerm) await api.settings.taxonomy.update(editingTerm.id, input);
      else await api.settings.taxonomy.create(input);
      setNotice(editingTerm ? 'Comparison term updated as a new taxonomy version.' : 'Comparison term created. Insurers can now map it on a draft product.');
      setEditingTerm(null);
      setTaxonomyForm(emptyTaxonomy());
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The comparison term could not be saved.');
    } finally {
      setBusy('');
    }
  };

  const editTaxonomy = (term) => {
    setEditingTerm(term);
    setTaxonomyForm({ code: term.code, label: term.label, description: term.description || '', category: term.category, dataType: term.dataType, unit: term.unit || '', allowedValues: (term.allowedValues || []).join(', '), displayRule: term.displayRule, displayOrder: String(term.displayOrder) });
    setError('');
    setNotice('');
  };

  const toggleTaxonomy = async (term) => {
    setBusy(`taxonomy:${term.id}`);
    setError('');
    setNotice('');
    try {
      const status = term.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
      await api.settings.taxonomy.update(term.id, { status });
      setNotice(`${term.label} is now ${status === 'ACTIVE' ? 'available for new product mappings' : 'disabled for future product mappings'}. Historical product versions keep their reviewed snapshot.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The comparison term could not be updated.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3"><Button type="button" variant="outline" size="icon" onClick={onBack} aria-label="Back to admin overview"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span></Button><div><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Rules and comparison terms</h2><p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">Set platform-wide underwriting inputs and the common vocabulary customers use to compare approved products. Every non-PIA change is proposed first, then confirmed as an immutable version.</p></div></div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading || Boolean(busy)}>{loading ? <Spinner aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Refresh</Button>
      </div>

      {error && <Alert variant="destructive"><TriangleAlert aria-hidden="true" /><AlertTitle>{error}</AlertTitle></Alert>}
      {notice && <p role="status" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-relaxed text-primary">{notice}</p>}

      <section className="grid gap-6 xl:grid-cols-[minmax(15rem,.68fr)_minmax(0,1.5fr)]">
        <Card className="gap-0 border-border shadow-none"><CardHeader className="border-b"><CardTitle className="flex items-center gap-2 text-lg"><SlidersHorizontal className="size-5 text-primary" aria-hidden="true" />Platform rules</CardTitle><p className="mt-1 text-sm text-muted-foreground">Choose a setting to propose a new version.</p></CardHeader><CardContent className="p-2">{RULES.map((rule) => <button key={rule.key} type="button" onClick={() => selectRule(rule.key)} className={`w-full rounded-xl px-3 py-3 text-left transition-colors ${selectedKey === rule.key ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}><span className="block text-sm font-medium">{rule.label}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{rule.description}</span></button>)}<div className="mx-2 mt-2 border-t border-border pt-2"><button type="button" onClick={onOpenPia} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-muted"><span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Gavel className="size-4" aria-hidden="true" /></span><span><span className="block text-sm font-medium">PIA minimum rate</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Uses its separate two-person approval control.</span></span></button></div></CardContent></Card>

        <Card className="border-border shadow-none"><CardHeader className="border-b"><CardTitle className="text-lg">{selectedRule.label}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{selectedRule.description}</p></CardHeader><CardContent className="pt-6"><form onSubmit={proposeRule} className="space-y-5" noValidate><FieldSet><Field><FieldLabel htmlFor="rule-value">Rule value</FieldLabel><Textarea id="rule-value" value={valueText} onChange={(event) => setValueText(event.target.value)} className="min-h-52 font-mono text-xs" spellCheck="false" /><FieldDescription>Use the typed example for this setting. The API validates the final structure before it is stored.</FieldDescription></Field><div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="rule-effective-from">Effective from</FieldLabel><Input id="rule-effective-from" type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></Field><Field><FieldLabel htmlFor="rule-effective-until">Effective until <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel><Input id="rule-effective-until" type="date" value={effectiveUntil} min={effectiveFrom} onChange={(event) => setEffectiveUntil(event.target.value)} /></Field></div><Field><FieldLabel htmlFor="rule-note">Reason for this version <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel><Input id="rule-note" value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="Why this operational rule is changing" /></Field></FieldSet><Button type="submit" disabled={busy === 'propose-rule'}>{busy === 'propose-rule' ? <Spinner aria-hidden="true" /> : <FilePlus2 aria-hidden="true" />}Save provisional version</Button></form><div className="mt-8 border-t border-border pt-6"><h3 className="text-sm font-semibold">Version history</h3>{loading ? <p className="mt-3 text-sm text-muted-foreground">Loading rule history…</p> : ruleHistory.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No saved version yet. The example above is a provisional starting shape until you save and confirm it.</p> : <div className="mt-3 overflow-hidden rounded-xl border border-border">{ruleHistory.map((rule, index) => <div key={rule.id} className={`p-4 ${index ? 'border-t border-border' : ''}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">Version {rule.versionNumber} · effective {rule.effectiveFrom}</p><p className="mt-1 text-xs text-muted-foreground">Created {new Date(rule.createdAt).toLocaleString('en-ZM')}</p></div><div className="flex items-center gap-2"><Badge variant="outline" className={rule.state === 'CONFIRMED' ? 'border-foreground/15 bg-muted text-foreground' : 'border-primary/20 bg-primary/10 text-primary'}>{rule.state === 'CONFIRMED' ? 'Confirmed' : 'Provisional'}</Badge>{rule.state === 'PROVISIONAL' && <Button type="button" size="sm" variant="outline" disabled={busy === `confirm:${rule.id}`} onClick={() => void confirmRule(rule)}>{busy === `confirm:${rule.id}` ? <Spinner aria-hidden="true" /> : <Check aria-hidden="true" />}Confirm</Button>}</div></div><details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-primary">View saved value</summary><pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">{JSON.stringify(rule.value, null, 2)}</pre></details></div>)}</div>}</div></CardContent></Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(18rem,.8fr)_minmax(0,1.4fr)]">
        <Card className="border-border shadow-none"><CardHeader className="border-b"><CardTitle className="flex items-center gap-2 text-lg"><Tags className="size-5 text-primary" aria-hidden="true" />{editingTerm ? `Edit ${editingTerm.label}` : 'Add comparison term'}</CardTitle><p className="mt-1 text-sm text-muted-foreground">Define the fields every insurer uses to describe comparable product terms.</p></CardHeader><CardContent className="pt-6"><form onSubmit={saveTaxonomy} className="space-y-4" noValidate><Field><FieldLabel htmlFor="taxonomy-code">Code</FieldLabel><Input id="taxonomy-code" value={taxonomyForm.code} disabled={Boolean(editingTerm)} onChange={(event) => setTaxonomyForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="MEDICAL_LIMIT" /></Field><Field><FieldLabel htmlFor="taxonomy-label">Customer label</FieldLabel><Input id="taxonomy-label" value={taxonomyForm.label} onChange={(event) => setTaxonomyForm((current) => ({ ...current, label: event.target.value }))} placeholder="Medical expenses limit" /></Field><Field><FieldLabel htmlFor="taxonomy-description">Description <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel><Textarea id="taxonomy-description" value={taxonomyForm.description} onChange={(event) => setTaxonomyForm((current) => ({ ...current, description: event.target.value }))} /></Field><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1"><Field><FieldLabel htmlFor="taxonomy-category">Category</FieldLabel><NativeSelect id="taxonomy-category" value={taxonomyForm.category} onChange={(event) => setTaxonomyForm((current) => ({ ...current, category: event.target.value }))}>{CATEGORIES.map((value) => <NativeSelectOption key={value} value={value}>{formatEnum(value)}</NativeSelectOption>)}</NativeSelect></Field><Field><FieldLabel htmlFor="taxonomy-data-type">Value type</FieldLabel><NativeSelect id="taxonomy-data-type" value={taxonomyForm.dataType} onChange={(event) => setTaxonomyForm((current) => ({ ...current, dataType: event.target.value, allowedValues: event.target.value === 'LIST' ? current.allowedValues : '' }))}>{DATA_TYPES.map((value) => <NativeSelectOption key={value} value={value}>{formatEnum(value)}</NativeSelectOption>)}</NativeSelect></Field></div><Field><FieldLabel htmlFor="taxonomy-unit">Unit <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel><Input id="taxonomy-unit" value={taxonomyForm.unit} disabled={taxonomyForm.dataType === 'BOOLEAN'} onChange={(event) => setTaxonomyForm((current) => ({ ...current, unit: event.target.value }))} placeholder="ZMW, days, kilometres" /></Field>{taxonomyForm.dataType === 'LIST' && <Field><FieldLabel htmlFor="taxonomy-values">Allowed values</FieldLabel><Input id="taxonomy-values" value={taxonomyForm.allowedValues} onChange={(event) => setTaxonomyForm((current) => ({ ...current, allowedValues: event.target.value }))} placeholder="Standard, Enhanced, Premium" /><FieldDescription>Separate each allowed option with a comma.</FieldDescription></Field>}<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1"><Field><FieldLabel htmlFor="taxonomy-display-rule">Display rule</FieldLabel><NativeSelect id="taxonomy-display-rule" value={taxonomyForm.displayRule} onChange={(event) => setTaxonomyForm((current) => ({ ...current, displayRule: event.target.value }))}>{DISPLAY_RULES.map((value) => <NativeSelectOption key={value} value={value}>{value === 'ALWAYS_SHOW' ? 'Always show' : 'Show when provided'}</NativeSelectOption>)}</NativeSelect></Field><Field><FieldLabel htmlFor="taxonomy-order">Display order</FieldLabel><Input id="taxonomy-order" type="number" min="0" max="10000" value={taxonomyForm.displayOrder} onChange={(event) => setTaxonomyForm((current) => ({ ...current, displayOrder: event.target.value }))} /></Field></div><div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy === 'save-taxonomy'}>{busy === 'save-taxonomy' ? <Spinner aria-hidden="true" /> : <FilePlus2 aria-hidden="true" />}{editingTerm ? 'Update term' : 'Add term'}</Button>{editingTerm && <Button type="button" variant="ghost" onClick={() => { setEditingTerm(null); setTaxonomyForm(emptyTaxonomy()); }}>Cancel</Button>}</div></form></CardContent></Card>

        <Card className="border-border shadow-none"><CardHeader className="border-b"><CardTitle className="flex items-center gap-2 text-lg"><Settings2 className="size-5 text-primary" aria-hidden="true" />Comparison taxonomy</CardTitle><p className="mt-1 text-sm text-muted-foreground">Changes create a new taxonomy version. Existing product versions keep the snapshot they were approved with.</p></CardHeader><CardContent className="pt-6">{loading ? <p className="text-sm text-muted-foreground">Loading comparison terms…</p> : taxonomy.length === 0 ? <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No comparison terms have been defined yet.</p> : <div className="overflow-hidden rounded-xl border border-border">{taxonomy.map((term, index) => <div key={term.id} className={`flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between ${index ? 'border-t border-border' : ''}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{term.label}</p><Badge variant="outline" className={term.status === 'ACTIVE' ? 'border-foreground/15 bg-muted text-foreground' : 'border-primary/20 bg-primary/10 text-primary'}>{term.status === 'ACTIVE' ? 'Active' : 'Disabled'}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{term.code} · {formatEnum(term.category)} · {formatEnum(term.dataType)} · v{term.versionNumber}{term.unit ? ` · ${term.unit}` : ''}</p>{term.description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{term.description}</p>}</div><div className="flex shrink-0 flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => editTaxonomy(term)}>Edit</Button><Button type="button" size="sm" variant="outline" disabled={busy === `taxonomy:${term.id}`} onClick={() => void toggleTaxonomy(term)}>{busy === `taxonomy:${term.id}` ? <Spinner aria-hidden="true" /> : term.status === 'ACTIVE' ? 'Disable' : 'Enable'}</Button></div></div>)}</div>}</CardContent></Card>
      </section>
    </div>
  );
}

function formatEnum(value) { return String(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
