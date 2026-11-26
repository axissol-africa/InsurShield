import { env } from '@/config/env';
import { openDocument } from '@/lib/files';
import { Button } from '@/components/ui/primitives/button';

export default function InspectionDocuments({ items = [], label }) {
  return <section aria-label={label} className="space-y-2">
    <h4 className="font-medium">{label}</h4>
    {items.length ? <ul className="space-y-2">{items.map((item, index) => {
      const document = item.document;
      const name = document?.name || document?.fileName || 'Document';
      return <li key={`${document?.id}-${item.slot}-${index}`} className="break-words text-sm">
        {item.slot && <span className="capitalize">{item.slot === 'report' ? 'Inspection report' : item.slot.replaceAll('_', ' ')} · </span>}
        {document?.url && /^(https?:\/\/|\/(?![\\/]))[^\s\\]*$/.test(document.url)
          ? <a className="underline" href={document.url} target="_blank" rel="noopener noreferrer">{name}</a>
          : env.apiMode === 'mock' && /^data:(application\/pdf|image\/(png|jpeg));base64,/.test(document?.dataUrl || '')
            ? <Button variant="link" onClick={() => openDocument(document)}>{name}</Button>
            : <span>{name} — link unavailable</span>}
        {item.reference && <span className="block text-xs text-muted-foreground">Reference: {item.reference}</span>}
      </li>;
    })}</ul> : <p className="text-sm text-muted-foreground">No documents recorded.</p>}
  </section>;
}
