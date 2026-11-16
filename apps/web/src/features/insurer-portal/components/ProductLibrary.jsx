import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, FilePenLine, Plus, RotateCcw, Send, TriangleAlert } from 'lucide-react';
import { api } from '@/api';
import { Alert, AlertTitle } from '@/components/ui/primitives/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Field, FieldDescription, FieldLabel, FieldSet } from '@/components/ui/primitives/field';
import { Input } from '@/components/ui/primitives/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/primitives/native-select';
import { Spinner } from '@/components/ui/primitives/spinner';
import CoverGuideDocument from '@/components/cover-guide/CoverGuideDocument';
import CoverGuideLibrary from './CoverGuideLibrary';
import { EmptyPanel, PageHeader } from './ui';

const COVER_TYPES = ['COMPREHENSIVE', 'THIRD_PARTY'];
const COVER_TYPE_LABELS = { COMPREHENSIVE: 'Comprehensive', THIRD_PARTY: 'Third party only' };
const INSPECTION_RULES = [
  ['NOT_REQUIRED', 'No inspection required'],
  ['OPTIONAL', 'Inspection is optional'],
  ['REQUIRED', 'Inspection is required'],
];
const INSPECTION_TIMINGS = [
  ['BEFORE_QUOTATION', 'Before a quotation'],
  ['BEFORE_PAYMENT', 'Before payment'],
  ['AFTER_PAYMENT', 'After payment'],
];
const INSPECTION_METHODS = [
  ['SELF_CAPTURE', 'Customer self-capture'],
  ['PHYSICAL', 'Physical inspection'],
];
const DURATION_OPTIONS = [
  ['Q1', '3 months'],
  ['Q2', '6 months'],
  ['Q3', '9 months'],
  ['Q4', '12 months'],
];
const STATUS_COPY = {
  DRAFT: ['Draft', 'Finish the details, then send this version for platform review.'],
  SUBMITTED: ['Submitted for review', 'The terms are locked while an administrator reviews them.'],
  APPROVED: ['Approved', 'Customers will be able to see this version when product selection is introduced.'],
  REJECTED: ['Changes requested', 'Start a revised draft and address the review comment.'],
  WITHDRAWN: ['Withdrawn', 'This version is kept in history and is no longer available.'],
};
const statusClass = {
  DRAFT: 'border-primary/20 bg-primary/10 text-primary',
  SUBMITTED: 'border-foreground/15 bg-muted text-foreground',
  APPROVED: 'border-foreground/15 bg-muted text-foreground',
  REJECTED: 'border-primary/20 bg-primary/10 text-primary',
  WITHDRAWN: 'border-border bg-background text-muted-foreground',
};
const day = () => new Date().toISOString().slice(0, 10);
const byVersion = (first, second) => second.versionNumber - first.versionNumber;

function firstVersion(products) {
  const product = products[0];
  const version = [...(product?.versions || [])].sort(byVersion)[0];
  return version ? { productId: product.id, versionId: version.id } : null;
}

function asEditorInsurer(insurer, version) {
  return { ...insurer, coverGuides: { [coverGuideType(version.coverType)]: version.coverGuide || {} } };
}

// The legacy guide editor carries its display cover type in the local form
// model. A product version stores that separately, so never leak the legacy
// field into the stricter API-owned cover-guide contract.
function productGuidePayload(guide = {}) {
  const terms = { ...guide };
  delete terms.coverType;
  return terms;
}

/**
 * Insurer-owned terms stay versioned. This library deliberately does not
 * update the old `coverGuides` cache, because changing a live customer quote
 * path before Batch 12 would make a later version change retroactive.
 */
export default function ProductLibrary({ insurer, canManage }) {
  const [products, setProducts] = useState([]);
  const [taxonomy, setTaxonomy] = useState([]);
  const [selection, setSelection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [action, setAction] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async (preferred = null) => {
    setLoading(true);
    setError('');
    try {
      const [records, terms] = await Promise.all([api.products.insurer.list(), api.products.insurer.comparisonTaxonomy()]);
      const next = Array.isArray(records) ? records : [];
      setProducts(next);
      setTaxonomy(Array.isArray(terms) ? terms : []);
      setSelection((current) => {
        const wanted = preferred || current;
        const currentStillExists = wanted && next.some((product) => product.id === wanted.productId && product.versions?.some((version) => version.id === wanted.versionId));
        return currentStillExists ? wanted : firstVersion(next);
      });
    } catch (caught) {
      setProducts([]);
      setTaxonomy([]);
      setSelection(null);
      setError(caught instanceof Error ? caught.message : 'Product terms could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const deferredLoad = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(deferredLoad);
  }, [refresh]);

  const selected = useMemo(() => {
    const product = products.find((item) => item.id === selection?.productId);
    const version = product?.versions?.find((item) => item.id === selection?.versionId);
    return product && version ? { product, version } : null;
  }, [products, selection]);

  const perform = async (label, work, preferred) => {
    setAction(label);
    setError('');
    try {
      const result = await work();
      await refresh(preferred || (result?.product && result?.id ? { productId: result.product.id, versionId: result.id } : null));
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That product action could not be completed.');
      return null;
    } finally {
      setAction('');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product terms"
        description="Create a product version, complete the standard cover guide, then submit it for review. Approved versions are retained as history so a later change cannot alter an earlier policy."
      >
        {canManage && <Button type="button" onClick={() => setShowCreate((open) => !open)}><Plus aria-hidden="true" />New product</Button>}
      </PageHeader>

      {error && <Alert variant="destructive"><TriangleAlert aria-hidden="true" /><AlertTitle>{error}</AlertTitle></Alert>}

      {showCreate && canManage && (
        <NewProductForm
          busy={action === 'create'}
          onCancel={() => setShowCreate(false)}
          onCreate={async (input) => {
            const result = await perform('create', () => api.products.insurer.create(input));
            if (result) setShowCreate(false);
          }}
        />
      )}

      {loading ? (
        <Card><CardContent className="flex min-h-40 items-center justify-center gap-3 text-sm text-muted-foreground"><Spinner aria-hidden="true" />Loading product versions…</CardContent></Card>
      ) : products.length === 0 ? (
        <EmptyPanel icon={BookOpenCheck} title="No product terms yet" description="Create a draft for each motor cover your company offers. Nothing is visible to customers until a platform administrator approves it.">
          {canManage && <Button type="button" onClick={() => setShowCreate(true)}><Plus aria-hidden="true" />Create the first product</Button>}
        </EmptyPanel>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(16rem,.72fr)_minmax(0,1.6fr)] xl:items-start">
          <ProductList products={products} selection={selection} onSelect={setSelection} />
          {selected && (
            <ProductWorkspace
              key={`${selected.product.id}-${selected.version.id}`}
              insurer={insurer}
              product={selected.product}
              version={selected.version}
              canManage={canManage}
              busy={action}
              onSaveDetails={(changes) => perform('save-details', () => api.products.insurer.updateDraft(selected.product.id, selected.version.id, changes), selection)}
              onSaveGuide={async (guide) => {
                const result = await perform(
                  'save-guide',
                  () => api.products.insurer.updateDraft(selected.product.id, selected.version.id, { coverGuide: productGuidePayload(guide) }),
                  selection,
                );
                // CoverGuideLibrary uses a successful promise as its signal to
                // show confirmation. Preserve its error state on failure.
                if (!result) throw new Error('The cover guide could not be saved.');
                return result;
              }}
              taxonomy={taxonomy}
              onSaveComparison={(comparisonItems) => perform(
                'save-comparison',
                () => api.products.insurer.updateDraft(selected.product.id, selected.version.id, { comparisonItems }),
                selection,
              )}
              onSubmit={() => perform('submit', () => api.products.insurer.submit(selected.product.id, selected.version.id), selection)}
              onRevise={() => perform('revise', () => api.products.insurer.revise(selected.product.id, selected.version.id))}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ProductList({ products, selection, onSelect }) {
  return (
    <aside aria-label="Your product versions" className="space-y-3 xl:sticky xl:top-24">
      <h2 className="px-1 text-sm font-medium text-muted-foreground">Your products</h2>
      {products.map((product) => {
        const latest = [...product.versions].sort(byVersion)[0];
        return (
          <Card key={product.id} size="sm" className="gap-0 border-border shadow-none">
            <CardContent className="p-2">
              <p className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{product.code}</p>
              {[...product.versions].sort(byVersion).map((version) => {
                const active = selection?.versionId === version.id;
                return (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => onSelect({ productId: product.id, versionId: version.id })}
                    className={`flex w-full items-start justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${active ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                  >
                    <span className="min-w-0"><span className="block truncate text-sm font-medium">{version.name}</span><span className="mt-1 block text-xs text-muted-foreground">Version {version.versionNumber} · {COVER_TYPE_LABELS[version.coverType]}</span></span>
                    <Badge variant="outline" className={`shrink-0 ${statusClass[version.status]}`}>{version.status === 'APPROVED' ? 'Approved' : version.status === 'SUBMITTED' ? 'In review' : version.status === 'REJECTED' ? 'Changes needed' : version.status === 'WITHDRAWN' ? 'Withdrawn' : 'Draft'}</Badge>
                  </button>
                );
              })}
              {latest && <p className="px-2 pb-1 pt-2 text-xs text-muted-foreground">Latest version: {latest.versionNumber}</p>}
            </CardContent>
          </Card>
        );
      })}
    </aside>
  );
}

function ProductWorkspace({ insurer, product, version, taxonomy, canManage, busy, onSaveDetails, onSaveGuide, onSaveComparison, onSubmit, onRevise }) {
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(() => versionToForm(version));
  const status = STATUS_COPY[version.status] || [version.status, ''];
  const draft = version.status === 'DRAFT';
  const pending = Boolean(busy);

  const saveDetails = async (event) => {
    event.preventDefault();
    const saved = await onSaveDetails(toVersionChanges(form));
    if (saved) setNotice('Product details saved as a draft.');
  };
  const saveGuide = async (guide) => {
    const saved = await onSaveGuide(guide);
    if (saved) setNotice('Cover guide draft saved. Submit when every answer is ready for review.');
  };

  return (
    <section aria-label={`Product ${product.code} version ${version.versionNumber}`} className="min-w-0 space-y-6">
      <Card className="gap-0 border-border shadow-none">
        <CardHeader className="grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b">
          <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{product.code} · Version {version.versionNumber}</p><CardTitle className="mt-2 truncate">{version.name}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{status[1]}</p></div>
          <Badge variant="outline" className={statusClass[version.status]}>{status[0]}</Badge>
        </CardHeader>
        <CardContent className="pt-6">
          {version.reviewComment && <p className="mb-5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed"><span className="font-medium">Review note: </span>{version.reviewComment}</p>}
          {notice && <p role="status" className="mb-5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{notice}</p>}
          {draft && canManage ? (
            <form onSubmit={saveDetails} className="space-y-5" noValidate>
              <FieldSet>
                <FieldDescription>These fields identify the version and determine when its inspection rule applies.</FieldDescription>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field><FieldLabel htmlFor="product-name">Product name</FieldLabel><Input id="product-name" value={form.name} maxLength={120} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
                  <Field><FieldLabel htmlFor="product-cover-type">Cover type</FieldLabel><Input id="product-cover-type" value={COVER_TYPE_LABELS[form.coverType]} readOnly aria-describedby="product-cover-type-help" /><FieldDescription id="product-cover-type-help">Cover type is fixed for this product. Create a new product for a different cover type.</FieldDescription></Field>
                  <Field><FieldLabel htmlFor="product-rate">Annual rate (%)</FieldLabel><Input id="product-rate" type="number" min="0" max="100" step="0.01" value={form.ratePercentage} onChange={(event) => setForm((current) => ({ ...current, ratePercentage: event.target.value }))} /><FieldDescription>This approved rate is used only for a customer estimate; the final quote remains yours.</FieldDescription></Field>
                  <Field className="justify-end"><label className="flex min-h-10 items-center gap-3 rounded-xl border border-border px-3 text-sm"><input type="checkbox" checked={form.showEstimate} onChange={(event) => setForm((current) => ({ ...current, showEstimate: event.target.checked }))} className="size-4 accent-primary" /><span><span className="block font-medium">Show estimate</span><span className="block text-xs text-muted-foreground">Let customers see an indicative price before they request a quote.</span></span></label></Field>
                  <Field><FieldLabel htmlFor="product-effective-from">Effective from</FieldLabel><Input id="product-effective-from" type="date" value={form.effectiveFrom} onChange={(event) => setForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></Field>
                  <Field><FieldLabel htmlFor="product-effective-until">Effective until <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel><Input id="product-effective-until" type="date" value={form.effectiveUntil} min={form.effectiveFrom} onChange={(event) => setForm((current) => ({ ...current, effectiveUntil: event.target.value }))} /></Field>
                  <Field><FieldLabel htmlFor="product-inspection-rule">Inspection rule</FieldLabel><NativeSelect id="product-inspection-rule" value={form.inspectionRule} onChange={(event) => setForm((current) => ({ ...current, inspectionRule: event.target.value, inspectionTiming: event.target.value === 'NOT_REQUIRED' ? '' : current.inspectionTiming, inspectionMethod: event.target.value === 'NOT_REQUIRED' ? '' : current.inspectionMethod }))}>{INSPECTION_RULES.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field>
                  <Field><FieldLabel htmlFor="product-inspection-timing">Inspection timing</FieldLabel><NativeSelect id="product-inspection-timing" disabled={form.inspectionRule === 'NOT_REQUIRED'} value={form.inspectionTiming} onChange={(event) => setForm((current) => ({ ...current, inspectionTiming: event.target.value }))}><NativeSelectOption value="">Choose timing…</NativeSelectOption>{INSPECTION_TIMINGS.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field>
                  <Field><FieldLabel htmlFor="product-inspection-method">Inspection method</FieldLabel><NativeSelect id="product-inspection-method" disabled={form.inspectionRule === 'NOT_REQUIRED'} value={form.inspectionMethod} onChange={(event) => setForm((current) => ({ ...current, inspectionMethod: event.target.value }))}><NativeSelectOption value="">Choose method…</NativeSelectOption>{INSPECTION_METHODS.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field>
                </div>
                <Field><FieldLabel>Available cover periods</FieldLabel><div className="grid gap-2 sm:grid-cols-2">{DURATION_OPTIONS.map(([value, label]) => <label key={value} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-sm"><input type="checkbox" checked={form.allowedDurations.includes(value)} onChange={() => setForm((current) => ({ ...current, allowedDurations: current.allowedDurations.includes(value) ? current.allowedDurations.filter((item) => item !== value) : [...current.allowedDurations, value] }))} className="size-4 accent-primary" />{label}</label>)}</div><FieldDescription>Select every policy period this version can offer.</FieldDescription></Field>
              </FieldSet>
              <Button type="submit" variant="outline" disabled={pending}>{busy === 'save-details' && <Spinner aria-hidden="true" />}<FilePenLine aria-hidden="true" />Save product details</Button>
            </form>
          ) : (
            <dl className="grid gap-4 text-sm sm:grid-cols-4"><Fact label="Cover type" value={COVER_TYPE_LABELS[version.coverType]} /><Fact label="Annual rate" value={`${(Number(version.rateBps || 0) / 100).toFixed(2)}%`} /><Fact label="Cover periods" value={(version.allowedDurations || []).map((item) => ({ Q1: '3 mo', Q2: '6 mo', Q3: '9 mo', Q4: '12 mo' })[item]).join(', ')} /><Fact label="Inspection" value={inspectionSummary(version.inspection)} /></dl>
          )}
        </CardContent>
      </Card>

      <ComparisonMappings
        key={`${version.id}:${version.updatedAt || ''}:${taxonomy.map((term) => term.id).join(',')}`}
        version={version}
        taxonomy={taxonomy}
        editable={draft && canManage}
        busy={pending || busy === 'save-comparison'}
        onSave={async (comparisonItems) => {
          const saved = await onSaveComparison(comparisonItems);
          if (saved) setNotice('Customer comparison terms saved as a draft.');
          return saved;
        }}
      />

      {draft && canManage ? (
        <div className="space-y-4"><div><h2 className="text-lg font-semibold">Customer cover guide</h2><p className="mt-1 text-sm text-muted-foreground">Complete the standard questions customers will later compare. You can save an incomplete draft, but submission requires every answer.</p></div><CoverGuideLibrary
          key={version.id}
          insurer={asEditorInsurer(insurer, version)}
          coverTypes={[coverGuideType(version.coverType)]}
          onSave={(_coverType, guide) => saveGuide(guide)}
          saveLabel="Save guide draft"
          savingLabel="Saving draft…"
          savedMessage="Cover guide draft saved. Review every answer, then submit the product for review."
          requireCompleteOnSave={false}
          compact
        /></div>
      ) : (
        <Card className="border-border shadow-none"><CardHeader><CardTitle className="text-lg">Cover guide</CardTitle><p className="mt-1 text-sm text-muted-foreground">This historical version is read-only. Create a revised draft to change it.</p></CardHeader><CardContent><CoverGuideDocument guide={version.coverGuide || {}} coverType={version.coverType} insurerName={insurer?.name} /></CardContent></Card>
      )}

      <Card size="sm" className="border-border shadow-none"><CardContent className="flex flex-wrap items-center gap-3">
        {draft && canManage && <Button type="button" disabled={pending} onClick={() => void onSubmit()}>{busy === 'submit' ? <Spinner aria-hidden="true" /> : <Send aria-hidden="true" />}Submit for review</Button>}
        {!draft && canManage && <Button type="button" variant="outline" disabled={pending} onClick={() => void onRevise()}>{busy === 'revise' ? <Spinner aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}Create revised draft</Button>}
        <p className="min-w-56 flex-1 text-sm leading-relaxed text-muted-foreground">{draft ? 'Submitting locks this version. An administrator can approve it or return it with a clear comment.' : 'Published and reviewed versions stay unchanged. A revision begins as a new draft.'}</p>
      </CardContent></Card>
    </section>
  );
}

function NewProductForm({ busy, onCancel, onCreate }) {
  const [form, setForm] = useState({ code: '', name: '', coverType: 'COMPREHENSIVE', inspectionRule: 'NOT_REQUIRED', inspectionTiming: '', inspectionMethod: '', ratePercentage: '', showEstimate: true, allowedDurations: ['Q1', 'Q2', 'Q3', 'Q4'], effectiveFrom: day(), effectiveUntil: '' });
  return (
    <Card className="border-primary/20 shadow-none"><CardHeader><CardTitle className="text-lg">Start a product draft</CardTitle><p className="mt-1 text-sm text-muted-foreground">A product code is permanent for this insurer. The first version remains a draft until you submit it.</p></CardHeader><CardContent>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void onCreate({ ...toVersionChanges(form), code: form.code, coverType: form.coverType, coverGuide: {} }); }} noValidate>
        <Field><FieldLabel htmlFor="new-product-code">Product code</FieldLabel><Input id="new-product-code" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="MOTOR-COMP-01" /></Field>
        <Field><FieldLabel htmlFor="new-product-name">Product name</FieldLabel><Input id="new-product-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Comprehensive Gold" /></Field>
        <Field><FieldLabel htmlFor="new-product-cover">Cover type</FieldLabel><NativeSelect id="new-product-cover" value={form.coverType} onChange={(event) => setForm((current) => ({ ...current, coverType: event.target.value }))}>{COVER_TYPES.map((type) => <NativeSelectOption key={type} value={type}>{COVER_TYPE_LABELS[type]}</NativeSelectOption>)}</NativeSelect></Field>
        <Field><FieldLabel htmlFor="new-product-rate">Annual rate (%)</FieldLabel><Input id="new-product-rate" type="number" min="0" max="100" step="0.01" value={form.ratePercentage} onChange={(event) => setForm((current) => ({ ...current, ratePercentage: event.target.value }))} placeholder="4.50" /></Field>
        <Field><FieldLabel htmlFor="new-product-effective">Effective from</FieldLabel><Input id="new-product-effective" type="date" value={form.effectiveFrom} onChange={(event) => setForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></Field>
        <Field><FieldLabel htmlFor="new-product-inspection">Inspection rule</FieldLabel><NativeSelect id="new-product-inspection" value={form.inspectionRule} onChange={(event) => setForm((current) => ({ ...current, inspectionRule: event.target.value }))}>{INSPECTION_RULES.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field>
        <Field className="sm:col-span-2"><FieldLabel>Available cover periods</FieldLabel><div className="grid gap-2 sm:grid-cols-4">{DURATION_OPTIONS.map(([value, label]) => <label key={value} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm"><input type="checkbox" checked={form.allowedDurations.includes(value)} onChange={() => setForm((current) => ({ ...current, allowedDurations: current.allowedDurations.includes(value) ? current.allowedDurations.filter((item) => item !== value) : [...current.allowedDurations, value] }))} className="size-4 accent-primary" />{label}</label>)}</div></Field>
        <Field className="sm:col-span-2"><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={form.showEstimate} onChange={(event) => setForm((current) => ({ ...current, showEstimate: event.target.checked }))} className="size-4 accent-primary" /><span><span className="font-medium">Show an estimate to customers</span><span className="ml-1 text-muted-foreground">They still need a final quotation from your team.</span></span></label></Field>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2"><Button type="submit" disabled={busy}>{busy && <Spinner aria-hidden="true" />}<Plus aria-hidden="true" />Create draft</Button><Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button></div>
      </form>
    </CardContent></Card>
  );
}

function versionToForm(version) {
  return {
    name: version.name || '', coverType: version.coverType || 'COMPREHENSIVE', effectiveFrom: version.effectiveFrom || day(), effectiveUntil: version.effectiveUntil || '',
    inspectionRule: version.inspection?.rule || 'NOT_REQUIRED', inspectionTiming: version.inspection?.timing || '', inspectionMethod: version.inspection?.method || '',
    ratePercentage: version.rateBps === undefined ? '' : String(Number(version.rateBps) / 100), showEstimate: Boolean(version.showEstimate), allowedDurations: version.allowedDurations || ['Q1', 'Q2', 'Q3', 'Q4'],
  };
}
function toVersionChanges(form) {
  return {
    name: form.name, effectiveFrom: form.effectiveFrom, effectiveUntil: form.effectiveUntil || null,
    inspectionRule: form.inspectionRule, inspectionTiming: form.inspectionRule === 'NOT_REQUIRED' ? null : form.inspectionTiming || null,
    inspectionMethod: form.inspectionRule === 'NOT_REQUIRED' ? null : form.inspectionMethod || null,
    rateBps: String(form.ratePercentage).trim() === '' ? undefined : Math.round(Number(form.ratePercentage) * 100), showEstimate: Boolean(form.showEstimate), allowedDurations: form.allowedDurations,
  };
}

function ComparisonMappings({ version, taxonomy, editable, busy, onSave }) {
  const [mappings, setMappings] = useState(() => comparisonDraft(taxonomy, version.comparisonItems));
  const [notice, setNotice] = useState('');

  const save = async (event) => {
    event.preventDefault();
    const saved = await onSave(mappings.map((mapping) => ({ taxonomyItemId: mapping.taxonomyItemId, included: mapping.included, valueText: mapping.valueText || undefined })));
    if (saved) setNotice('Comparison terms saved.');
  };

  if (taxonomy.length === 0 && editable) {
    return <Card className="border-border shadow-none"><CardHeader><CardTitle className="text-lg">Customer comparison terms</CardTitle></CardHeader><CardContent><p className="text-sm leading-relaxed text-muted-foreground">No active comparison terms have been published by InsurShield yet. You can complete the rest of the draft; comparison mappings will be required only when the platform adds active terms.</p></CardContent></Card>;
  }

  if (!editable) {
    const items = version.comparisonItems || [];
    return <Card className="border-border shadow-none"><CardHeader><CardTitle className="text-lg">Customer comparison terms</CardTitle><p className="mt-1 text-sm text-muted-foreground">These terms are the exact snapshot reviewed with this product version.</p></CardHeader><CardContent>{items.length === 0 ? <p className="text-sm text-muted-foreground">No comparison terms were mapped for this historical version.</p> : <dl className="divide-y divide-border overflow-hidden rounded-xl border border-border">{items.map((item) => <div key={item.taxonomyItemId} className="grid gap-1 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"><div><dt className="text-sm font-medium">{item.label}</dt><dd className="mt-1 text-xs text-muted-foreground">{item.category.toLowerCase()} · taxonomy v{item.taxonomyVersion}</dd></div><dd className="text-sm font-medium">{item.included ? item.valueText || 'Included' : 'Not included'}</dd></div>)}</dl>}</CardContent></Card>;
  }

  return (
    <Card className="border-border shadow-none">
      <CardHeader><CardTitle className="text-lg">Customer comparison terms</CardTitle><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Mark whether this version includes each platform term and add the exact limit, excess or option where it applies. Customers will compare these values side by side after approval.</p></CardHeader>
      <CardContent>
        {notice && <p role="status" className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{notice}</p>}
        <form onSubmit={save} className="space-y-3" noValidate>
          {taxonomy.map((term) => {
            const mapping = mappings.find((item) => item.taxonomyItemId === term.id);
            if (!mapping) return null;
            return <div key={term.id} className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-[minmax(0,1fr)_minmax(10rem,.7fr)_auto] md:items-center">
              <div className="min-w-0"><p className="text-sm font-medium">{term.label}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{term.description || comparisonHint(term)}</p></div>
              <ComparisonValueInput term={term} mapping={mapping} disabled={busy || !mapping.included} onChange={(value) => setMappings((current) => current.map((item) => item.taxonomyItemId === term.id ? { ...item, valueText: value } : item))} />
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={mapping.included} disabled={busy} onChange={(event) => setMappings((current) => current.map((item) => item.taxonomyItemId === term.id ? { ...item, included: event.target.checked, valueText: event.target.checked ? item.valueText : '' } : item))} className="size-4 accent-primary" />Included</label>
            </div>;
          })}
          <Button type="submit" variant="outline" disabled={busy}>{busy && <Spinner aria-hidden="true" />}<FilePenLine aria-hidden="true" />Save comparison terms</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ComparisonValueInput({ term, mapping, disabled, onChange }) {
  if (term.dataType === 'LIST') return <NativeSelect value={mapping.valueText} disabled={disabled} aria-label={`${term.label} value`} onChange={(event) => onChange(event.target.value)}><NativeSelectOption value="">Choose value…</NativeSelectOption>{term.allowedValues.map((value) => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}</NativeSelect>;
  return <Input value={mapping.valueText} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-label={`${term.label} value`} inputMode={term.dataType === 'NUMBER' || term.dataType === 'CURRENCY' ? 'decimal' : 'text'} placeholder={term.dataType === 'CURRENCY' ? `Amount in ${term.unit || 'ZMW'}` : term.dataType === 'BOOLEAN' ? 'Yes or No' : term.unit ? `Value in ${term.unit}` : 'Optional detail'} />;
}

function comparisonDraft(taxonomy, currentItems = []) {
  const byId = new Map(currentItems.map((item) => [item.taxonomyItemId, item]));
  return taxonomy.map((term) => {
    const existing = byId.get(term.id);
    return { taxonomyItemId: term.id, included: existing?.included ?? false, valueText: existing?.valueText || '' };
  });
}
function comparisonHint(term) {
  if (term.dataType === 'LIST') return `Choose one of: ${term.allowedValues.join(', ')}.`;
  if (term.dataType === 'CURRENCY') return `Enter the amount in ${term.unit || 'ZMW'}, if applicable.`;
  if (term.dataType === 'BOOLEAN') return 'Confirm whether this product includes the term.';
  return 'Add an exact value where it helps customers compare.';
}
function inspectionSummary(inspection = {}) {
  if (inspection.rule === 'NOT_REQUIRED') return 'Not required';
  return `${inspection.rule === 'REQUIRED' ? 'Required' : 'Optional'} · ${(inspection.timing || '').replaceAll('_', ' ').toLowerCase()} · ${(inspection.method || '').replaceAll('_', ' ').toLowerCase()}`;
}
function coverGuideType(coverType) { return coverType === 'THIRD_PARTY' ? 'ThirdParty' : 'Comprehensive'; }
function Fact({ label, value }) {
  return <div><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1 leading-snug">{value || 'Not stated'}</dd></div>;
}
