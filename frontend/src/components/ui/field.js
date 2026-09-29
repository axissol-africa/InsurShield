/**
 * One form field for the whole product.
 *
 * Customer and staff screens had drifted into two different fields — a white
 * one with a thin focus ring and a filled one with a soft ring — which is the
 * kind of difference nobody can justify in a review. This is the single
 * definition: a filled box so an input reads as somewhere to type before it is
 * focused, a hairline rule like every other edge here, and a focus ring strong
 * enough to follow with a keyboard.
 *
 * Phones get 16px from the base layer, which stops iOS zooming a focused
 * field; that rule is in index.css rather than repeated here.
 */
export const fieldClass =
  'w-full rounded-[1px] border border-line-strong bg-canvas-2 p-3 text-[15px] text-ink outline-none transition-colors duration-200 ease-out focus:border-primary focus:ring-2 focus:ring-primary/30';

/** The small monospace caption that names a field. */
export const labelClass =
  'mb-2 block font-mono text-[12px] uppercase leading-none tracking-[0.12em] text-ink-muted';
