import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, TriangleAlert } from 'lucide-react';
import { useStore } from '@/store';
import { cn } from '@/lib/cn';
import JourneyLayout from '@/features/quote-journey/components/JourneyLayout';
import { Alert, AlertDescription } from '@/components/ui/primitives/alert';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent } from '@/components/ui/primitives/card';
import { Label } from '@/components/ui/primitives/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/primitives/radio-group';

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

  const continueJourney = (event) => {
    event.preventDefault();
    setVehicleUsage(selected);
    navigate('/quote-request');
  };

  return (
    <JourneyLayout step={3} title="How is the vehicle used?" description={`Choose the main use for ${vehicleName}.`}>
      <Alert role="note" className="mb-6 border-primary/20 bg-primary/5">
        <TriangleAlert aria-hidden="true" className="text-primary" />
        <AlertDescription className="text-foreground">
          Declaring private use for a taxi, ride-hailing, delivery or other commercial vehicle <strong>can invalidate your policy</strong>.
        </AlertDescription>
      </Alert>
      <form onSubmit={continueJourney} className="space-y-6">
        <RadioGroup value={selected} onValueChange={setSelected} aria-label="Vehicle use" className="gap-3 md:grid-cols-2">
          {OPTIONS.map((option, index) => (
            <Card key={option.id} size="sm" className={cn('relative has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', selected === option.id ? 'bg-primary/5 ring-primary' : 'hover:ring-foreground/25')}>
              <CardContent className="flex items-start gap-3">
                <span className="material-symbols-outlined mt-0.5 text-primary" aria-hidden="true">{option.icon}</span>
                <div className="min-w-0 flex-1 space-y-2">
                  <Label htmlFor={`usage-${index}`} className="cursor-pointer text-base leading-snug after:absolute after:inset-0">{option.id}</Label>
                  <p id={`usage-description-${index}`} className="text-sm leading-relaxed text-muted-foreground">{option.desc}</p>
                </div>
                <RadioGroupItem id={`usage-${index}`} value={option.id} aria-describedby={`usage-description-${index}`} className="relative z-10 mt-0.5 size-5 data-[state=checked]:border-primary data-[state=checked]:bg-primary" />
              </CardContent>
            </Card>
          ))}
        </RadioGroup>
        <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-between">
          <Button asChild variant="ghost" className="min-h-11"><Link to="/vehicle-identification"><ArrowLeft aria-hidden="true" />Back</Link></Button>
          <Button type="submit" size="lg" className="min-h-11">Continue to quote request<ArrowRight aria-hidden="true" /></Button>
        </div>
      </form>
    </JourneyLayout>
  );
}
