import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import JourneyProgress from '../components/JourneyProgress';

const OPTIONS = [
  { id: 'Individual', label: 'Individual', icon: 'person', desc: 'Standard private car for personal use' },
  { id: 'Individual_Motorcycles', label: 'Individual (Motorcycles)', icon: 'two_wheeler', desc: 'Private motorcycle for personal commute' },
  { id: 'Commercial_Motorcycles', label: 'Commercial (Motorcycles)', icon: 'moped', desc: 'Delivery, courier, or corporate bikes' },
  { id: 'Commercial_Cars_Hire', label: 'Commercial (Cars for Hire)', icon: 'car_rental', desc: 'Rental, leasing, or corporate hires' },
  { id: 'Commercial_Small_Buses', label: 'Commercial (Small Public Buses)', icon: 'directions_bus', desc: 'Minibuses, Rosa buses & commuter shuttles' },
  { id: 'Commercial_Trucks', label: 'Commercial (Trucks, Horses & Trailers)', icon: 'local_shipping', desc: 'Heavy transport, logistics & haulage' },
  { id: 'Commercial_Taxis', label: 'Commercial (Taxis & Yangos)', icon: 'local_taxi', desc: 'Ride-hailing cabs & traditional taxis' },
];

export default function VehicleUsagePage() {
  const navigate = useNavigate();
  const { setVehicleUsage, vehicleDetails } = useStore();
  const [selected, setSelected] = useState('Individual');
  const continueJourney = () => { const item = OPTIONS.find(option => option.id === selected); setVehicleUsage(item.label); navigate('/select-insurers'); };
  const vehicleName = vehicleDetails ? `${vehicleDetails.make} ${vehicleDetails.model} (${vehicleDetails.plateNumber})` : 'your vehicle';

  return <><JourneyProgress current={3} /><main className="min-h-[calc(100vh-80px)] bg-slate-50 px-5 py-10 sm:px-8 lg:py-16"><div className="mx-auto max-w-[1250px]"><div className="text-center"><h1 className="text-[35px] font-extrabold tracking-[-.04em] sm:text-[45px]">How do you use your vehicle?</h1><p className="mt-3 inline-flex rounded-md bg-red-100 px-4 py-2 text-[14px] font-bold text-primary">For {vehicleName}</p></div><div className="mx-auto mt-10 max-w-[1120px] rounded-xl border border-amber-300 bg-amber-50 p-5"><div className="flex gap-3"><span className="material-symbols-outlined text-[27px] text-amber-700">warning</span><p className="text-[15px] leading-6 text-amber-900"><strong className="block text-[16px] uppercase">Important legal notice</strong>Selecting standard private use for a ride-hailing, taxi, delivery, or other commercial vehicle <strong className="text-primary">can invalidate your policy.</strong> Choose the primary way this vehicle is used.</p></div></div><div className="mx-auto mt-10 grid max-w-[1120px] gap-4 md:grid-cols-2">{OPTIONS.map(option => { const active = selected === option.id; return <button key={option.id} onClick={() => setSelected(option.id)} className={`flex min-h-[118px] items-center gap-4 rounded-2xl border-2 bg-white p-5 text-left ${active ? 'border-primary' : 'border-slate-200 hover:border-primary/50'}`}><span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${active ? 'bg-primary/10 text-primary' : 'bg-slate-50 text-secondary'}`}><span className="material-symbols-outlined">{option.icon}</span></span><span className="min-w-0 flex-1"><span className="block text-[18px] font-extrabold leading-tight">{option.label}</span><span className="mt-1 block text-[14px] text-secondary">{option.desc}</span></span><span className={`h-7 w-7 shrink-0 rounded-full border-[3px] ${active ? 'border-primary' : 'border-slate-200'}`}>{active && <span className="m-1 block h-3.5 w-3.5 rounded-full bg-primary" />}</span></button>; })}</div><div className="mx-auto mt-10 flex max-w-[1120px] justify-end"><button onClick={continueJourney} className="inline-flex min-h-14 items-center gap-3 rounded-lg bg-primary px-10 text-[17px] font-bold text-white hover:bg-primary-container">Continue <span className="material-symbols-outlined">arrow_forward</span></button></div></div></main></>;
}
