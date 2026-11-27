import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/primitives/button';

const journeys = [
  ['Start a new quote', '/insurance-type', 'Prepare your vehicle details, compare cover guides and request insurer quotes.'],
  ['Recover a request', '/account?section=quotes', 'Sign in with the account you used to find a saved request and its next step.'],
  ['Renew a policy', '/renewal', 'Select an existing policy, review its details and compare current cover.'],
  ['Start a claim', '/claims?action=claim', 'Prepare your policy and incident details to receive a claim reference.'],
  ['Apply for NCD', '/claims?action=ncd', 'Provide your policy and claim-free history for insurer verification.'],
  ['Request an inspection', '/inspections', 'Prepare vehicle, location and contact details to arrange an assessment.'],
  ['Contact an insurer', '/support', 'Find contact details; keep your policy or claim reference handy.'],
];

export default function CustomerJourneyLinks() {
  return (
    <nav aria-label="Customer journeys" className="border-b border-line bg-canvas">
      <div className="mx-auto max-w-[1200px] px-6 py-10 lg:px-10">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">What would you like to do?</h2>
        <p className="mt-2 text-sm text-ink-muted">You can explore cover and insurer contacts without signing in. Your saved records require a verified account.</p>
        <ul className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {journeys.map(([label, path, description]) => (
            <li key={path} className="min-w-0">
              <Button asChild variant="link" className="h-auto min-h-11 max-w-full justify-start whitespace-normal px-0 text-left text-base">
                <Link to={path}>{label}</Link>
              </Button>
              <p className="text-sm leading-6 text-ink-muted">{description}</p>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
