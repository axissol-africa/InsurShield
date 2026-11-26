import { InsurerReputation } from '@/features/reputation/components/InsurerReputation';
import { useState } from 'react';
import { usePublicInsurerProfile, usePublicReviews } from '../hooks/usePublicInsurerProfile';
import { reviewLabel } from '../presentation';
import { Link, useParams } from 'react-router-dom';
import { env } from '@/config/env';
import { mailtoHref, telHref } from '@/lib/contactLinks';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';

const month = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return 'Publication date unavailable';
  return new Date(`${value}-01T00:00:00+02:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Africa/Lusaka' });
};
const httpsUrl = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
};

function PublishedReviews({ insurerId }) {
  const [page, setPage] = useState(1);
  const { data: result, error, reload } = usePublicReviews(insurerId, page);
  const move = setPage;
  return <Card><CardHeader><CardTitle><h2>Verified policy purchase reviews</h2></CardTitle></CardHeader><CardContent className="space-y-4">
    {error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={reload}>Retry reviews</Button></div> : !result && <p role="status">Loading reviews…</p>}
    {result && <>
      {!result.items.length && <p>No published reviews are available.</p>}
      <ul className="space-y-4">{result.items.map((review) => <li key={review.id} className="space-y-2 border-b pb-4 last:border-0">
        <p className="font-medium">{review.rating} out of 5 stars</p><p className="text-sm text-muted-foreground">Verified policy purchase · {month(review.publishedAt)}</p>
        {review.text && <p className="whitespace-pre-wrap break-words">{review.text}</p>}
        {review.response && <div className="space-y-1 border-l-2 pl-4"><h3 className="text-sm font-semibold">Insurer response · {month(review.response.publishedAt)}</h3><p className="whitespace-pre-wrap break-words">{review.response.text}</p></div>}
      </li>)}</ul>
    </>}
    <nav aria-label="Review pages" className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={page === 1} onClick={() => move(page - 1)}>Previous reviews</Button><span role="status">Page {page}</span><Button variant="outline" disabled={!result?.hasMore || Boolean(error)} onClick={() => move(page + 1)}>Next reviews</Button></nav>
  </CardContent></Card>;
}

function Profile({ insurerId }) {
  const result = usePublicInsurerProfile(insurerId);
  const record = result.profile;
  const content = record?.profile;
  return <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
    <Button asChild variant="outline"><Link to="/insurance-type">Explore cover</Link></Button>
    {env.apiMode === 'mock' && <p role="status">Demo mode: approved public profiles and verified reviews require the connected service.</p>}
    {result.loading && <p role="status">Loading insurer profile…</p>}
    {result.error && <div role="alert"><h1 className="text-xl font-semibold">Profile unavailable</h1><p>{result.error}</p><Button onClick={result.reload}>Retry profile</Button></div>}
    {!result.loading && !result.error && !record && <><h1 className="text-2xl font-semibold">Profile not available</h1><p>This insurer does not have an approved public profile available.</p></>}
    {record && <>
      <header className="space-y-3">{httpsUrl(content.logoUrl) && <img src={httpsUrl(content.logoUrl)} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" className="h-16 w-32 object-contain object-left" />}<h1 className="break-words text-3xl font-semibold">{content.brandName}</h1><p className="text-sm text-muted-foreground">{record.name}{record.tradingName && ` · ${record.tradingName}`}</p><p className="whitespace-pre-wrap break-words">{content.description}</p></header>
      <Card><CardHeader><CardTitle><h2>Licence and service information</h2></CardTitle></CardHeader><CardContent className="space-y-3">
        <p>Insurer status: {reviewLabel(record.status)}</p><p>Licence: {record.licence.current ? 'Current' : 'Not current'}{record.licence.number && ` · ${record.licence.number}`}</p>
        {record.licence.expiresAt && <p>Licence expiry: {new Date(record.licence.expiresAt).toLocaleDateString('en-GB', { timeZone: 'Africa/Lusaka' })}</p>}
        <p className="whitespace-pre-wrap break-words">{content.serviceInformation}</p>
        {content.contactEmail && <p className="break-words">Email: {mailtoHref(content.contactEmail) ? <a className="text-primary underline" href={mailtoHref(content.contactEmail)}>{content.contactEmail}</a> : content.contactEmail}</p>}
        {content.contactPhone && <p>Phone: {telHref(content.contactPhone) ? <a className="text-primary underline" href={telHref(content.contactPhone)}>{content.contactPhone}</a> : content.contactPhone}</p>}
        {httpsUrl(content.websiteUrl) && <a className="inline-block text-primary underline" href={httpsUrl(content.websiteUrl)} target="_blank" rel="noopener noreferrer">Visit insurer website (opens in a new tab)</a>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle><h2>Available products</h2></CardTitle></CardHeader><CardContent>{record.products.length ? <ul className="space-y-2">{record.products.map((product) => <li key={product.versionId} className="break-words">{product.name} · {reviewLabel(product.coverType)}</li>)}</ul> : <p>No products are currently available.</p>}{record.productsTruncated && <p className="mt-3 text-sm text-muted-foreground">More products may be available when you explore cover.</p>}</CardContent></Card>
      <InsurerReputation insurerId={insurerId} />
      <PublishedReviews insurerId={insurerId} />
    </>}
  </div>;
}
export default function InsurerProfilePage() {
  const { insurerId } = useParams();
  return <Profile key={insurerId} insurerId={insurerId} />;
}
