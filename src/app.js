import {
  clampWpm,
  estimateRemainingSeconds,
  findNextSentenceIndex,
  findPreviousSentenceIndex,
  formatDuration,
  getEffectiveWpm,
  getTokenDurationMs,
  splitWordByOrp,
} from './orp.js';
import { parseEpubFile, parsePdfFile, parsePlainText } from './parsers.js';
import { SAMPLE_PASSAGES } from './sample-text.js';

const SETTINGS_KEY = 'focalread.settings.v1';
const POSITIONS_KEY = 'focalread.positions.v1';

const FONT_STACKS = {
  sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: '"Georgia", "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif',
  mono: '"JetBrains Mono", "Cascadia Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

const DEFAULT_SETTINGS = {
  wpm: 300,
  rampEnabled: false,
  rampStartWpm: 300,
  rampEndWpm: 900,
  smartPacing: true,
  countdown: true,
  focusDim: true,
  showReticle: true,
  fontSize: 68,
  fontFamily: 'sans',
  orpColor: '#ff3b30',
  theme: 'oled',
};

const state = {
  doc: null,
  currentIndex: 0,
  isPlaying: false,
  isCountingDown: false,
  timerId: null,
  expectedNextAt: 0,
  awakeTimeoutId: null,
  toastTimeoutId: null,
  settings: loadSettings(),
};

// DOM references
const el = {
  app: document.getElementById('app'),
  docTitle: document.getElementById('doc-title'),
  docBadge: document.getElementById('doc-badge'),
  docSubtitle: document.getElementById('doc-subtitle'),
  sectionSelect: document.getElementById('section-select'),

  btnOpenInput: document.getElementById('btn-open-input'),
  btnContext: document.getElementById('btn-context'),
  btnSettings: document.getElementById('btn-settings'),
  btnFullscreen: document.getElementById('btn-fullscreen'),

  rsvpStage: document.getElementById('rsvp-stage'),
  wordDisplay: document.getElementById('word-display'),
  wordLeft: document.getElementById('word-left'),
  wordOrp: document.getElementById('word-orp'),
  wordRight: document.getElementById('word-right'),
  hudWpm: document.getElementById('hud-wpm'),
  hudMode: document.getElementById('hud-mode'),
  stageHint: document.getElementById('stage-hint'),

  progressSlider: document.getElementById('progress-slider'),
  sectionTicks: document.getElementById('section-ticks'),
  statWords: document.getElementById('stat-words'),
  statPercent: document.getElementById('stat-percent'),
  statEta: document.getElementById('stat-eta'),

  btnRestart: document.getElementById('btn-restart'),
  btnPrevSentence: document.getElementById('btn-prev-sentence'),
  btnPrevWord: document.getElementById('btn-prev-word'),
  btnPlay: document.getElementById('btn-play'),
  iconPlay: document.getElementById('icon-play'),
  iconPause: document.getElementById('icon-pause'),
  btnNextWord: document.getElementById('btn-next-word'),
  btnNextSentence: document.getElementById('btn-next-sentence'),

  btnWpmDown: document.getElementById('btn-wpm-down'),
  btnWpmUp: document.getElementById('btn-wpm-up'),
  wpmValue: document.getElementById('wpm-value'),
  wpmSlider: document.getElementById('wpm-slider'),
  presetPills: Array.from(document.querySelectorAll('.preset-pill[data-wpm]')),
  btnRampToggle: document.getElementById('btn-ramp-toggle'),
  fixedSpeedRow: document.getElementById('fixed-speed-row'),
  rampConfigRow: document.getElementById('ramp-config-row'),
  rampStart: document.getElementById('ramp-start'),
  rampEnd: document.getElementById('ramp-end'),

  dropOverlay: document.getElementById('drop-overlay'),
  modalInput: document.getElementById('modal-input'),
  modalContext: document.getElementById('modal-context'),
  modalSettings: document.getElementById('modal-settings'),

  fileDropzone: document.getElementById('file-dropzone'),
  fileInput: document.getElementById('file-input'),
  parseStatus: document.getElementById('parse-status'),
  parseStatusLabel: document.getElementById('parse-status-label'),
  parseStatusPct: document.getElementById('parse-status-pct'),
  parseBarFill: document.getElementById('parse-bar-fill'),
  parseError: document.getElementById('parse-error'),

  pasteTitle: document.getElementById('paste-title'),
  pasteTextarea: document.getElementById('paste-textarea'),
  btnLoadPaste: document.getElementById('btn-load-paste'),
  btnSampleTrainer: document.getElementById('btn-sample-trainer'),
  btnSampleClassic: document.getElementById('btn-sample-classic'),

  contextBody: document.getElementById('context-body'),

  optSmartPacing: document.getElementById('opt-smart-pacing'),
  optCountdown: document.getElementById('opt-countdown'),
  optFocusDim: document.getElementById('opt-focus-dim'),
  optShowReticle: document.getElementById('opt-show-reticle'),
  optFontSize: document.getElementById('opt-font-size'),
  optFontSizeVal: document.getElementById('opt-font-size-val'),
  optFontFamily: document.getElementById('opt-font-family'),
  optOrpColor: document.getElementById('opt-orp-color'),
  optTheme: document.getElementById('opt-theme'),

  toast: document.getElementById('toast'),
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch {
    // Ignore storage quota / private mode issues
  }
}

function getSavedPosition(docId) {
  try {
    const raw = localStorage.getItem(POSITIONS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return Number.isInteger(map[docId]) ? map[docId] : 0;
  } catch {
    return 0;
  }
}

function savePosition(docId, index) {
  if (!docId) return;
  try {
    const raw = localStorage.getItem(POSITIONS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[docId] = index;
    // Cap stored history to 40 documents
    const keys = Object.keys(map);
    if (keys.length > 40) {
      delete map[keys[0]];
    }
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(map));
  } catch {
    // Ignore
  }
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(state.toastTimeoutId);
  state.toastTimeoutId = setTimeout(() => {
    el.toast.classList.add('hidden');
  }, 2600);
}

function applySettingsToDom() {
  const s = state.settings;
  document.documentElement.setAttribute('data-theme', s.theme);
  document.documentElement.style.setProperty('--orp-color', s.orpColor);
  document.documentElement.style.setProperty('--accent', s.orpColor);
  document.documentElement.style.setProperty('--word-size', `${s.fontSize}px`);
  document.documentElement.style.setProperty('--word-font', FONT_STACKS[s.fontFamily] || FONT_STACKS.sans);

  el.app.classList.toggle('focus-dim', Boolean(s.focusDim));
  el.rsvpStage.classList.toggle('hide-reticle', !s.showReticle);

  // Sync speed & ramp UI
  el.wpmSlider.value = String(clampWpm(s.wpm));
  el.rampStart.value = String(clampWpm(s.rampStartWpm));
  el.rampEnd.value = String(clampWpm(s.rampEndWpm));
  el.btnRampToggle.classList.toggle('active', s.rampEnabled);
  el.btnRampToggle.setAttribute('aria-pressed', String(s.rampEnabled));
  el.btnRampToggle.querySelector('span').textContent = `Ramp ${s.rampStartWpm}→${s.rampEndWpm}`;
  el.fixedSpeedRow.classList.toggle('hidden', s.rampEnabled);
  el.rampConfigRow.classList.toggle('hidden', !s.rampEnabled);
  el.hudMode.classList.toggle('hidden', !s.rampEnabled);
  el.hudMode.textContent = `RAMP ${s.rampStartWpm} → ${s.rampEndWpm}`;

  for (const pill of el.presetPills) {
    const val = Number(pill.dataset.wpm);
    pill.classList.toggle('active', !s.rampEnabled && val === s.wpm);
  }

  // Sync settings controls
  el.optSmartPacing.checked = s.smartPacing;
  el.optCountdown.checked = s.countdown;
  el.optFocusDim.checked = s.focusDim;
  el.optShowReticle.checked = s.showReticle;
  el.optFontSize.value = String(s.fontSize);
  el.optFontSizeVal.textContent = `${s.fontSize}px`;

  el.optFontFamily.querySelectorAll('.pill-choice').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.font === s.fontFamily);
  });
  el.optOrpColor.querySelectorAll('.swatch').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.color === s.orpColor);
  });
  el.optTheme.querySelectorAll('.pill-choice').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === s.theme);
  });

  renderCurrentWord();
  updateStats();
}

function loadDocument(doc, { enableRamp = null, resumeSaved = true } = {}) {
  pause();
  state.doc = doc;

  if (enableRamp !== null) {
    state.settings.rampEnabled = enableRamp;
    saveSettings();
  }

  const savedPos = resumeSaved ? getSavedPosition(doc.id) : 0;
  state.currentIndex = Math.min(Math.max(0, savedPos), Math.max(0, doc.tokens.length - 1));

  el.docTitle.textContent = doc.title;
  el.docBadge.textContent = doc.sourceType.toUpperCase();
  const wordCountStr = `${doc.tokens.length.toLocaleString()} words`;
  el.docSubtitle.textContent = doc.author ? `${doc.author} · ${wordCountStr}` : wordCountStr;

  // Populate chapter / page dropdown and progress bar ticks
  el.sectionSelect.innerHTML = '';
  el.sectionTicks.innerHTML = '';

  if (doc.sections.length > 1) {
    doc.sections.forEach((sec, idx) => {
      const opt = document.createElement('option');
      opt.value = String(sec.startIndex);
      opt.textContent = sec.title;
      el.sectionSelect.appendChild(opt);

      if (idx > 0 && doc.tokens.length > 1) {
        const tick = document.createElement('span');
        tick.className = 'section-tick';
        tick.style.left = `${(sec.startIndex / (doc.tokens.length - 1)) * 100}%`;
        el.sectionTicks.appendChild(tick);
      }
    });
    el.sectionSelect.classList.remove('hidden');
  } else {
    el.sectionSelect.classList.add('hidden');
  }

  el.progressSlider.max = String(Math.max(0, doc.tokens.length - 1));
  applySettingsToDom();
}

function getCurrentEffectiveWpm() {
  const totalWords = state.doc ? state.doc.tokens.length : 1;
  return getEffectiveWpm({
    baseWpm: state.settings.wpm,
    rampEnabled: state.settings.rampEnabled,
    rampStartWpm: state.settings.rampStartWpm,
    rampEndWpm: state.settings.rampEndWpm,
    index: state.currentIndex,
    totalWords,
  });
}

function renderCurrentWord() {
  if (!state.doc || state.doc.tokens.length === 0) {
    el.wordLeft.textContent = '';
    el.wordOrp.textContent = 'Ready';
    el.wordRight.textContent = '';
    return;
  }

  const token = state.doc.tokens[state.currentIndex];
  const { left, orp, right } = splitWordByOrp(token.text);

  el.wordDisplay.classList.remove('is-countdown');
  el.wordLeft.textContent = left;
  el.wordOrp.textContent = orp;
  el.wordRight.textContent = right;

  // Slightly scale down ultra-long words so they never overflow narrow screens
  const len = token.text.length;
  const baseSize = state.settings.fontSize;
  const viewportCap = Math.min(baseSize, Math.floor(window.innerWidth * 0.145));
  const scaled = len > 13 ? Math.max(26, Math.round(viewportCap * (13 / len) ** 0.55)) : viewportCap;
  el.wordDisplay.style.fontSize = `${scaled}px`;
}

function updateStats() {
  const total = state.doc ? state.doc.tokens.length : 0;
  const currentWpm = getCurrentEffectiveWpm();

  el.wpmValue.textContent = String(currentWpm);
  el.hudWpm.textContent = `${currentWpm} WPM`;

  if (total === 0) {
    el.statWords.textContent = '0 / 0';
    el.statPercent.textContent = '0%';
    el.statEta.textContent = '0:00 left';
    el.progressSlider.value = '0';
    return;
  }

  el.progressSlider.value = String(state.currentIndex);
  el.statWords.textContent = `${(state.currentIndex + 1).toLocaleString()} / ${total.toLocaleString()}`;
  const pct = total > 1 ? Math.round((state.currentIndex / (total - 1)) * 100) : 100;
  el.statPercent.textContent = `${pct}%`;

  const remainingSecs = estimateRemainingSeconds(state.doc.tokens, state.currentIndex, {
    baseWpm: state.settings.wpm,
    rampEnabled: state.settings.rampEnabled,
    rampStartWpm: state.settings.rampStartWpm,
    rampEndWpm: state.settings.rampEndWpm,
    smartPacing: state.settings.smartPacing,
  });
  el.statEta.textContent = `${formatDuration(remainingSecs)} left`;

  // Sync active chapter in dropdown
  if (state.doc.sections.length > 1) {
    let activeStart = state.doc.sections[0].startIndex;
    for (const sec of state.doc.sections) {
      if (sec.startIndex <= state.currentIndex) {
        activeStart = sec.startIndex;
      } else {
        break;
      }
    }
    if (el.sectionSelect.value !== String(activeStart)) {
      el.sectionSelect.value = String(activeStart);
    }
  }
}

function setPlayingUi(playing) {
  el.app.classList.toggle('is-playing', playing);
  el.iconPlay.classList.toggle('hidden', playing);
  el.iconPause.classList.toggle('hidden', !playing);
  el.btnPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function play() {
  if (!state.doc || state.doc.tokens.length === 0) return;
  if (state.isPlaying) return;

  // If already at the very end, restart from beginning
  if (state.currentIndex >= state.doc.tokens.length - 1) {
    state.currentIndex = 0;
  }

  state.isPlaying = true;
  setPlayingUi(true);

  if (state.settings.countdown) {
    runCountdown(3);
  } else {
    startPlaybackLoop();
  }
}

function runCountdown(count) {
  if (!state.isPlaying) return;
  if (count <= 0) {
    state.isCountingDown = false;
    startPlaybackLoop();
    return;
  }

  state.isCountingDown = true;
  el.wordDisplay.classList.add('is-countdown');
  el.wordLeft.textContent = '';
  el.wordOrp.textContent = String(count);
  el.wordRight.textContent = '';

  state.timerId = setTimeout(() => {
    runCountdown(count - 1);
  }, 420);
}

function startPlaybackLoop() {
  if (!state.isPlaying || !state.doc) return;
  renderCurrentWord();
  updateStats();
  state.expectedNextAt = performance.now();
  scheduleNextTick();
}

function scheduleNextTick() {
  if (!state.isPlaying || !state.doc) return;

  const token = state.doc.tokens[state.currentIndex];
  const wpm = getCurrentEffectiveWpm();
  const durationMs = getTokenDurationMs(token, wpm, state.settings.smartPacing);

  // Drift-compensated deadline scheduling for crisp timing at 600-1200 WPM
  state.expectedNextAt += durationMs;
  const delay = Math.max(8, state.expectedNextAt - performance.now());

  state.timerId = setTimeout(() => {
    if (!state.isPlaying || !state.doc) return;

    if (state.currentIndex >= state.doc.tokens.length - 1) {
      pause();
      savePosition(state.doc.id, 0);
      showToast('Finished reading!');
      return;
    }

    state.currentIndex += 1;
    renderCurrentWord();
    updateStats();

    if (state.currentIndex % 15 === 0) {
      savePosition(state.doc.id, state.currentIndex);
    }

    scheduleNextTick();
  }, delay);
}

function pause() {
  clearTimeout(state.timerId);
  state.timerId = null;
  state.isPlaying = false;
  state.isCountingDown = false;
  setPlayingUi(false);

  if (state.doc) {
    renderCurrentWord();
    updateStats();
    savePosition(state.doc.id, state.currentIndex);
  }
}

function togglePlay() {
  if (state.isPlaying) pause();
  else play();
}

function jumpTo(index) {
  if (!state.doc || state.doc.tokens.length === 0) return;
  const clamped = Math.min(state.doc.tokens.length - 1, Math.max(0, Math.round(index)));
  state.currentIndex = clamped;
  renderCurrentWord();
  updateStats();
  savePosition(state.doc.id, state.currentIndex);

  if (state.isPlaying && !state.isCountingDown) {
    clearTimeout(state.timerId);
    state.expectedNextAt = performance.now();
    scheduleNextTick();
  }
}

function setWpm(newWpm) {
  const clamped = clampWpm(newWpm);
  state.settings.wpm = clamped;
  if (state.settings.rampEnabled) {
    state.settings.rampEnabled = false;
  }
  saveSettings();
  applySettingsToDom();
}

function wakeChromeTemporarily() {
  if (!state.isPlaying || !state.settings.focusDim) return;
  el.app.classList.add('ui-awake');
  clearTimeout(state.awakeTimeoutId);
  state.awakeTimeoutId = setTimeout(() => {
    el.app.classList.remove('ui-awake');
  }, 1800);
}

// Modals
function openModal(modalEl) {
  pause();
  modalEl.classList.remove('hidden');
}

function closeModal(modalEl) {
  modalEl.classList.add('hidden');
}

function closeAllModals() {
  [el.modalInput, el.modalContext, el.modalSettings].forEach((m) => m.classList.add('hidden'));
}

function isAnyModalOpen() {
  return (
    !el.modalInput.classList.contains('hidden') ||
    !el.modalContext.classList.contains('hidden') ||
    !el.modalSettings.classList.contains('hidden')
  );
}

// Context View Renderer
function openContextView() {
  if (!state.doc || state.doc.tokens.length === 0) return;
  openModal(el.modalContext);

  const tokens = state.doc.tokens;
  const windowRadius = 280;
  const start = Math.max(0, state.currentIndex - windowRadius);
  const end = Math.min(tokens.length - 1, state.currentIndex + windowRadius);

  el.contextBody.innerHTML = '';
  const frag = document.createDocumentFragment();

  if (start > 0) {
    const note = document.createElement('p');
    note.className = 'modal-subtitle';
    note.textContent = `Showing words ${(start + 1).toLocaleString()}–${(end + 1).toLocaleString()} of ${tokens.length.toLocaleString()}`;
    frag.appendChild(note);
  }

  let currentParaIdx = -1;
  let paraEl = null;

  for (let i = start; i <= end; i++) {
    const tok = tokens[i];
    if (tok.paragraphIndex !== currentParaIdx) {
      currentParaIdx = tok.paragraphIndex;
      paraEl = document.createElement('p');
      paraEl.className = 'context-para';
      frag.appendChild(paraEl);
    }

    const span = document.createElement('span');
    span.className = 'context-word';
    if (i === state.currentIndex) {
      span.classList.add('is-current');
      span.id = 'context-current-word';
    }
    span.dataset.index = String(i);
    span.textContent = tok.text;
    paraEl.appendChild(span);
    paraEl.appendChild(document.createTextNode(' '));
  }

  el.contextBody.appendChild(frag);

  const currentSpan = document.getElementById('context-current-word');
  if (currentSpan) {
    currentSpan.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
}

// File Upload Handling (.pdf, .epub, .txt, .md)
function setParseProgress({ stage, current, total }) {
  el.parseError.classList.add('hidden');
  el.parseStatus.classList.remove('hidden');
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  el.parseStatusLabel.textContent = total > 1 ? `${stage} (${current}/${total})…` : `${stage}…`;
  el.parseStatusPct.textContent = `${pct}%`;
  el.parseBarFill.style.width = `${pct}%`;
}

function resetParseUi() {
  el.parseStatus.classList.add('hidden');
  el.parseError.classList.add('hidden');
  el.parseBarFill.style.width = '0%';
}

async function handleFileUpload(file) {
  if (!file) return;
  openModal(el.modalInput);
  resetParseUi();

  const name = file.name || 'Document';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';

  try {
    let doc;
    if (ext === 'pdf' || file.type === 'application/pdf') {
      setParseProgress({ stage: 'Opening PDF', current: 0, total: 1 });
      const buf = await file.arrayBuffer();
      doc = await parsePdfFile(buf, name, setParseProgress);
    } else if (ext === 'epub' || file.type === 'application/epub+zip') {
      setParseProgress({ stage: 'Opening EPUB', current: 0, total: 1 });
      const buf = await file.arrayBuffer();
      doc = await parseEpubFile(buf, name, setParseProgress);
    } else if (['txt', 'md', 'markdown', 'text'].includes(ext) || file.type.startsWith('text/')) {
      setParseProgress({ stage: 'Reading text file', current: 1, total: 1 });
      const text = await file.text();
      doc = parsePlainText(text, name.replace(/\.[^.]+$/, ''), ext === 'md' ? 'md' : 'txt');
    } else {
      throw new Error(`Unsupported file type ".${ext || 'unknown'}". Please upload a PDF, EPUB, TXT, or Markdown file.`);
    }

    resetParseUi();
    loadDocument(doc, { resumeSaved: true });
    closeModal(el.modalInput);
    showToast(`Loaded "${doc.title}" (${doc.tokens.length.toLocaleString()} words)`);
  } catch (err) {
    el.parseStatus.classList.add('hidden');
    el.parseError.textContent = err?.message || 'Failed to read this file.';
    el.parseError.classList.remove('hidden');
  } finally {
    el.fileInput.value = '';
  }
}

// Event Bindings
function bindEvents() {
  // Stage click & keyboard play/pause
  el.rsvpStage.addEventListener('click', togglePlay);
  el.btnPlay.addEventListener('click', togglePlay);
  el.btnRestart.addEventListener('click', () => {
    pause();
    jumpTo(0);
  });
  el.btnPrevWord.addEventListener('click', () => jumpTo(state.currentIndex - 1));
  el.btnNextWord.addEventListener('click', () => jumpTo(state.currentIndex + 1));
  el.btnPrevSentence.addEventListener('click', () => {
    if (!state.doc) return;
    jumpTo(findPreviousSentenceIndex(state.doc.tokens, state.currentIndex));
  });
  el.btnNextSentence.addEventListener('click', () => {
    if (!state.doc) return;
    jumpTo(findNextSentenceIndex(state.doc.tokens, state.currentIndex));
  });

  // Scrubber & Section jump
  el.progressSlider.addEventListener('input', (e) => {
    jumpTo(Number(e.target.value));
  });
  el.sectionSelect.addEventListener('change', (e) => {
    jumpTo(Number(e.target.value));
  });

  // Speed controls
  el.wpmSlider.addEventListener('input', (e) => setWpm(Number(e.target.value)));
  el.btnWpmDown.addEventListener('click', () => setWpm(state.settings.wpm - 25));
  el.btnWpmUp.addEventListener('click', () => setWpm(state.settings.wpm + 25));
  el.presetPills.forEach((pill) => {
    pill.addEventListener('click', () => setWpm(Number(pill.dataset.wpm)));
  });

  el.btnRampToggle.addEventListener('click', () => {
    state.settings.rampEnabled = !state.settings.rampEnabled;
    saveSettings();
    applySettingsToDom();
    if (state.settings.rampEnabled) {
      showToast(`Ramp mode on: ${state.settings.rampStartWpm} → ${state.settings.rampEndWpm} WPM`);
    }
  });

  const updateRampBounds = () => {
    state.settings.rampStartWpm = clampWpm(el.rampStart.value);
    state.settings.rampEndWpm = clampWpm(el.rampEnd.value);
    saveSettings();
    applySettingsToDom();
  };
  el.rampStart.addEventListener('change', updateRampBounds);
  el.rampEnd.addEventListener('change', updateRampBounds);

  // Header actions
  el.btnOpenInput.addEventListener('click', () => {
    resetParseUi();
    openModal(el.modalInput);
  });
  el.btnContext.addEventListener('click', openContextView);
  el.btnSettings.addEventListener('click', () => openModal(el.modalSettings));
  el.btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  });

  // Modal closing
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.closeModal);
      if (target) closeModal(target);
    });
  });

  [el.modalInput, el.modalContext, el.modalSettings].forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal(backdrop);
    });
  });

  // Context word click-to-jump
  el.contextBody.addEventListener('click', (e) => {
    const wordEl = e.target.closest('.context-word');
    if (!wordEl) return;
    jumpTo(Number(wordEl.dataset.index));
    closeModal(el.modalContext);
  });

  // Paste & Sample loaders
  el.btnLoadPaste.addEventListener('click', () => {
    const raw = el.pasteTextarea.value.trim();
    if (!raw) {
      el.parseError.textContent = 'Please paste some text before loading.';
      el.parseError.classList.remove('hidden');
      return;
    }
    try {
      const title = el.pasteTitle.value.trim() || 'Pasted Text';
      const doc = parsePlainText(raw, title, 'text');
      loadDocument(doc, { resumeSaved: false });
      closeModal(el.modalInput);
      showToast(`Loaded "${doc.title}" (${doc.tokens.length.toLocaleString()} words)`);
    } catch (err) {
      el.parseError.textContent = err.message;
      el.parseError.classList.remove('hidden');
    }
  });

  el.btnSampleTrainer.addEventListener('click', () => {
    const sample = SAMPLE_PASSAGES.trainer;
    const doc = parsePlainText(sample.text, sample.title, 'demo', sample.author);
    state.settings.rampStartWpm = 300;
    state.settings.rampEndWpm = 900;
    loadDocument(doc, { enableRamp: true, resumeSaved: false });
    closeModal(el.modalInput);
    showToast('Loaded 300 → 900 WPM Trainer');
  });

  el.btnSampleClassic.addEventListener('click', () => {
    const sample = SAMPLE_PASSAGES.classic;
    const doc = parsePlainText(sample.text, sample.title, 'demo', sample.author);
    loadDocument(doc, { enableRamp: false, resumeSaved: false });
    closeModal(el.modalInput);
    showToast('Loaded Practice Passage');
  });

  // File picker & dropzone inside modal
  el.fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    el.fileDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.fileDropzone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    el.fileDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.fileDropzone.classList.remove('is-dragover');
    });
  });
  el.fileDropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileUpload(file);
  });

  // Global window drag-and-drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepth += 1;
    el.dropOverlay.classList.remove('hidden');
  });
  window.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      el.dropOverlay.classList.add('hidden');
    }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.dropOverlay.classList.add('hidden');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileUpload(file);
  });

  // Settings listeners
  el.optSmartPacing.addEventListener('change', (e) => {
    state.settings.smartPacing = e.target.checked;
    saveSettings();
    updateStats();
  });
  el.optCountdown.addEventListener('change', (e) => {
    state.settings.countdown = e.target.checked;
    saveSettings();
  });
  el.optFocusDim.addEventListener('change', (e) => {
    state.settings.focusDim = e.target.checked;
    saveSettings();
    applySettingsToDom();
  });
  el.optShowReticle.addEventListener('change', (e) => {
    state.settings.showReticle = e.target.checked;
    saveSettings();
    applySettingsToDom();
  });
  el.optFontSize.addEventListener('input', (e) => {
    state.settings.fontSize = Number(e.target.value);
    saveSettings();
    applySettingsToDom();
  });

  el.optFontFamily.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-font]');
    if (!btn) return;
    state.settings.fontFamily = btn.dataset.font;
    saveSettings();
    applySettingsToDom();
  });
  el.optOrpColor.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-color]');
    if (!btn) return;
    state.settings.orpColor = btn.dataset.color;
    saveSettings();
    applySettingsToDom();
  });
  el.optTheme.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme]');
    if (!btn) return;
    state.settings.theme = btn.dataset.theme;
    saveSettings();
    applySettingsToDom();
  });

  // Mouse movement wakes dimmed chrome during playback
  window.addEventListener('mousemove', wakeChromeTemporarily, { passive: true });
  window.addEventListener('resize', renderCurrentWord, { passive: true });

  // Global keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isAnyModalOpen()) {
        closeAllModals();
      } else if (state.isPlaying) {
        pause();
      }
      return;
    }

    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isAnyModalOpen()) {
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setWpm(state.settings.wpm + 25);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setWpm(state.settings.wpm - 25);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.shiftKey && state.doc) {
        jumpTo(findPreviousSentenceIndex(state.doc.tokens, state.currentIndex));
      } else {
        jumpTo(state.currentIndex - 1);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.shiftKey && state.doc) {
        jumpTo(findNextSentenceIndex(state.doc.tokens, state.currentIndex));
      } else {
        jumpTo(state.currentIndex + 1);
      }
    } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      pause();
      jumpTo(0);
    } else if (e.key.toLowerCase() === 'o' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      resetParseUi();
      openModal(el.modalInput);
    } else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      openContextView();
    } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      openModal(el.modalSettings);
    } else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      el.btnFullscreen.click();
    }
  });
}

function init() {
  bindEvents();
  const sample = SAMPLE_PASSAGES.trainer;
  const doc = parsePlainText(sample.text, sample.title, 'demo', sample.author);
  loadDocument(doc, { resumeSaved: false });
}

init();
