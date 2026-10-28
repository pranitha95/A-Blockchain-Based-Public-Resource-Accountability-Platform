import { Compass, FolderKanban, SearchCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClass } from '../components/ui/Button';
import { Card, PageHeader } from '../components/ui/Layout';
import { usePageTitle } from '../lib/usePageTitle';

export function NotFoundPage() {
  usePageTitle('Page not found');
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="404 · Not found"
        title="This page does not exist"
        description="The address may be mistyped, or the record may not be visible to your account. Proof of Impact never reveals whether a restricted record exists."
      />
      <Card className="card--padded">
        <div className="not-found">
          <span className="not-found__icon" aria-hidden="true"><Compass size={30} /></span>
          <div>
            <h2>Where would you like to go?</h2>
            <p>
              Public project records, the blockchain registry and record verification are available without an account.
              Your dashboard and review queue require an authenticated session.
            </p>
            <div className="button-row">
              <Link to="/projects" className={buttonClass('primary')}>
                <FolderKanban size={16} aria-hidden="true" /> Browse projects
              </Link>
              <Link to="/verify" className={buttonClass('secondary')}>
                <SearchCheck size={16} aria-hidden="true" /> Verify a record
              </Link>
              <Link to="/" className={buttonClass('ghost')}>Return home</Link>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
