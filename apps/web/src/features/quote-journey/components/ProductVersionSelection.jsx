import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api';
import { formatZMW } from '@/domain/premiumEngine';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/primitives/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Checkbox } from '@/components/ui/primitives/checkbox';
import { Input } from '@/components/ui/primitives/input';
import { NativeSelect } from '@/components/ui/primitives/native-select';
import { documentToRecord } from '@/lib/files';

const MAX_SELECTED_PRODUCTS = 5;

const coverTypeFor = (insuranceType) => (insuranceType === 'ThirdParty' || insuranceType === 'Third Party Only' ? 'THIRD_PARTY' : 'COMPREHENSIVE');
const durationFor = (coverageDurationId) => ({ '1q': 'Q1', '2q': 'Q2', '3q': 'Q3', '4q': 'Q4' }[coverageDurationId] || 'Q4');

const summaryFor = (product) => product.version?.coverGuide?.summary || 'Read the insurer’s cover guide before requesting a final quote.';
const requirementKey = (productVersionId, key) => `${productVersionId}:${key}`;

function ProductRequirements({
  product,
  answers,
  declarations,
  documents,
  onAnswerChange,
  onDeclarationChange,
  onDocumentChange,
}) {
  const [fileError, setFileError] = useState({});
  const requirements = [...(product.version.requirements || [])].sort((left, right) => left.displayOrder - right.displayOrder);
  if (!requirements.length) return null;

  const inputFor = (requirement) => {
    const id = `requirement-${product.version.id}-${requirement.key}`;
    const key = requirementKey(product.version.id, requirement.key);
    const common = {
      id,
      'aria-describedby': requirement.helpText ? `${id}-help` : undefined,
    };

    if (requirement.kind === 'QUESTION') {
      const inputType = requirement.config?.inputType;
      if (inputType === 'BOOLEAN') {
        return (
          <label className="flex cursor-pointer items-center gap-2 text-sm" htmlFor={id}>
            <Checkbox
              {...common}
              checked={answers[key] === true}
              onCheckedChange={(checked) => onAnswerChange(key, checked === true)}
            />
            <span>Yes</span>
          </label>
        );
      }
      if (inputType === 'SELECT') {
        return (
          <NativeSelect {...common} className="w-full" value={answers[key] ?? ''} onChange={(event) => onAnswerChange(key, event.target.value)}>
            <option value="">Choose an option</option>
            {(requirement.config?.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
          </NativeSelect>
        );
      }
      return (
        <Input
          {...common}
          className="w-full"
          type={inputType === 'NUMBER' ? 'number' : 'text'}
          inputMode={inputType === 'NUMBER' ? 'decimal' : undefined}
          value={answers[key] ?? ''}
          onChange={(event) => onAnswerChange(key, inputType === 'NUMBER' && event.target.value !== '' ? Number(event.target.value) : event.target.value)}
        />
      );
    }

    if (requirement.kind === 'DECLARATION') {
      return (
        <label className="flex cursor-pointer items-start gap-2 text-sm leading-6" htmlFor={id}>
          <Checkbox {...common} className="mt-1" checked={declarations[key] === true} onCheckedChange={(checked) => onDeclarationChange(key, checked === true)} />
          <span>{requirement.config?.text || requirement.label}</span>
        </label>
      );
    }

    const uploaded = documents[key];
    return (
      <div className="space-y-2">
        <Input
          {...common}
          className="w-full"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
              onDocumentChange(key, await documentToRecord(file));
              setFileError((current) => ({ ...current, [key]: '' }));
            } catch (error) {
              setFileError((current) => ({ ...current, [key]: error.message || 'This document could not be added.' }));
            }
          }}
        />
        {uploaded && <p className="text-xs text-primary">{uploaded.name || 'Document added'} — choose another file to replace it.</p>}
        {fileError[key] && <p role="alert" className="text-xs text-destructive">{fileError[key]}</p>}
      </div>
    );
  };

  return (
    <section className="space-y-3 border-t border-border pt-3" aria-label={`${product.version.name} additional information`}>
      <p className="text-sm font-medium text-primary">Additional information for this product</p>
      {requirements.map((requirement) => {
        const id = `requirement-${product.version.id}-${requirement.key}`;
        return (
          <div key={requirement.key} className="space-y-2 rounded-lg border border-border/80 bg-muted/20 p-3">
            {requirement.kind !== 'DECLARATION' && (
              <label htmlFor={id} className="block text-sm font-medium">
                {requirement.label}{requirement.required && <span className="ml-1 text-destructive">*</span>}
              </label>
            )}
            {requirement.helpText && <p id={`${id}-help`} className="text-xs leading-5 text-muted-foreground">{requirement.helpText}</p>}
            {inputFor(requirement)}
          </div>
        );
      })}
    </section>
  );
}
/**
 * The current customer journey chooses immutable, published product versions
 * before the quote request is sent. It deliberately keeps each choice at the
 * product-version level: one insurer can offer several options to the same
 * customer, and each option can later receive its own final quote.
 */
export default function ProductVersionSelection({
  insuranceType,
  vehicleValue,
  vehicleUsage,
  coverageDurationId,
  selectedProductVersionIds = [],
  selectedProductVersions,
  onSelectionChange,
  onLoadStateChange,
  productRequirementAnswers = {},
  productRequirementDeclarations = {},
  productRequirementDocuments = {},
  onRequirementAnswerChange,
  onRequirementDeclarationChange,
  onRequirementDocumentChange,
}) {
  const [products, setProducts] = useState([]);
  const [loadedKey, setLoadedKey] = useState(null);
  const [error, setError] = useState('');
  const [estimates, setEstimates] = useState({});
  const [selectionError, setSelectionError] = useState('');
  const coverType = coverTypeFor(insuranceType);
  const selectionKey = JSON.stringify(selectedProductVersionIds);
  const loadKey = `${coverType}:${selectionKey}`;
  const ready = loadedKey === loadKey && !error;
  const loading = loadedKey !== loadKey;
  const failed = loadedKey === loadKey && Boolean(error);

  useEffect(() => {
    let cancelled = false;
    onLoadStateChange?.('loading');
    api.products
      .directory({ coverType, limit: 100 })
      .then(async (records) => {
        if (cancelled) return;
        const available = Array.isArray(records) ? [...records] : [];
        const listedIds = new Set(available.map((product) => product.version.id));
        // A bounded directory page cannot establish that a renewal is unavailable.
        const missingIds = [...new Set(JSON.parse(selectionKey))].filter((id) => !listedIds.has(id));
        const resolved = await Promise.all(missingIds.map((productVersionId) =>
          api.products.directory({ coverType, productVersionId, limit: 1 }),
        ));
        if (cancelled) return;
        available.push(...resolved.flat());
        setProducts(available);
        setLoadedKey(loadKey);
        setError('');
        onLoadStateChange?.('ready');
      })
      .catch((caught) => {
        if (cancelled) return;
        setProducts([]);
        setLoadedKey(loadKey);
        setError(caught.message || 'The available insurance products could not be loaded. Please try again.');
        onLoadStateChange?.('error');
      });
    return () => {
      cancelled = true;
    };
  }, [coverType, loadKey, selectionKey, onLoadStateChange]);

  const availableIds = useMemo(() => new Set(products.map((product) => product.version?.id).filter(Boolean)), [products]);

  useEffect(() => {
    if (!ready) return;
    const validIds = selectedProductVersionIds.filter((id) => availableIds.has(id));
    // A selection made outside this list (a renewal starting from the product
    // bought last year) arrives as ids alone; fill in the products so their
    // requirements are asked for.
    const missingDetails = selectedProductVersions !== undefined && validIds.some((id) => !selectedProductVersions.some((entry) => entry?.version?.id === id));
    if (validIds.length !== selectedProductVersionIds.length || missingDetails) {
      onSelectionChange(validIds, products.filter((product) => validIds.includes(product.version.id)));
    }
  }, [availableIds, onSelectionChange, products, ready, selectedProductVersionIds, selectedProductVersions]);

  const selectedProducts = useMemo(
    () => products.filter((product) => selectedProductVersionIds.includes(product.version?.id)),
    [products, selectedProductVersionIds],
  );

  useEffect(() => {
    if (!selectedProducts.length || !vehicleValue || !vehicleUsage) return undefined;
    let cancelled = false;
    const needingEstimates = selectedProducts.filter(
      (product) => !Object.prototype.hasOwnProperty.call(estimates, product.version.id),
    );
    if (!needingEstimates.length) return undefined;
    Promise.all(
      needingEstimates.map(async (product) => {
        try {
          const estimate = await api.products.estimate(product.product.id, product.version.id, {
            vehicleValue,
            vehicleUsage,
            coverageDuration: durationFor(coverageDurationId),
          });
          return [product.version.id, estimate];
        } catch {
          // Estimates are optional information. The final insurer quote stays
          // authoritative, so an unavailable estimate must not block a valid
          // product selection.
          return [product.version.id, null];
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setEstimates((current) => ({ ...current, ...Object.fromEntries(results) }));
    });
    return () => {
      cancelled = true;
    };
  }, [coverageDurationId, estimates, selectedProducts, vehicleUsage, vehicleValue]);

  const toggle = (product, checked) => {
    const id = product.version.id;
    if (checked && !selectedProductVersionIds.includes(id) && selectedProductVersionIds.length >= MAX_SELECTED_PRODUCTS) {
      setSelectionError('Choose up to five products for one quote request.');
      return;
    }
    const nextIds = checked
      ? [...new Set([...selectedProductVersionIds, id])]
      : selectedProductVersionIds.filter((selectedId) => selectedId !== id);
    setSelectionError('');
    onSelectionChange(nextIds, products.filter((entry) => nextIds.includes(entry.version.id)));
  };

  return (
    <section id="section-products" tabIndex={-1} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-primary">Choose insurance products</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Select one to five published products to receive separate final quotes. You may choose more than one product from the same insurer.
          </p>
        </div>
        <Badge variant="secondary">{selectedProductVersionIds.length} of {MAX_SELECTED_PRODUCTS} selected</Badge>
      </div>

      {loading && <p role="status" className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">Loading available products…</p>}
      {failed && (
        <Alert variant="destructive">
          <AlertTitle>Products are unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {ready && !products.length && (
        <Alert>
          <AlertTitle>No products are available</AlertTitle>
          <AlertDescription>There are no published products for this cover type right now. Please try again later.</AlertDescription>
        </Alert>
      )}
      {ready && products.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {products.map((product) => {
            const selected = selectedProductVersionIds.includes(product.version.id);
            const limitReached = !selected && selectedProductVersionIds.length >= MAX_SELECTED_PRODUCTS;
            const estimate = estimates[product.version.id];
            return (
              <Card key={product.version.id} size="sm" className={selected ? 'border-primary ring-1 ring-primary/50' : ''}>
                <CardHeader className="gap-3">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`product-${product.version.id}`}
                      checked={selected}
                      disabled={limitReached}
                      onCheckedChange={(checked) => toggle(product, checked === true)}
                      aria-label={`Select ${product.version.name} from ${product.insurer.name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base">{product.version.name}</CardTitle>
                      <p className="mt-1 text-sm font-medium text-primary">{product.insurer.name}</p>
                    </div>
                    <Badge variant="outline">v{product.version.number}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="leading-6 text-muted-foreground">{summaryFor(product)}</p>
                  {estimate ? (
                    <p>
                      <span className="text-muted-foreground">Indicative premium</span>{' '}
                      <strong>{formatZMW(estimate.estimatedPremium)}</strong>
                    </p>
                  ) : (
                    <p className="text-muted-foreground">The insurer will provide the final premium after review.</p>
                  )}
                  {selected && (
                    <ProductRequirements
                      product={product}
                      answers={productRequirementAnswers}
                      declarations={productRequirementDeclarations}
                      documents={productRequirementDocuments}
                      onAnswerChange={onRequirementAnswerChange}
                      onDeclarationChange={onRequirementDeclarationChange}
                      onDocumentChange={onRequirementDocumentChange}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {selectionError && <p role="alert" className="text-sm text-destructive">{selectionError}</p>}
    </section>
  );
}
