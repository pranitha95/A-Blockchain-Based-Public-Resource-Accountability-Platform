import type { SessionUser } from '@poi/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, KeyRound, LockKeyhole, ShieldCheck, UserCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, FormErrorSummary } from '../components/ui/Feedback';
import { buttonClass, Button } from '../components/ui/Button';
import { Field } from '../components/ui/Primitives';
import { useAuth } from '../features/auth/AuthProvider';
import { useMeta } from '../features/meta/MetaProvider';
import { useToast } from '../features/ui/ToastProvider';
import { api } from '../lib/api';
import { fieldError } from '../lib/forms';
import { isSafeInternalPath } from '../lib/format';
import { usePageTitle } from '../lib/usePageTitle';

export function LoginPage() {
  usePageTitle('Sign in');
  const { setUser } = useAuth();
  const { meta } = useMeta();
  const { notify } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await api.post<SessionUser>('/auth/login', { email, password });
      queryClient.clear();
      setUser(user);
      notify(`Signed in as ${user.fullName}.`, 'success');
      const from = (location.state as { from?: string } | null)?.from;
      navigate(isSafeInternalPath(from) ? from : '/dashboard', { replace: true });
    } catch (loginError) {
      setError(loginError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-layout">
      <section className="auth-card">
        <div className="auth-card__head">
          <span className="eyebrow">Account access</span>
          <h1>Sign in to Proof of Impact</h1>
          <p>Your role is determined by the platform account, never by a browser selection.</p>
        </div>
        <form className="form-stack" onSubmit={submit}>
          <FormErrorSummary error={error} />
          <Field label="Email address" htmlFor="login-email" required error={fieldError(error, 'email')}>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              placeholder="you@example.org"
            />
          </Field>
          <Field label="Password" htmlFor="login-password" required error={fieldError(error, 'password')}>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              maxLength={128}
            />
          </Field>
          <Button type="submit" size="lg" loading={submitting} className="button--block">
            Sign in <ArrowRight size={17} aria-hidden="true" />
          </Button>
          <p className="form-note">
            This build has no self-service password reset. Existing credentials cannot be reset through the current
            administration API; contact the platform operator if you lose access.
          </p>
        </form>
        <p className="auth-card__switch">
          New to the platform? <Link to="/register">Create a public observer account</Link>.
        </p>
        {meta?.platform.demoMode ? (
          <Alert tone="info" compact title="This is a demonstration environment">
            Seeded accounts are labelled as demonstration records. Their credentials are provided through the local
            setup notes; the application does not display or store plaintext passwords.
          </Alert>
        ) : null}
      </section>

      <aside className="auth-aside">
        <span className="auth-aside__icon" aria-hidden="true"><ShieldCheck size={24} /></span>
        <h2>One account, a server-verified role</h2>
        <p>
          Sessions are opaque and stored server-side. Role checks happen on every protected endpoint, so changing a
          value in the browser does not grant any authority.
        </p>
        <ul className="role-list">
          <li><UserCheck size={17} aria-hidden="true" /><span><strong>Public observer</strong> — inspect public records and verify commitments.</span></li>
          <li><KeyRound size={17} aria-hidden="true" /><span><strong>Project owner</strong> — maintain owned projects, submit evidence and claims.</span></li>
          <li><ShieldCheck size={17} aria-hidden="true" /><span><strong>Independent reviewer</strong> — decide records only on assigned projects.</span></li>
          <li><LockKeyhole size={17} aria-hidden="true" /><span><strong>Administrator</strong> — manage users, projects, reviewers and settings.</span></li>
        </ul>
        <div className="auth-aside__foot">
          <Link to="/projects" className={buttonClass('ghost', 'sm')}>Continue as a public reader <ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
      </aside>
    </div>
  );
}
