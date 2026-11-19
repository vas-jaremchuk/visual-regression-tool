'use client';

import { ErrorState } from '@/components/ErrorState';

export default function Error(props: { error: Error; reset: () => void }) {
  return <ErrorState {...props} />;
}
