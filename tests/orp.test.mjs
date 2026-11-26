import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import {
  getOrpIndex,
  splitWordByOrp,
  tokenizeText,
  getEffectiveWpm,
  getTokenDurationMs,
  findPreviousSentenceIndex,
  findNextSentenceIndex,
} from '../src/orp.js';
import { parseEpubFile, parsePlainText, resolveEpubPath } from '../src/parsers.js';

test('ORP matches every example from the RSVP speed-reading video', () => {
  const cases = [
    ['a', 'a'],
    ['in', 'n'],
    ['key', 'e'],
    ['keep', 'e'],
    ['your', 'o'],
    ['don’t', 'o'],
    ['spell', 'p'],
    ['minute.', 'n'],
    ['reading.', 'a'],
  ];

  for (const [word, expectedLetter] of cases) {
    const parts = splitWordByOrp(word);
    assert.equal(parts.orp, expectedLetter, `Expected ORP of "${word}" to be "${expectedLetter}", got "${parts.orp}"`);
    assert.equal(parts.left + parts.orp + parts.right, word);
  }
});

test('ORP skips leading quotes and parentheses', () => {
  const quoted = splitWordByOrp('“reading”');
  assert.equal(quoted.orp, 'a');
  assert.equal(quoted.left, '“re');
  assert.equal(quoted.right, 'ding”');
  assert.equal(getOrpIndex('(keep)'), 2);
});

test('Tokenizer preserves paragraph and sentence boundaries', () => {
  const tokens = tokenizeText('Hello world.\n\nSecond paragraph here!');
  assert.equal(tokens.length, 5);
  assert.equal(tokens[1].isSentenceEnd, true);
  assert.equal(tokens[1].isParagraphEnd, true);
  assert.equal(tokens[2].paragraphIndex, 1);
  assert.equal(tokens[4].isParagraphEnd, true);
});

test('Ramp mode smoothly interpolates WPM from 300 to 900', () => {
  assert.equal(
    getEffectiveWpm({ baseWpm: 300, rampEnabled: true, rampStartWpm: 300, rampEndWpm: 900, index: 0, totalWords: 101 }),
    300
  );
  assert.equal(
    getEffectiveWpm({ baseWpm: 300, rampEnabled: true, rampStartWpm: 300, rampEndWpm: 900, index: 50, totalWords: 101 }),
    600
  );
  assert.equal(
    getEffectiveWpm({ baseWpm: 300, rampEnabled: true, rampStartWpm: 300, rampEndWpm: 900, index: 100, totalWords: 101 }),
    900
  );
});

test('Smart pacing adds dwell time for punctuation and paragraph breaks', () => {
  const plain = getTokenDurationMs({ text: 'word', isParagraphEnd: false }, 300, true);
  const comma = getTokenDurationMs({ text: 'word,', isParagraphEnd: false }, 300, true);
  const period = getTokenDurationMs({ text: 'word.', isParagraphEnd: false }, 300, true);
  const para = getTokenDurationMs({ text: 'word.', isParagraphEnd: true }, 300, true);

  assert.equal(plain, 200);
  assert.ok(comma > plain);
  assert.ok(period > comma);
  assert.ok(para > period);
});

test('Sentence navigation jumps cleanly backward and forward', () => {
  const tokens = tokenizeText('One two. Three four. Five six.');
  assert.equal(findNextSentenceIndex(tokens, 0), 2);
  assert.equal(findNextSentenceIndex(tokens, 2), 4);
  assert.equal(findPreviousSentenceIndex(tokens, 4), 2);
  assert.equal(findPreviousSentenceIndex(tokens, 2), 0);
});

test('Plain text parser extracts Markdown headings as sections', () => {
  const doc = parsePlainText('# Intro\nHello world.\n\n## Chapter Two\nSecond part here.', 'Notes', 'md');
  assert.equal(doc.sections.length, 2);
  assert.equal(doc.sections[0].title, 'Intro');
  assert.equal(doc.sections[1].title, 'Chapter Two');
});

test('EPUB path resolution handles nested relative paths', () => {
  assert.equal(resolveEpubPath('OEBPS', 'Text/ch1.xhtml#sec1'), 'OEBPS/Text/ch1.xhtml');
  assert.equal(resolveEpubPath('OEBPS/content', '../Text/ch2.xhtml'), 'OEBPS/Text/ch2.xhtml');
});

test('EPUB parser unpacks valid multi-chapter EPUB archive in spine order', async () => {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Speed Reading Handbook</dc:title>
        <dc:creator>Ada Reader</dc:creator>
      </metadata>
      <manifest>
        <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine>
        <itemref idref="ch1"/>
        <itemref idref="ch2"/>
      </spine>
    </package>`
  );
  zip.file(
    'OEBPS/ch1.xhtml',
    `<html><body><h1>Chapter One</h1><p>Keep your eyes locked on the red letter.</p></body></html>`
  );
  zip.file(
    'OEBPS/ch2.xhtml',
    `<html><body><h1>Chapter Two</h1><p>Accelerate smoothly from 300 to 900 words per minute.</p></body></html>`
  );

  const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' });
  const doc = await parseEpubFile(arrayBuffer, 'handbook.epub', () => {}, JSZip);

  assert.equal(doc.title, 'Speed Reading Handbook');
  assert.equal(doc.author, 'Ada Reader');
  assert.equal(doc.sourceType, 'epub');
  assert.equal(doc.sections.length, 2);
  assert.equal(doc.sections[0].title, 'Chapter One');
  assert.equal(doc.sections[1].title, 'Chapter Two');
  assert.ok(doc.tokens.some((t) => t.text === 'Accelerate'));
});
