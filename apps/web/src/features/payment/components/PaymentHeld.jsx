import { Link } from 'react-router-dom';
import JourneyLayout from '@/features/quote-journey/components/JourneyLayout';
import { Card, CardContent } from '@/components/ui/primitives/card';
import { Button } from '@/components/ui/primitives/button';
import { formatZMW } from '@/domain/premiumEngine';

export default function PaymentHeld({ receipt }) {
  return <JourneyLayout step={6} title="Payment held — awaiting resolution" description="Your payment was received, but the server has not created a policy. Do not pay again while this is being resolved.">
    <Card><CardContent className="space-y-4 pt-6">
      <p role="status">Policy creation is awaiting resolution. This is not confirmation of insurance cover.</p>
      <p>Payment reference: {receipt.transactionId}</p>
      <p>Amount received: {formatZMW(receipt.amount)}</p>
      <Button asChild variant="outline"><Link to="/account">Go to my account</Link></Button>
      <Button asChild variant="outline"><Link to="/support">Contact support</Link></Button>
    </CardContent></Card>
  </JourneyLayout>;
}
