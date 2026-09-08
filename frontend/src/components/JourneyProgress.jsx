const STEPS = [
  { short: 'Coverage', label: 'Coverage Type' },
  { short: 'Vehicle', label: 'Vehicle Details' },
  { short: 'Usage', label: 'Vehicle Use' },
  { short: 'Quotes', label: 'Get Quotes' },
];

export default function JourneyProgress({ current }) {
  return (
    <div className="border-b border-slate-200 bg-slate-50">
      <ol className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        {STEPS.map((step, index) => {
          const number = index + 1;
          const complete = number < current;
          const active = number === current;
          return <li key={step.label} className="flex min-w-0 flex-1 items-center last:flex-none">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-[16px] font-bold ${complete || active ? 'border-primary bg-primary text-white' : 'border-slate-200 bg-white text-secondary'}`}>
              {complete ? <span className="material-symbols-outlined text-[18px]">check</span> : number}
            </div>
            <span className={`ml-2 hidden whitespace-nowrap text-[15px] sm:inline ${active ? 'font-bold text-primary' : complete ? 'font-semibold text-on-surface' : 'font-medium text-secondary'}`}>{step.label}</span>
            <span className={`ml-2 text-[14px] font-bold sm:hidden ${active ? 'text-primary' : 'sr-only'}`}>{active ? step.short : ''}</span>
            {number < STEPS.length && <span className={`mx-3 hidden h-0.5 flex-1 sm:block ${number < current ? 'bg-primary' : 'bg-slate-200'}`} />}
          </li>;
        })}
      </ol>
    </div>
  );
}
