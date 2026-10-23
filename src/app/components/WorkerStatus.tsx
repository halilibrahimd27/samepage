import { useEffect, useState } from 'react';
import { WorkerFailedError } from '../../core/pipeline/workerClient';
import { useI18n } from '../i18n';
import { pipelineClient } from '../pipelineClient';

type Status = { state: 'checking' } | { state: 'ready' } | { state: 'failed'; timeout: boolean };

export function WorkerStatus() {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>({ state: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    pipelineClient
      .call((api) => api.ping())
      .then(
        () => active && setStatus({ state: 'ready' }),
        (error: unknown) =>
          active &&
          setStatus({
            state: 'failed',
            timeout: error instanceof WorkerFailedError && error.kind === 'timeout',
          }),
      );
    return () => {
      active = false;
    };
  }, [attempt]);

  if (status.state === 'failed') {
    return (
      <div
        role="alert"
        className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
      >
        {t(status.timeout ? 'error.workerTimeout' : 'error.workerCrash')}{' '}
        <button
          type="button"
          className="font-medium underline"
          onClick={() => {
            setStatus({ state: 'checking' });
            setAttempt((n) => n + 1);
          }}
        >
          {t('error.restart')}
        </button>
      </div>
    );
  }
  return (
    <p className="text-xs text-slate-500" data-testid="worker-status" data-state={status.state}>
      {t(status.state === 'ready' ? 'worker.ready' : 'worker.starting')}
    </p>
  );
}
