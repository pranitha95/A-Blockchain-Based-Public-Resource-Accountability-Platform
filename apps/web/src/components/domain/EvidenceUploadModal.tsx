import type { EvidenceView } from '@poi/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { useToast } from '../../features/ui/ToastProvider';
import { api, errorMessage } from '../../lib/api';
import { fieldError } from '../../lib/forms';
import { queryKeys } from '../../lib/queryKeys';
import { Button } from '../ui/Button';
import { FormErrorSummary } from '../ui/Feedback';
import { Field, SelectField } from '../ui/Primitives';
import { Modal } from '../ui/Modal';

export function EvidenceUploadModal({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const formId = useId();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'RESTRICTED'>('PUBLIC');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<unknown>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a PDF, PNG, JPEG or WebP file to upload.');
      const data = new FormData();
      data.append('file', file);
      data.append('title', title);
      if (description.trim()) data.append('description', description);
      data.append('visibility', visibility);
      return api.postForm<EvidenceView>(`/projects/${projectId}/evidence`, data);
    },
    onSuccess: (evidence) => {
      notify(`“${evidence.title}” was uploaded and hashed.`, 'success');
      void queryClient.invalidateQueries({ queryKey: queryKeys.evidence(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.audit({ projectId }) });
      setTitle('');
      setDescription('');
      setVisibility('PUBLIC');
      setFile(null);
      setError(null);
      onClose();
    },
    onError: (uploadError) => {
      setError(uploadError);
      notify(errorMessage(uploadError), 'error');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
      title="Upload evidence"
      description="Files are inspected by content, stored under randomised names and accompanied by a SHA-256 checksum."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button type="submit" form={formId} loading={mutation.isPending}>
            <FileUp size={16} aria-hidden="true" /> Upload evidence
          </Button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={submit}>
        <FormErrorSummary error={error} />
        <Field label="Evidence title" htmlFor="evidence-title" required error={fieldError(error, 'title')}>
          <input
            id="evidence-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
            minLength={3}
            required
            placeholder="e.g. Completion photographs, March 2026"
          />
        </Field>
        <Field
          label="Description"
          htmlFor="evidence-description"
          hint="Optional context for public or restricted readers."
          error={fieldError(error, 'description')}
        >
          <textarea
            id="evidence-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            maxLength={2000}
          />
        </Field>
        <SelectField
          id="evidence-visibility"
          label="Visibility"
          value={visibility}
          onChange={(value) => setVisibility(value as 'PUBLIC' | 'RESTRICTED')}
          options={[
            { value: 'PUBLIC', label: 'Public — downloadable by anyone who can view the project' },
            { value: 'RESTRICTED', label: 'Restricted — project participants only' },
          ]}
          hint="Restricted files and their audit entries are withheld from public viewers."
          required
          error={fieldError(error, 'visibility')}
        />
        <Field
          label="File"
          htmlFor="evidence-file"
          required
          hint="PDF, PNG, JPEG or WebP. Maximum 10 MB. The file signature is checked, not only its extension."
          error={fieldError(error, 'file')}
        >
          <input
            id="evidence-file"
            type="file"
            accept=".pdf,image/png,image/jpeg,image/webp"
            required
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        <p className="form-note">
          Uploaded files are evidence records, not declarations of truth. The platform verifies format and integrity,
          not whether a document is authentic.
        </p>
      </form>
    </Modal>
  );
}
