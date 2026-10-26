import { useEffect, useRef, useState } from 'react';
import { parsePlaygroundMarkup } from '../../core/segment/markup';
import { validateTranslation } from '../../core/validate/validate';
import {
  harvestTagged,
  looksTranslated,
  pageTranslationState,
  renderTagged,
} from '../bridges/pageTranslation';
import { TURKISH_SAMPLE } from './playgroundSample';

/**
 * Spike for ADR-015 (P1b.1): can we harvest the browser's own page translation under our CSP,
 * on desktop Chrome and Chrome for Android? Developer page, not translated into the UI languages.
 */
const SAMPLE = TURKISH_SAMPLE.split(/\n\s*\n/).map((p) => parsePlaygroundMarkup(p));

interface Row {
  id: string;
  source: string;
  translated: boolean;
  harvested: string;
  issues: string[];
}

export function TranslateTest() {
  const sheet = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState(pageTranslationState());
  const [extra, setExtra] = useState(0);
  const [copied, setCopied] = useState(false);
  const startedAt = useRef(0);
  const [firstChangeMs, setFirstChangeMs] = useState<number | null>(null);

  // The sheet is in Turkish; the rest of the app is marked translate="no".
  useEffect(() => {
    startedAt.current = performance.now();
    const html = document.documentElement;
    const previous = html.lang;
    html.lang = 'tr';
    return () => {
      html.lang = previous;
    };
  }, []);

  const scan = () => {
    const els = sheet.current ? [...sheet.current.querySelectorAll<HTMLElement>('[data-seg]')] : [];
    const next = els.map((el) => {
      const src = el.dataset.src ?? '';
      const translated = looksTranslated(el);
      const harvested = translated ? harvestTagged(el) : '';
      const issues = translated
        ? validateTranslation({
            source: src,
            target: harvested,
            sourceLang: 'tr',
            targetLang: state.htmlLang.slice(0, 2) || 'en',
          })
            .filter((i) => i.code !== 'WRONG_LANGUAGE')
            .map((i) => `${i.code}: ${i.detail}`)
        : [];
      return { id: el.dataset.seg ?? '', source: src, translated, harvested, issues };
    });
    if (firstChangeMs === null && next.some((r) => r.translated)) {
      setFirstChangeMs(Math.round(performance.now() - startedAt.current));
    }
    setRows(next);
    setState(pageTranslationState());
  };

  useEffect(() => {
    const root = sheet.current;
    if (!root) return;
    const segments = [
      ...SAMPLE,
      ...Array.from({ length: extra }, (_, i) => SAMPLE[i % SAMPLE.length]!),
    ];
    root.replaceChildren();
    segments.forEach((enc, i) => {
      const p = document.createElement('p');
      p.dataset.seg = `s${i + 1}`;
      p.dataset.src = enc.source;
      p.dataset.tags = enc.tags.map((t) => t.id).join(',');
      renderTagged(p, enc.source);
      p.className = 'mb-3';
      root.append(p);
    });
    scan();
    const observer = new MutationObserver(() => scan());
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    const attrObserver = new MutationObserver(() => setState(pageTranslationState()));
    attrObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'lang'],
    });
    return () => {
      observer.disconnect();
      attrObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only when the sheet size changes
  }, [extra]);

  const addLater = () => {
    const root = sheet.current;
    if (!root) return;
    const enc = parsePlaygroundMarkup(
      'Bu paragraf, çeviri açıldıktan **sonra** eklenmiştir ve otomatik olarak çevrilmesi beklenir [2].',
    );
    const p = document.createElement('p');
    p.dataset.seg = `late${root.childElementCount + 1}`;
    p.dataset.src = enc.source;
    p.dataset.tags = enc.tags.map((t) => t.id).join(',');
    renderTagged(p, enc.source);
    root.append(p);
  };

  const done = rows.filter((r) => r.translated).length;
  const report = JSON.stringify(
    {
      userAgent: navigator.userAgent,
      htmlLang: state.htmlLang,
      chromeTranslatedClass: state.chromeTranslated,
      firstChangeMs,
      translated: `${done}/${rows.length}`,
      issues: rows.filter((r) => r.issues.length).map((r) => ({ id: r.id, issues: r.issues })),
      samples: rows.slice(0, 6).map((r) => ({ id: r.id, harvested: r.harvested })),
    },
    null,
    2,
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        translate="no"
        className="notranslate flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm"
      >
        <h2 className="text-lg font-semibold">
          Tarayıcı çevirisi testi / Browser translation test
        </h2>
        <ol className="list-decimal pl-5">
          <li>
            <b>Masaüstü Chrome:</b> adres çubuğundaki çeviri simgesine tıkla (ya da sağ tık →
            “İngilizce’ye çevir”). Dil Türkçe’den farklı bir dile ayarlı değilse ⋮ → “Çevir…” →
            “İngilizce”.
          </li>
          <li>
            <b>Android Chrome:</b> ⋮ menü → “Çevir…” → gerekirse dil olarak “İngilizce”yi seç.
          </li>
          <li>
            Aşağıdaki sayaç artmalı. Sonra “Sonradan paragraf ekle” ve “Uzun sayfa” düğmelerini
            dene.
          </li>
          <li>“Raporu kopyala” ile sonucu bana yapıştır.</li>
        </ol>
        <p data-testid="tt-status">
          Çevrilen / translated: <b>{done}</b> / {rows.length} · html lang:{' '}
          <b>{state.htmlLang || '—'}</b> · Chrome class:{' '}
          <b>{state.chromeTranslated ? 'yes' : 'no'}</b>
          {firstChangeMs !== null && <> · ilk değişiklik {firstChangeMs} ms</>}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-slate-400 px-2 py-1"
            onClick={addLater}
          >
            Sonradan paragraf ekle
          </button>
          <button
            type="button"
            className="rounded border border-slate-400 px-2 py-1"
            onClick={() => setExtra(300)}
          >
            Uzun sayfa (300 paragraf)
          </button>
          <button
            type="button"
            className="rounded bg-blue-600 px-2 py-1 text-white"
            onClick={() => void navigator.clipboard.writeText(report).then(() => setCopied(true))}
          >
            {copied ? 'Kopyalandı ✓' : 'Raporu kopyala'}
          </button>
        </div>
      </div>

      <div
        ref={sheet}
        lang="tr"
        translate="yes"
        className="rounded-xl border border-slate-200 bg-white p-4 font-serif"
        data-testid="tt-sheet"
      />

      <details translate="no" className="notranslate text-xs">
        <summary className="cursor-pointer">Toplanan metin / harvested</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{report}</pre>
      </details>
    </div>
  );
}
