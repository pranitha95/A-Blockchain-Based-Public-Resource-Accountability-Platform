import type { SessionUser } from '@poi/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Eye, ShieldCheck, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, FormErrorSummary } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Primitives';
import { useAuth } from '../features/auth/AuthProvider';
import { useToast } from '../features/ui/ToastProvider';
import { api } from '../lib/api';
import { fieldError } from '../lib/forms';
import { usePageTitle } from '../lib/usePageTitle';

export function RegisterPage() {
  usePageTitle('Create account');
  const { setUser } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLocalError(null);
    if (password !== confirmPassword) {
      setLocalError('The two passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const user = await api.post<SessionUser>('/auth/register', { fullName, email, password });
      queryClient.clear();
      setUser(user);
      notify('Your public observer account is ready.', 'success');
      navigate('/dashboard', { replace: true });
    } catch (registerError) {
      setError(registerError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-layout auth-layout--register">
      <section className="auth-card">
        <div className="auth-card__head">
          <span className="eyebrow">Public participation</span>
          <h1>Create a public observer account</h1>
          <p>
            Observer accounts can inspect public projects, follow audit history and verify anchored commitments.
          </p>
        </div>
        <Alert tone="info" compact>
          Self-registration creates a <strong>Public observer</strong> only. Owner and reviewer access is appointed by a
          platform administrator after the account exists.
        </Alert>
        <form className="form-stack" onSubmit={submit}>
          <FormErrorSummary error={error} />
          {localError ? <div className="form-error-summary" role="alert">{localError}</div> : null}
          <Field label="Full name" htmlFor="register-name" required error={fieldError(error, 'fullName')}>
            <input
              id="register-name"
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
              minLength={2}
              maxLength={120}
              placeholder="Your full name"
            />
          </Field>
          <Field label="Email address" htmlFor="register-email" required error={fieldError(error, 'email')}>
            <input
              id="register-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              maxLength={254}
              placeholder="you@example.org"
            />
          </Field>
          <Field
            label="Password"
            htmlFor="register-password"
            required
            hint="At least 10 characters, including a letter and a number."
            error={fieldError(error, 'password')}
          >
            <input
              id="register-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={10}
              maxLength={128}
            />
          </Field>
          <Field label="Confirm password" htmlFor="register-confirm" required error={localError ?? undefined}>
            <input
              id="register-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              maxLength={128}
            />
          </Field>
          <Button type="submit" size="lg" loading={submitting} className="button--block">
            <UserPlus size={17} aria-hidden="true" /> Create observer account
          </Button>
          <p className="form-note">
            Registration is rate-limited and stored passwords are hashed with Argon2id. The platform does not support
            public role selection.
          </p>
        </form>
        <p className="auth-card__switch">
          Already have an account? <Link to="/login">Sign in</Link>.
        </p>
      </section>

      <aside className="auth-aside">
        <span className="auth-aside__icon" aria-hidden="true"><ShieldCheck size={24} /></span>
        <h2>What an observer can do</h2>
        <ul className="role-list">
          <li><Eye size={17} aria-hidden="true" /><span>Inspect every public project, including budgets, milestones, public evidence and review outcomes.</span></li>
          <li><ShieldCheck size={17} aria-hidden="true" /><span>Read the public event trail and inspect the integrity of the append-only audit chain.</span></li>
          <li><ArrowRight size={17} aria-hidden="true" /><span>Verify a record commitment or anchor identifier without needing a wallet.</span></li>
        </ul>
        <p className="auth-aside__small">
          Observer accounts cannot submit evidence, approve claims, change project records or see restricted evidence.
          Those limits are enforced by the API, not by hidden buttons.
        </p>
      </aside>
    </div>
  );
}
