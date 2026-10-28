// samepage browser extension (P9.12): "Translate with samepage" on a PDF tab or a link to a PDF.
// The PDF is fetched here (the tab's own site through activeTab; a linked site only after the
// user grants that one site) and handed to samepage in a new tab. Nothing else is sent anywhere.
const SAMEPAGE = 'https://halilibrahimd27.github.io/samepage/';
const MAX_BYTES = 100 * 1024 * 1024; // samepage's PDF limit

const api = globalThis.browser ?? globalThis.chrome;

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: 'samepage-page',
    title: 'Translate this PDF with samepage',
    contexts: ['page', 'frame'],
  });
  api.contextMenus.create({
    id: 'samepage-link',
    title: 'Translate the linked PDF with samepage',
    contexts: ['link'],
  });
});

/** A file name from the URL ("paper.pdf"), or a default. */
function fileName(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return /\.(pdf|docx|pptx|tex)$/i.test(last) ? last : `${last || 'paper'}.pdf`;
  } catch {
    return 'paper.pdf';
  }
}

/** Base64 in chunks (a large PDF would overflow String.fromCharCode's arguments). */
function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function fetchDocument(url) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`The paper could not be downloaded (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error('The paper is larger than 100 MB.');
  return bytes;
}

/** Opens samepage and gives it the file once the page has loaded. */
async function openInSamepage(bytes, name) {
  const tab = await api.tabs.create({ url: SAMEPAGE });
  await new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tab.id && info.status === 'complete') {
        api.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    api.tabs.onUpdated.addListener(listener);
  });
  await api.scripting.executeScript({
    target: { tabId: tab.id },
    // Runs in samepage's page: the app accepts this message from its own window and origin only.
    func: (base64, fileName) =>
      window.postMessage({ type: 'samepage:file', name: fileName, base64 }, window.location.origin),
    args: [toBase64(bytes), name],
  });
}

async function notify(tabId, message) {
  try {
    await api.scripting.executeScript({
      target: { tabId },
      func: (text) => alert(text),
      args: [`samepage: ${message}`],
    });
  } catch {
    // A page the extension cannot write to (the browser's own pages): nothing more to do.
  }
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.menuItemId === 'samepage-link' ? info.linkUrl : info.frameUrl || info.pageUrl;
  if (!url || !/^https?:/.test(url)) return;
  try {
    if (info.menuItemId === 'samepage-link') {
      // Another site than the tab's: asked for that one site, at the user's click.
      const origin = `${new URL(url).origin}/*`;
      const granted = await api.permissions.request({ origins: [origin] });
      if (!granted) return;
    }
    await openInSamepage(await fetchDocument(url), fileName(url));
  } catch (error) {
    if (tab?.id !== undefined)
      await notify(tab.id, error instanceof Error ? error.message : String(error));
  }
});
