import { ErrorBoundary } from './components/ErrorBoundary';
import { WorkerStatus } from './components/WorkerStatus';

export function App() {
  return (
    <ErrorBoundary
      fallback={(reset) => (
        <div role="alert" className="mx-auto max-w-3xl p-8">
          <p>Something went wrong. Your file was not uploaded anywhere.</p>
          <button type="button" className="mt-2 underline" onClick={reset}>
            Try again
          </button>
        </div>
      )}
    >
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-3xl font-semibold">samepage</h1>
        <p className="mt-2 text-slate-600">
          Translate PDF and DOCX documents in your browser while keeping their layout.
        </p>
        <footer className="mt-8">
          <WorkerStatus />
        </footer>
      </main>
    </ErrorBoundary>
  );
}
