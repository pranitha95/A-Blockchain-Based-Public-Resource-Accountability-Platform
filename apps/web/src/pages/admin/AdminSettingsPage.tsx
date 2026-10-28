import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Blocks,
  CheckCircle2,
  FileText,
  FolderKanban,
  Info,
  Save,
  ShieldCheck,
  TestTube2,
  Undo2,
} from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { AdminTabs } from '../../components/domain/AdminTabs';
import { Button } from '../../components/ui/Button';
import { Alert, ErrorState, FormErrorSummary, LoadingCard } from '../../components/ui/Feedback';
import { Card, DetailGrid, DetailItem, PageHeader, SectionHeading } from '../../components/ui/Layout';
import { Field } from '../../components/ui/Primitives';
import { useMeta } from '../../features/meta/MetaProvider';
import { useToast } from '../../features/ui/ToastProvider';
import { api } from '../../lib/api';
import { fieldError } from '../../lib/forms';
import { queryKeys } from '../../lib/queryKeys';
import { usePageTitle } from '../../lib/usePageTitle';

interface AdminPlatformSettings {
  publicDirectoryEnabled: boolean;
  showDemoData: boolean;
  reportFooterNote: string;
}

export function AdminSettingsPage() {
  usePageTitle('Platform settings');
  const { meta } = useMeta();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const formId = useId();

  const settingsQuery = useQuery({
    queryKey: queryKeys.adminSettings,
    queryFn: () => api.get<AdminPlatformSettings>('/admin/settings'),
  });

  const [publicDirectoryEnabled, setPublicDirectoryEnabled] = useState(true);
  const [showDemoData, setShowDemoData] = useState(true);
  const [reportFooterNote, setReportFooterNote] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!settingsQuery.data) return;
    setPublicDirectoryEnabled(settingsQuery.data.publicDirectoryEnabled);
    setShowDemoData(settingsQuery.data.showDemoData);
    setReportFooterNote(settingsQuery.data.reportFooterNote);
  }, [settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: () =>
      api.patch<AdminPlatformSettings>('/admin/settings', {
        publicDirectoryEnabled,
        showDemoData,
        reportFooterNote,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.adminSettings, saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.meta });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      setError(null);
      notify('Platform settings saved and recorded in the audit chain.', 'success');
    },
    onError: setError,
  });

  if (settingsQuery.isLoading) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Administration" title="Platform settings" />
        <AdminTabs />
        <LoadingCard label="Loading platform settings…" />
      </div>
    );
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Administration" title="Platform settings" />
        <AdminTabs />
        <ErrorState
          error={settingsQuery.error}
          title="Platform settings could not be loaded"
          action={<Button size="sm" variant="secondary" onClick={() => void settingsQuery.refetch()}>Try again</Button>}
        />
      </div>
    );
  }

  const saved = settingsQuery.data;
  const dirty =
    publicDirectoryEnabled !== saved.publicDirectoryEnabled ||
    showDemoData !== saved.showDemoData ||
    reportFooterNote !== saved.reportFooterNote;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Administration"
        title="Platform settings"
        description="Operational switches for the public directory, demonstration labelling and generated-report text. Changes are recorded in the append-only audit chain."
      />
      <AdminTabs />

      <Alert tone="warning" title="These settings do not change historical records">
        Settings affect how the platform presents and gates information from now on. They never rewrite audit events,
        reports, review decisions or blockchain commitments that already exist.
      </Alert>

      <form
        id={formId}
        className="two-column two-column--wide-left"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        <div className="page-stack">
          <FormErrorSummary error={error} />
          <Card>
            <SectionHeading
              title="Public project directory"
              description="Controls whether unauthenticated visitors and public observer accounts can list public projects."
              action={<SettingState enabled={publicDirectoryEnabled} />}
            />
            <label className="setting-toggle">
              <input
                type="checkbox"
                checked={publicDirectoryEnabled}
                onChange={(event) => setPublicDirectoryEnabled(event.target.checked)}
              />
              <span className="setting-toggle__track" aria-hidden="true"><span /></span>
              <span className="setting-toggle__text">
                <strong>Public directory is {publicDirectoryEnabled ? 'enabled' : 'disabled'}</strong>
                <small>
                  {publicDirectoryEnabled
                    ? 'Visitors without an account can browse the public project list.'
                    : 'The project list returns not found for signed-out visitors and observer accounts.'}
                </small>
              </span>
            </label>
            <Alert tone="info" compact>
              In this build the switch gates the project list only. A direct project detail link is still served when the
              project itself is marked public. Project visibility and status remain the authoritative access controls
              for individual records.
            </Alert>
          </Card>

          <Card>
            <SectionHeading
              title="Demonstration labelling"
              description="Controls the visible demonstration banner and the demonstration flag in statistics."
              action={<SettingState enabled={showDemoData} />}
            />
            <label className="setting-toggle">
              <input
                type="checkbox"
                checked={showDemoData}
                onChange={(event) => setShowDemoData(event.target.checked)}
              />
              <span className="setting-toggle__track" aria-hidden="true"><span /></span>
              <span className="setting-toggle__text">
                <strong>Demonstration notices are {showDemoData ? 'visible' : 'suppressed'}</strong>
                <small>
                  {showDemoData
                    ? 'Signed-in demo users see a banner and statistics report demonstration mode.'
                    : 'The banner and demo-mode flag are suppressed; records still exist unchanged.'}
                </small>
              </span>
            </label>
            <Alert tone="warning" compact>
              This switch does not delete, hide or relabel demonstration records. It suppresses presentation only.
              Disabling it does not make demonstration data real, and re-enabling it does not create data.
            </Alert>
          </Card>

          <Card>
            <SectionHeading
              title="Generated report footer"
              description="Included in the frozen snapshot of reports generated after this setting is saved."
            />
            <Field
              label="Footer note"
              htmlFor="report-footer"
              hint={`${reportFooterNote.length} of 500 characters. Existing reports keep the note they were generated with.`}
              error={fieldError(error, 'reportFooterNote')}
            >
              <textarea
                id="report-footer"
                rows={5}
                value={reportFooterNote}
                onChange={(event) => setReportFooterNote(event.target.value)}
                maxLength={500}
              />
            </Field>
            <div className="report-footer-preview">
              <span><FileText size={14} aria-hidden="true" /> Preview</span>
              <p>{reportFooterNote || 'No footer note will be stored in new report snapshots.'}</p>
            </div>
          </Card>

          <div className={`settings-savebar${dirty ? ' settings-savebar--dirty' : ''}`}>
            <div>
              <strong>{dirty ? 'Unsaved changes' : 'All changes saved'}</strong>
              <span>{dirty ? 'Saving writes an audit event.' : 'This page reflects the stored platform settings.'}</span>
            </div>
            <div className="button-row button-row--compact">
              <Button
                type="button"
                variant="secondary"
                disabled={!dirty || mutation.isPending}
                onClick={() => {
                  setPublicDirectoryEnabled(saved.publicDirectoryEnabled);
                  setShowDemoData(saved.showDemoData);
                  setReportFooterNote(saved.reportFooterNote);
                  setError(null);
                }}
              >
                <Undo2 size={15} aria-hidden="true" /> Reset
              </Button>
              <Button type="submit" loading={mutation.isPending} disabled={!dirty}>
                <Save size={15} aria-hidden="true" /> Save settings
              </Button>
            </div>
          </div>
        </div>

        <div className="page-stack">
          <Card>
            <SectionHeading title="Deployment context" description="Read-only values from the running environment. They are not changed by this form." />
            <DetailGrid>
              <DetailItem label="Runtime demo mode"><SettingState enabled={Boolean(meta?.platform.demoMode)} offLabel="Off" onLabel="On" /></DetailItem>
              <DetailItem label="Demo notices visible">{
                meta?.platform.showDemoData && meta?.platform.demoMode ? 'Yes' : 'No'
              }</DetailItem>
              <DetailItem label="Network">{meta ? `${meta.chain.chainName} (${meta.chain.chainId})` : '—'}</DetailItem>
              <DetailItem label="Anchoring available"><SettingState enabled={Boolean(meta?.chain.anchoringAvailable)} offLabel="No" onLabel="Yes" /></DetailItem>
              <DetailItem label="API version">{meta?.apiVersion ?? '—'}</DetailItem>
            </DetailGrid>
            <p className="muted-note">
              Chain configuration and runtime demo mode come from server environment variables. They are intentionally
              not editable from the browser.
            </p>
          </Card>

          <Card>
            <SectionHeading title="What administrators cannot do" />
            <ul className="trail-links">
              <li><ShieldCheck size={15} aria-hidden="true" />Administrators cannot approve their own claims or act as an independent reviewer.</li>
              <li><FolderKanban size={15} aria-hidden="true" />This form does not bypass project ownership or reviewer-independence checks.</li>
              <li><Blocks size={15} aria-hidden="true" />This form cannot fabricate anchors, confirmations or contract state.</li>
              <li><TestTube2 size={15} aria-hidden="true" />The demonstration flag does not convert demonstration records into real data.</li>
            </ul>
          </Card>

          <Card>
            <SectionHeading title="Audit visibility" />
            <p>
              Each save appends an event with the changed keys and values. The append-only audit chain records the action
              even if a setting is later changed back.
            </p>
            <p className="muted-note">
              Audit integrity can be checked from the project activity views or the public audit endpoint. A valid chain
              demonstrates internal consistency, not independent truth.
            </p>
          </Card>
        </div>
      </form>
    </div>
  );
}

function SettingState({
  enabled,
  onLabel = 'Enabled',
  offLabel = 'Disabled',
}: {
  enabled: boolean;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <span className={`setting-state${enabled ? ' setting-state--on' : ' setting-state--off'}`}>
      {enabled ? <CheckCircle2 size={13} aria-hidden="true" /> : <Info size={13} aria-hidden="true" />}
      {enabled ? onLabel : offLabel}
    </span>
  );
}
