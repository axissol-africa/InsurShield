import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useStore } from '@/store';
import JourneyProgress from '@/features/quote-journey/components/JourneyProgress';
import Meta from '@/components/ui/Meta';

/**
 * What each cover actually pays for. Rendered as a matrix inside both panels so
 * the difference between them is visible rather than something the customer has
 * to infer from prose.
 */
const COVER_MATRIX = [
  { label: 'Damage you cause to other people', short: 'Damage to others', Comprehensive: true, ThirdParty: true },
  { label: 'Injury you cause to other people', short: 'Injury to others', Comprehensive: true, ThirdParty: true },
  { label: 'Damage to your own vehicle', short: 'Your vehicle', Comprehensive: true, ThirdParty: false },
  { label: 'Theft of your vehicle', short: 'Theft', Comprehensive: true, ThirdParty: false },
  { label: 'Fire damage', short: 'Fire', Comprehensive: true, ThirdParty: false },
];

const OPTIONS = [
  {
    id: 'Comprehensive',
    code: 'COMP',
    title: 'Comprehensive',
    chips: ['Recommended'],
    copy: 'Covers damage to your own vehicle, theft, fire, and your liability to other people in an accident.',
  },
  {
    id: 'ThirdParty',
    code: 'TPO',
    title: 'Third party only',
    chips: ['Legal minimum'],
    copy: 'The minimum cover required by law in Zambia. Pays for damage and injury you cause to others, not for your own vehicle.',
  },
];

export default function InsuranceTypePage() {
  const navigate = useNavigate();
  const { insuranceType, setInsuranceType } = useStore();
  const [selected, setSelected] = useState(insuranceType || 'Comprehensive');

  const continueJourney = () => {
    setInsuranceType(selected);
    navigate('/vehicle-identification');
  };

  const selectedOption = OPTIONS.find((option) => option.id === selected);

  return (
    <>
      <JourneyProgress current={1} />

      <main className="relative overflow-hidden">
        <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />

        <div className="relative mx-auto w-full max-w-[1200px] px-4 py-6 pb-10 sm:px-6 sm:py-14 sm:pb-24 lg:px-10 lg:py-20">
          <header className="mx-auto max-w-2xl text-center">
            <span className="hidden items-center gap-3 border border-dashed border-line-strong bg-canvas px-3 py-1.5 sm:inline-flex">
              <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
              <Meta className="text-ink-muted">Step 01 · Coverage</Meta>
            </span>

            <h1 className="text-[28px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:mt-7 sm:text-[50px]">
              Choose your cover
            </h1>
            <p className="mt-2 text-[14px] leading-[1.5] text-ink-muted sm:mt-5 sm:text-[17px]">
              <span className="sm:hidden">An account is only needed to send your request.</span>
              <span className="hidden sm:inline">
                Explore as a guest — an account is only needed when you send your request to insurers.
              </span>
            </p>
          </header>

          <div
            role="radiogroup"
            aria-label="Coverage type"
            className="mt-5 grid grid-cols-2 gap-3 sm:mt-14 sm:gap-5"
          >
            {OPTIONS.map((option) => {
              const active = selected === option.id;
              const includedCount = COVER_MATRIX.filter((row) => row[option.id]).length;

              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelected(option.id)}
                  className={`group relative flex flex-col overflow-hidden rounded-[1px] border bg-canvas p-3 text-left transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:p-8 ${
                    active ? 'ticked border-primary bg-primary/[0.02]' : 'border-line hover:border-line-strong'
                  }`}
                >
                  <span className="beam pointer-events-none absolute left-0 top-0 h-px w-1/3 bg-primary" aria-hidden="true" />

                  {/* Selection control + classification code. */}
                  <span className="flex items-center justify-between">
                    <span className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={`flex h-6 w-6 items-center justify-center rounded-[1px] border transition-colors duration-200 ease-out ${
                          active ? 'border-primary bg-primary' : 'border-line-strong bg-canvas'
                        }`}
                      >
                        {active && <span className="h-2 w-2 bg-white" />}
                      </span>
                      <Meta className={`hidden sm:inline ${active ? 'text-primary' : 'text-ink-faint'}`}>{option.code}</Meta>
                    </span>

                    <span className="hidden flex-wrap justify-end gap-2 sm:flex">
                      {option.chips.map((chip) => (
                        <Meta
                          key={chip}
                          className={`rounded-[1px] border px-2.5 py-1.5 ${
                            active ? 'border-primary/30 bg-primary/10 text-primary' : 'border-line text-ink-faint'
                          }`}
                        >
                          {chip}
                        </Meta>
                      ))}
                    </span>
                  </span>

                  <span className="mt-4 block text-[17px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:mt-7 sm:text-[30px] sm:tracking-[-0.03em]">
                    {option.title}
                  </span>
                  {/* On phones the chip sits under the title, where there is room for it. */}
                  <Meta className={`mt-2 block sm:hidden ${active ? 'text-primary' : 'text-ink-faint'}`}>
                    {option.chips[0]}
                  </Meta>
                  {/* The full description is the matrix's job on small screens. */}
                  <span className="mt-3 hidden text-[15px] leading-[1.6] text-ink-muted sm:block">{option.copy}</span>

                  {/* What it pays for. */}
                  <span className="mt-4 block border-t border-dashed border-line pt-4 sm:mt-7 sm:pt-5">
                    <span className="grid gap-2 sm:gap-2.5">
                      {COVER_MATRIX.map((row) => {
                        const included = row[option.id];
                        return (
                          <span key={row.label} className="flex items-center gap-2 sm:gap-3">
                            <span
                              aria-hidden="true"
                              className={`flex h-4 w-4 shrink-0 items-center justify-center ${
                                included ? 'text-primary' : 'text-ink-faint'
                              }`}
                            >
                              {included ? (
                                <span className="material-symbols-outlined text-[16px]">check</span>
                              ) : (
                                <span className="h-px w-2.5 bg-current" />
                              )}
                            </span>
                            <span
                              className={`text-[12px] leading-[1.35] sm:text-[14px] sm:leading-[1.4] ${included ? 'text-ink' : 'text-ink-faint line-through decoration-line-strong'}`}
                            >
                              <span className="sm:hidden">{row.short}</span>
                              <span className="hidden sm:inline">{row.label}</span>
                              <span className="sr-only">{included ? ' — included' : ' — not included'}</span>
                            </span>
                          </span>
                        );
                      })}
                    </span>
                  </span>

                  <span className="mt-auto flex items-center justify-between gap-2 border-t border-dashed border-line pt-4 sm:pt-5">
                    <Meta className="whitespace-nowrap text-ink-faint">
                      <span className="sm:hidden">{includedCount}/{COVER_MATRIX.length}</span>
                      <span className="hidden sm:inline">Covers {includedCount} of {COVER_MATRIX.length}</span>
                    </Meta>
                    <span aria-hidden="true" className="flex items-center gap-1">
                      {COVER_MATRIX.map((row, index) => (
                        <span
                          key={row.label}
                          className={`block h-[3px] w-[3px] rounded-full ${index < includedCount ? 'bg-primary' : 'bg-line-strong'}`}
                        />
                      ))}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* What happens with this choice. */}
          <div className="mt-8 hidden flex-col gap-4 border border-dashed border-line-strong p-5 sm:flex sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Meta className="text-ink-muted">What happens next</Meta>
              <p className="mt-3 max-w-xl text-[14px] leading-[1.55] text-ink-muted">
                Your choice goes to every insurer in the same request. You compare their final quotes
                before anything is payable.
              </p>
            </div>
            <span aria-hidden="true" className="flex shrink-0 items-center gap-1.5">
              {Array.from({ length: 12 }, (_, index) => (
                <span
                  key={index}
                  className="dot-pulse block h-[3px] w-[3px] rounded-full bg-primary"
                  style={{ animationDelay: `${index * 0.09}s` }}
                />
              ))}
            </span>
          </div>

          <div className="mt-5 flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:mt-10 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:pt-8">
            <Link
              to="/"
              className="group inline-flex items-center gap-2 text-[15px] font-medium text-ink-muted transition-colors duration-200 ease-out hover:text-primary"
            >
              <span className="material-symbols-outlined text-[18px] transition-transform duration-200 ease-out group-hover:-translate-x-1" aria-hidden="true">arrow_back</span>
              Back
            </Link>

            <div className="flex items-center gap-5">
              <Meta className="hidden text-ink-faint sm:block">
                Selected: {selectedOption.code}
              </Meta>
              <button
                type="button"
                onClick={continueJourney}
                className="group relative inline-flex min-h-[52px] flex-1 items-center justify-center gap-2.5 overflow-hidden rounded-[1px] bg-primary px-10 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:flex-none"
              >
                <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
                <span className="relative">Continue</span>
                <span className="material-symbols-outlined relative text-[18px] transition-transform duration-200 ease-out group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>
              </button>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
