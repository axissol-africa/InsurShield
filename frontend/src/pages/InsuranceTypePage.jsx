import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import JourneyProgress from '../components/JourneyProgress';

const OPTIONS = [
  {
    id: 'Comprehensive',
    title: 'Comprehensive',
    tags: [['Recommended', 'bg-red-50 text-primary'], ['Full cover', 'bg-primary/5 text-primary']],
    copy: 'Covers damage to your own vehicle, theft, fire, and your liability to other people in an accident.',
  },
  {
    id: 'ThirdParty',
    title: 'Third party only (TPO)',
    tags: [['Basic', 'bg-slate-100 text-secondary'], ['Legal minimum', 'bg-amber-50 text-amber-800']],
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

  return (
    <>
      <JourneyProgress current={1} />
      <main className="mx-auto w-full max-w-[1420px] px-6 py-14 pb-24 sm:px-10 lg:py-20">
        <header className="mx-auto max-w-3xl text-center">
          <h1 className="text-[36px] font-extrabold tracking-[-.04em] sm:text-[48px]">Choose your cover</h1>
          <p className="mt-3 text-[18px] text-secondary">You can explore quotes as a guest — an account is only needed when you send your request to insurers.</p>
        </header>

        <div role="radiogroup" aria-label="Coverage type" className="mx-auto mt-12 grid max-w-[1160px] gap-5 md:grid-cols-2">
          {OPTIONS.map((option) => {
            const active = selected === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(option.id)}
                className={`relative min-h-[240px] rounded-2xl border-2 bg-white p-8 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? 'border-primary' : 'border-slate-200 hover:border-primary/50'}`}
              >
                <span aria-hidden="true" className={`absolute left-8 top-8 flex h-8 w-8 items-center justify-center rounded-full border-[3px] ${active ? 'border-primary' : 'border-slate-200'}`}>
                  {active && <span className="h-3.5 w-3.5 rounded-full bg-primary" />}
                </span>
                <span className="ml-12 flex flex-wrap justify-end gap-2">
                  {option.tags.map(([tag, style]) => <span key={tag} className={`rounded-md px-3 py-1 text-[12px] font-bold ${style}`}>{tag}</span>)}
                </span>
                <span className="mt-7 block text-[27px] font-extrabold tracking-[-.03em]">{option.title}</span>
                <span className="mt-4 block max-w-lg text-[17px] leading-6 text-secondary">{option.copy}</span>
              </button>
            );
          })}
        </div>

        <div className="mx-auto mt-10 flex max-w-[1160px] justify-end">
          <button type="button" onClick={continueJourney} className="inline-flex min-h-14 items-center gap-3 rounded-lg bg-primary px-10 text-[17px] font-bold text-white hover:bg-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            Continue <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
          </button>
        </div>
      </main>
    </>
  );
}
