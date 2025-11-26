const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID';
const GOOGLE_API_KEY = 'YOUR_GOOGLE_API_KEY';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];

const CHARACTER_NAMES = ['Lumpy', 'Flops', 'Theadora', 'Stitch', 'Piggle', 'Lionel'];
const DIE_OPTIONS = [
  { value: 'green', color: '#34d399' },
  { value: 'yellow', color: '#facc15' },
  { value: 'orange', color: '#fb923c' },
  { value: 'purple', color: '#a855f7' },
  { value: 'blue', color: '#3b82f6' },
  { value: 'white', color: '#ffffff' },
];
const ITEM_SLOTS = [
  { key: 'head', label: 'Head' },
  { key: 'body', label: 'Body' },
  { key: 'paws', label: 'Paws' },
  { key: 'accessory', label: 'Accessory' },
];
const STATUS_OPTIONS = [
  { value: 'worried', label: 'Worried' },
  { value: 'scorched', label: 'Scorched' },
  { value: 'scared', label: 'Scared' },
  { value: 'soggy', label: 'Soggy' },
  { value: 'courageous', label: 'Courageous' },
  { value: 'trapped', label: 'Trapped' },
  { value: 'angry', label: 'Angry' },
  { value: 'torn', label: 'Torn' },
  { value: "skreela's mark", label: "Skreela's Mark" },
];

const STORAGE_KEYS = {
  gameplay: 'stuffed-fable/gameplay',
  timelinePrefix: 'stuffed-fable/timeline/',
  teacherSessions: 'stuffed-fable/teacher/sessions',
  driveBackups: 'stuffed-fable/drive/backups',
};

function createEmptyItemSlots() {
  return ITEM_SLOTS.reduce((slots, slot) => {
    slots[slot.key] = '';
    return slots;
  }, {});
}

function normalizeItemSlots(rawItems) {
  const slots = createEmptyItemSlots();
  if (Array.isArray(rawItems)) {
    rawItems
      .filter((item) => typeof item === 'string' && item.trim())
      .slice(0, ITEM_SLOTS.length)
      .forEach((item, index) => {
        const slotKey = ITEM_SLOTS[index]?.key;
        if (slotKey) {
          slots[slotKey] = item.trim();
        }
      });
    return slots;
  }

  if (rawItems && typeof rawItems === 'object') {
    ITEM_SLOTS.forEach(({ key }) => {
      const value = rawItems[key];
      slots[key] = typeof value === 'string' && value.trim() ? value.trim() : '';
    });
  }

  return slots;
}

function createDefaultCharacter(label, name) {
  return {
    label,
    name,
    stuffing: 0,
    heart: 0,
    buttons: 0,
    die: null,
    statuses: [],
    items: createEmptyItemSlots(),
  };
}

const state = {
  role: null,
  teacherView: 'home',
  selectedTeacherSessionId: null,
  teacherSessions: [],
  mode: 'reading',
  readingTab: 'narrative',
  scenes: [],
  selectedSceneId: null,
  isLoadingScenes: true,
  vocabularyMap: {},
  timelineOptionPool: [],
  timelineSelections: {},
  timelineConflicts: new Set(),
  timelineResults: {},
  timelineAttempts: 0,
  activeTimelineTile: null,
  characters: [
    createDefaultCharacter('Character 1', 'Lumpy'),
    createDefaultCharacter('Character 2', 'Flops'),
  ],
  activeCharacterIndex: 0,
  showGameStatus: false,
  teacherScenePromptShown: false,
  pendingSceneChange: null,
  pendingSceneStatusTarget: null,
  googleAuth: {
    connected: false,
    message: 'Not connected',
  },
  activeSleepCardId: null,
  pendingSleepStatus: 'sleeping',
  activeLostCardId: null,
  pendingDriveLoad: null,
};

const driveAutosaveTimers = {};
const driveBackupMetadata = { teacher: {}, student: {} };
let googleScriptsLoaded = false;
let googleClientReady = false;
let googleTokenClient = null;

const app = document.getElementById('app');

function compareSceneIds(a, b) {
  const tokenize = (id) =>
    id
      .split('-')
      .map((part) => ({
        value: part,
        isNumeric: /^\d+$/.test(part),
        number: Number(part),
      }));

  const aParts = tokenize(a);
  const bParts = tokenize(b);
  const maxLength = Math.max(aParts.length, bParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const aPart = aParts[index];
    const bPart = bParts[index];

    if (!aPart) {
      return -1;
    }
    if (!bPart) {
      return 1;
    }

    if (aPart.isNumeric && bPart.isNumeric) {
      if (aPart.number !== bPart.number) {
        return aPart.number - bPart.number;
      }
      continue;
    }

    if (aPart.isNumeric !== bPart.isNumeric) {
      return aPart.isNumeric ? -1 : 1;
    }

    const diff = aPart.value.localeCompare(bPart.value);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function storageAvailable() {
  try {
    return typeof window !== 'undefined' && 'localStorage' in window && window.localStorage !== null;
  } catch (error) {
    console.warn('Local storage is unavailable.', error);
    return false;
  }
}

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureGoogleApisLoaded() {
  if (googleScriptsLoaded) {
    return;
  }

  await Promise.all([
    loadExternalScript('https://accounts.google.com/gsi/client'),
    loadExternalScript('https://apis.google.com/js/api.js'),
  ]);

  googleScriptsLoaded = true;
}

async function ensureGoogleClient() {
  if (googleClientReady) {
    return;
  }

  await ensureGoogleApisLoaded();

  await new Promise((resolve, reject) => {
    window.gapi.load('client', {
      callback: resolve,
      onerror: () => reject(new Error('Failed to load Google API client.')),
    });
  });

  await window.gapi.client.init({
    apiKey: GOOGLE_API_KEY,
    discoveryDocs: GOOGLE_DISCOVERY_DOCS,
  });

  if (!googleTokenClient) {
    googleTokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPES,
      callback: () => {},
    });
  }

  googleClientReady = true;
}

async function requestGoogleAccessToken() {
  await ensureGoogleClient();

  return new Promise((resolve, reject) => {
    if (!googleTokenClient) {
      reject(new Error('Google token client unavailable.'));
      return;
    }

    const existingToken = window.gapi.client.getToken?.();
    googleTokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      window.gapi.client.setToken({ access_token: response.access_token });
      resolve(response.access_token);
    };

    googleTokenClient.requestAccessToken({ prompt: existingToken ? '' : 'consent' });
  });
}

function getTimelineStorageKey(sceneId) {
  return `${STORAGE_KEYS.timelinePrefix}${sceneId}`;
}

function loadTimelineProgress(sceneId) {
  if (!sceneId || !storageAvailable()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getTimelineStorageKey(sceneId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn('Unable to read saved timeline progress.', error);
    return null;
  }
}

function attemptStorageWrite(writeFn, sceneIdToPreserve) {
  if (!storageAvailable()) {
    return false;
  }

  try {
    writeFn();
    return true;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      const evicted = evictOldestTimelineEntry(sceneIdToPreserve);
      if (evicted) {
        try {
          writeFn();
          return true;
        } catch (retryError) {
          console.warn('Storage write failed after eviction.', retryError);
        }
      }
    } else {
      console.warn('Storage write failed.', error);
    }
  }

  return false;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function listBackupDifferences(a, b, prefix = '') {
  if (Object.is(a, b)) {
    return [];
  }

  const label = prefix || 'value';
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return [label];
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return [label];
    }

    const differences = [];
    a.forEach((value, index) => {
      differences.push(...listBackupDifferences(value, b[index], `${label}[${index}]`));
    });
    return differences;
  }

  const differences = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.forEach((key) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (!(key in a) || !(key in b)) {
      differences.push(nextPrefix);
      return;
    }
    differences.push(...listBackupDifferences(a[key], b[key], nextPrefix));
  });

  return differences;
}

function saveTimelineProgress(sceneId) {
  if (!sceneId || !storageAvailable()) {
    return;
  }

  const payload = {
    selections: state.timelineSelections,
    attempts: state.timelineAttempts,
    results: state.timelineResults,
    updatedAt: Date.now(),
  };

  const serialized = JSON.stringify(payload);
  const success = attemptStorageWrite(() => {
    window.localStorage.setItem(getTimelineStorageKey(sceneId), serialized);
  }, sceneId);
  if (!success) {
    console.warn('Unable to persist timeline progress.');
  }
}

function isQuotaExceededError(error) {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22 || error.code === 1014)
  );
}

function evictOldestTimelineEntry(excludeSceneId) {
  if (!storageAvailable()) {
    return false;
  }

  let oldestKey = null;
  let oldestTimestamp = Number.POSITIVE_INFINITY;

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(STORAGE_KEYS.timelinePrefix)) {
        continue;
      }

      const sceneId = key.slice(STORAGE_KEYS.timelinePrefix.length);
      if (sceneId === excludeSceneId) {
        continue;
      }

      const raw = window.localStorage.getItem(key);
      if (!raw) {
        continue;
      }

      try {
        const parsed = JSON.parse(raw);
        const timestamp = Number(parsed?.updatedAt);
        if (Number.isFinite(timestamp) && timestamp < oldestTimestamp) {
          oldestTimestamp = timestamp;
          oldestKey = key;
        }
      } catch (parseError) {
        oldestKey = key;
        oldestTimestamp = Number.NEGATIVE_INFINITY;
        break;
      }
    }

    if (oldestKey) {
      window.localStorage.removeItem(oldestKey);
      return true;
    }
  } catch (error) {
    console.warn('Unable to evict timeline entry.', error);
  }

  return false;
}

function loadGameplayProgress() {
  if (!storageAvailable()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.gameplay);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn('Unable to read saved gameplay progress.', error);
    return null;
  }
}

function sanitizeCharacter(savedCharacter, fallbackCharacter) {
  const base = {
    label: fallbackCharacter.label,
    name: fallbackCharacter.name,
    stuffing: fallbackCharacter.stuffing,
    heart: fallbackCharacter.heart,
    buttons: fallbackCharacter.buttons,
    die: fallbackCharacter.die,
    statuses: [...fallbackCharacter.statuses],
    items: { ...fallbackCharacter.items },
  };

  if (!savedCharacter || typeof savedCharacter !== 'object') {
    return base;
  }

  const dieOption = DIE_OPTIONS.find((option) => option.value === savedCharacter.die)?.value ?? null;
  const validStatuses = Array.isArray(savedCharacter.statuses)
    ? Array.from(
        new Set(savedCharacter.statuses.filter((status) => STATUS_OPTIONS.some((option) => option.value === status)))
      )
    : base.statuses;

  return {
    ...base,
    name: CHARACTER_NAMES.includes(savedCharacter.name) ? savedCharacter.name : base.name,
    stuffing: clampNumber(savedCharacter.stuffing, 0, 5, base.stuffing),
    heart: clampNumber(savedCharacter.heart, 0, Number.POSITIVE_INFINITY, base.heart),
    buttons: clampNumber(savedCharacter.buttons, 0, Number.POSITIVE_INFINITY, base.buttons),
    die: dieOption,
    statuses: validStatuses,
    items: normalizeItemSlots(savedCharacter.items),
  };
}

function applyGameplayState(saved) {
  if (!saved || typeof saved !== 'object') {
    throw new Error('Invalid gameplay data');
  }

  if (!Array.isArray(saved.characters) || saved.characters.length === 0) {
    throw new Error('Gameplay data missing characters.');
  }

  state.characters = state.characters.map((character, index) => {
    const savedCharacter = saved.characters[index];
    return sanitizeCharacter(savedCharacter, character);
  });

  if (typeof saved.activeCharacterIndex === 'number') {
    const indexValue = clampNumber(saved.activeCharacterIndex, 0, state.characters.length - 1, state.activeCharacterIndex);
    state.activeCharacterIndex = indexValue;
  } else if (state.activeCharacterIndex >= state.characters.length) {
    state.activeCharacterIndex = 0;
  }
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  let next = Math.round(numeric);
  if (Number.isFinite(min) && next < min) {
    next = min;
  }
  if (Number.isFinite(max) && next > max) {
    next = max;
  }
  return next;
}

function hydrateGameplayState() {
  const saved = loadGameplayProgress();
  if (!saved) {
    return;
  }

  try {
    applyGameplayState(saved);
  } catch (error) {
    console.warn('Unable to hydrate gameplay state.', error);
  }
}

function saveGameplayProgress() {
  if (state.role === 'teacher' && state.teacherView === 'session') {
    updateActiveTeacherSession((session) => {
      session.gameplay = getGameplaySnapshot();
      return session;
    });
    return;
  }

  if (!storageAvailable()) {
    return;
  }

  const payload = getGameplaySnapshot();

  const success = attemptStorageWrite(() => {
    window.localStorage.setItem(STORAGE_KEYS.gameplay, JSON.stringify(payload));
  });
  if (!success) {
    console.warn('Unable to persist gameplay progress.');
    return;
  }

  scheduleDriveAutosave('student');
}

function getGameplaySnapshot() {
  return {
    version: 1,
    activeCharacterIndex: state.activeCharacterIndex,
    characters: state.characters.map((character) => ({
      label: character.label,
      name: character.name,
      stuffing: character.stuffing,
      heart: character.heart,
      buttons: character.buttons,
      die: character.die,
      statuses: [...character.statuses],
      items: { ...character.items },
    })),
  };
}

function getDefaultGameplaySnapshot() {
  return {
    version: 1,
    activeCharacterIndex: 0,
    characters: [
      createDefaultCharacter('Character 1', 'Lumpy'),
      createDefaultCharacter('Character 2', 'Flops'),
    ],
  };
}

function downloadGameplayBackup() {
  const payload = {
    exportedAt: new Date().toISOString(),
    data: getGameplaySnapshot(),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `stuffed-fable-gameplay-backup-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function extractGameplayData(raw) {
  if (raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object') {
    return raw.data;
  }
  return raw;
}

function loadTeacherSessions() {
  if (!storageAvailable()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.teacherSessions);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((entry) => sanitizeTeacherSession(entry)).filter(Boolean);
  } catch (error) {
    console.warn('Unable to load teacher sessions.', error);
    return [];
  }
}

function sanitizeTeacherSession(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const now = Date.now();
  return {
    id: typeof entry.id === 'string' ? entry.id : `session-${now}`,
    name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Untitled Session',
    createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : now,
    updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : now,
    gameplay: entry.gameplay && typeof entry.gameplay === 'object' ? entry.gameplay : getDefaultGameplaySnapshot(),
    sceneProgress: entry.sceneProgress && typeof entry.sceneProgress === 'object' ? { ...entry.sceneProgress } : {},
    sleepCards: Array.isArray(entry.sleepCards) ? entry.sleepCards.map(sanitizeSleepCard).filter(Boolean) : [],
    lostCards: Array.isArray(entry.lostCards) ? entry.lostCards.map(sanitizeLostCard).filter(Boolean) : [],
  };
}

function sanitizeSleepCard(card) {
  if (!card || typeof card !== 'object') {
    return null;
  }
  const validStatuses = ['sleeping', 'restless', 'waking'];
  const status = validStatuses.includes(card.status) ? card.status : 'sleeping';
  return {
    id: typeof card.id === 'string' ? card.id : `sleep-${Date.now()}`,
    status,
  };
}

function sanitizeLostCard(card) {
  if (!card || typeof card !== 'object') {
    return null;
  }
  return {
    id: typeof card.id === 'string' ? card.id : `lost-${Date.now()}`,
    name: typeof card.name === 'string' ? card.name : '',
  };
}

function persistTeacherSessions(updatedSessionId = null) {
  if (!storageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEYS.teacherSessions, JSON.stringify(state.teacherSessions));
    scheduleDriveAutosave('teacher', updatedSessionId ?? state.selectedTeacherSessionId);
  } catch (error) {
    console.warn('Unable to save teacher sessions.', error);
  }
}

function createTeacherSession(name) {
  const now = Date.now();
  return {
    id: `session-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: name?.trim() || `Session ${state.teacherSessions.length + 1}`,
    createdAt: now,
    updatedAt: now,
    gameplay: getDefaultGameplaySnapshot(),
    sceneProgress: {},
    sleepCards: [],
    lostCards: [],
  };
}

function deleteTeacherSession(sessionId) {
  const nextSessions = state.teacherSessions.filter((session) => session.id !== sessionId);
  if (nextSessions.length === state.teacherSessions.length) {
    return false;
  }

  state.teacherSessions = nextSessions;
  if (state.selectedTeacherSessionId === sessionId) {
    state.selectedTeacherSessionId = null;
  }

  persistTeacherSessions(sessionId);
  return true;
}

function getActiveTeacherSession() {
  if (!state.selectedTeacherSessionId) {
    return null;
  }
  return state.teacherSessions.find((session) => session.id === state.selectedTeacherSessionId) ?? null;
}

function updateActiveTeacherSession(updater) {
  const session = getActiveTeacherSession();
  if (!session) {
    return;
  }
  const next = updater(session);
  if (next && next !== session) {
    const index = state.teacherSessions.findIndex((item) => item.id === session.id);
    if (index >= 0) {
      state.teacherSessions[index] = next;
    }
  }
  session.updatedAt = Date.now();
  persistTeacherSessions(session.id);
}

function hydrateFromStorage() {
  hydrateGameplayState();
  state.teacherSessions = loadTeacherSessions();
}

async function init() {
  renderBaseLayout();
  setupTeacherControls();
  hydrateFromStorage();
  await loadScenes();

  if (state.scenes.length > 0) {
    state.selectedSceneId = state.scenes[0].id;
    prepareScene(state.selectedSceneId);
  } else {
    prepareScene(null);
  }

  renderModeToggle();
  renderReadingNav();
  renderGameplayNav();
  renderContent();
}

async function loadScenes() {
  state.isLoadingScenes = true;
  renderReadingNav();

  try {
    const files = await discoverSceneFiles();
    const loadedScenes = [];

    for (const fileName of files) {
      try {
        const response = await fetch(`./scenes/${fileName}`, { cache: 'no-cache' });
        if (!response.ok) {
          console.error(`Unable to load scene file: ${fileName}`);
          continue;
        }

        const data = await response.json();
        loadedScenes.push({
          id: fileName.replace(/\.json$/i, ''),
          data,
        });
      } catch (error) {
        console.error(`Error parsing scene file: ${fileName}`, error);
      }
    }

    loadedScenes.sort((a, b) => compareSceneIds(a.id, b.id));
    state.scenes = loadedScenes;

    if (!loadedScenes.some((scene) => scene.id === state.selectedSceneId)) {
      state.selectedSceneId = loadedScenes[0]?.id ?? null;
    }
  } catch (error) {
    console.error('Failed to discover scenes', error);
    state.scenes = [];
    state.selectedSceneId = null;
  } finally {
    state.isLoadingScenes = false;
  }
}

async function discoverSceneFiles() {
  try {
    const response = await fetch('./scenes/scene-index.json', { cache: 'no-cache' });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.files)) {
        const files = data.files
          .filter((file) => typeof file === 'string' && file.endsWith('.json'))
          .filter((file) => !file.endsWith('scene-index.json'))
          .sort((a, b) => compareSceneIds(a.replace(/\.json$/i, ''), b.replace(/\.json$/i, '')));

        if (files.length > 0) {
          return files;
        }
      }
    } else {
      console.warn('Scene manifest returned a non-success status.', response.status);
    }
  } catch (manifestError) {
    console.warn('Unable to load scene manifest. Attempting directory listing fallback.', manifestError);
  }

  const directoryUrl = './scenes/';

  try {
    const response = await fetch(directoryUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });

    if (response.ok) {
      const contentType = response.headers.get('Content-Type') ?? '';
      if (contentType.includes('text/html')) {
        const html = await response.text();
        const parser = new DOMParser();
        const documentFragment = parser.parseFromString(html, 'text/html');
        const files = Array.from(documentFragment.querySelectorAll('a'))
          .map((anchor) => anchor.getAttribute('href') ?? '')
          .map((href) => href.replace(/\/$/, ''))
          .filter((href) => href.endsWith('.json'))
          .filter((href) => !href.endsWith('scene-index.json'))
          .map((href) => href.split('/').pop())
          .filter(Boolean);

        if (files.length > 0) {
          return Array.from(new Set(files)).sort((a, b) =>
            compareSceneIds(a.replace(/\.json$/i, ''), b.replace(/\.json$/i, ''))
          );
        }
      }
    }
  } catch (error) {
    console.warn('Directory listing unavailable.', error);
  }

  return [];
}

function renderBaseLayout() {
  app.innerHTML = `
    <div class="app-container">
      <header id="readingNav" class="top-nav"></header>
      <header id="gameplayNav" class="top-nav hidden"></header>
      <main id="content"></main>
    </div>
    <button id="modeToggle" class="mode-toggle" type="button"></button>
    <div id="vocabModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
      <div class="modal-content vocab-modal">
        <button class="modal-close" data-close-target="vocabModal" aria-label="Close vocabulary">✕</button>
        <h3 id="vocabWord"></h3>
        <p id="vocabDefinition" class="vocab-definition"></p>
        <h4>Example sentences</h4>
        <ul id="vocabExamples" class="vocab-examples"></ul>
      </div>
    </div>
    <div id="timelineModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
      <div class="modal-content timeline-modal">
        <button class="modal-close" data-close-target="timelineModal" aria-label="Close event picker">✕</button>
        <h3>Select the matching event</h3>
        <div id="timelineOptions" class="timeline-modal-options"></div>
      </div>
    </div>
    <div id="sessionModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
      <div class="modal-content teacher-modal">
        <button class="modal-close" data-close-target="sessionModal" aria-label="Close session modal">✕</button>
        <h3>Create a New Session</h3>
        <label class="modal-label" for="sessionNameInput">Session Name</label>
        <input id="sessionNameInput" type="text" class="modal-input" placeholder="Enter a name" />
        <div class="modal-actions">
          <button type="button" class="secondary-button" data-close-target="sessionModal">Cancel</button>
          <button id="sessionCreateButton" type="button" class="secondary-button primary">Create Session</button>
        </div>
      </div>
    </div>
    <div id="downloadModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
      <div class="modal-content teacher-modal">
        <button class="modal-close" data-close-target="downloadModal" aria-label="Close download modal">✕</button>
        <h3>Download Saved Progress</h3>
        <p>Select the sessions you want to export.</p>
        <div class="download-toolbar">
          <button type="button" id="selectAllSessions" class="secondary-button">Select all</button>
          <button type="button" id="clearAllSessions" class="secondary-button">Deselect all</button>
        </div>
        <div id="downloadSessionList" class="session-checkbox-list"></div>
        <div class="modal-actions">
          <button type="button" class="secondary-button" data-close-target="downloadModal">Cancel</button>
          <button id="driveBackupButton" type="button" class="secondary-button secondary">Back up to Drive</button>
          <button id="downloadSessionsButton" type="button" class="secondary-button primary">Download</button>
        </div>
      </div>
    </div>
    <div id="sceneStatusModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
      <div class="modal-content teacher-modal">
        <button class="modal-close" data-close-target="sceneStatusModal" aria-label="Close scene status">✕</button>
        <h3>Update Scene Progress</h3>
        <p id="sceneStatusMessage"></p>
        <div class="modal-actions">
          <button id="markSceneStarted" type="button" class="secondary-button">Mark Started</button>
          <button id="markSceneFinished" type="button" class="secondary-button">Mark Finished</button>
          <button id="skipSceneStatus" type="button" class="secondary-button">Don't change</button>
        </div>
      </div>
    </div>
    <div id="scenePromptModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
      <div class="modal-content teacher-modal">
        <button class="modal-close" data-close-target="scenePromptModal" aria-label="Close scene prompt">✕</button>
        <h3>Resume Story Progress</h3>
        <p id="scenePromptMessage"></p>
        <div class="modal-actions" id="scenePromptActions"></div>
      </div>
    </div>
    <div id="sleepCardModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
      <div class="modal-content teacher-modal">
        <button class="modal-close" data-close-target="sleepCardModal" aria-label="Close sleep card modal">✕</button>
        <h3 id="sleepCardModalTitle">Sleep Card</h3>
        <div class="sleep-status-options">
          ${['sleeping', 'restless', 'waking']
            .map((status) => `<button type="button" class="status-chip" data-status="${status}">${status}</button>`)
            .join('')}
        </div>
        <div class="modal-actions">
          <button id="sleepCardDelete" type="button" class="secondary-button">Delete</button>
          <button id="sleepCardSave" type="button" class="secondary-button primary">Save</button>
        </div>
      </div>
    </div>
    <div id="lostCardModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
      <div class="modal-content teacher-modal">
        <button class="modal-close" data-close-target="lostCardModal" aria-label="Close lost card modal">✕</button>
        <h3 id="lostCardModalTitle">Lost Card</h3>
        <label class="modal-label" for="lostCardInput">Card Name</label>
        <input id="lostCardInput" type="text" class="modal-input" />
        <div class="modal-actions">
          <button id="lostCardDelete" type="button" class="secondary-button">Delete</button>
          <button id="lostCardSave" type="button" class="secondary-button primary">Save</button>
        </div>
      </div>
    </div>
    <div id="driveConflictModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
      <div class="modal-content teacher-modal">
        <button class="modal-close" data-close-target="driveConflictModal" aria-label="Close backup chooser">✕</button>
        <h3>Choose a Drive backup to load</h3>
        <p id="driveConflictMessage" class="muted-text"></p>
        <ul id="driveConflictDifferences" class="drive-diff-list"></ul>
        <div class="modal-actions">
          <button id="loadAutosaveButton" type="button" class="secondary-button">Load autosave</button>
          <button id="loadManualButton" type="button" class="secondary-button primary">Load manual save</button>
        </div>
      </div>
    </div>
  `;

  app.querySelectorAll('.modal-close').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.dataset.closeTarget));
  });

  [
    'vocabModal',
    'timelineModal',
    'sessionModal',
    'downloadModal',
    'sceneStatusModal',
    'scenePromptModal',
    'sleepCardModal',
    'lostCardModal',
    'driveConflictModal',
  ].forEach((id) => {
    const modal = document.getElementById(id);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal(id);
      }
    });
  });
}

function setupTeacherControls() {
  const createButton = document.getElementById('sessionCreateButton');
  if (createButton) {
    createButton.addEventListener('click', handleCreateSession);
  }
  const nameInput = document.getElementById('sessionNameInput');
  if (nameInput) {
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleCreateSession();
      }
    });
  }

  const selectAll = document.getElementById('selectAllSessions');
  if (selectAll) {
    selectAll.addEventListener('click', selectAllDownloadSessions);
  }
  const clearAll = document.getElementById('clearAllSessions');
  if (clearAll) {
    clearAll.addEventListener('click', clearAllDownloadSessions);
  }
  const downloadButton = document.getElementById('downloadSessionsButton');
  if (downloadButton) {
    downloadButton.addEventListener('click', handleDownloadConfirm);
  }
  const driveButton = document.getElementById('driveBackupButton');
  if (driveButton) {
    driveButton.addEventListener('click', handleDriveBackup);
  }

  const loadAutosave = document.getElementById('loadAutosaveButton');
  if (loadAutosave) {
    loadAutosave.addEventListener('click', () => confirmDriveLoad('autosave'));
  }
  const loadManual = document.getElementById('loadManualButton');
  if (loadManual) {
    loadManual.addEventListener('click', () => confirmDriveLoad('manual'));
  }

  const startedButton = document.getElementById('markSceneStarted');
  if (startedButton) {
    startedButton.addEventListener('click', () => {
      const targetScene = state.pendingSceneStatusTarget ?? state.selectedSceneId;
      const destinationScene = state.pendingSceneChange ?? state.selectedSceneId;
      if (targetScene) {
        setTeacherSceneStatus('started', targetScene);
      }
      closeModal('sceneStatusModal');
      state.pendingSceneChange = null;
      state.pendingSceneStatusTarget = null;
      applySceneChange(destinationScene);
    });
  }

  const finishedButton = document.getElementById('markSceneFinished');
  if (finishedButton) {
    finishedButton.addEventListener('click', () => {
      const targetScene = state.pendingSceneStatusTarget ?? state.selectedSceneId;
      const destinationScene = state.pendingSceneChange ?? state.selectedSceneId;
      if (targetScene) {
        setTeacherSceneStatus('finished', targetScene);
      }
      closeModal('sceneStatusModal');
      state.pendingSceneChange = null;
      state.pendingSceneStatusTarget = null;
      applySceneChange(destinationScene);
    });
  }

  const skipButton = document.getElementById('skipSceneStatus');
  if (skipButton) {
    skipButton.addEventListener('click', () => {
      const destinationScene = state.pendingSceneChange ?? state.selectedSceneId;
      closeModal('sceneStatusModal');
      state.pendingSceneChange = null;
      state.pendingSceneStatusTarget = null;
      applySceneChange(destinationScene);
    });
  }

  document.querySelectorAll('#sleepCardModal .status-chip').forEach((button) => {
    button.addEventListener('click', () => {
      state.pendingSleepStatus = button.dataset.status;
      syncSleepStatusButtons();
    });
  });

  const sleepSave = document.getElementById('sleepCardSave');
  if (sleepSave) {
    sleepSave.addEventListener('click', handleSleepCardSave);
  }
  const sleepDelete = document.getElementById('sleepCardDelete');
  if (sleepDelete) {
    sleepDelete.addEventListener('click', () => {
      if (state.activeSleepCardId) {
        handleSleepCardDelete();
      } else {
        closeModal('sleepCardModal');
      }
    });
  }

  const lostSave = document.getElementById('lostCardSave');
  if (lostSave) {
    lostSave.addEventListener('click', handleLostCardSave);
  }
  const lostDelete = document.getElementById('lostCardDelete');
  if (lostDelete) {
    lostDelete.addEventListener('click', () => {
      if (state.activeLostCardId) {
        handleLostCardDelete();
      } else {
        closeModal('lostCardModal');
      }
    });
  }
}

function renderModeToggle() {
  const button = document.getElementById('modeToggle');
  if (!state.role || (state.role === 'teacher' && state.teacherView === 'home')) {
    button.classList.add('hidden');
    button.onclick = null;
    return;
  }

  button.classList.remove('hidden');
  button.textContent = state.mode === 'reading' ? 'Switch to Gameplay Mode' : 'Switch to Reading Mode';
  button.onclick = () => {
    state.mode = state.mode === 'reading' ? 'gameplay' : 'reading';
    toggleNavVisibility();
    renderModeToggle();
    renderContent();
  };
  toggleNavVisibility();
}

function toggleNavVisibility() {
  const readingNav = document.getElementById('readingNav');
  const gameplayNav = document.getElementById('gameplayNav');
  if (!state.role || (state.role === 'teacher' && state.teacherView === 'home')) {
    readingNav.classList.add('hidden');
    gameplayNav.classList.add('hidden');
    return;
  }

  if (state.mode === 'reading') {
    readingNav.classList.remove('hidden');
    gameplayNav.classList.add('hidden');
  } else {
    readingNav.classList.add('hidden');
    gameplayNav.classList.remove('hidden');
  }
}

function renderReadingNav() {
  const nav = document.getElementById('readingNav');
  if (!state.role || (state.role === 'teacher' && state.teacherView === 'home')) {
    nav.innerHTML = '';
    return;
  }

  const isTeacherSession = state.role === 'teacher' && state.teacherView === 'session';
  const session = isTeacherSession ? getActiveTeacherSession() : null;
  const progressMap = session?.sceneProgress ?? {};
  const options = [...state.scenes]
    .sort((a, b) => compareSceneIds(a.id, b.id))
    .map((scene) => {
      const status = progressMap[scene.id];
      const symbol = status === 'finished' ? ' ✓' : status === 'started' ? ' …' : '';
      return `<option value="${scene.id}" ${scene.id === state.selectedSceneId ? 'selected' : ''}>${scene.id}${symbol}</option>`;
    })
    .join('');
  let selectMarkup = options;

  if (state.isLoadingScenes) {
    selectMarkup = '<option selected disabled>Loading scenes…</option>';
  } else if (state.scenes.length === 0) {
    selectMarkup = '<option selected disabled>No scenes found</option>';
  }

  nav.innerHTML = `
    <span class="nav-title">Reading Mode</span>
    <div class="select-control">
      <label for="sceneSelect">Page · Scene</label>
      <select id="sceneSelect" ${state.isLoadingScenes || state.scenes.length === 0 ? 'disabled' : ''}>
        ${selectMarkup}
      </select>
    </div>
    <div class="tab-group" role="tablist">
      <button class="tab-button ${state.readingTab === 'narrative' ? 'active' : ''}" data-tab="narrative" type="button">Narrative</button>
      <button class="tab-button ${state.readingTab === 'timeline' ? 'active' : ''}" data-tab="timeline" type="button">Timeline</button>
    </div>
  `;

  const select = nav.querySelector('#sceneSelect');
  if (select) {
    select.addEventListener('change', (event) => {
      const nextSceneId = event.target.value;
      if (isTeacherSession) {
        event.target.value = state.selectedSceneId;
        requestSceneStatusUpdate(nextSceneId);
        return;
      }
      state.selectedSceneId = nextSceneId;
      prepareScene(nextSceneId);
      renderContent();
    });
  }

  nav.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      state.readingTab = button.dataset.tab;
      renderReadingNav();
      renderContent();
    });
  });
}

function renderGameplayNav() {
  const nav = document.getElementById('gameplayNav');
  if (!state.role || (state.role === 'teacher' && state.teacherView === 'home')) {
    nav.innerHTML = '';
    return;
  }

  const isTeacherSession = state.role === 'teacher' && state.teacherView === 'session';
  nav.innerHTML = `
    <span class="nav-title">Gameplay Mode</span>
    <div class="tab-group" role="tablist">
      ${
        isTeacherSession
          ? `<button class="tab-button ${state.showGameStatus ? 'active' : ''}" data-status-tab="status" type="button">Game Status</button>`
          : ''
      }
      ${state.characters
        .map(
          (character, index) => `
            <button class="tab-button ${!state.showGameStatus && state.activeCharacterIndex === index ? 'active' : ''}" data-character-index="${index}" type="button">
              ${character.label} (${character.name})
            </button>
          `
        )
        .join('')}
    </div>
  `;

  nav.querySelectorAll('button[data-character-index]').forEach((button) => {
    button.addEventListener('click', () => {
      state.showGameStatus = false;
      state.activeCharacterIndex = Number(button.dataset.characterIndex);
      saveGameplayProgress();
      renderGameplayNav();
      renderContent();
    });
  });

  const statusButton = nav.querySelector('button[data-status-tab]');
  if (statusButton) {
    statusButton.addEventListener('click', () => {
      state.showGameStatus = true;
      renderGameplayNav();
      renderContent();
    });
  }
}

function prepareScene(sceneId) {
  if (!sceneId) {
    state.vocabularyMap = {};
    state.timelineOptionPool = [];
    state.timelineSelections = {};
    state.timelineResults = {};
    state.timelineAttempts = 0;
    state.timelineConflicts = new Set();
    return;
  }
  const scene = getScene(sceneId);
  const vocabulary = scene?.narrative?.vocabulary ?? [];
  state.vocabularyMap = vocabulary.reduce((map, entry) => {
    map[entry.word.toLowerCase()] = entry;
    return map;
  }, {});

  prepareTimeline(sceneId, scene);
  state.readingTab = 'narrative';
  state.activeTimelineTile = null;
  renderReadingNav();
}

function prepareTimeline(sceneId, scene) {
  const events = scene?.timeline?.events ?? [];
  const blanks = events.filter((event) => event.type === 'blank');
  const blankTexts = blanks.map((event) => event.text);
  const distractors = scene?.timeline?.distractors ?? [];
  state.timelineOptionPool = shuffle([...blankTexts, ...distractors]);
  state.timelineSelections = {};
  state.timelineConflicts = new Set();
  state.timelineResults = {};
  state.timelineAttempts = 0;

  const saved = loadTimelineProgress(sceneId);
  if (saved) {
    const selections = saved.selections && typeof saved.selections === 'object' ? saved.selections : {};
    const normalizedSelections = {};
    Object.entries(selections).forEach(([index, value]) => {
      const numericIndex = Number(index);
      if (
        Number.isInteger(numericIndex) &&
        numericIndex >= 0 &&
        numericIndex < events.length &&
        events[numericIndex]?.type === 'blank' &&
        typeof value === 'string' &&
        value
      ) {
        normalizedSelections[numericIndex] = value;
      }
    });

    const results = saved.results && typeof saved.results === 'object' ? saved.results : {};
    const normalizedResults = {};
    Object.entries(results).forEach(([index, value]) => {
      const numericIndex = Number(index);
      if (
        Number.isInteger(numericIndex) &&
        numericIndex >= 0 &&
        numericIndex < events.length &&
        events[numericIndex]?.type === 'blank' &&
        (value === 'correct' || value === 'incorrect')
      ) {
        normalizedResults[numericIndex] = value;
      }
    });

    state.timelineSelections = normalizedSelections;
    state.timelineResults = normalizedResults;
    if (Number.isFinite(saved.attempts)) {
      state.timelineAttempts = Math.max(0, Math.floor(saved.attempts));
    }
    updateTimelineConflicts();
  }
}

function renderContent() {
  const container = document.getElementById('content');
  container.innerHTML = '';

  if (!state.role) {
    renderRoleSelection(container);
    return;
  }

  if (state.role === 'teacher' && state.teacherView === 'home') {
    renderTeacherHome(container);
    return;
  }

  if (state.role === 'teacher' && state.teacherView === 'session') {
    container.appendChild(createTeacherSessionBanner());
  }

  if (state.mode === 'reading') {
    renderReadingContent(container);
  } else {
    if (state.role === 'teacher' && state.teacherView === 'session' && state.showGameStatus) {
      renderTeacherGameStatus(container);
    } else {
      renderGameplayContent(container);
    }
  }
}

function renderRoleSelection(container) {
  const card = document.createElement('section');
  card.className = 'card role-card';
  card.innerHTML = `
    <h2>Who is using the app today?</h2>
    <p class="muted-text">Choose the experience that matches your role.</p>
    <div class="role-actions">
      <button type="button" class="role-button" data-role="student">I'm a Student</button>
      <button type="button" class="role-button secondary" data-role="teacher">I'm a Teacher</button>
    </div>
  `;
  container.appendChild(card);

  card.querySelectorAll('.role-button').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.role === 'student') {
        enterStudentExperience();
      } else {
        enterTeacherExperience();
      }
    });
  });
}

function enterStudentExperience() {
  state.role = 'student';
  state.teacherView = 'home';
  state.showGameStatus = false;
  state.mode = 'reading';
  state.selectedTeacherSessionId = null;
  renderModeToggle();
  toggleNavVisibility();
  renderReadingNav();
  renderGameplayNav();
  renderContent();
}

function enterTeacherExperience() {
  state.role = 'teacher';
  state.teacherView = 'home';
  state.showGameStatus = false;
  state.mode = 'reading';
  state.selectedTeacherSessionId = null;
  state.teacherScenePromptShown = false;
  renderModeToggle();
  toggleNavVisibility();
  renderReadingNav();
  renderGameplayNav();
  renderContent();
}

function renderTeacherHome(container) {
  const hero = document.createElement('section');
  hero.className = 'card teacher-home-card';
  hero.innerHTML = `
    <h2>Teacher Control Room</h2>
    <p class="muted-text">Manage classroom sessions, download backups, and keep the adventure on track.</p>
  `;

  const actions = document.createElement('div');
  actions.className = 'teacher-actions';

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'secondary-button primary';
  addButton.textContent = 'Add session';
  addButton.addEventListener('click', () => {
    openNewSessionModal();
  });

  const downloadButton = document.createElement('button');
  downloadButton.type = 'button';
  downloadButton.className = 'secondary-button';
  downloadButton.textContent = 'Download saved progress';
  downloadButton.addEventListener('click', () => {
    openDownloadModal();
  });

  const googleButton = document.createElement('button');
  googleButton.type = 'button';
  googleButton.className = 'secondary-button secondary';
  googleButton.textContent = state.googleAuth.connected ? 'Google Connected' : 'Log in with Google';
  googleButton.addEventListener('click', () => {
    handleGoogleLogin();
  });

  const manualDriveButton = document.createElement('button');
  manualDriveButton.type = 'button';
  manualDriveButton.className = 'secondary-button primary';
  manualDriveButton.textContent = 'Save to Drive';
  manualDriveButton.disabled = !state.googleAuth.connected;
  manualDriveButton.title = state.googleAuth.connected ? '' : 'Log in to enable Drive saves.';
  manualDriveButton.addEventListener('click', handleManualDriveSave);

  const loadDriveButton = document.createElement('button');
  loadDriveButton.type = 'button';
  loadDriveButton.className = 'secondary-button';
  loadDriveButton.textContent = 'Load from Drive';
  loadDriveButton.disabled = !state.googleAuth.connected;
  loadDriveButton.title = state.googleAuth.connected ? '' : 'Log in to enable Drive saves.';
  loadDriveButton.addEventListener('click', handleDriveLoadRequest);

  const status = document.createElement('span');
  status.className = 'muted-text';
  status.textContent = state.googleAuth.message;

  const driveMeta = document.createElement('span');
  driveMeta.className = 'muted-text';
  const { autosave, manual } = getDriveBackupMetadata('teacher', state.selectedTeacherSessionId);
  driveMeta.textContent = `Autosave: ${formatBackupTimestamp(autosave)} · Manual: ${formatBackupTimestamp(manual)}`;

  actions.append(addButton, downloadButton, googleButton, manualDriveButton, loadDriveButton, status, driveMeta);
  hero.appendChild(actions);
  container.appendChild(hero);

  const sessionGrid = document.createElement('div');
  sessionGrid.className = 'session-grid';

  if (state.teacherSessions.length === 0) {
    const emptyCard = document.createElement('div');
    emptyCard.className = 'session-card empty';
    emptyCard.innerHTML = '<p>No sessions yet. Create one to get started.</p>';
    sessionGrid.appendChild(emptyCard);
  } else {
    const sorted = [...state.teacherSessions].sort((a, b) => b.updatedAt - a.updatedAt);
    sorted.forEach((session) => {
      sessionGrid.appendChild(createSessionCard(session));
    });
  }

  container.appendChild(sessionGrid);
}

function createSessionCard(session) {
  const card = document.createElement('article');
  card.className = 'session-card';
  const title = document.createElement('h3');
  title.textContent = session.name;
  const timestamp = document.createElement('p');
  timestamp.className = 'muted-text';
  timestamp.textContent = `Updated ${formatTimestamp(session.updatedAt)}`;

  const buttonRow = document.createElement('div');
  buttonRow.className = 'session-card-actions';
  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'secondary-button primary';
  openButton.textContent = 'Open session';
  openButton.addEventListener('click', () => {
    enterTeacherSession(session.id);
  });

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'secondary-button danger session-delete-button';
  deleteButton.textContent = 'Delete';
  deleteButton.addEventListener('click', () => {
    const confirmed = window.confirm(`Delete "${session.name}"? This action cannot be undone.`);
    if (!confirmed) {
      return;
    }

    const shouldExitSession = state.selectedTeacherSessionId === session.id && state.teacherView === 'session';
    const deleted = deleteTeacherSession(session.id);
    if (!deleted) {
      return;
    }

    if (shouldExitSession) {
      exitTeacherSession();
      return;
    }

    renderContent();
  });

  buttonRow.append(openButton, deleteButton);
  card.append(title, timestamp, buttonRow);
  return card;
}

function formatTimestamp(value) {
  if (!Number.isFinite(value)) {
    return 'just now';
  }
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return 'just now';
  }
}

function formatBackupTimestamp(entry) {
  if (!entry || !Number.isFinite(entry.updatedAt)) {
    return 'No save';
  }
  return formatTimestamp(entry.updatedAt);
}

function createTeacherSessionBanner() {
  const session = getActiveTeacherSession();
  const card = document.createElement('section');
  card.className = 'card teacher-banner';

  if (!session) {
    card.innerHTML = '<p>No session selected.</p>';
    return card;
  }

  const title = document.createElement('h2');
  title.textContent = session.name;
  const meta = document.createElement('p');
  meta.className = 'muted-text';
  meta.textContent = `Last updated ${formatTimestamp(session.updatedAt)}`;

  const actions = document.createElement('div');
  actions.className = 'teacher-actions';

  const homeButton = document.createElement('button');
  homeButton.type = 'button';
  homeButton.className = 'secondary-button';
  homeButton.textContent = 'Back to home';
  homeButton.addEventListener('click', () => {
    exitTeacherSession();
  });

  const downloadButton = document.createElement('button');
  downloadButton.type = 'button';
  downloadButton.className = 'secondary-button secondary';
  downloadButton.textContent = 'Download this session';
  downloadButton.addEventListener('click', () => {
    openDownloadModal([session.id]);
  });

  actions.append(homeButton, downloadButton);

  const collapsible = document.createElement('details');
  collapsible.className = 'teacher-collapsible teacher-session-info';
  collapsible.open = true;

  const summary = document.createElement('summary');
  summary.className = 'teacher-session-summary';
  const summaryTitle = document.createElement('span');
  summaryTitle.className = 'summary-title';
  summaryTitle.textContent = session.name;
  const summaryMeta = document.createElement('span');
  summaryMeta.className = 'summary-meta muted-text';
  summaryMeta.textContent = `Updated ${formatTimestamp(session.updatedAt)}`;
  summary.append(summaryTitle, summaryMeta);

  const body = document.createElement('div');
  body.className = 'teacher-session-body';
  body.append(title, meta, actions);

  collapsible.append(summary, body);

  card.append(collapsible);
  return card;
}

function enterTeacherSession(sessionId) {
  state.selectedTeacherSessionId = sessionId;
  state.teacherView = 'session';
  state.mode = 'reading';
  state.showGameStatus = false;
  state.teacherScenePromptShown = false;

  const session = getActiveTeacherSession();
  if (!session) {
    alert('Unable to load the selected session.');
    exitTeacherSession();
    return;
  }
  if (session?.gameplay) {
    try {
      applyGameplayState(session.gameplay);
    } catch (error) {
      console.warn('Unable to load gameplay for session.', error);
      applyGameplayState(getDefaultGameplaySnapshot());
    }
  } else {
    applyGameplayState(getDefaultGameplaySnapshot());
  }

  determineTeacherSceneSelection({ shouldPrompt: true });
  renderModeToggle();
  toggleNavVisibility();
  renderReadingNav();
  renderGameplayNav();
  renderContent();
}

function exitTeacherSession() {
  state.teacherView = 'home';
  state.selectedTeacherSessionId = null;
  state.mode = 'reading';
  state.showGameStatus = false;
  renderModeToggle();
  toggleNavVisibility();
  renderReadingNav();
  renderGameplayNav();
  renderContent();
}

function determineTeacherSceneSelection({ shouldPrompt = false } = {}) {
  const session = getActiveTeacherSession();
  if (!session) {
    state.selectedSceneId = null;
    return;
  }

  const sceneIds = state.scenes.map((scene) => scene.id);
  if (sceneIds.length === 0) {
    state.selectedSceneId = null;
    return;
  }

  const progress = session.sceneProgress ?? {};
  const inProgress = sceneIds.filter((id) => progress[id] === 'started');
  if (inProgress.length > 0) {
    const last = inProgress[inProgress.length - 1];
    if (state.selectedSceneId !== last) {
      state.selectedSceneId = last;
      prepareScene(last);
    }
    state.teacherScenePromptShown = true;
    return;
  }

  const finished = sceneIds.filter((id) => progress[id] === 'finished');
  const lastFinished = finished[finished.length - 1] ?? null;
  const nextId = lastFinished ? sceneIds[sceneIds.indexOf(lastFinished) + 1] ?? null : null;

  if (lastFinished && state.selectedSceneId !== lastFinished) {
    state.selectedSceneId = lastFinished;
    prepareScene(lastFinished);
  } else if (!lastFinished && state.selectedSceneId !== sceneIds[0]) {
    state.selectedSceneId = sceneIds[0];
    prepareScene(sceneIds[0]);
  }

  if (shouldPrompt && lastFinished && !state.teacherScenePromptShown) {
    openScenePromptModal(lastFinished, nextId);
    return;
  }

  if (!lastFinished && shouldPrompt) {
    openScenePromptModal(null, sceneIds[0] ?? null);
  }
}

function openNewSessionModal() {
  const input = document.getElementById('sessionNameInput');
  if (input) {
    input.value = '';
    input.focus();
  }
  openModal('sessionModal');
}

function handleCreateSession() {
  const input = document.getElementById('sessionNameInput');
  const name = input?.value?.trim() ?? '';
  const session = createTeacherSession(name);
  state.teacherSessions = [...state.teacherSessions, session];
  persistTeacherSessions(session.id);
  closeModal('sessionModal');
  renderContent();
}

function openDownloadModal(preselectedIds = []) {
  populateDownloadModal(preselectedIds);
  openModal('downloadModal');
}

function populateDownloadModal(preselectedIds = []) {
  const list = document.getElementById('downloadSessionList');
  if (!list) {
    return;
  }
  list.innerHTML = '';
  const idsToCheck = new Set(preselectedIds);
  if (state.teacherSessions.length === 0) {
    const message = document.createElement('p');
    message.className = 'muted-text';
    message.textContent = 'No saved sessions available.';
    list.appendChild(message);
  } else {
    state.teacherSessions.forEach((session) => {
      const label = document.createElement('label');
      label.className = 'session-checkbox';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = session.id;
      if (idsToCheck.size === 0) {
        checkbox.checked = false;
      } else {
        checkbox.checked = idsToCheck.has(session.id);
      }
      const span = document.createElement('span');
      span.textContent = `${session.name} (${formatTimestamp(session.updatedAt)})`;
      label.append(checkbox, span);
      list.appendChild(label);
    });
  }

  const driveButton = document.getElementById('driveBackupButton');
  if (driveButton) {
    driveButton.disabled = !state.googleAuth.connected;
    driveButton.title = state.googleAuth.connected ? '' : 'Log in with Google to enable backups.';
  }
}

function selectAllDownloadSessions() {
  document.querySelectorAll('#downloadSessionList input[type="checkbox"]').forEach((box) => {
    box.checked = true;
  });
}

function clearAllDownloadSessions() {
  document.querySelectorAll('#downloadSessionList input[type="checkbox"]').forEach((box) => {
    box.checked = false;
  });
}

function getSelectedDownloadSessionIds() {
  return Array.from(document.querySelectorAll('#downloadSessionList input[type="checkbox"]'))
    .filter((box) => box.checked)
    .map((box) => box.value);
}

function handleDownloadConfirm() {
  const ids = getSelectedDownloadSessionIds();
  if (ids.length === 0) {
    alert('Select at least one session to download.');
    return;
  }
  downloadSelectedSessions(ids);
}

function requestSceneStatusUpdate(nextSceneId) {
  if (!nextSceneId) {
    return;
  }
  const currentSceneId = state.selectedSceneId;
  const session = getActiveTeacherSession();
  state.pendingSceneChange = nextSceneId;
  state.pendingSceneStatusTarget = currentSceneId;
  const currentStatus = currentSceneId ? session?.sceneProgress?.[currentSceneId] : null;

  if (!currentSceneId || currentStatus === 'finished') {
    state.pendingSceneChange = null;
    state.pendingSceneStatusTarget = null;
    applySceneChange(nextSceneId);
    return;
  }

  const message = document.getElementById('sceneStatusMessage');
  if (message) {
    if (currentSceneId) {
      message.textContent = `Update progress for ${currentSceneId}?`;
    } else {
      message.textContent = 'Update progress before continuing?';
    }
  }
  openModal('sceneStatusModal');
}

function setTeacherSceneStatus(status, sceneId = state.selectedSceneId) {
  const session = getActiveTeacherSession();
  if (!session || !sceneId) {
    return;
  }
  if (!session.sceneProgress) {
    session.sceneProgress = {};
  }
  if (!status) {
    delete session.sceneProgress[sceneId];
  } else {
    if (status === 'started') {
      Object.keys(session.sceneProgress).forEach((key) => {
        if (session.sceneProgress[key] === 'started' && key !== sceneId) {
          session.sceneProgress[key] = 'finished';
        }
      });
    }
    session.sceneProgress[sceneId] = status;
  }
  session.updatedAt = Date.now();
  persistTeacherSessions(session.id);
}

function applySceneChange(sceneId) {
  if (!sceneId) {
    return;
  }
  state.selectedSceneId = sceneId;
  prepareScene(sceneId);
  renderReadingNav();
  renderContent();
}

function openScenePromptModal(lastFinishedId, nextId) {
  const message = document.getElementById('scenePromptMessage');
  const actions = document.getElementById('scenePromptActions');
  if (!message || !actions) {
    return;
  }
  if (lastFinishedId) {
    message.textContent = `The last finished page·scene is ${lastFinishedId}. Where would you like to go next?`;
  } else {
    message.textContent = 'No progress has been recorded yet. Choose a starting point.';
  }
  actions.innerHTML = '';

  if (lastFinishedId) {
    const viewLast = document.createElement('button');
    viewLast.type = 'button';
    viewLast.className = 'secondary-button';
    viewLast.textContent = `View ${lastFinishedId}`;
    viewLast.addEventListener('click', () => {
      state.teacherScenePromptShown = true;
      closeModal('scenePromptModal');
      applySceneChange(lastFinishedId);
    });
    actions.appendChild(viewLast);
  }

  if (nextId) {
    const viewNext = document.createElement('button');
    viewNext.type = 'button';
    viewNext.className = 'secondary-button primary';
    viewNext.textContent = `Go to ${nextId}`;
    viewNext.addEventListener('click', () => {
      state.teacherScenePromptShown = true;
      closeModal('scenePromptModal');
      applySceneChange(nextId);
    });
    actions.appendChild(viewNext);
  } else {
    const note = document.createElement('p');
    note.className = 'muted-text';
    note.textContent = 'The next page·scene has not been created yet.';
    actions.appendChild(note);
  }

  openModal('scenePromptModal');
}

function createSceneProgressControls() {
  const wrapper = document.createElement('div');
  wrapper.className = 'scene-progress-controls';
  const session = getActiveTeacherSession();
  const sceneId = state.selectedSceneId;
  if (!session || !sceneId) {
    wrapper.textContent = 'Select a page·scene to manage progress.';
    return wrapper;
  }

  const status = session.sceneProgress?.[sceneId];
  const info = document.createElement('span');
  info.className = 'muted-text';
  info.textContent =
    status === 'finished'
      ? 'Marked as finished'
      : status === 'started'
      ? 'In progress'
      : 'No progress recorded';
  wrapper.appendChild(info);

  const buttons = document.createElement('div');
  buttons.className = 'scene-progress-buttons';

  if (status !== 'finished') {
    if (status !== 'started') {
      const startButton = document.createElement('button');
      startButton.type = 'button';
      startButton.className = 'secondary-button primary';
      startButton.textContent = 'Mark started';
      startButton.addEventListener('click', () => {
        setTeacherSceneStatus('started');
        renderReadingNav();
        renderContent();
      });
      buttons.appendChild(startButton);
    } else {
      const finishButton = document.createElement('button');
      finishButton.type = 'button';
      finishButton.className = 'secondary-button primary';
      finishButton.textContent = 'Mark finished';
      finishButton.addEventListener('click', () => {
        setTeacherSceneStatus('finished');
        renderReadingNav();
        renderContent();
      });
      buttons.appendChild(finishButton);
    }
  } else {
    const badge = document.createElement('span');
    badge.className = 'status-badge';
    badge.textContent = '✓ Completed';
    buttons.appendChild(badge);
  }

  if (status === 'started' || status === 'finished') {
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'secondary-button secondary';
    resetButton.textContent = 'Reset status';
    resetButton.addEventListener('click', () => {
      setTeacherSceneStatus(null);
      renderReadingNav();
      renderContent();
    });
    buttons.appendChild(resetButton);
  }

  wrapper.appendChild(buttons);
  return wrapper;
}

function renderTeacherGameStatus(container) {
  const session = getActiveTeacherSession();
  const card = document.createElement('section');
  card.className = 'card game-status-card';
  const title = document.createElement('h2');
  title.textContent = 'Game Status';
  card.appendChild(title);

  if (!session) {
    const message = document.createElement('p');
    message.textContent = 'Select a session to manage game status.';
    card.appendChild(message);
    container.appendChild(card);
    return;
  }

  card.appendChild(renderSleepCardSection(session));
  card.appendChild(renderLostCardSection(session));
  container.appendChild(card);
}

function renderSleepCardSection(session) {
  const section = document.createElement('div');
  section.className = 'status-section';
  const heading = document.createElement('h3');
  heading.textContent = 'Revealed Sleep Cards';
  section.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'sleep-card-list';

  if (session.sleepCards.length === 0) {
    const placeholder = document.createElement('p');
    placeholder.className = 'muted-text';
    placeholder.textContent = 'No sleep cards revealed yet.';
    list.appendChild(placeholder);
  } else {
    session.sleepCards.forEach((card) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `sleep-card ${card.status}`;
      item.dataset.cardId = card.id;
      item.textContent = card.status;
      item.addEventListener('click', () => {
        openSleepCardModal(card.id);
      });
      list.appendChild(item);
    });
  }

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'add-card-button';
  addButton.textContent = '+ Add';
  addButton.addEventListener('click', () => {
    openSleepCardModal(null);
  });

  list.appendChild(addButton);
  section.appendChild(list);
  return section;
}

function renderLostCardSection(session) {
  const section = document.createElement('div');
  section.className = 'status-section';
  const heading = document.createElement('h3');
  heading.textContent = 'Lost Cards Obtained';
  section.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'lost-card-list';

  if (session.lostCards.length === 0) {
    const placeholder = document.createElement('p');
    placeholder.className = 'muted-text';
    placeholder.textContent = 'No lost cards have been found.';
    list.appendChild(placeholder);
  } else {
    session.lostCards.forEach((card) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'lost-card';
      item.dataset.cardId = card.id;
      item.textContent = card.name || 'Unnamed card';
      item.addEventListener('click', () => {
        openLostCardModal(card.id);
      });
      list.appendChild(item);
    });
  }

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'add-card-button';
  addButton.textContent = '+ Add';
  addButton.addEventListener('click', () => {
    openLostCardModal(null);
  });

  list.appendChild(addButton);
  section.appendChild(list);
  return section;
}

function openSleepCardModal(cardId) {
  const session = getActiveTeacherSession();
  if (!session) {
    return;
  }
  state.activeSleepCardId = cardId;
  const deleteButton = document.getElementById('sleepCardDelete');
  const title = document.getElementById('sleepCardModalTitle');
  if (cardId) {
    const card = session.sleepCards.find((entry) => entry.id === cardId);
    state.pendingSleepStatus = card?.status ?? 'sleeping';
    if (deleteButton) {
      deleteButton.textContent = 'Delete';
    }
    if (title) {
      title.textContent = 'Edit Sleep Card';
    }
  } else {
    state.pendingSleepStatus = 'sleeping';
    if (deleteButton) {
      deleteButton.textContent = 'Cancel';
    }
    if (title) {
      title.textContent = 'Add Sleep Card';
    }
  }
  syncSleepStatusButtons();
  openModal('sleepCardModal');
}

function syncSleepStatusButtons() {
  document.querySelectorAll('#sleepCardModal .status-chip').forEach((button) => {
    if (button.dataset.status === state.pendingSleepStatus) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }
  });
}

function handleSleepCardSave() {
  const session = getActiveTeacherSession();
  if (!session) {
    return;
  }
  if (!session.sleepCards) {
    session.sleepCards = [];
  }
  if (state.activeSleepCardId) {
    const target = session.sleepCards.find((card) => card.id === state.activeSleepCardId);
    if (target) {
      target.status = state.pendingSleepStatus;
    }
  } else {
    session.sleepCards.push({ id: `sleep-${Date.now()}`, status: state.pendingSleepStatus });
  }
  session.updatedAt = Date.now();
  persistTeacherSessions(session.id);
  closeModal('sleepCardModal');
  renderContent();
}

function handleSleepCardDelete() {
  const session = getActiveTeacherSession();
  if (!session) {
    closeModal('sleepCardModal');
    return;
  }
  if (!state.activeSleepCardId) {
    closeModal('sleepCardModal');
    return;
  }
  session.sleepCards = session.sleepCards.filter((card) => card.id !== state.activeSleepCardId);
  session.updatedAt = Date.now();
  persistTeacherSessions(session.id);
  closeModal('sleepCardModal');
  renderContent();
}

function openLostCardModal(cardId) {
  const session = getActiveTeacherSession();
  if (!session) {
    return;
  }
  state.activeLostCardId = cardId;
  const input = document.getElementById('lostCardInput');
  const title = document.getElementById('lostCardModalTitle');
  const deleteButton = document.getElementById('lostCardDelete');
  if (cardId) {
    const card = session.lostCards.find((entry) => entry.id === cardId);
    if (input) {
      input.value = card?.name ?? '';
    }
    if (title) {
      title.textContent = 'Edit Lost Card';
    }
    if (deleteButton) {
      deleteButton.textContent = 'Delete';
    }
  } else {
    if (input) {
      input.value = '';
    }
    if (title) {
      title.textContent = 'Add Lost Card';
    }
    if (deleteButton) {
      deleteButton.textContent = 'Cancel';
    }
  }
  openModal('lostCardModal');
}

function handleLostCardSave() {
  const session = getActiveTeacherSession();
  const input = document.getElementById('lostCardInput');
  if (!session || !input) {
    return;
  }
  const name = input.value.trim();
  if (!name) {
    alert('Please enter a card name.');
    return;
  }
  if (!session.lostCards) {
    session.lostCards = [];
  }
  if (state.activeLostCardId) {
    const card = session.lostCards.find((entry) => entry.id === state.activeLostCardId);
    if (card) {
      card.name = name;
    }
  } else {
    session.lostCards.push({ id: `lost-${Date.now()}`, name });
  }
  session.updatedAt = Date.now();
  persistTeacherSessions(session.id);
  closeModal('lostCardModal');
  renderContent();
}

function handleLostCardDelete() {
  const session = getActiveTeacherSession();
  if (!session) {
    closeModal('lostCardModal');
    return;
  }
  if (!state.activeLostCardId) {
    closeModal('lostCardModal');
    return;
  }
  session.lostCards = session.lostCards.filter((card) => card.id !== state.activeLostCardId);
  session.updatedAt = Date.now();
  persistTeacherSessions(session.id);
  closeModal('lostCardModal');
  renderContent();
}

function downloadSelectedSessions(ids) {
  const selected = state.teacherSessions.filter((session) => ids.includes(session.id));
  if (selected.length === 0) {
    alert('No matching sessions found.');
    return;
  }
  const files = selected.map((session) => ({
    name: getSessionFilename(session),
    content: JSON.stringify(session, null, 2),
  }));
  let blob;
  let filename;
  if (files.length === 1) {
    blob = new Blob([files[0].content], { type: 'application/json' });
    filename = files[0].name;
  } else {
    blob = createZipArchive(files);
    filename = `stuffed-fable-sessions-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  closeModal('downloadModal');
}

function getSessionFilename(session) {
  const slug = session.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'session'}-${session.id}.json`;
}

function createZipArchive(files) {
  let offset = 0;
  const fileEntries = [];
  const chunks = [];
  const encoder = new TextEncoder();

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const crc = crc32(dataBytes);
    const { time, date } = getZipTimestamp();
    const localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, 0x04034b50, true);
    localHeader.setUint16(4, 20, true);
    localHeader.setUint16(6, 0, true);
    localHeader.setUint16(8, 0, true);
    localHeader.setUint16(10, time, true);
    localHeader.setUint16(12, date, true);
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, dataBytes.length, true);
    localHeader.setUint32(22, dataBytes.length, true);
    localHeader.setUint16(26, nameBytes.length, true);
    localHeader.setUint16(28, 0, true);

    chunks.push(localHeader, nameBytes, dataBytes);
    fileEntries.push({ nameBytes, dataBytes, crc, offset, time, date });
    offset += 30 + nameBytes.length + dataBytes.length;
  });

  const centralChunks = [];
  let centralSize = 0;
  fileEntries.forEach((entry) => {
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 0x0014, true);
    header.setUint16(6, 0x0014, true);
    header.setUint16(8, 0, true);
    header.setUint16(10, 0, true);
    header.setUint16(12, entry.time, true);
    header.setUint16(14, entry.date, true);
    header.setUint32(16, entry.crc, true);
    header.setUint32(20, entry.dataBytes.length, true);
    header.setUint32(24, entry.dataBytes.length, true);
    header.setUint16(28, entry.nameBytes.length, true);
    header.setUint16(30, 0, true);
    header.setUint16(32, 0, true);
    header.setUint16(34, 0, true);
    header.setUint16(36, 0, true);
    header.setUint32(38, 0, true);
    header.setUint32(42, entry.offset, true);
    centralChunks.push(header, entry.nameBytes);
    centralSize += 46 + entry.nameBytes.length;
  });

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, fileEntries.length, true);
  end.setUint16(10, fileEntries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);

  return new Blob([...chunks, ...centralChunks, end], { type: 'application/zip' });
}

function crc32(bytes) {
  const table = (function buildTable() {
    if (crc32.table) {
      return crc32.table;
    }
    const tbl = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let j = 0; j < 8; j += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      tbl[i] = c >>> 0;
    }
    crc32.table = tbl;
    return tbl;
  })();
  let crc = 0 ^ -1;
  bytes.forEach((byte) => {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  });
  return (crc ^ -1) >>> 0;
}

function getZipTimestamp() {
  const now = new Date();
  const time = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | (Math.floor(now.getSeconds() / 2) & 0x1f);
  const date = (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0xf) << 5) | (now.getDate() & 0x1f);
  return { time, date };
}

async function handleDriveBackup() {
  const ids = getSelectedDownloadSessionIds();
  if (ids.length === 0) {
    alert('Select at least one session to back up.');
    return;
  }
  await backupSessionsToDrive(ids);
  closeModal('downloadModal');
}

function getDriveRoleKey() {
  return state.role === 'teacher' ? 'teacher' : 'student';
}

function getDriveSessionKey(roleKey = getDriveRoleKey(), sessionId = null) {
  if (roleKey === 'teacher') {
    return sessionId ?? state.selectedTeacherSessionId;
  }
  return 'student';
}

function setDriveBackupMetadataEntry(roleKey, sessionKey, slot, updatedAt) {
  if (!driveBackupMetadata[roleKey]) {
    driveBackupMetadata[roleKey] = {};
  }
  if (!driveBackupMetadata[roleKey][sessionKey]) {
    driveBackupMetadata[roleKey][sessionKey] = { autosave: null, manual: null };
  }
  driveBackupMetadata[roleKey][sessionKey][slot] = updatedAt
    ? { updatedAt }
    : null;
}

function getDriveBackupMetadata(roleKey = getDriveRoleKey(), sessionId = null) {
  const sessionKey = getDriveSessionKey(roleKey, sessionId);
  const entry = driveBackupMetadata[roleKey]?.[sessionKey];
  return entry || { autosave: null, manual: null };
}

function cloneSessionForBackup(session) {
  if (!session) {
    return null;
  }

  return {
    ...session,
    sceneProgress: { ...(session.sceneProgress ?? {}) },
    gameplay: session.gameplay ? JSON.parse(JSON.stringify(session.gameplay)) : getDefaultGameplaySnapshot(),
    sleepCards: Array.isArray(session.sleepCards) ? [...session.sleepCards] : [],
    lostCards: Array.isArray(session.lostCards) ? [...session.lostCards] : [],
  };
}

function getTeacherDrivePayload(sessionId = null) {
  const sessionKey = sessionId ?? state.selectedTeacherSessionId;
  const session = state.teacherSessions.find((entry) => entry.id === sessionKey);
  if (!session) {
    throw new Error('Select a teacher session before saving to Drive.');
  }
  return {
    session: cloneSessionForBackup(session),
  };
}

function getStudentDrivePayload() {
  return {
    gameplay: getGameplaySnapshot(),
  };
}

function getDrivePayloadByRole(roleKey, sessionKey = null) {
  return roleKey === 'teacher' ? getTeacherDrivePayload(sessionKey) : getStudentDrivePayload();
}

function getDriveFileName(roleKey, slot, sessionKey) {
  if (roleKey === 'teacher') {
    return `stuffed-fable-teacher-${sessionKey}-${slot}.json`;
  }
  return `stuffed-fable-student-${slot}.json`;
}

function getDriveAppProperties(roleKey, slot, sessionKey) {
  return {
    app: 'stuffed-fable-helper',
    role: roleKey,
    slot,
    sessionKey: sessionKey ?? 'student',
  };
}

function buildDriveQuery(roleKey, slot, sessionKey) {
  const props = getDriveAppProperties(roleKey, slot, sessionKey);
  const segments = Object.entries(props).map(
    ([key, value]) => `appProperties has { key='${key}' and value='${value}' }`
  );
  return `${segments.join(' and ')} and trashed = false`;
}

async function ensureDriveAccess() {
  if (GOOGLE_CLIENT_ID.includes('YOUR_') || GOOGLE_API_KEY.includes('YOUR_')) {
    throw new Error('Add your Google API credentials in src/main.js to enable Google Drive backups.');
  }

  await requestGoogleAccessToken();
  state.googleAuth.connected = true;
  state.googleAuth.message = 'Connected to Google Drive';
}

async function findDriveBackupFile(roleKey, slot, sessionKey) {
  await ensureDriveAccess();
  const response = await window.gapi.client.drive.files.list({
    spaces: 'appDataFolder',
    q: buildDriveQuery(roleKey, slot, sessionKey),
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 1,
  });
  return response.result.files?.[0] ?? null;
}

function createMultipartBody(metadata, data, boundary) {
  const delimiter = `--${boundary}`;
  const closeDelimiter = `--${boundary}--`;
  return [
    delimiter,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    delimiter,
    'Content-Type: application/json',
    '',
    JSON.stringify(data),
    closeDelimiter,
    '',
  ].join('\r\n');
}

async function upsertDriveBackup(slot, roleKey, sessionKey, payload) {
  if (!sessionKey) {
    throw new Error('Select a session before saving to Drive.');
  }

  const existing = await findDriveBackupFile(roleKey, slot, sessionKey);
  const metadata = {
    name: getDriveFileName(roleKey, slot, sessionKey),
    parents: ['appDataFolder'],
    appProperties: getDriveAppProperties(roleKey, slot, sessionKey),
  };
  const boundary = `stuffed-fable-${Math.random().toString(36).slice(2)}`;
  const body = createMultipartBody(metadata, payload, boundary);
  const response = await window.gapi.client.request({
    path: existing ? `upload/drive/v3/files/${existing.id}` : 'upload/drive/v3/files',
    method: existing ? 'PATCH' : 'POST',
    params: {
      uploadType: 'multipart',
      fields: 'id,modifiedTime',
    },
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  const modifiedTime = response.result.modifiedTime ? Date.parse(response.result.modifiedTime) : Date.now();
  setDriveBackupMetadataEntry(roleKey, sessionKey, slot, modifiedTime);
  return { updatedAt: modifiedTime, data: payload };
}

async function downloadDriveBackup(slot, roleKey, sessionKey) {
  if (!sessionKey) {
    throw new Error('Select a session before loading from Drive.');
  }
  const file = await findDriveBackupFile(roleKey, slot, sessionKey);
  if (!file) {
    return null;
  }

  const [metaResponse, contentResponse] = await Promise.all([
    window.gapi.client.drive.files.get({
      fileId: file.id,
      fields: 'id,modifiedTime',
    }),
    window.gapi.client.drive.files.get({
      fileId: file.id,
      alt: 'media',
    }),
  ]);

  const content = contentResponse.body ?? contentResponse.result ?? null;
  const parsed = typeof content === 'string' ? JSON.parse(content) : content;
  const modifiedTime = metaResponse.result.modifiedTime ? Date.parse(metaResponse.result.modifiedTime) : Date.now();
  setDriveBackupMetadataEntry(roleKey, sessionKey, slot, modifiedTime);
  return {
    updatedAt: modifiedTime,
    data: parsed,
  };
}

function scheduleDriveAutosave(roleKey = getDriveRoleKey(), sessionId = null) {
  if (!state.googleAuth.connected) {
    return;
  }

  const sessionKey = getDriveSessionKey(roleKey, sessionId);
  if (roleKey === 'teacher' && !sessionKey) {
    return;
  }
  const timerKey = `${roleKey}:${sessionKey ?? 'none'}`;
  if (driveAutosaveTimers[timerKey]) {
    clearTimeout(driveAutosaveTimers[timerKey]);
  }

  driveAutosaveTimers[timerKey] = setTimeout(() => {
    performDriveSave('autosave', roleKey, sessionKey);
  }, 400);
}

async function performDriveSave(slot, roleKey = getDriveRoleKey(), sessionId = null) {
  if (!state.googleAuth.connected) {
    return;
  }
  const sessionKey = getDriveSessionKey(roleKey, sessionId);
  if (roleKey === 'teacher' && !sessionKey) {
    return;
  }
  try {
    const payload = getDrivePayloadByRole(roleKey, sessionKey);
    await upsertDriveBackup(slot, roleKey, sessionKey, payload);
  } catch (error) {
    console.error('Drive save failed', error);
    state.googleAuth.message = 'Drive save failed';
    renderContent();
  }
}

async function handleManualDriveSave() {
  const roleKey = getDriveRoleKey();
  const sessionKey = getDriveSessionKey(roleKey);

  if (roleKey === 'teacher' && !sessionKey) {
    alert('Open a teacher session to save to Drive.');
    return;
  }

  try {
    await ensureDriveAccess();
    const payload = getDrivePayloadByRole(roleKey, sessionKey);
    await upsertDriveBackup('manual', roleKey, sessionKey, payload);
    alert('Manual save uploaded to Drive.');
  } catch (error) {
    console.error('Manual Drive save failed', error);
    alert('Unable to save to Google Drive. Check your connection and credentials.');
  }
}

function describeDifferences(autosave, manual) {
  if (!autosave || !manual) {
    return [];
  }

  const autosaveData = autosave.data ?? {};
  const manualData = manual.data ?? {};

  const autosaveSerialized = stableStringify(autosaveData);
  const manualSerialized = stableStringify(manualData);
  if (autosaveSerialized === manualSerialized) {
    return [];
  }

  return listBackupDifferences(autosaveData, manualData).slice(0, 20);
}

function renderDriveConflictModal(autosave, manual) {
  const message = document.getElementById('driveConflictMessage');
  const diffList = document.getElementById('driveConflictDifferences');

  if (message) {
    message.textContent = `Choose which backup to load. Manual saved ${formatTimestamp(
      manual?.updatedAt
    )}, autosave saved ${formatTimestamp(autosave?.updatedAt)}.`;
  }

  if (diffList) {
    diffList.innerHTML = '';
    const differences = describeDifferences(autosave, manual);
    if (!differences.length) {
      const item = document.createElement('li');
      item.textContent = 'No differences detected.';
      diffList.appendChild(item);
      return;
    }

    differences.forEach((difference) => {
      const item = document.createElement('li');
      item.textContent = difference;
      diffList.appendChild(item);
    });
  }
}

function applyTeacherDrivePayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.session) {
    throw new Error('Invalid teacher backup payload.');
  }

  const session = sanitizeTeacherSession(payload.session);
  if (!session) {
    throw new Error('Invalid teacher session data.');
  }

  const index = state.teacherSessions.findIndex((entry) => entry.id === session.id);
  if (index >= 0) {
    state.teacherSessions[index] = session;
  } else {
    state.teacherSessions = [...state.teacherSessions, session];
  }

  state.selectedTeacherSessionId = session.id;
  persistTeacherSessions(session.id);
  if (state.teacherView === 'session') {
    applyGameplayState(session.gameplay ?? getDefaultGameplaySnapshot());
  }
}

function applyStudentDrivePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid student backup payload.');
  }
  applyGameplayState(payload.gameplay ?? getDefaultGameplaySnapshot());
  saveGameplayProgress();
}

function applyDrivePayload(roleKey, payload, sessionKey = null) {
  if (roleKey === 'teacher') {
    applyTeacherDrivePayload(payload, sessionKey);
  } else {
    applyStudentDrivePayload(payload);
  }

  renderReadingNav();
  renderGameplayNav();
  renderContent();
}

async function handleDriveLoadRequest() {
  const roleKey = getDriveRoleKey();
  const sessionKey = getDriveSessionKey(roleKey);
  if (roleKey === 'teacher' && !sessionKey) {
    alert('Open a teacher session to load backups.');
    return;
  }

  try {
    const [autosave, manual] = await Promise.all([
      downloadDriveBackup('autosave', roleKey, sessionKey),
      downloadDriveBackup('manual', roleKey, sessionKey),
    ]);

    if (!autosave && !manual) {
      alert('No Drive backups available for this view.');
      return;
    }

    if (autosave && manual) {
      const autosaveSerialized = stableStringify(autosave.data ?? {});
      const manualSerialized = stableStringify(manual.data ?? {});
      if (autosaveSerialized !== manualSerialized) {
        state.pendingDriveLoad = { roleKey, sessionKey, autosave, manual };
        renderDriveConflictModal(autosave, manual);
        openModal('driveConflictModal');
        return;
      }
    }

    const payload = (manual ?? autosave)?.data;
    applyDrivePayload(roleKey, payload, sessionKey);
  } catch (error) {
    console.error('Drive load failed', error);
    alert('Unable to load from Google Drive.');
  }
}

function confirmDriveLoad(choice) {
  if (!state.pendingDriveLoad) {
    closeModal('driveConflictModal');
    return;
  }

  const { roleKey, sessionKey, autosave, manual } = state.pendingDriveLoad;
  const selected = choice === 'manual' ? manual : autosave;
  if (!selected) {
    closeModal('driveConflictModal');
    return;
  }

  applyDrivePayload(roleKey, selected.data, sessionKey);
  state.pendingDriveLoad = null;
  closeModal('driveConflictModal');
}

async function backupSessionsToDrive(ids) {
  if (!ids.length) {
    return;
  }
  try {
    await ensureDriveAccess();
    await Promise.all(
      ids.map(async (id) => {
        const payload = getTeacherDrivePayload(id);
        await upsertDriveBackup('manual', 'teacher', id, payload);
      })
    );
    alert('Selected sessions saved to Drive (manual slot).');
  } catch (error) {
    console.error('Bulk Drive backup failed', error);
    alert('Unable to save selected sessions to Google Drive.');
  }
}

async function handleGoogleLogin() {
  if (GOOGLE_CLIENT_ID.includes('YOUR_') || GOOGLE_API_KEY.includes('YOUR_')) {
    alert('Add your Google API credentials in src/main.js to enable Google Drive backups.');
    return;
  }

  state.googleAuth.message = 'Connecting to Google…';
  renderContent();

  try {
    await ensureGoogleClient();
    await requestGoogleAccessToken();
    state.googleAuth.connected = true;
    state.googleAuth.message = 'Connected to Google Drive';
    scheduleDriveAutosave('teacher');
    scheduleDriveAutosave('student');
  } catch (error) {
    console.error('Google login failed', error);
    state.googleAuth.connected = false;
    state.googleAuth.message = 'Google sign-in failed';
    alert('Unable to connect to Google Drive.');
  }

  renderContent();
}

function renderReadingContent(container) {
  if (state.isLoadingScenes) {
    const message = document.createElement('div');
    message.className = 'card';
    message.innerHTML = '<p>Loading scenes…</p>';
    container.appendChild(message);
    return;
  }

  if (!state.selectedSceneId) {
    const message = document.createElement('div');
    message.className = 'card';
    message.innerHTML = '<p>No scenes detected. Add JSON files to the scenes folder.</p>';
    container.appendChild(message);
    return;
  }

  const scene = getScene(state.selectedSceneId);
  if (!scene) {
    const message = document.createElement('div');
    message.className = 'card';
    message.innerHTML = `<p>Unable to load scene <strong>${state.selectedSceneId}</strong>.</p>`;
    container.appendChild(message);
    return;
  }

  const isTeacherSession = state.role === 'teacher' && state.teacherView === 'session';

  if (state.readingTab === 'narrative') {
    renderNarrativeCard(container, scene, { isTeacherSession });
  } else {
    renderTimelineCard(container, scene, { isTeacherSession });
  }
}

function renderNarrativeCard(container, scene, { isTeacherSession = false } = {}) {
  const card = document.createElement('article');
  card.className = 'card narrative-card';
  const title = document.createElement('h2');
  title.textContent = scene.narrative?.title ?? 'Narrative';
  card.appendChild(title);

  if (isTeacherSession) {
    card.appendChild(createSceneProgressControls());
  }

  const vocabulary = scene.narrative?.vocabulary ?? [];
  const vocabularyWords = vocabulary.map((entry) => entry.word);

  (scene.narrative?.paragraphs ?? []).forEach((paragraph) => {
    const p = document.createElement('p');
    p.className = 'narrative-paragraph';
    p.innerHTML = highlightVocabulary(paragraph, vocabularyWords);
    card.appendChild(p);
  });

  container.appendChild(card);

  card.querySelectorAll('.narrative-word').forEach((element) => {
    element.addEventListener('click', () => {
      const entry = state.vocabularyMap[element.dataset.word];
      if (entry) {
        openVocabularyModal(entry);
      }
    });
  });
}

function renderTimelineCard(container, scene, { isTeacherSession = false } = {}) {
  const card = document.createElement('section');
  card.className = 'card timeline-card';
  const title = document.createElement('h2');
  title.textContent = 'Timeline';
  card.appendChild(title);

  const list = document.createElement('div');
  list.className = 'timeline-list';

  (scene.timeline?.events ?? []).forEach((event, index) => {
    const tile = document.createElement('div');
    tile.className = `timeline-tile ${event.type}`;

    if (event.type === 'anchor') {
      tile.textContent = event.text;
      if (isTeacherSession) {
        tile.classList.add('teacher-anchor');
      }
    } else if (isTeacherSession) {
      tile.textContent = event.text;
    } else {
      tile.classList.add('blank');
      const selected = state.timelineSelections[index];
      tile.innerHTML = selected
        ? `<span>${selected}</span>`
        : '<span class="placeholder">Tap to choose the event</span>';
      tile.addEventListener('click', () => {
        state.activeTimelineTile = index;
        openTimelineModal();
      });

      if (state.timelineResults[index] === 'correct') {
        tile.classList.add('correct');
      } else if (state.timelineResults[index] === 'incorrect') {
        tile.classList.add('incorrect');
      }

      if (state.timelineConflicts.has(index)) {
        tile.classList.add('conflict');
      }
    }

    list.appendChild(tile);
  });

  card.appendChild(list);

  if (isTeacherSession) {
    container.appendChild(card);
    return;
  }

  const controls = document.createElement('div');
  controls.className = 'timeline-controls';

  const checkButton = document.createElement('button');
  checkButton.className = 'timeline-check';
  checkButton.type = 'button';
  checkButton.textContent = 'Check Answers';
  checkButton.addEventListener('click', () => {
    evaluateTimeline(scene);
  });

  const attemptCounter = document.createElement('div');
  attemptCounter.className = 'attempt-counter';
  attemptCounter.textContent = `Attempts: ${state.timelineAttempts}`;

  controls.append(checkButton, attemptCounter);
  card.appendChild(controls);
  container.appendChild(card);
}

function renderGameplayContent(container) {
  const card = document.createElement('section');
  card.className = 'card character-card';
  const activeCharacter = state.characters[state.activeCharacterIndex];

  const heading = document.createElement('h2');
  heading.textContent = `${activeCharacter.label} — ${activeCharacter.name}`;
  card.appendChild(heading);

  const nameRow = document.createElement('div');
  nameRow.className = 'character-row';
  nameRow.innerHTML = `
    <label for="characterName">Character</label>
    <select id="characterName" class="character-select">
      ${CHARACTER_NAMES.map(
        (name) => `<option value="${name}" ${activeCharacter.name === name ? 'selected' : ''}>${name}</option>`
      ).join('')}
    </select>
  `;
  card.appendChild(nameRow);

  nameRow.querySelector('select').addEventListener('change', (event) => {
    activeCharacter.name = event.target.value;
    renderGameplayNav();
    saveGameplayProgress();
    renderContent();
  });

  card.appendChild(createCounterRow('Stuffing Points', 'stuffing', activeCharacter, { min: 0, max: 5 }));
  card.appendChild(createCounterRow('Heart Points', 'heart', activeCharacter, { min: 0 }));
  card.appendChild(createCounterRow('Buttons', 'buttons', activeCharacter, { min: 0 }));

  const dieRow = document.createElement('div');
  dieRow.className = 'character-row';
  const dieLabel = document.createElement('label');
  dieLabel.textContent = 'Stored Die';
  dieRow.appendChild(dieLabel);
  const dieOptions = document.createElement('div');
  dieOptions.className = 'die-options';

  DIE_OPTIONS.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'die-option';
    button.style.background = option.color;
    if (activeCharacter.die === option.value) {
      button.classList.add('selected');
    }
    button.addEventListener('click', () => {
      activeCharacter.die = option.value === activeCharacter.die ? null : option.value;
      saveGameplayProgress();
      renderContent();
    });
    dieOptions.appendChild(button);
  });

  dieRow.appendChild(dieOptions);
  card.appendChild(dieRow);

  const statusRow = document.createElement('div');
  statusRow.className = 'character-row';
  const statusLabel = document.createElement('label');
  statusLabel.textContent = 'Status Effects';
  statusRow.appendChild(statusLabel);
  const statusOptions = document.createElement('div');
  statusOptions.className = 'status-options';

  STATUS_OPTIONS.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'status-option';
    button.textContent = option.label;
    if (activeCharacter.statuses.includes(option.value)) {
      button.classList.add('selected');
    }
    button.addEventListener('click', () => {
      const hasStatus = activeCharacter.statuses.includes(option.value);
      activeCharacter.statuses = hasStatus
        ? activeCharacter.statuses.filter((status) => status !== option.value)
        : [...activeCharacter.statuses, option.value];
      saveGameplayProgress();
      renderContent();
    });
    statusOptions.appendChild(button);
  });

  statusRow.appendChild(statusOptions);
  card.appendChild(statusRow);

  const itemsSection = document.createElement('div');
  itemsSection.className = 'items-section';
  const itemsHeading = document.createElement('h3');
  itemsHeading.textContent = 'Items';
  itemsSection.appendChild(itemsHeading);

  const itemGrid = document.createElement('div');
  itemGrid.className = 'item-slot-grid';

  ITEM_SLOTS.forEach(({ key, label }) => {
    const slot = document.createElement('div');
    slot.className = 'item-slot';

    const slotLabel = document.createElement('span');
    slotLabel.className = 'item-slot-label';
    slotLabel.textContent = label;

    const slotValue = document.createElement('span');
    slotValue.className = 'item-slot-value';
    if (activeCharacter.items[key]) {
      slotValue.textContent = activeCharacter.items[key];
    } else {
      slotValue.textContent = 'Empty';
      slotValue.classList.add('empty');
    }

    const slotActions = document.createElement('div');
    slotActions.className = 'item-slot-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'item-slot-btn';
    editButton.textContent = activeCharacter.items[key] ? 'Edit' : 'Add';
    editButton.addEventListener('click', () => {
      const updated = prompt(`Set ${label} item`, activeCharacter.items[key] || '');
      if (updated === null) {
        return;
      }
      const trimmed = updated.trim();
      activeCharacter.items[key] = trimmed;
      saveGameplayProgress();
      renderContent();
    });
    slotActions.appendChild(editButton);

    if (activeCharacter.items[key]) {
      const clearButton = document.createElement('button');
      clearButton.type = 'button';
      clearButton.className = 'item-slot-btn secondary';
      clearButton.textContent = 'Clear';
      clearButton.addEventListener('click', () => {
        activeCharacter.items[key] = '';
        saveGameplayProgress();
        renderContent();
      });
      slotActions.appendChild(clearButton);
    }

    slot.append(slotLabel, slotValue, slotActions);
    itemGrid.appendChild(slot);
  });

  itemsSection.appendChild(itemGrid);
  card.appendChild(itemsSection);

  const backupSection = document.createElement('div');
  backupSection.className = 'backup-controls';

  const backupButton = document.createElement('button');
  backupButton.type = 'button';
  backupButton.className = 'secondary-button';
  backupButton.textContent = 'Back Up Data';
  backupButton.addEventListener('click', () => {
    downloadGameplayBackup();
  });

  const uploadInput = document.createElement('input');
  uploadInput.type = 'file';
  uploadInput.accept = 'application/json';
  uploadInput.className = 'visually-hidden';

  const uploadButton = document.createElement('button');
  uploadButton.type = 'button';
  uploadButton.className = 'secondary-button';
  uploadButton.textContent = 'Restore Backup';
  uploadButton.addEventListener('click', () => {
    uploadInput.click();
  });

  uploadInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const gameplayData = extractGameplayData(parsed);
      applyGameplayState(gameplayData);
      saveGameplayProgress();
      renderGameplayNav();
      renderContent();
    } catch (error) {
      console.error('Backup import failed.', error);
      alert('Unable to import backup file. Please ensure it was created by this app.');
    } finally {
      event.target.value = '';
    }
  });
  const driveSaveButton = document.createElement('button');
  driveSaveButton.type = 'button';
  driveSaveButton.className = 'secondary-button primary';
  driveSaveButton.textContent = 'Save to Drive';
  driveSaveButton.disabled = !state.googleAuth.connected;
  driveSaveButton.title = state.googleAuth.connected ? '' : 'Log in to enable Drive saves.';
  driveSaveButton.addEventListener('click', handleManualDriveSave);

  const driveLoadButton = document.createElement('button');
  driveLoadButton.type = 'button';
  driveLoadButton.className = 'secondary-button';
  driveLoadButton.textContent = 'Load from Drive';
  driveLoadButton.disabled = !state.googleAuth.connected;
  driveLoadButton.title = state.googleAuth.connected ? '' : 'Log in to enable Drive saves.';
  driveLoadButton.addEventListener('click', handleDriveLoadRequest);

  const driveMeta = document.createElement('p');
  driveMeta.className = 'muted-text';
  const { autosave, manual } = getDriveBackupMetadata('student');
  driveMeta.textContent = `Drive autosave: ${formatBackupTimestamp(autosave)} · Manual: ${formatBackupTimestamp(manual)}`;

  backupSection.append(
    backupButton,
    uploadButton,
    driveSaveButton,
    driveLoadButton,
    uploadInput,
    driveMeta
  );
  card.appendChild(backupSection);
  container.appendChild(card);
}

function createCounterRow(labelText, key, character, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const row = document.createElement('div');
  row.className = 'character-row';

  const label = document.createElement('label');
  label.textContent = labelText;
  row.appendChild(label);

  const control = document.createElement('div');
  control.className = 'counter-control';

  const decrease = document.createElement('button');
  decrease.type = 'button';
  decrease.className = 'counter-button';
  decrease.textContent = '−';
  decrease.addEventListener('click', () => {
    const next = Number.isFinite(min) ? Math.max(character[key] - 1, min) : character[key] - 1;
    if (next !== character[key]) {
      character[key] = next;
      saveGameplayProgress();
      renderContent();
    }
  });

  const value = document.createElement('span');
  value.className = 'counter-value';
  value.textContent = character[key];

  const increase = document.createElement('button');
  increase.type = 'button';
  increase.className = 'counter-button';
  increase.textContent = '+';
  increase.addEventListener('click', () => {
    const next = Number.isFinite(max) ? Math.min(character[key] + 1, max) : character[key] + 1;
    if (next !== character[key]) {
      character[key] = next;
      saveGameplayProgress();
      renderContent();
    }
  });

  control.append(decrease, value, increase);
  row.appendChild(control);
  return row;
}

function highlightVocabulary(text, words) {
  let result = text;
  const sortedWords = [...words].sort((a, b) => b.length - a.length);
  sortedWords.forEach((word) => {
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi');
    result = result.replace(pattern, (match) => `<span class="narrative-word" data-word="${word.toLowerCase()}">${match}</span>`);
  });
  return result;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

function openVocabularyModal(entry) {
  const modal = document.getElementById('vocabModal');
  modal.classList.remove('hidden');
  document.getElementById('vocabWord').textContent = entry.word;
  document.getElementById('vocabDefinition').innerHTML = `<strong>${entry.word}</strong> — ${entry.definition}`;
  const examples = document.getElementById('vocabExamples');
  examples.innerHTML = '';
  (entry.examples || []).forEach((example) => {
    const li = document.createElement('li');
    li.textContent = example;
    examples.appendChild(li);
  });
}

function openTimelineModal() {
  const modal = document.getElementById('timelineModal');
  const optionsContainer = document.getElementById('timelineOptions');
  modal.classList.remove('hidden');
  optionsContainer.innerHTML = '';

  state.timelineOptionPool.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'timeline-option';
    button.textContent = option;

    const selectedValues = Object.values(state.timelineSelections).filter(Boolean);
    if (selectedValues.includes(option)) {
      button.classList.add('selected');
    }

    if (state.activeTimelineTile !== null && state.timelineSelections[state.activeTimelineTile] === option) {
      button.classList.add('active');
    }

    button.addEventListener('click', () => {
      if (state.activeTimelineTile !== null) {
        state.timelineSelections[state.activeTimelineTile] = option;
        state.timelineResults = {};
        updateTimelineConflicts();
        saveTimelineProgress(state.selectedSceneId);
        closeModal('timelineModal');
        state.activeTimelineTile = null;
        renderContent();
      }
    });

    optionsContainer.appendChild(button);
  });
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('hidden');
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('hidden');
    if (id === 'timelineModal') {
      state.activeTimelineTile = null;
    }
    if (id === 'sceneStatusModal') {
      state.pendingSceneChange = null;
      state.pendingSceneStatusTarget = null;
    }
    if (id === 'scenePromptModal') {
      state.teacherScenePromptShown = true;
    }
    if (id === 'sleepCardModal') {
      state.activeSleepCardId = null;
    }
    if (id === 'lostCardModal') {
      state.activeLostCardId = null;
    }
    if (id === 'driveConflictModal') {
      state.pendingDriveLoad = null;
    }
  }
}

function evaluateTimeline(scene) {
  const events = scene.timeline?.events ?? [];
  const results = {};
  events.forEach((event, index) => {
    if (event.type === 'blank') {
      const selection = state.timelineSelections[index];
      results[index] = selection && selection === event.text ? 'correct' : 'incorrect';
    }
  });
  state.timelineResults = results;
  state.timelineAttempts += 1;
  saveTimelineProgress(state.selectedSceneId);
  renderContent();
}

function updateTimelineConflicts() {
  const selections = state.timelineSelections;
  const used = new Map();
  const conflicts = new Set();

  Object.entries(selections).forEach(([index, value]) => {
    if (!value) return;
    if (used.has(value)) {
      conflicts.add(Number(index));
      conflicts.add(used.get(value));
    } else {
      used.set(value, Number(index));
    }
  });

  state.timelineConflicts = conflicts;
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getScene(id) {
  return state.scenes.find((scene) => scene.id === id)?.data ?? null;
}

window.addEventListener('DOMContentLoaded', () => {
  init();
});
