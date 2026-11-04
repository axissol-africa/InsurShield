import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import { env } from '@/config/env';
import { fieldClass, labelClass } from '@/components/ui/field';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives/card';

const MIN_PASSWORD_LENGTH = 8;

/** The development-only Better Auth reset link lands here with its opaque token. */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password !== confirmPassword) return setError('The two passwords do not match.');
    setSaving(true);
    setError('');
    try {
      await api.auth.resetPassword(token, password);
      navigate('/create-account', { replace: true, state: { reset: true } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'We could not reset your password. Please request another link.');
    } finally {
      setSaving(false);
    }
  };

  if (env.apiMode !== 'http') {
    return <main className="grid min-h-full place-items-center bg-muted/60 p-4"><Card className="w-full max-w-md"><CardHeader><CardTitle>Password reset</CardTitle><CardDescription>Use the account page to reset a prototype password.</CardDescription></CardHeader><CardContent><Button asChild className="w-full"><Link to="/create-account?mode=recover">Go to account access</Link></Button></CardContent></Card></main>;
  }

  return (
    <main className="grid min-h-full place-items-center bg-muted/60 p-4 sm:p-6">
      <Card className="w-full max-w-md border-border shadow-none">
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
          <CardDescription>Use at least {MIN_PASSWORD_LENGTH} characters. This link can only be used once.</CardDescription>
        </CardHeader>
        <CardContent>
          {!token ? <p role="alert" className="text-sm text-primary">This reset link is incomplete. Request a new one from account access.</p> : (
            <form onSubmit={submit} className="space-y-5">
              <label className="block"><span className={labelClass}>New password</span><input className={fieldClass} value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" required /></label>
              <label className="block"><span className={labelClass}>Confirm new password</span><input className={fieldClass} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" required /></label>
              {error && <p role="alert" className="text-sm text-primary">{error}</p>}
              <Button type="submit" size="lg" disabled={saving} className="w-full">{saving ? 'Saving…' : 'Save new password'}</Button>
            </form>
          )}
          <Link to="/create-account" className="mt-5 block text-center text-sm font-medium text-primary hover:underline">Back to sign in</Link>
        </CardContent>
      </Card>
    </main>
  );
}
