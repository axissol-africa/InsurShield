import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Meta from '@/components/ui/Meta';
import { useStore } from '@/store';
import JourneyProgress from '@/features/quote-journey/components/JourneyProgress';

const OPTIONS = [
  { id: 'Individual', icon: 'person', desc: 'Standard private car for personal use' },
  { id: 'Individual (Motorcycles)', icon: 'two_wheeler', desc: 'Private motorcycle for personal commuting' },
  { id: 'Commercial (Motorcycles)', icon: 'moped', desc: 'Delivery, courier or corporate bikes' },
  { id: 'Commercial (Cars for Hire)', icon: 'car_rental', desc: 'Rental, leasing or corporate hire' },
  { id: 'Commercial (Small Public Buses)', icon: 'directions_bus', desc: 'Minibuses, Rosa buses and commuter shuttles' },
  { id: 'Commercial (Trucks, Horses & Trailers)', icon: 'local_shipping', desc: 'Heavy transport, logistics and haulage' },
  { id: 'Commercial (Taxis & Yangos)', icon: 'local_taxi', desc: 'Ride-hailing cabs and traditional taxis' },
];

export default function VehicleUsagePage() {
  const navigate = useNavigate();
  const { vehicleUsage, setVehicleUsage, vehicleDetails } = useStore();
  const [selected, setSelected] = useState(vehicleUsage || OPTIONS[0].id);

  const vehicleName = vehicleDetails ? `${vehicleDetails.make} ${vehicleDetails.model}${vehicleDetails.plateNumber ? ` (${vehicleDetails.plateNumber})` : ''}` : 'your vehicle';

  const continueJourney = () => {
    setVehicleUsage(selected);
    navigate('/quote-request');
  };

  return (
    <>
      <JourneyProgress current={3} />
      <main className="relative overflow-hidden">
        <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-[1120px] px-6 py-12 pb-24 lg:px-10">
          <header className="border-b border-line pb-8">
            <span className="inline-flex items-center gap-3">
              <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
              <Meta className="text-ink-muted">Step 03 · Vehicle use</Meta>
            </span>
            <h1 className="mt-6 text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-[42px]">How is the vehicle used?</h1>
            <Meta className="mt-4 inline-flex rounded-[1px] border border-dashed border-line-strong px-3 py-2 text-ink-muted">For {vehicleName}</Meta>
          </header>

          <p className="mt-8 flex gap-3 rounded-[1px] border border-primary/30 bg-primary/[0.06] p-4 text-[14px] leading-6 text-primary">
            <span className="material-symbols-outlined text-[24px] text-primary" aria-hidden="true">warning</span>
            <span>Choose the vehicle's main use. Declaring private use for a taxi, ride-hailing, delivery or other commercial vehicle <strong className="text-primary">can invalidate your policy</strong>.</span>
          </p>

          <div role="radiogroup" aria-label="Vehicle use" className="mt-8 grid gap-4 md:grid-cols-2">
            {OPTIONS.map((option) => {
              const active = selected === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelected(option.id)}
                  className={`flex min-h-[110px] items-center gap-4 rounded-[1px] border-2 bg-white p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? 'border-primary' : 'border-line hover:border-primary/50'}`}
                >
                  <span aria-hidden="true" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${active ? 'bg-primary/10 text-primary' : 'bg-canvas-2 text-ink-muted'}`}>
                    <span className="material-symbols-outlined">{option.icon}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[18px] font-semibold leading-tight">{option.id}</span>
                    <span className="mt-1 block text-[14px] text-ink-muted">{option.desc}</span>
                  </span>
                  <span aria-hidden="true" className={`h-7 w-7 shrink-0 rounded-full border-[3px] ${active ? 'border-primary' : 'border-line'}`}>
                    {active && <span className="m-1 block h-3.5 w-3.5 rounded-full bg-primary" />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-10 flex justify-end">
            <button type="button" onClick={continueJourney} className="inline-flex min-h-14 items-center gap-3 rounded-[1px] bg-primary px-10 text-[17px] font-medium text-white hover:bg-[#b91c1c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
              Continue to quote request <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
