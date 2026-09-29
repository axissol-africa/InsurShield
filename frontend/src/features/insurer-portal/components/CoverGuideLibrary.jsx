import { useState } from 'react';
import { documentToRecord, openDocument } from '@/lib/files';
import Meta from '@/components/ui/Meta';
import { DocumentPicker, Icon } from './ui';

const GUIDES = [
  {
    key: 'Comprehensive',
    title: 'Comprehensive cover guide',
    description: 'Sent automatically with every comprehensive quotation. Explain benefits, exclusions, excesses, claims steps and any policy conditions.',
  },
  {
    key: 'ThirdParty',
    title: 'Third party only guide',
    description: 'Sent automatically with every third-party quotation. Explain what is covered, what is not covered, limits, claims steps and any policy conditions.',
  },
];

/** The insurer's one-time library of customer-facing cover documents. */
export default function CoverGuideLibrary({ insurer, onSave }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const documents = insurer?.coverDocuments || {};

  const save = async (coverageType, event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setSaving(coverageType);
    try {
      await onSave(coverageType, await documentToRecord(file));
    } catch (caught) {
      setError(caught.message || 'The cover guide could not be saved.');
    } finally {
      event.target.value = '';
      setSaving('');
    }
  };

  const remove = async (coverageType) => {
    if (!window.confirm(`Remove the ${coverageType === 'ThirdParty' ? 'third party' : 'comprehensive'} cover guide? New quotes of this type cannot be sent until a replacement is added.`)) return;
    setSaving(coverageType);
    setError('');
    try {
      await onSave(coverageType, null);
    } catch (caught) {
      setError(caught.message || 'The cover guide could not be removed.');
    } finally {
      setSaving('');
    }
  };

  return (
    <section className="mx-auto max-w-4xl pb-10">
      <header className="border-b border-line pb-7">
        <Meta className="text-primary">Customer information library</Meta>
        <h2 className="mt-4 text-[30px] font-semibold tracking-[-.035em] text-ink">Cover guides</h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-[1.6] text-ink-muted">Prepare these two documents once. InsurShield attaches the correct guide automatically whenever you send a quote, so customers can understand the cover before choosing and paying.</p>
      </header>

      {error && <p role="alert" className="mt-5 border border-primary/30 bg-primary/5 p-4 text-[13px] text-primary">{error}</p>}

      <div className="mt-7 grid gap-5 md:grid-cols-2">
        {GUIDES.map((guide) => {
          const document = documents[guide.key];
          const busy = saving === guide.key;
          return (
            <article key={guide.key} className={`border p-5 ${document ? 'border-primary/35 bg-white' : 'border-dashed border-line-strong bg-canvas-2'}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Meta className={document ? 'text-primary' : 'text-ink-faint'}>{guide.key === 'ThirdParty' ? 'Third party only' : 'Comprehensive'}</Meta>
                  <h3 className="mt-3 text-[18px] font-semibold tracking-[-.02em] text-ink">{guide.title}</h3>
                </div>
                <Icon name={document ? 'task_alt' : 'description'} className={`text-[22px] ${document ? 'text-primary' : 'text-line-strong'}`} />
              </div>
              <p className="mt-4 min-h-20 text-[13px] leading-[1.55] text-ink-muted">{guide.description}</p>
              {document ? (
                <div className="border-t border-dashed border-line pt-4">
                  <DocumentPicker document={document} onPick={(event) => save(guide.key, event)} onClear={() => remove(guide.key)} prompt="Replace guide" error="" />
                  <button type="button" onClick={() => openDocument(document)} className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"><Icon name="visibility" className="text-[16px]" />View customer guide</button>
                </div>
              ) : (
                <label className="mt-4 flex min-h-11 cursor-pointer items-center justify-center gap-2 bg-primary px-4 text-[13px] font-medium text-white hover:bg-[#b91c1c]">
                  <Icon name={busy ? 'sync' : 'upload_file'} className={busy ? 'animate-spin text-[18px]' : 'text-[18px]'} />
                  {busy ? 'Saving guide…' : 'Upload cover guide'}
                  <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" disabled={busy} onChange={(event) => save(guide.key, event)} />
                </label>
              )}
            </article>
          );
        })}
      </div>

      <p className="mt-6 border border-line bg-white p-4 text-[13px] leading-[1.55] text-ink-muted"><strong className="font-medium text-ink">Before publishing:</strong> make sure each guide includes benefits, exclusions, excesses, key limits, claims contact details and any special policy conditions. Customers receive the guide together with the final quote.</p>
    </section>
  );
}
