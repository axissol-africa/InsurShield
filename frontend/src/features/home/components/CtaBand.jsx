import { useNavigate } from 'react-router-dom';

/**
 * The closing call to action: a solid accent panel with a bloom rising from
 * its lower edge, drifting icon tiles, and a ticker of what the platform
 * actually does. Every claim in the ticker is something the product does today.
 */

const TILES = [
  { icon: 'directions_car', top: '12%', left: '6%', tilt: '-11deg', delay: '0s' },
  { icon: 'description', top: '30%', left: '15%', tilt: '9deg', delay: '1.1s' },
  { icon: 'shield', top: '9%', right: '8%', tilt: '13deg', delay: '.6s' },
  { icon: 'payments', top: '33%', right: '16%', tilt: '-8deg', delay: '1.7s' },
  { icon: 'photo_camera', top: '58%', left: '9%', tilt: '7deg', delay: '2.2s' },
  { icon: 'verified', top: '60%', right: '10%', tilt: '-12deg', delay: '.3s' },
];

const FEATURES = [
  ['bolt', 'One request reaches every insurer'],
  ['description', 'Insurer-issued quotation documents'],
  ['balance', 'PIA-regulated minimum rate applied'],
  ['photo_camera', 'Guided photo capture, no depot visit'],
  ['event_repeat', 'Cover aligned to your RTSA anniversary'],
  ['support_agent', 'First claim notification from your account'],
];

export default function CtaBand() {
  const navigate = useNavigate();

  return (
    <section className="bg-ink px-4 pb-14 pt-16 sm:px-6 lg:px-10 lg:pb-20 lg:pt-24">
      <div className="relative mx-auto max-w-[1200px] overflow-hidden rounded-[20px] bg-primary">
        <div className="halftone pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />

        {/* Drifting tiles. Hidden on small screens, where they would crowd the copy. */}
        <div className="pointer-events-none absolute inset-0 hidden md:block" aria-hidden="true">
          {TILES.map((tile) => (
            <span
              key={tile.icon}
              className="tile-float absolute flex h-14 w-14 items-center justify-center rounded-[10px] border border-dashed border-white/40 text-white/70"
              style={{
                top: tile.top,
                left: tile.left,
                right: tile.right,
                '--tilt': tile.tilt,
                animationDelay: tile.delay,
              }}
            >
              <span className="material-symbols-outlined text-[22px]">{tile.icon}</span>
            </span>
          ))}
        </div>

        <div className="relative px-6 pb-36 pt-20 text-center sm:px-10 lg:pb-44 lg:pt-24">
          {/* Anchored to the bottom of the copy block, i.e. just above the ticker. */}
          <div className="bloom bloom-breathe pointer-events-none absolute inset-x-0 bottom-0 h-[300px] lg:h-[380px]" aria-hidden="true" />

          <div className="relative z-10">
          <h2 className="mx-auto max-w-3xl text-[34px] font-semibold leading-[1.06] tracking-[-0.04em] text-white sm:text-[46px] lg:text-[56px]">
            Cover without the phone calls
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-[16px] leading-[1.6] text-white/85 sm:text-[17px]">
            Start with your registration number. Every registered insurer prices the same request,
            and nothing is payable until you accept a quote.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => navigate('/insurance-type')}
              className="group inline-flex min-h-[52px] items-center justify-center gap-2.5 rounded-full bg-white px-8 text-[15px] font-medium text-ink transition-colors duration-200 ease-out hover:bg-white/90"
            >
              Get insurance
              <span className="material-symbols-outlined text-[18px] transition-transform duration-200 ease-out group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/support')}
              className="inline-flex min-h-[52px] items-center justify-center rounded-full border border-white/40 bg-white/10 px-8 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-white/20"
            >
              How it works
            </button>
          </div>
          </div>
        </div>

        {/* Feature ticker. A light scrim keeps the labels legible where the
            bloom passes behind them. */}
        <div className="relative z-10 overflow-hidden border-t border-white/30 bg-primary/55 backdrop-blur-[1px]">
          <div className="feature-ticker flex w-max">
            {[...FEATURES, ...FEATURES].map(([icon, label], index) => (
              <span
                key={`${label}-${index}`}
                className="flex shrink-0 items-center gap-3 border-r border-dashed border-white/25 px-8 py-5"
              >
                <span className="material-symbols-outlined text-[18px] text-white/80" aria-hidden="true">{icon}</span>
                <span className="whitespace-nowrap text-[14px] text-white">{label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
