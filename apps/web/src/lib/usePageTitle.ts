import { useEffect } from 'react';

export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · Proof of Impact` : 'Proof of Impact · Public Resource Accountability';
  }, [title]);
}
