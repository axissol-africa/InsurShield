import { useEffect, useRef } from 'react';
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import DitherChart from './DitherChart';

/**
 * The argument for the product, made visually: phoning insurers one at a time
 * versus sending one request. The left panel is deliberately cluttered and
 * never quite still; the right panel is almost empty.
 *
 * The scattered notes on the left are illustrative, so they are hidden from
 * assistive technology — the headings and the summary line carry the meaning.
 */

const CHAOS_NOTES = [
  { text: '“Can you resend your White Book?”', top: '41%', left: '1%', tilt: '-1.5deg', wide: true },
  { text: '“That quote expired on Friday.”', top: '62%', left: '8%', tilt: '1.2deg', wide: true },
  { text: '“Our underwriter will call you back.”', top: '79%', left: '42%', tilt: '-0.8deg' },
];

const ALERTS = [
  { label: 'NO REPLY', detail: 'Insurer 3 · day 4' },
  { label: 'EXPIRED', detail: 'Insurer 1 · Friday' },
  { label: 'RESEND', detail: 'Insurer 5 · again' },
];

/**
 * Counts up once when the panel scrolls into view. Driven by a motion value
 * rather than component state, so the animation never re-renders the section.
 */
function useCountUp(target, active, reduceMotion) {
  const value = useMotionValue(reduceMotion ? target : 0);

  useEffect(() => {
    if (reduceMotion) {
      value.set(target);
      return undefined;
    }
    if (!active) return undefined;
    const controls = animate(value, target, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [target, active, reduceMotion, value]);

  return useTransform(value, (current) => Math.round(current));
}

export default function ComparisonSplit({ insurerCount }) {
  const reduceMotion = useReducedMotion();
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-120px' });
  const count = useCountUp(insurerCount, inView, reduceMotion);

  return (
    <section ref={ref} className="border-b border-line bg-ink">
      <div className="grid lg:grid-cols-2">
        {/* ── The old way ─────────────────────────────────────────── */}
        <div className="relative min-h-[520px] overflow-hidden px-6 py-14 lg:px-12 lg:py-20">
          <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden="true" />

          <div className="relative flex items-center gap-3">
            <span className="material-symbols-outlined text-[18px] text-amber-400" aria-hidden="true">warning</span>
            <span className="font-mono text-[12px] uppercase leading-none tracking-[0.12em] text-white/45">
              Status: still comparing
            </span>
          </div>

          <h3 className="relative mt-7 max-w-[320px] text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] text-white sm:text-[36px]">
            Buying cover the <span className="whitespace-nowrap text-white/40">old way</span>
          </h3>

          {/* Erratic quotes, drawn as noise. */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-32 opacity-40 lg:opacity-70" aria-hidden="true">
            <DitherChart className="h-full w-full" />
          </div>

          {/* Scattered notes. Hidden below lg, where free positioning would
              collide with the alert pile and become unreadable. */}
          <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
            {CHAOS_NOTES.map((note) => (
              <p
                key={note.text}
                className={`unsettled absolute rounded-[2px] border border-dashed border-white/20 bg-[#0e0e0e]/95 px-4 py-3 text-[13px] leading-[1.4] text-white/45 ${note.wide ? 'max-w-[230px]' : 'max-w-[200px]'}`}
                style={{ top: note.top, left: note.left, '--tilt': note.tilt }}
              >
                {note.text}
              </p>
            ))}
          </div>

          {/* The alert pile. Stacks in normal flow on phones and is positioned
              freely from lg up — the inline top/right are simply ignored while
              the items are static. */}
          <div
            className="relative z-10 mt-10 flex flex-col gap-3 lg:pointer-events-none lg:absolute lg:inset-0 lg:mt-0 lg:block"
            aria-hidden="true"
          >
            {ALERTS.map((alert, index) => (
              <div
                key={alert.label}
                className="unsettled flex w-full items-center gap-3 rounded-[2px] border border-white/10 bg-[#141414] px-3.5 py-3 lg:absolute lg:right-[6%] lg:w-[228px]"
                style={{
                  top: `${34 + index * 12}%`,
                  '--tilt': `${index % 2 === 0 ? -0.6 : 0.8}deg`,
                  animationDelay: `${index * 0.6}s`,
                  zIndex: 10 - index,
                }}
              >
                <span className="shrink-0 whitespace-nowrap rounded-[2px] bg-primary/15 px-2 py-1 font-mono text-[10px] leading-none tracking-[0.08em] text-primary">
                  {alert.label}
                </span>
                <span className="font-mono text-[11px] leading-[1.35] text-white/35">{alert.detail}</span>
              </div>
            ))}
          </div>

          <p className="relative z-10 mt-10 font-mono text-[12px] uppercase tracking-[0.12em] text-white/30 lg:absolute lg:bottom-8 lg:left-12 lg:mt-0">
            {insurerCount} calls · {insurerCount} forms · one answer at a time
          </p>
        </div>

        {/* ── With InsurShield ────────────────────────────────────── */}
        <div className="relative flex min-h-[520px] flex-col justify-center overflow-hidden bg-primary px-6 py-14 lg:px-12 lg:py-20">
          <div className="halftone pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
          {/* Registration marks, echoing the corner ticks used elsewhere. */}
          {['left-4 top-4 border-l border-t', 'right-4 top-4 border-r border-t', 'left-4 bottom-4 border-b border-l', 'right-4 bottom-4 border-b border-r'].map((position) => (
            <span key={position} className={`pointer-events-none absolute h-3 w-3 border-white/40 ${position}`} aria-hidden="true" />
          ))}

          <div className="relative">
            <span className="font-mono text-[12px] uppercase leading-none tracking-[0.12em] text-white/60">
              Status: quotes in
            </span>
            <h3 className="mt-7 max-w-[320px] text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] text-white sm:text-[36px]">
              Buying cover with InsurShield
            </h3>
          </div>

          {/* One calm statement, with a rule running through it. */}
          <div className="relative mt-14 flex items-center">
            <span className="hidden h-px flex-1 border-t border-dashed border-white/30 sm:block" aria-hidden="true" />
            <span className="inline-flex items-center gap-3 rounded-full border border-white/35 bg-white/10 px-6 py-4 backdrop-blur-sm">
              <span className="material-symbols-outlined text-[20px] text-white" aria-hidden="true">check</span>
              <span className="text-[17px] font-medium text-white sm:text-[19px]">
                <motion.span className="tabular-nums">{count}</motion.span> final quotes, side by side
              </span>
            </span>
            <span className="hidden h-px flex-1 border-t border-dashed border-white/30 sm:block" aria-hidden="true" />
          </div>

          <p className="relative mt-14 font-mono text-[12px] uppercase tracking-[0.12em] text-white/60">
            1 request · 1 form · every insurer at once
          </p>
        </div>
      </div>
    </section>
  );
}
