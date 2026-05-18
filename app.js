import { store } from './store.js';
import { makeCommand } from './commands.js';
import {
  DIMENSIONS,
  DIMENSION_BY_ID,
  CATEGORY_LABELS,
  display,
  proportionOf,
  groupByProportion,
  makeCustomDimension,
} from './data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const root = document.getElementById('view');

const MODES = [
  { id: 'custom',   label: 'Custom',   num: '01' },
  { id: 'centered', label: 'Centered', num: '02' },
  { id: 'corner',   label: 'Corner',   num: '03' },
  { id: 'row',      label: 'Row',      num: '04' },
];

// Custom first so user-added sizes sit at the top of the selection list.
const SELECTABLE_CATEGORIES = ['custom', 'photo', 'canvas'];

const REFERENCE_ID = 'ref-human';
const REFERENCE = DIMENSION_BY_ID[REFERENCE_ID];

// Square workspace in centimeters. Fits a 170 cm person and the largest
// canvas (90×30 cm) with room to drag.
const WORKSPACE = 200;
const ITEM_GAP = 4;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ──────────────────────────── template helpers ────────────────────────────

const tplCache = new Map();
const getTpl = (id) => {
  if (!tplCache.has(id)) tplCache.set(id, document.getElementById(id));
  return tplCache.get(id);
};
const clone = (id) => getTpl(id).content.cloneNode(true);
const cloneSvg = (id) => {
  const frag = clone(id);
  return frag.querySelector('svg').firstElementChild;
};
const slot = (frag, name) => frag.querySelector(`[data-slot="${name}"]`);
const cloneRoot = (id) => slot(clone(id), 'self');

const setAttrs = (el, attrs) => {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
};

// ──────────────────────────── selection helpers ────────────────────────────

const getItem = (state, id) =>
  DIMENSION_BY_ID[id] || state.customDimensions.find((d) => d.id === id);

const allDimensions = (state) => [...DIMENSIONS, ...state.customDimensions];

const workItems = (state) =>
  state.selectedIds
    .map((id) => getItem(state, id))
    .filter((d) => d && d.category !== 'reference');

const dimensionsByCategory = (state) => {
  const out = {};
  for (const cat of SELECTABLE_CATEGORIES) out[cat] = [];
  for (const d of allDimensions(state)) if (out[d.category]) out[d.category].push(d);
  return out;
};

// ──────────────────────────── position presets ────────────────────────────

const computePresetPositions = (items, mode) => {
  if (!items.length) return {};

  if (mode === 'centered' || mode === 'custom') {
    // Custom falls back to centered for items the user hasn't dragged yet.
    return Object.fromEntries(items.map((it) => [it.id, {
      x: (WORKSPACE - it.widthCm) / 2,
      y: (WORKSPACE - it.heightCm) / 2,
    }]));
  }

  if (mode === 'corner') {
    const maxW = Math.max(...items.map((i) => i.widthCm));
    const maxH = Math.max(...items.map((i) => i.heightCm));
    const x0 = (WORKSPACE - maxW) / 2;
    const y0 = (WORKSPACE - maxH) / 2;
    return Object.fromEntries(items.map((it) => [it.id, { x: x0, y: y0 }]));
  }

  // row
  const totalW = items.reduce((s, i) => s + i.widthCm, 0) + ITEM_GAP * Math.max(0, items.length - 1);
  const maxH = Math.max(...items.map((i) => i.heightCm));
  const y0 = (WORKSPACE - maxH) / 2;
  let x = (WORKSPACE - totalW) / 2;
  const out = {};
  for (const it of items) {
    out[it.id] = { x, y: y0 + maxH - it.heightCm };
    x += it.widthCm + ITEM_GAP;
  }
  return out;
};

const effectivePositions = (state) => {
  const items = workItems(state);
  const presets = computePresetPositions(items, state.mode);
  if (state.mode !== 'custom') return presets;
  // Custom mode: prefer user-dragged positions, fall back to centered preset.
  const out = {};
  for (const it of items) {
    out[it.id] = state.customPositions[it.id] ?? presets[it.id];
  }
  return out;
};

// ──────────────────────────── command shortcuts ────────────────────────────

const setMode = (to) => {
  const from = store.state.mode;
  if (from === to) return;
  store.dispatch(makeCommand('SET_MODE', { from, to }));
};

const toggle = (id) => store.dispatch(makeCommand('TOGGLE_SELECTION', { id }));

const commitDrag = (id, toX, toY, fromX, fromY, fromMode) => {
  store.dispatch(makeCommand('MOVE_ITEM', { id, toX, toY, fromX, fromY, fromMode }));
};

const setDecoration = (id, kind, to) => {
  const prev = store.state.decorations[id] ?? { mat: 0, frame: 0 };
  const from = prev[kind];
  if (Math.abs(from - to) < 1e-6) return;
  store.dispatch(makeCommand('SET_DECORATION', { id, kind, from, to }));
};

const addCustomDimension = (width, height, unit) => {
  const item = makeCustomDimension(width, height, unit);
  store.dispatch(makeCommand('ADD_CUSTOM_DIMENSION', { item }));
};

const removeCustomDimension = (id) => {
  const s = store.state;
  const item = s.customDimensions.find((d) => d.id === id);
  if (!item) return;
  store.dispatch(makeCommand('REMOVE_CUSTOM_DIMENSION', {
    item,
    wasSelected: s.selectedIds.includes(id),
    color: s.colorAssignments[id],
    decoration: s.decorations[id],
    position: s.customPositions[id],
  }));
};

// ──────────────────────────── rendering ────────────────────────────

const buildTabs = (state) => {
  const out = document.createDocumentFragment();
  for (const m of MODES) {
    const frag = clone('tpl-tab');
    const btn = slot(frag, 'self');
    btn.textContent = m.label;
    btn.dataset.mode = m.id;
    btn.dataset.num = m.num;
    btn.setAttribute('aria-selected', String(m.id === state.mode));
    if (m.id === state.mode) btn.classList.add('is-active');
    out.appendChild(frag);
  }
  return out;
};

const DECORATION_LABELS = { mat: 'Mat', frame: 'Frame' };
const DECORATION_PRESETS = [0, 1, 2];

const buildDecorationRow = (item, kind, value) => {
  const frag = clone('tpl-decoration');
  slot(frag, 'label').textContent = DECORATION_LABELS[kind];
  for (const preset of DECORATION_PRESETS) {
    const btn = slot(frag, `preset${preset}`);
    btn.dataset.decoration = `${item.id}:${kind}:${preset}`;
    if (Math.abs(value - preset) < 1e-6) btn.classList.add('is-active');
  }
  const input = slot(frag, 'input');
  input.dataset.decorationInput = `${item.id}:${kind}`;
  if (value && !DECORATION_PRESETS.some((p) => Math.abs(p - value) < 1e-6)) {
    input.value = value;
  }
  return frag;
};

const buildItem = (item, state, selectedSet) => {
  const frag = clone('tpl-item');
  const d = display(item);
  const colorIdx = state.colorAssignments[item.id];
  const isSel = selectedSet.has(item.id);

  const label = frag.querySelector('label');
  if (isSel) label.classList.add('is-selected');

  const checkbox = slot(frag, 'checkbox');
  checkbox.checked = isSel;
  checkbox.dataset.toggle = item.id;

  const swatch = slot(frag, 'swatch');
  if (colorIdx !== undefined) swatch.classList.add(`color-${colorIdx}`);

  slot(frag, 'name').textContent = d.primary;
  slot(frag, 'alt').textContent = `(${d.secondary})`;
  slot(frag, 'aspect').textContent = proportionOf(item).toFixed(2);

  if (item.category === 'custom') {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'item-remove';
    removeBtn.dataset.removeCustom = item.id;
    removeBtn.setAttribute('aria-label', `Remove ${d.primary}`);
    removeBtn.textContent = '✕';
    label.appendChild(removeBtn);
  }

  if (isSel) {
    const dec = state.decorations[item.id] ?? { mat: 0, frame: 0 };
    const decoArea = slot(frag, 'decorations');
    decoArea.appendChild(buildDecorationRow(item, 'mat', dec.mat));
    decoArea.appendChild(buildDecorationRow(item, 'frame', dec.frame));
  }

  return frag;
};

const buildCatBlock = (cat, items, state, selectedSet) => {
  const frag = clone('tpl-cat-block');
  const title = slot(frag, 'title');
  title.textContent = CATEGORY_LABELS[cat];
  title.classList.add(`cat-${cat}`);
  if (cat === 'custom') {
    const add = slot(frag, 'add');
    add.hidden = false;
    add.dataset.openCustomForm = '1';
    add.setAttribute('aria-label', 'Add custom size');
  }
  const list = slot(frag, 'list');
  for (const item of items) list.appendChild(buildItem(item, state, selectedSet));
  return frag;
};

const buildSelection = (state) => {
  const frag = clone('tpl-selection');
  const grouped = dimensionsByCategory(state);
  const selected = new Set(state.selectedIds);
  slot(frag, 'count').textContent = `${workItems(state).length} selected`;
  const blocks = slot(frag, 'blocks');
  for (const cat of SELECTABLE_CATEGORIES) {
    blocks.appendChild(buildCatBlock(cat, grouped[cat], state, selected));
  }
  return frag;
};

// ──────────────────────────── visualization ────────────────────────────

const formatDim = (n) => String(Math.round(n));

const buildPerson = (x, y) => {
  const g = cloneSvg('tpl-person');
  g.setAttribute('transform', `translate(${x} ${y})`);
  return g;
};

// Build a path describing the ring between two axis-aligned rectangles.
// With fill-rule="evenodd" the inner rectangle is excluded, so the mat / frame
// renders only as a band around the picture rather than a solid block under
// it. The picture's translucent fill then sits over the grid, not over the
// decoration layers.
const ringPath = (ox, oy, ow, oh, ix, iy, iw, ih) =>
  `M ${ox} ${oy} h ${ow} v ${oh} h ${-ow} Z M ${ix} ${iy} h ${iw} v ${ih} h ${-iw} Z`;

const buildShape = (item, x, y, colorIdx, decoration) => {
  const colorClass = `color-${colorIdx}`;
  const { mat = 0, frame = 0 } = decoration ?? {};
  const w = item.widthCm;
  const h = item.heightCm;

  const g = document.createElementNS(SVG_NS, 'g');
  g.classList.add('shape-group', `shape-group-${item.category}`, colorClass);
  g.dataset.dragId = item.id;
  g.setAttribute('transform', `translate(${x} ${y})`);

  if (frame > 0) {
    const total = mat + frame;
    const fr = document.createElementNS(SVG_NS, 'path');
    fr.setAttribute('d', ringPath(
      -total, -total, w + 2 * total, h + 2 * total,
      -mat, -mat, w + 2 * mat, h + 2 * mat,
    ));
    fr.setAttribute('fill-rule', 'evenodd');
    fr.setAttribute('class', 'shape-frame');
    g.appendChild(fr);
  }
  if (mat > 0) {
    const pa = document.createElementNS(SVG_NS, 'path');
    pa.setAttribute('d', ringPath(
      -mat, -mat, w + 2 * mat, h + 2 * mat,
      0, 0, w, h,
    ));
    pa.setAttribute('fill-rule', 'evenodd');
    pa.setAttribute('class', 'shape-mat');
    g.appendChild(pa);
  }

  const rect = document.createElementNS(SVG_NS, 'rect');
  setAttrs(rect, { x: 0, y: 0, width: item.widthCm, height: item.heightCm, rx: 0.4 });
  rect.setAttribute('class', `shape ${colorClass}`);
  g.appendChild(rect);

  if (item.category === 'canvas') {
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('class', `shape-label ${colorClass}`);
    text.setAttribute('x', item.widthCm - 1);
    text.setAttribute('y', item.heightCm - 1.2);
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('dominant-baseline', 'alphabetic');
    text.textContent = `${formatDim(item.widthCm)}×${formatDim(item.heightCm)}`;
    g.appendChild(text);
  }

  return g;
};

const parseTranslate = (el) => {
  const t = el.getAttribute('transform') ?? '';
  const m = t.match(/translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/);
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
};

const buildCompareViz = (state) => {
  const svg = cloneRoot('tpl-viz-svg');
  svg.setAttribute('viewBox', `0 0 ${WORKSPACE} ${WORKSPACE}`);

  // Person centered in workspace, behind everything as scale context.
  const personX = (WORKSPACE - REFERENCE.widthCm) / 2;
  const personY = (WORKSPACE - REFERENCE.heightCm) / 2;
  svg.appendChild(buildPerson(personX, personY));

  // Shapes group is masked so dragging beyond the workspace fades softly.
  const clipGroup = document.createElementNS(SVG_NS, 'g');
  clipGroup.setAttribute('mask', 'url(#workspace-mask)');

  const positions = effectivePositions(state);
  const items = workItems(state).slice().sort(
    (a, b) => (b.widthCm * b.heightCm) - (a.widthCm * a.heightCm),
  );
  for (const it of items) {
    const p = positions[it.id];
    const colorIdx = state.colorAssignments[it.id] ?? 0;
    const decoration = state.decorations[it.id];
    clipGroup.appendChild(buildShape(it, p.x, p.y, colorIdx, decoration));
  }
  svg.appendChild(clipGroup);

  return svg;
};

const buildBucketItem = (item) => {
  const frag = clone('tpl-bucket-item');
  const d = display(item);
  slot(frag, 'name').textContent = d.primary;
  slot(frag, 'alt').textContent = `(${d.secondary})`;
  return frag;
};

const buildBucket = (bucket) => {
  const frag = clone('tpl-bucket');
  slot(frag, 'label').textContent = bucket.label;
  const body = slot(frag, 'body');
  for (const cat of SELECTABLE_CATEGORIES) {
    if (!bucket.byCategory.has(cat)) continue;
    const catFrag = clone('tpl-bucket-cat');
    const title = slot(catFrag, 'title');
    title.textContent = CATEGORY_LABELS[cat];
    title.classList.add(`cat-${cat}`);
    const list = slot(catFrag, 'list');
    for (const item of bucket.byCategory.get(cat)) list.appendChild(buildBucketItem(item));
    body.appendChild(catFrag);
  }
  return frag;
};

const buildGroupedSection = (state) => {
  const frag = clone('tpl-grouped-section');
  const items = allDimensions(state).filter((d) => d.category !== 'reference');
  const list = slot(frag, 'list');
  for (const bucket of groupByProportion(items)) {
    list.appendChild(buildBucket(bucket));
  }
  return frag;
};

// ──────────────────────────── custom-size dialog ────────────────────────────

const customDialog = () => document.getElementById('custom-dialog');

const openCustomForm = () => {
  const dlg = customDialog();
  dlg.showModal();
  requestAnimationFrame(() => dlg.querySelector('input[name="width"]')?.focus());
};

const closeCustomForm = () => {
  const dlg = customDialog();
  dlg.querySelector('form')?.reset();
  if (dlg.open) dlg.close();
};

// ──────────────────────────── drag ────────────────────────────

const startDrag = (groupEl, downEvent) => {
  downEvent.preventDefault();
  try { groupEl.setPointerCapture(downEvent.pointerId); } catch {}

  const id = groupEl.dataset.dragId;
  const item = getItem(store.state, id);
  if (!item) return;

  const svg = groupEl.ownerSVGElement;
  const ctm = svg.getScreenCTM();
  if (!ctm) return;
  const sx = 1 / ctm.a;
  const sy = 1 / ctm.d;

  const start = parseTranslate(groupEl);
  const startCX = downEvent.clientX;
  const startCY = downEvent.clientY;
  const fromMode = store.state.mode;
  const fromCustom = store.state.customPositions[id];

  const dec = store.state.decorations[id] ?? { mat: 0, frame: 0 };
  const border = dec.mat + dec.frame;

  groupEl.classList.add('is-dragging');
  // Lift to top of parent so a dragged shape stays on top of overlapping ones.
  groupEl.parentNode.appendChild(groupEl);

  const onMove = (e) => {
    const dx = (e.clientX - startCX) * sx;
    const dy = (e.clientY - startCY) * sy;
    const nx = clamp(start.x + dx, border, WORKSPACE - item.widthCm - border);
    const ny = clamp(start.y + dy, border, WORKSPACE - item.heightCm - border);
    groupEl.setAttribute('transform', `translate(${nx} ${ny})`);
  };

  const onUp = () => {
    groupEl.removeEventListener('pointermove', onMove);
    groupEl.removeEventListener('pointerup', onUp);
    groupEl.removeEventListener('pointercancel', onUp);
    groupEl.classList.remove('is-dragging');
    const end = parseTranslate(groupEl);
    if (end.x === start.x && end.y === start.y && fromMode === 'custom') return;
    commitDrag(id, end.x, end.y, fromCustom?.x, fromCustom?.y, fromMode);
  };

  groupEl.addEventListener('pointermove', onMove);
  groupEl.addEventListener('pointerup', onUp);
  groupEl.addEventListener('pointercancel', onUp);
};

// ──────────────────────────── shell ────────────────────────────

const render = () => {
  const state = store.state;
  const frag = clone('tpl-app');
  slot(frag, 'tabs').appendChild(buildTabs(state));
  slot(frag, 'viz').appendChild(buildCompareViz(state));
  slot(frag, 'selection').appendChild(buildSelection(state));
  slot(frag, 'grouped').appendChild(buildGroupedSection(state));
  root.replaceChildren(frag);
};

const onClick = (e) => {
  const tab = e.target.closest('[data-mode]');
  if (tab) { setMode(tab.dataset.mode); return; }

  const dec = e.target.closest('[data-decoration]');
  if (dec) {
    const [id, kind, value] = dec.dataset.decoration.split(':');
    setDecoration(id, kind, parseFloat(value));
    return;
  }

  const remove = e.target.closest('[data-remove-custom]');
  if (remove) {
    e.preventDefault();
    e.stopPropagation();
    removeCustomDimension(remove.dataset.removeCustom);
    return;
  }

  if (e.target.closest('[data-open-custom-form]')) { openCustomForm(); return; }
  if (e.target.closest('[data-close-custom-form]')) { closeCustomForm(); return; }
};

const onSubmit = (e) => {
  const form = e.target.closest('[data-custom-form]');
  if (!form) return;
  e.preventDefault();
  const w = parseFloat(form.elements.width.value);
  const h = parseFloat(form.elements.height.value);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
  addCustomDimension(w, h, form.elements.unit.value);
  closeCustomForm();
};

const onChange = (e) => {
  const t = e.target.closest('[data-toggle]');
  if (t) { toggle(t.dataset.toggle); return; }

  const decInput = e.target.closest('[data-decoration-input]');
  if (decInput) {
    const [id, kind] = decInput.dataset.decorationInput.split(':');
    const raw = parseFloat(decInput.value);
    const value = Number.isFinite(raw) && raw >= 0 ? raw : 0;
    setDecoration(id, kind, value);
  }
};

const onPointerDown = (e) => {
  const g = e.target.closest('[data-drag-id]');
  if (g) startDrag(g, e);
};

const start = async () => {
  await store.ready;
  store.subscribe(render);
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('pointerdown', onPointerDown);

  // Modal form lives outside #view so its listeners are bound directly.
  const dlg = customDialog();
  dlg.addEventListener('submit', onSubmit);
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-custom-form]')) { closeCustomForm(); return; }
    // Click on the dialog backdrop (i.e. the dialog element itself).
    if (e.target === dlg) closeCustomForm();
  });
  dlg.addEventListener('close', () => dlg.querySelector('form')?.reset());
  render();
};

start();
