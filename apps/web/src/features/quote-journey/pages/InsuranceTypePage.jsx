import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Minus } from 'lucide-react';
import { useStore } from '@/store';
import { cn } from '@/lib/cn';
import JourneyLayout from '@/features/quote-journey/components/JourneyLayout';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/primitives/card';
import { Label } from '@/components/ui/primitives/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/primitives/radio-group';

const COVER_MATRIX = [
  { label: 'Damage you cause to other people', Comprehensive: true, ThirdParty: true },
  { label: 'Injury you cause to other people', Comprehensive: true, ThirdParty: true },
  { label: 'Damage to your own vehicle', Comprehensive: true, ThirdParty: false },
  { label: 'Theft of your vehicle', Comprehensive: true, ThirdParty: false },
  { label: 'Fire damage', Comprehensive: true, ThirdParty: false },
];

const OPTIONS = [
  {
    id: 'Comprehensive',
    title: 'Comprehensive',
    badge: 'Recommended',
    copy: 'Covers damage to your own vehicle, theft, fire, and your liability to other people in an accident.',
  },
  {
    id: 'ThirdParty',
    title: 'Third party only',
    badge: 'Legal minimum',
    copy: 'The minimum cover required by law in Zambia. Pays for damage and injury you cause to others, not for your own vehicle.',
  },
];

export default function InsuranceTypePage() {
  const navigate = useNavigate();
  const { insuranceType, setInsuranceType } = useStore();
  const [selected, setSelected] = useState(insuranceType || 'Comprehensive');

  const continueJourney = (event) => {
    event.preventDefault();
    setInsuranceType(selected);
    navigate('/vehicle-identification');
  };

  return (
    <JourneyLayout
      step={1}
      title="Choose your cover"
      description="Explore as a guest. An account is only needed when you send your request to insurers."
    >
        <form onSubmit={continueJourney} className="space-y-6">
          <RadioGroup
            value={selected}
            onValueChange={setSelected}
            aria-label="Coverage type"
            className="gap-4 sm:grid-cols-2"
          >
            {OPTIONS.map((option) => (
              <Card
                key={option.id}
                className={cn(
                  'relative gap-5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                  selected === option.id ? 'bg-primary/5 ring-primary' : 'hover:ring-foreground/25',
                )}
              >
                <CardHeader className="gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant="secondary">{option.badge}</Badge>
                    <RadioGroupItem
                      id={option.id}
                      value={option.id}
                      aria-describedby={`${option.id}-description`}
                      className="relative z-10 size-5 data-[state=checked]:border-primary data-[state=checked]:bg-primary"
                    />
                  </div>
                  <h2>
                    <Label
                      htmlFor={option.id}
                      className="cursor-pointer text-xl font-semibold leading-tight after:absolute after:inset-0 sm:text-2xl"
                    >
                      {option.title}
                    </Label>
                  </h2>
                  <CardDescription id={`${option.id}-description`} className="leading-relaxed">
                    {option.copy}
                  </CardDescription>
                </CardHeader>
                <CardContent className="mt-auto">
                  <ul className="space-y-3 border-t border-border pt-5" aria-label={`${option.title} coverage`}>
                    {COVER_MATRIX.map((row) => {
                      const included = row[option.id];
                      const Icon = included ? Check : Minus;
                      return (
                        <li key={row.label} className="flex items-start gap-3 text-sm leading-snug">
                          <Icon
                            aria-hidden="true"
                            className={cn('mt-0.5 size-4 shrink-0', included ? 'text-primary' : 'text-muted-foreground')}
                          />
                          <span className={included ? 'text-foreground' : 'text-muted-foreground'}>
                            {row.label}
                            <span className="sr-only">{included ? ': included' : ': not included'}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </RadioGroup>

          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Your choice goes to every insurer in the same request. Review the prices and cover
            details before choosing a policy.
          </p>

          <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-between">
            <Button asChild variant="ghost" className="min-h-11">
              <Link to="/"><ArrowLeft aria-hidden="true" />Back</Link>
            </Button>
            <Button type="submit" size="lg" className="min-h-11 sm:min-w-40">
              Continue<ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </form>
    </JourneyLayout>
  );
}
