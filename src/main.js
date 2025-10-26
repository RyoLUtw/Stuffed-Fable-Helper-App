const CHARACTER_NAMES = ['Lumpy', 'Flops', 'Theadora', 'Stitch', 'Piggle', 'Lionel'];
const DIE_OPTIONS = [
  { value: 'green', color: '#34d399' },
  { value: 'yellow', color: '#facc15' },
  { value: 'orange', color: '#fb923c' },
  { value: 'purple', color: '#a855f7' },
  { value: 'blue', color: '#3b82f6' },
];

const state = {
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
    {
      label: 'Character 1',
      name: 'Lumpy',
      stuffing: 0,
      heart: 0,
      buttons: 0,
      die: null,
      items: [],
      activeItemIndex: null,
    },
    {
      label: 'Character 2',
      name: 'Flops',
      stuffing: 0,
      heart: 0,
      buttons: 0,
      die: null,
      items: [],
      activeItemIndex: null,
    },
  ],
  activeCharacterIndex: 0,
};

const app = document.getElementById('app');

async function init() {
  renderBaseLayout();
  renderModeToggle();
  renderReadingNav();
  renderGameplayNav();
  await loadScenes();

  if (state.scenes.length > 0) {
    state.selectedSceneId = state.scenes[0].id;
    prepareScene(state.selectedSceneId);
  } else {
    prepareScene(null);
  }

  renderReadingNav();
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

    loadedScenes.sort((a, b) => a.id.localeCompare(b.id));
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
          return Array.from(new Set(files)).sort((a, b) => a.localeCompare(b));
        }
      }
    }
  } catch (error) {
    console.warn('Directory listing unavailable, falling back to manifest file.', error);
  }

  try {
    const response = await fetch('./scenes/scene-index.json', { cache: 'no-cache' });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.files)) {
        return data.files
          .filter((file) => typeof file === 'string' && file.endsWith('.json'))
          .filter((file) => !file.endsWith('scene-index.json'))
          .sort((a, b) => a.localeCompare(b));
      }
    }
  } catch (manifestError) {
    console.error('Unable to load scene manifest.', manifestError);
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
  `;

  app.querySelectorAll('.modal-close').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.dataset.closeTarget));
  });

  ['vocabModal', 'timelineModal'].forEach((id) => {
    const modal = document.getElementById(id);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal(id);
      }
    });
  });
}

function renderModeToggle() {
  const button = document.getElementById('modeToggle');
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
  const options = state.scenes
    .map((scene) => `<option value="${scene.id}" ${scene.id === state.selectedSceneId ? 'selected' : ''}>${scene.id}</option>`)
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
  nav.innerHTML = `
    <span class="nav-title">Gameplay Mode</span>
    <div class="tab-group" role="tablist">
      ${state.characters
        .map(
          (character, index) => `
            <button class="tab-button ${state.activeCharacterIndex === index ? 'active' : ''}" data-character-index="${index}" type="button">
              ${character.label} (${character.name})
            </button>
          `
        )
        .join('')}
    </div>
  `;

  nav.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeCharacterIndex = Number(button.dataset.characterIndex);
      renderGameplayNav();
      renderContent();
    });
  });
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

  prepareTimeline(scene);
  state.readingTab = 'narrative';
  state.timelineResults = {};
  state.timelineAttempts = 0;
  state.activeTimelineTile = null;
  renderReadingNav();
}

function prepareTimeline(scene) {
  const events = scene?.timeline?.events ?? [];
  const blanks = events.filter((event) => event.type === 'blank');
  const blankTexts = blanks.map((event) => event.text);
  const distractors = scene?.timeline?.distractors ?? [];
  state.timelineOptionPool = shuffle([...blankTexts, ...distractors]);
  state.timelineSelections = {};
  state.timelineConflicts = new Set();
  state.timelineResults = {};
  state.timelineAttempts = 0;
}

function renderContent() {
  const container = document.getElementById('content');
  container.innerHTML = '';

  if (state.mode === 'reading') {
    renderReadingContent(container);
  } else {
    renderGameplayContent(container);
  }
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

  if (state.readingTab === 'narrative') {
    renderNarrativeCard(container, scene);
  } else {
    renderTimelineCard(container, scene);
  }
}

function renderNarrativeCard(container, scene) {
  const card = document.createElement('article');
  card.className = 'card narrative-card';
  const title = document.createElement('h2');
  title.textContent = scene.narrative?.title ?? 'Narrative';
  card.appendChild(title);

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

function renderTimelineCard(container, scene) {
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
      renderContent();
    });
    dieOptions.appendChild(button);
  });

  dieRow.appendChild(dieOptions);
  card.appendChild(dieRow);

  const itemsSection = document.createElement('div');
  itemsSection.className = 'items-section';
  const itemsHeading = document.createElement('h3');
  itemsHeading.textContent = 'Items';
  itemsSection.appendChild(itemsHeading);

  const itemList = document.createElement('div');
  itemList.className = 'item-list';

  if (activeCharacter.items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'placeholder';
    empty.textContent = 'No items recorded yet.';
    itemList.appendChild(empty);
  } else {
    activeCharacter.items.forEach((item, index) => {
      const tile = document.createElement('div');
      tile.className = 'item-tile';
      if (activeCharacter.activeItemIndex === index) {
        tile.classList.add('active');
      }
      tile.innerHTML = `
        <span>${item}</span>
        <span class="item-actions">
          <button class="item-action-btn edit" type="button">Edit</button>
          <button class="item-action-btn delete" type="button">Delete</button>
        </span>
      `;

      tile.addEventListener('click', () => {
        activeCharacter.activeItemIndex = activeCharacter.activeItemIndex === index ? null : index;
        renderContent();
      });

      tile.querySelector('.edit').addEventListener('click', (event) => {
        event.stopPropagation();
        const updated = prompt('Update item', item);
        if (updated && updated.trim()) {
          activeCharacter.items[index] = updated.trim();
          renderContent();
        }
      });

      tile.querySelector('.delete').addEventListener('click', (event) => {
        event.stopPropagation();
        activeCharacter.items.splice(index, 1);
        if (activeCharacter.activeItemIndex === index) {
          activeCharacter.activeItemIndex = null;
        }
        renderContent();
      });

      itemList.appendChild(tile);
    });
  }

  itemsSection.appendChild(itemList);

  const addItemButton = document.createElement('button');
  addItemButton.type = 'button';
  addItemButton.className = 'add-item-btn';
  addItemButton.textContent = 'Add Item';
  addItemButton.addEventListener('click', () => {
    const newItem = prompt('Add new item');
    if (newItem && newItem.trim()) {
      activeCharacter.items.push(newItem.trim());
      renderContent();
    }
  });

  itemsSection.appendChild(addItemButton);
  card.appendChild(itemsSection);
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
        closeModal('timelineModal');
        state.activeTimelineTile = null;
        renderContent();
      }
    });

    optionsContainer.appendChild(button);
  });
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('hidden');
    if (id === 'timelineModal') {
      state.activeTimelineTile = null;
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
