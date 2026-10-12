import { useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, Eye, Pencil, Plus, TriangleAlert, Upload, X } from 'lucide-react';
import {
  COVER_TYPES, COVER_TYPE_LABELS, blankCoverGuide, cleanCoverGuide,
  coverGuideCompleteness, fieldsFor, isCoverGuideComplete, sectionsFor, validateCoverGuide,
} from '@/domain/coverGuide';
import { cn } from '@/lib/cn';
import { Alert, AlertTitle } from '@/components/ui/primitives/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent } from '@/components/ui/primitives/card';
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/primitives/field';
import { Input } from '@/components/ui/primitives/input';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/primitives/input-group';
import { Item, ItemContent, ItemDescription, ItemMedia } from '@/components/ui/primitives/item';
import { NativeSelect, NativeSelectOption } from '@/components/ui/primitives/native-select';
import { Progress } from '@/components/ui/primitives/progress';
import { Spinner } from '@/components/ui/primitives/spinner';
import { Switch } from '@/components/ui/primitives/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives/tabs';
import { Textarea } from '@/components/ui/primitives/textarea';
import CoverGuideDocument from '@/components/cover-guide/CoverGuideDocument';
import { usePortalAction } from '@/features/insurer-portal/hooks/usePortalAction';
import { PageHeader, StatusBadge } from './ui';

const fieldId = (coverType, key) => `guide-${coverType}-${key}`;

/** A published guide as the form edits it: every question present, old shapes normalised. */
const asDraft = (guide, coverType) => ({ ...blankCoverGuide(coverType), ...cleanCoverGuide(guide || {}, coverType) });
const sameAnswers = (first, second, coverType) =>
  JSON.stringify(cleanCoverGuide(first, coverType)) === JSON.stringify(cleanCoverGuide(second || {}, coverType));

/**
 * Where an insurer states what its cover actually does.
 *
 * Every insurer answers the same questions, so the customer-facing document is
 * identical in shape whoever wrote it — which is the only way a customer can
 * compare two policies without reading both in full. The insurer sees exactly
 * that document in the preview before publishing it.
 *
 * Nothing is published until it is complete: a half-written guide would be
 * worse than none, because it reads as though this insurer simply offers less.
 */
export default function CoverGuideLibrary({ insurer, onSave }) {
  const [coverType, setCoverType] = useState(COVER_TYPES[0]);
  // A published guide is normalised on the way in, not just on the way out:
  // one saved before benefits became plain lines holds `{ item, limit }` pairs,
  // and those would reach a text input as "[object Object]".
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(COVER_TYPES.map((type) => [type, asDraft(insurer?.coverGuides?.[type], type)])));
  const [showErrors, setShowErrors] = useState(false);
  const [savingType, setSavingType] = useState('');
  const [saved, setSaved] = useState('');
  const [unanswered, setUnanswered] = useState('');
  // Each save sends the whole set of guides, so only one runs at a time: two
  // at once would each write the other's cover type back as it was.
  const saving = usePortalAction(async (type, guide) => {
    setSavingType(type);
    await onSave(type, guide);
  }, (caught) => caught?.message || 'The cover guide could not be saved.');
  const [preview, setPreview] = useState(false);

  const draft = drafts[coverType];
  const sections = sectionsFor();
  const progress = coverGuideCompleteness(draft);
  const { errors } = useMemo(() => validateCoverGuide(draft), [draft]);
  const published = insurer?.coverGuides?.[coverType];
  const isPublished = (type) => isCoverGuideComplete(asDraft(insurer?.coverGuides?.[type], type));
  const publishedCount = COVER_TYPES.filter(isPublished).length;
  const unsaved = !sameAnswers(draft, published, coverType);
  const publishing = saving.pending && savingType === coverType;
  const waitingForOther = saving.pending && !publishing;
  const error = unanswered || saving.error;

  const clearError = () => {
    setUnanswered('');
    saving.clearError();
  };

  const set = (key, value) => {
    setDrafts((previous) => ({ ...previous, [coverType]: { ...previous[coverType], [key]: value } }));
    setSaved('');
    clearError();
  };

  const switchType = (type) => {
    setCoverType(type);
    setShowErrors(false);
    setPreview(false);
    clearError();
  };

  const publish = async () => {
    const check = validateCoverGuide(draft);
    if (!check.valid) {
      setShowErrors(true);
      saving.clearError();
      setUnanswered('Answer the highlighted questions before publishing this guide.');
      // Take the person to the first question that needs them; on a long form
      // the summary alone leaves them hunting.
      const first = fieldsFor().find((field) => check.errors[field.key]);
      window.requestAnimationFrame(() => document.getElementById(fieldId(coverType, first.key))?.focus());
      return;
    }
    setUnanswered('');
    if (!(await saving.run(coverType, cleanCoverGuide(draft, coverType)))) return;
    setShowErrors(false);
    setSaved(coverType);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cover guides"
        description="Answer these once per cover type. Every insurer on InsurShield answers the same questions, so customers compare policies rather than documents — and your plan is read on its terms, not on how well it was laid out."
      >
        <StatusBadge tone={publishedCount < COVER_TYPES.length ? 'open' : 'settled'} className="px-3 py-1">
          {publishedCount} of {COVER_TYPES.length} published
        </StatusBadge>
      </PageHeader>

      <Tabs value={coverType} onValueChange={switchType} className="max-w-4xl gap-6">
        <TabsList>
          {COVER_TYPES.map((type) => (
            <TabsTrigger key={type} value={type}>
              {COVER_TYPE_LABELS[type]}
              {/* A phone has room for the mark but not the word; the word stays for screen readers. */}
              <StatusBadge tone={isPublished(type) ? 'settled' : 'open'}>
                {isPublished(type) ? <CircleCheck aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
                <span className="sr-only sm:not-sr-only">{isPublished(type) ? 'Published' : 'Needed'}</span>
              </StatusBadge>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={coverType} className="space-y-6">
          <Card size="sm">
            <CardContent className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-48 flex-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{progress.done} of {progress.total} answered</span>
                  <span className="tabular-nums text-muted-foreground">{progress.percent}%</span>
                </div>
                <Progress value={progress.percent} aria-label="Questions answered" className="mt-2 h-1.5" />
              </div>
              <Button type="button" variant="outline" onClick={() => setPreview((open) => !open)}>
                {preview ? <Pencil aria-hidden="true" /> : <Eye aria-hidden="true" />}
                {preview ? 'Back to the form' : 'Preview as a customer'}
              </Button>
            </CardContent>
          </Card>

          {preview ? (
            <div className="space-y-4">
              <Item variant="muted" size="sm">
                <ItemMedia variant="icon"><Eye aria-hidden="true" /></ItemMedia>
                <ItemContent>
                  <ItemDescription className="line-clamp-none text-foreground">
                    This is the document a customer reads beside every other insurer&apos;s. Anything still unanswered shows as “Not stated”.
                  </ItemDescription>
                </ItemContent>
              </Item>
              <CoverGuideDocument guide={draft} coverType={coverType} insurerName={insurer?.name} />
            </div>
          ) : (
            <form className="space-y-6" noValidate onSubmit={(event) => { event.preventDefault(); void publish(); }}>
              {sections.map((section) => (
                <Card key={section.id}>
                  <CardContent>
                    <FieldSet>
                      {/* The legend stays the fieldset's first child, which is what names the group. */}
                      <FieldLegend>{section.title}</FieldLegend>
                      <FieldDescription>{section.hint}</FieldDescription>
                      <div className="grid gap-5 sm:grid-cols-2">
                        {section.fields.map((field) => (
                          <GuideField
                            key={field.key}
                            id={fieldId(coverType, field.key)}
                            field={field}
                            value={draft[field.key]}
                            error={showErrors ? errors[field.key] : ''}
                            onChange={(value) => set(field.key, value)}
                          />
                        ))}
                      </div>
                    </FieldSet>
                  </CardContent>
                </Card>
              ))}

              {error && (
                <Alert variant="destructive">
                  <TriangleAlert aria-hidden="true" />
                  <AlertTitle>{error}</AlertTitle>
                </Alert>
              )}
              {saved === coverType && (
                <Item variant="muted" size="sm" role="status">
                  <ItemMedia variant="icon"><CircleCheck className="text-primary" aria-hidden="true" /></ItemMedia>
                  <ItemContent>
                    <ItemDescription className="line-clamp-none text-foreground">
                      Published. Customers comparing {COVER_TYPE_LABELS[coverType].toLowerCase()} quotes see this guide.
                    </ItemDescription>
                  </ItemContent>
                </Item>
              )}

              <Card size="sm" className="sticky bottom-4 z-10 shadow-lg">
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3">
                  <Button type="submit" size="lg" disabled={saving.pending} aria-busy={publishing}>
                    {publishing ? <Spinner aria-hidden="true" /> : <Upload aria-hidden="true" />}
                    {publishing ? 'Publishing…' : published ? 'Update the guide' : 'Publish the guide'}
                  </Button>
                  {unsaved && <Badge variant="outline">Unsaved changes</Badge>}
                  <p className="min-w-48 flex-1 text-xs text-muted-foreground">
                    {waitingForOther
                      ? `Your ${COVER_TYPE_LABELS[savingType].toLowerCase()} guide is still publishing.`
                      : published ? 'Published — changes apply to quotes sent from now on.' : 'Quotes for this cover type cannot be sent until this is published.'}
                  </p>
                </CardContent>
              </Card>
            </form>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── One question ────────────────────────────────────────────────────

function GuideField({ id, field, value, error, onChange }) {
  const wide = field.kind === 'long' || field.kind === 'list';
  const errorId = `${id}-error`;
  const control = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined };

  return (
    <Field data-invalid={error ? true : undefined} className={cn(wide && 'sm:col-span-2')}>
      <FieldLabel htmlFor={id}>{field.required ? `${field.label} *` : field.label}</FieldLabel>

      {field.kind === 'long' && (
        <Textarea {...control} rows={2} value={value || ''} maxLength={field.max} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} className="resize-none" />
      )}

      {field.kind === 'text' && (
        <Input {...control} value={value || ''} maxLength={field.max} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} />
      )}

      {field.kind === 'days' && (
        <InputGroup>
          <InputGroupInput {...control} inputMode="numeric" value={value ?? ''} onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ''))} placeholder="7" />
          <InputGroupAddon align="inline-end"><InputGroupText>days</InputGroupText></InputGroupAddon>
        </InputGroup>
      )}

      {field.kind === 'choice' && (
        <NativeSelect {...control} value={value || ''} onChange={(event) => onChange(event.target.value)}>
          <NativeSelectOption value="">Choose…</NativeSelectOption>
          {field.options.map((option) => <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>)}
        </NativeSelect>
      )}

      {field.kind === 'boolean' && (
        <div className="flex h-9 items-center gap-3">
          <Switch {...control} checked={Boolean(value)} onCheckedChange={onChange} />
          <span className="text-sm text-muted-foreground" aria-hidden="true">{value ? 'Yes' : 'No'}</span>
        </div>
      )}

      {field.kind === 'list' && (
        <ListField control={control} label={field.label} value={value || []} max={field.max} placeholder={field.placeholder} onChange={onChange} />
      )}

      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  );
}

/** A plain list of lines — exclusions, documents needed. The first line carries the field's label; the rest say which line they are. */
function ListField({ control, label, value, max, placeholder, onChange }) {
  const rows = value.length ? value : [''];
  const update = (index, next) => onChange(rows.map((row, position) => (position === index ? next : row)));

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <div key={index} className="flex gap-2">
          <Input
            {...(index === 0 ? control : { 'aria-label': `${label} line ${index + 1}` })}
            value={row}
            onChange={(event) => update(index, event.target.value)}
            placeholder={placeholder}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(rows.filter((_, position) => position !== index))}
            aria-label={`Remove ${label} line ${index + 1}`}
            className="shrink-0 text-muted-foreground"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
      {rows.length < max && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...rows, ''])} className="w-fit text-primary">
          <Plus aria-hidden="true" />Add another
        </Button>
      )}
    </div>
  );
}
