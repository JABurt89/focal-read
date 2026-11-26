/**
 * Client-side document parsers for Plain Text / Markdown, PDF, and EPUB.
 * All parsing happens 100% locally in the browser (zero server uploads).
 */

import { tokenizeText } from './orp.js';

/**
 * Build a unified reader document object from structured sections.
 *
 * @param {object} params
 * @param {string} params.title
 * @param {string} [params.author]
 * @param {string} params.sourceType - 'text' | 'txt' | 'pdf' | 'epub'
 * @param {Array<{ title: string, text: string }>} params.sections
 */
export function buildDocument({ title, author = '', sourceType = 'text', sections }) {
  const allTokens = [];
  const resolvedSections = [];
  let paragraphOffset = 0;

  for (const sec of sections) {
    const sectionTokens = tokenizeText(sec.text);
    if (sectionTokens.length === 0) continue;

    const startIndex = allTokens.length;
    let maxLocalParagraph = 0;

    for (const tok of sectionTokens) {
      if (tok.paragraphIndex > maxLocalParagraph) {
        maxLocalParagraph = tok.paragraphIndex;
      }
      allTokens.push({
        ...tok,
        paragraphIndex: tok.paragraphIndex + paragraphOffset,
      });
    }

    paragraphOffset += maxLocalParagraph + 1;
    resolvedSections.push({
      title: sec.title || `Section ${resolvedSections.length + 1}`,
      startIndex,
      wordCount: sectionTokens.length,
    });
  }

  return {
    id: computeFingerprint(title, allTokens),
    title: title || 'Untitled Document',
    author,
    sourceType,
    tokens: allTokens,
    sections: resolvedSections,
  };
}

function computeFingerprint(title, tokens) {
  const sample = `${title}|${tokens.length}|${tokens.slice(0, 8).map((t) => t.text).join(' ')}`;
  let hash = 2166136261;
  for (let i = 0; i < sample.length; i++) {
    hash ^= sample.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `doc_${(hash >>> 0).toString(36)}`;
}

/**
 * Parse plain text or Markdown into a reader document, extracting Markdown headings as sections.
 */
export function parsePlainText(text, title = 'Pasted Text', sourceType = 'text', author = '') {
  const cleaned = (text || '').replace(/\r\n?/g, '\n').trim();
  if (!cleaned) {
    throw new Error('No readable text found.');
  }

  // Detect Markdown headings (`# Heading`) to offer section jumps
  const lines = cleaned.split('\n');
  const sections = [];
  let currentTitle = title;
  let buffer = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch && buffer.join('\n').trim().length > 0) {
      sections.push({ title: currentTitle, text: buffer.join('\n') });
      currentTitle = headingMatch[1].trim();
      buffer = [currentTitle];
    } else if (headingMatch && sections.length === 0 && buffer.length === 0) {
      currentTitle = headingMatch[1].trim();
      buffer.push(currentTitle);
    } else {
      buffer.push(line);
    }
  }

  if (buffer.join('\n').trim().length > 0) {
    sections.push({ title: currentTitle, text: buffer.join('\n') });
  }

  if (sections.length === 0) {
    sections.push({ title, text: cleaned });
  }

  return buildDocument({ title, author, sourceType, sections });
}

/**
 * Dynamically load the self-hosted pdf.js module and configure its same-origin worker.
 */
let pdfjsPromise = null;
async function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfUrl = new URL('../vendor/pdf.min.mjs', import.meta.url).href;
      const workerUrl = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      const pdfjsLib = await import(pdfUrl);
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

/**
 * Reconstruct clean paragraphs from a pdf.js `textContent.items` array.
 */
export function extractPdfPageText(items) {
  if (!items || items.length === 0) return '';

  const lines = [];
  let currentLine = '';
  let lastY = null;
  let lastHeight = 12;

  for (const item of items) {
    const str = item.str;
    if (typeof str !== 'string') continue;

    const transform = item.transform || [1, 0, 0, 12, 0, 0];
    const y = transform[5];
    const height = Math.abs(transform[3]) || item.height || 12;

    if (lastY !== null && Math.abs(y - lastY) > Math.max(height, lastHeight) * 0.6) {
      const gap = Math.abs(y - lastY);
      lines.push({
        text: currentLine.trim(),
        isParagraphBreak: gap > Math.max(height, lastHeight) * 1.65,
      });
      currentLine = '';
    }

    if (str.length > 0) {
      if (currentLine && !currentLine.endsWith(' ') && !currentLine.endsWith('-') && !str.startsWith(' ')) {
        currentLine += ' ';
      }
      currentLine += str;
    }

    if (item.hasEOL) {
      lines.push({ text: currentLine.trim(), isParagraphBreak: false });
      currentLine = '';
      lastY = null;
    } else {
      lastY = y;
      lastHeight = height;
    }
  }

  if (currentLine.trim()) {
    lines.push({ text: currentLine.trim(), isParagraphBreak: false });
  }

  // Merge wrapped lines into paragraphs and rejoin end-of-line hyphenation
  const paragraphs = [];
  let para = '';

  for (const line of lines) {
    if (!line.text) {
      if (para.trim()) {
        paragraphs.push(para.trim());
        para = '';
      }
      continue;
    }

    if (para.endsWith('-') && /^[a-z]/.test(line.text)) {
      para = para.slice(0, -1) + line.text;
    } else {
      para = para ? `${para} ${line.text}` : line.text;
    }

    if (line.isParagraphBreak) {
      paragraphs.push(para.trim());
      para = '';
    }
  }

  if (para.trim()) {
    paragraphs.push(para.trim());
  }

  return paragraphs.join('\n\n');
}

/**
 * Parse a PDF ArrayBuffer completely client-side using pdf.js.
 */
export async function parsePdfFile(arrayBuffer, fileName = 'Document.pdf', onProgress = () => {}) {
  const pdfjsLib = await getPdfJs();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;

  let docTitle = stripExtension(fileName);
  let docAuthor = '';

  try {
    const meta = await pdf.getMetadata();
    if (meta?.info?.Title?.trim()) docTitle = meta.info.Title.trim();
    if (meta?.info?.Author?.trim()) docAuthor = meta.info.Author.trim();
  } catch {
    // Ignore metadata read issues
  }

  const sections = [];
  const totalPages = pdf.numPages;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress({
      stage: 'Reading PDF pages',
      current: pageNum,
      total: totalPages,
    });
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = extractPdfPageText(content.items);
    if (pageText.trim()) {
      sections.push({
        title: `Page ${pageNum}`,
        text: pageText,
      });
    }
  }

  if (sections.length === 0) {
    throw new Error(
      'No selectable text found in this PDF. It may be a scanned image-only PDF without an embedded text layer.'
    );
  }

  return buildDocument({
    title: docTitle,
    author: docAuthor,
    sourceType: 'pdf',
    sections,
  });
}

/**
 * Resolve a relative href against an OPF base directory inside an EPUB ZIP archive.
 */
export function resolveEpubPath(baseDir, relativeHref) {
  const cleanHref = decodeURIComponent((relativeHref || '').split('#')[0]);
  const combined = baseDir ? `${baseDir}/${cleanHref}` : cleanHref;
  const parts = combined.split('/');
  const resolved = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.join('/');
}

/**
 * Extract readable plain text with paragraph breaks from an EPUB XHTML/HTML string.
 * Uses DOMParser in the browser, with a clean regex fallback for non-DOM environments.
 */
export function extractTextFromHtml(htmlString) {
  if (!htmlString) return '';

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    let doc = parser.parseFromString(htmlString, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) {
      doc = parser.parseFromString(htmlString, 'text/html');
    }

    const root = doc.body || doc.documentElement;
    if (!root) return '';

    // Remove non-reading elements
    root.querySelectorAll('script, style, noscript, svg, math, [aria-hidden="true"]').forEach((el) => el.remove());

    const blockTags = new Set([
      'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'LI', 'BLOCKQUOTE', 'PRE', 'TR', 'SECTION', 'ARTICLE',
      'HEADER', 'FOOTER', 'DT', 'DD', 'FIGCAPTION',
    ]);

    const chunks = [];
    const walk = (node) => {
      if (node.nodeType === 3) {
        const val = node.nodeValue || '';
        if (val) chunks.push(val);
        return;
      }
      if (node.nodeType !== 1) return;

      const tag = node.tagName.toUpperCase();
      if (tag === 'BR') {
        chunks.push('\n');
        return;
      }

      const isBlock = blockTags.has(tag);
      if (isBlock) chunks.push('\n\n');
      for (const child of node.childNodes) {
        walk(child);
      }
      if (isBlock) chunks.push('\n\n');
    };

    walk(root);

    return chunks
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Fallback for headless Node testing without DOMParser
  return htmlString
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|section|article|tr)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parse XML string safely for container.xml, OPF, and NCX files (works in browser & Node fallback).
 */
function parseOpfMetadataAndSpine(opfXml) {
  const titleMatch = opfXml.match(/<(?:\w+:)?title[^>]*>([\s\S]*?)<\/(?:\w+:)?title>/i);
  const creatorMatch = opfXml.match(/<(?:\w+:)?creator[^>]*>([\s\S]*?)<\/(?:\w+:)?creator>/i);

  const manifest = new Map();
  const itemRe = /<(?:\w+:)?item\b([^>]*?)\/?>/gi;
  let m;
  while ((m = itemRe.exec(opfXml)) !== null) {
    const attrs = parseXmlAttrs(m[1]);
    if (attrs.id && attrs.href) {
      manifest.set(attrs.id, {
        href: attrs.href,
        mediaType: attrs['media-type'] || '',
        properties: attrs.properties || '',
      });
    }
  }

  const spineIds = [];
  const itemrefRe = /<(?:\w+:)?itemref\b([^>]*?)\/?>/gi;
  while ((m = itemrefRe.exec(opfXml)) !== null) {
    const attrs = parseXmlAttrs(m[1]);
    if (attrs.idref && attrs.linear !== 'no') {
      spineIds.push(attrs.idref);
    }
  }

  return {
    title: titleMatch ? decodeXmlEntities(titleMatch[1].trim()) : '',
    author: creatorMatch ? decodeXmlEntities(creatorMatch[1].trim()) : '',
    manifest,
    spineIds,
  };
}

function parseXmlAttrs(attrString) {
  const attrs = {};
  const attrRe = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = attrRe.exec(attrString)) !== null) {
    attrs[m[1]] = decodeXmlEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

function decodeXmlEntities(str) {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'");
}

function parseNcxLabels(ncxXml, ncxBaseDir) {
  const labelMap = new Map();
  const navPointRe = /<(?:\w+:)?navPoint\b[\s\S]*?<(?:\w+:)?text>([\s\S]*?)<\/(?:\w+:)?text>[\s\S]*?<(?:\w+:)?content\b([^>]*?)\/?>/gi;
  let m;
  while ((m = navPointRe.exec(ncxXml)) !== null) {
    const label = decodeXmlEntities(m[1].trim());
    const attrs = parseXmlAttrs(m[2]);
    if (label && attrs.src) {
      const fullPath = resolveEpubPath(ncxBaseDir, attrs.src);
      if (!labelMap.has(fullPath)) {
        labelMap.set(fullPath, label);
      }
    }
  }
  return labelMap;
}

function parseNavLabels(navHtml, navBaseDir) {
  const labelMap = new Map();
  const linkRe = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(navHtml)) !== null) {
    const attrs = parseXmlAttrs(m[1]);
    const label = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (label && attrs.href) {
      const fullPath = resolveEpubPath(navBaseDir, attrs.href);
      if (!labelMap.has(fullPath)) {
        labelMap.set(fullPath, decodeXmlEntities(label));
      }
    }
  }
  return labelMap;
}

/**
 * Parse an EPUB ArrayBuffer completely client-side using JSZip.
 * Optionally accepts a JSZip constructor for Node-based automated tests.
 */
export async function parseEpubFile(
  arrayBuffer,
  fileName = 'Book.epub',
  onProgress = () => {},
  JSZipImpl = null
) {
  const JSZipLib = JSZipImpl || (typeof globalThis !== 'undefined' ? globalThis.JSZip : null);
  if (!JSZipLib) {
    throw new Error('EPUB parser library (JSZip) failed to load.');
  }

  onProgress({ stage: 'Unpacking EPUB archive', current: 0, total: 1 });
  const zip = await JSZipLib.loadAsync(arrayBuffer);

  // Locate a zip entry case-insensitively as a fallback for quirky EPUBs
  const getEntry = (path) => {
    const exact = zip.file(path);
    if (exact) return exact;
    const lower = path.toLowerCase();
    for (const key of Object.keys(zip.files)) {
      if (key.toLowerCase() === lower) return zip.files[key];
    }
    return null;
  };

  let opfPath = null;
  const containerEntry = getEntry('META-INF/container.xml');
  if (containerEntry) {
    const containerXml = await containerEntry.async('string');
    const rootMatch = containerXml.match(/full-path\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    if (rootMatch) {
      opfPath = rootMatch[1] || rootMatch[2];
    }
  }

  if (!opfPath) {
    opfPath = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.opf')) || null;
  }

  let docTitle = stripExtension(fileName);
  let docAuthor = '';
  let spinePaths = [];
  const tocLabels = new Map();

  if (opfPath && getEntry(opfPath)) {
    const opfXml = await getEntry(opfPath).async('string');
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
    const parsed = parseOpfMetadataAndSpine(opfXml);

    if (parsed.title) docTitle = parsed.title;
    if (parsed.author) docAuthor = parsed.author;

    // Extract chapter labels from EPUB 3 nav or EPUB 2 NCX if available
    for (const item of parsed.manifest.values()) {
      const fullPath = resolveEpubPath(opfDir, item.href);
      const itemDir = fullPath.includes('/') ? fullPath.slice(0, fullPath.lastIndexOf('/')) : '';
      if (item.properties.includes('nav') && getEntry(fullPath)) {
        const navHtml = await getEntry(fullPath).async('string');
        for (const [k, v] of parseNavLabels(navHtml, itemDir)) {
          tocLabels.set(k, v);
        }
      } else if (item.mediaType === 'application/x-dtbncx+xml' && getEntry(fullPath)) {
        const ncxXml = await getEntry(fullPath).async('string');
        for (const [k, v] of parseNcxLabels(ncxXml, itemDir)) {
          if (!tocLabels.has(k)) tocLabels.set(k, v);
        }
      }
    }

    for (const idref of parsed.spineIds) {
      const item = parsed.manifest.get(idref);
      if (!item) continue;
      if (item.properties.includes('nav')) continue; // Skip raw TOC nav doc unless fallback
      const fullPath = resolveEpubPath(opfDir, item.href);
      if (getEntry(fullPath)) {
        spinePaths.push(fullPath);
      }
    }
  }

  // Fallback: collect all HTML/XHTML files sorted naturally
  if (spinePaths.length === 0) {
    spinePaths = Object.keys(zip.files)
      .filter((name) => !zip.files[name].dir && /\.(xhtml|html|htm)$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  const sections = [];
  const totalChapters = spinePaths.length;

  for (let i = 0; i < totalChapters; i++) {
    const path = spinePaths[i];
    onProgress({
      stage: 'Extracting EPUB chapters',
      current: i + 1,
      total: totalChapters,
    });
    const entry = getEntry(path);
    if (!entry) continue;
    const html = await entry.async('string');
    const text = extractTextFromHtml(html);
    if (!text) continue;

    // Derive chapter title from TOC label, first heading, or chapter number
    let chapterTitle = tocLabels.get(path);
    if (!chapterTitle) {
      const hMatch = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
      if (hMatch) {
        const cleanHeading = decodeXmlEntities(hMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
        if (cleanHeading && cleanHeading.length <= 80) {
          chapterTitle = cleanHeading;
        }
      }
    }

    sections.push({
      title: chapterTitle || `Chapter ${sections.length + 1}`,
      text,
    });
  }

  if (sections.length === 0) {
    throw new Error('Could not extract readable text from this EPUB file.');
  }

  return buildDocument({
    title: docTitle,
    author: docAuthor,
    sourceType: 'epub',
    sections,
  });
}

function stripExtension(fileName) {
  return (fileName || 'Document').replace(/\.[^.]+$/, '');
}
