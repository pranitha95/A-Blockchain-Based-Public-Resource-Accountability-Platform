import type { AnchorRecordType, AnchorSummary } from '@poi/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Blocks } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMeta } from '../../features/meta/MetaProvider';
import { useToast } from '../../features/ui/ToastProvider';
import { api, errorMessage } from '../../lib/api';
import { anchoringGapDescription } from '../../lib/chain';
import { queryKeys } from '../../lib/queryKeys';
import { Button } from '../ui/Button';

export function RecordAnchorAction({
  recordType,
  recordId,
  label = 'Prepare anchor',
  size = 'sm',
}: {
  recordType: AnchorRecordType;
  recordId: string;
  label?: string;
  size?: 'sm' | 'md';
}) {
  const { meta } = useMeta();
  const { notify } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const configured = Boolean(meta?.chain.anchoringAvailable);

  const mutation = useMutation({
    mutationFn: () => api.post<AnchorSummary>('/anchors/prepare', { recordType, recordId }),
    onSuccess: (anchor) => {
      notify('Anchor prepared. Connect an authorised wallet to submit the transaction.', 'info');
      void queryClient.invalidateQueries({ queryKey: queryKeys.anchors({}) });
      void queryClient.invalidateQueries({ queryKey: ['anchors'] });
      navigate(`/blockchain/${anchor.id}`);
    },
    onError: (error) => {
      notify(errorMessage(error), 'error');
    },
  });

  return (
    <Button
      variant="subtle"
      size={size}
      loading={mutation.isPending}
      disabled={!configured}
      title={
        configured
          ? 'Create a prepared anchor, then submit it from an authorised browser wallet'
          : `Anchoring is unavailable because ${anchoringGapDescription(meta?.chain)}`
      }
      onClick={() => mutation.mutate()}
    >
      <Blocks size={15} aria-hidden="true" />
      {configured ? label : 'Anchoring not configured'}
    </Button>
  );
}
