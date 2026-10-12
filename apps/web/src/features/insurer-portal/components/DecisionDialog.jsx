import { useId, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Alert, AlertTitle } from '@/components/ui/primitives/alert';
import { Button } from '@/components/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/primitives/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/primitives/radio-group';
import { Spinner } from '@/components/ui/primitives/spinner';

/**
 * Review and decide: the facts to check (`children`) and every possible
 * outcome with its consequence, on one surface. A decision is chosen and then
 * confirmed, so one that cannot be undone is never a single stray click, and
 * no outcome is easier to reach than another.
 *
 * `options` are `{ value, title, description, confirm }`; `confirm` is the
 * wording of the button once that outcome is chosen. Mount it for the record
 * under review and unmount it on close, so every review starts undecided.
 */
export default function DecisionDialog({ title, description, options, pending, error, onDecide, onClose, children }) {
  const id = useId();
  const [choice, setChoice] = useState('');
  const chosen = options.find((option) => option.value === choice);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {children}

        <RadioGroup aria-label="Your decision" value={choice} onValueChange={setChoice} disabled={pending}>
          {options.map((option) => (
            <FieldLabel key={option.value} htmlFor={`${id}-${option.value}`}>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>{option.title}</FieldTitle>
                  <FieldDescription>{option.description}</FieldDescription>
                </FieldContent>
                <RadioGroupItem value={option.value} id={`${id}-${option.value}`} />
              </Field>
            </FieldLabel>
          ))}
        </RadioGroup>

        {error && (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" disabled={!chosen || pending} aria-busy={pending} onClick={() => onDecide(chosen)}>
            {pending && <Spinner aria-hidden="true" />}
            {chosen?.confirm ?? 'Confirm decision'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
