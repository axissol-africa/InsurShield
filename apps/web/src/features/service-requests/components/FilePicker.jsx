import { useId } from 'react';
import { Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { formatBytes } from '@/lib/files';
import { MAX_FILES } from '../shared';

/** Up to five PDF, JPG or PNG files, chosen in one go or a few at a time. */
export default function FilePicker({ files, onChange, label = 'Attach documents', hint }) {
  const id = useId();
  const add = (event) => {
    const picked = Array.from(event.target.files || []);
    event.target.value = '';
    onChange([...files, ...picked]);
  };
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div>
        <input id={id} type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={add} className="sr-only" disabled={files.length >= MAX_FILES} />
        <Button type="button" variant="outline" size="sm" asChild disabled={files.length >= MAX_FILES}>
          <label htmlFor={id} className="cursor-pointer"><Paperclip aria-hidden="true" />Choose files</label>
        </Button>
      </div>
      {files.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 truncate">{file.name} <span className="text-muted-foreground">· {formatBytes(file.size)}</span></span>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${file.name}`} onClick={() => onChange(files.filter((_, at) => at !== index))}>
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
