import { useEffect, useState } from 'react';
import { WorkerFailedError } from '../../core/pipeline/workerClient';
import { pipelineClient } from '../pipelineClient';

type Status = { state: 'checking' } | { state: 'ready' } | { state: 'failed'; reason: string };

function failureReason(error: unknown): string {
  return error instanceof WorkerFailedError && error.kind === 'timeout'
    ? 'The processing engine stopped responding.'
    : 'The processing engine crashed.';
}

export function WorkerStatus() {
  const [status, setStatus] = useState<Status>({ state: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    pipelineClient
      .call((api) => api.ping())
      .then(
        () => active && setStatus({ state: 'ready' }),
        (error: unknown) => active && setStatus({ state: 'failed', reason: failureReason(error) }),
      );
    return () => {
      active = false;
    };
  }, [attempt]);

  const restart = () => {
    setStatus({ state: 'checking' });
    setAttempt((n) => n + 1);
  };

  if (status.state === 'failed') {
    return (
      <div
        role="alert"
        className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
      >
        {status.reason}{' '}
        <button type="button" className="font-medium underline" onClick={restart}>
          Restart engine
        </button>
      </div>
    );
  }
  return (
    <p className="text-xs text-slate-500" data-testid="worker-status" data-state={status.state}>
      {status.state === 'ready' ? 'Processing engine ready' : 'Starting processing engine…'}
    </p>
  );
}
