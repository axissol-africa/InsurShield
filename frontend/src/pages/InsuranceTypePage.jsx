import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import JourneyProgress from '../components/JourneyProgress';

const OPTIONS = [
  { id: 'Comprehensive', title: 'Comprehensive', tags: [['Recommended', 'bg-red-50 text-primary'], ['Full Coverage', 'bg-emerald-50 text-green-700']], copy: 'Highest level of protection. Covers damage to your own vehicle, theft, fire, and third-party liabilities in accidents. Best for complete peace of mind.' },
  { id: 'ThirdParty', title: 'Third Party Only (TPO)', tags: [['Basic', 'bg-slate-100 text-secondary'], ['Legal Minimum', 'bg-amber-50 text-amber-800']], copy: 'Minimum legal requirement in Zambia. Covers damage and bodily injuries you cause to others, but does not pay for damage to your own vehicle.' },
];

export default function InsuranceTypePage() {
  const navigate = useNavigate();
  const { setInsuranceType } = useStore();
  const [selected, setSelected] = useState('Comprehensive');
  const continueJourney = () => { setInsuranceType(selected); navigate('/vehicle-identification'); };

  return <><JourneyProgress current={1} /><main className="mx-auto w-full max-w-[1420px] px-6 py-16 pb-24 sm:px-10 lg:py-24"><div className="mx-auto max-w-3xl text-center"><h1 className="text-[36px] font-extrabold tracking-[-.04em] sm:text-[48px]">Select Coverage Type</h1><p className="mt-3 text-[18px] text-secondary">Choose the level of protection that suits your budget and security needs.</p></div><div className="mx-auto mt-12 grid max-w-[1160px] gap-5 md:grid-cols-2">{OPTIONS.map(option => { const active = selected === option.id; return <button key={option.id} onClick={() => setSelected(option.id)} className={`relative min-h-[275px] rounded-2xl border-2 bg-white p-8 text-left transition-colors ${active ? 'border-primary' : 'border-slate-200 hover:border-primary/50'}`}><span className={`absolute left-8 top-8 flex h-8 w-8 items-center justify-center rounded-full border-[3px] ${active ? 'border-primary' : 'border-slate-200'}`}>{active && <span className="h-3.5 w-3.5 rounded-full bg-primary" />}</span><div className="ml-12 flex flex-wrap justify-end gap-2">{option.tags.map(([tag, style]) => <span key={tag} className={`rounded-md px-3 py-1 text-[12px] font-bold ${style}`}>{tag}</span>)}</div><h2 className="mt-7 text-[27px] font-extrabold tracking-[-.03em]">{option.title}</h2><p className="mt-4 max-w-lg text-[17px] leading-6 text-secondary">{option.copy}</p></button>; })}</div><div className="mx-auto mt-10 flex max-w-[1160px] justify-end"><button onClick={continueJourney} className="inline-flex min-h-14 items-center gap-3 rounded-lg bg-primary px-10 text-[17px] font-bold text-white hover:bg-primary-container">Continue <span className="material-symbols-outlined">arrow_forward</span></button></div></main></>;
}
