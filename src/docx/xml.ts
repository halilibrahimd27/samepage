import { DOMParser, XMLSerializer, type Document as XDocument } from '@xmldom/xmldom';

/** Hardened XML parsing (SECURITY.md §3): DOCTYPEs are stripped, so no entity can be resolved. */
export function parseXml(text: string): XDocument {
  const withoutDoctype = text.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, '');
  return new DOMParser({
    onError: (level, msg) => {
      if (level === 'fatalError') throw new Error(`XML parse error: ${msg}`);
    },
  }).parseFromString(withoutDoctype, 'text/xml');
}

export function serializeXml(doc: XDocument): string {
  return new XMLSerializer().serializeToString(doc);
}

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  dc: 'http://purl.org/dc/elements/1.1/',
  xml: 'http://www.w3.org/XML/1998/namespace',
} as const;
