// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIncomingFiles } from '../../src/app/incomingFiles';

type Consumer = (params: { files: unknown[] }) => void;

/** An installed app's launch queue: returns what launches the app with these handles. */
function fakeLaunchQueue() {
  let consumer: Consumer | undefined;
  Object.defineProperty(window, 'launchQueue', {
    configurable: true,
    value: { setConsumer: (c: Consumer) => (consumer = c) },
  });
  return (files: unknown[]) => consumer!({ files });
}

const handle = (file: File) => ({
  kind: 'file',
  name: file.name,
  getFile: () => Promise.resolve(file),
});

afterEach(() => {
  Reflect.deleteProperty(window, 'launchQueue');
  window.history.replaceState(null, '', '/');
});

describe('useIncomingFiles', () => {
  it('opens the files the installed app is launched with, in their order', async () => {
    const launch = fakeLaunchQueue();
    const onFiles = vi.fn();
    renderHook(() => useIncomingFiles(onFiles));
    const a = new File(['%PDF-'], 'a.pdf');
    const b = new File(['%PDF-'], 'b.pdf');
    launch([handle(a), { kind: 'directory', name: 'folder' }, handle(b)]);
    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([a, b], false));
  });

  it('reports a file the system would not hand over and opens the others', async () => {
    const launch = fakeLaunchQueue();
    const onFiles = vi.fn();
    renderHook(() => useIncomingFiles(onFiles));
    const a = new File(['%PDF-'], 'a.pdf');
    const denied = { kind: 'file', name: 'b.pdf', getFile: () => Promise.reject(new Error('no')) };
    launch([handle(a), denied]);
    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([a], true));
  });

  it('does nothing when the app starts without files', async () => {
    const launch = fakeLaunchQueue();
    const onFiles = vi.fn();
    renderHook(() => useIncomingFiles(onFiles));
    launch([]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('a share marker without kept files is reported and removed from the address', async () => {
    window.history.replaceState(null, '', '/samepage/?share=mh2x9k3c-1f3a9b2c#quality');
    const onFiles = vi.fn();
    renderHook(() => useIncomingFiles(onFiles));
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/samepage/#quality',
    );
    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([], true));
  });
});
