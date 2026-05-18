// Built-in catalog of dimensions. All sizes stored canonically in centimeters
// with the longer dimension first (landscape) so rectangles share an
// orientation. The reference (human) is the only portrait shape.

export const CM_PER_INCH = 2.54;

export const CATEGORY_LABELS = {
  reference: 'Reference',
  photo: 'Photo sizes',
  canvas: 'Canvas sizes',
  custom: 'Custom sizes',
};

// Build a dimension entry from raw user input. Mirrors the rect() helper but
// keeps unique IDs (timestamp + random) so duplicates don't collide.
export const makeCustomDimension = (a, b, defaultUnit) => {
  const longer = Math.max(a, b);
  const shorter = Math.min(a, b);
  const toCm = defaultUnit === 'in' ? (n) => n * CM_PER_INCH : (n) => n;
  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    category: 'custom',
    name: `${longer}×${shorter} ${defaultUnit}`,
    widthCm: toCm(longer),
    heightCm: toCm(shorter),
    defaultUnit,
  };
};

const fromInches = (n) => n * CM_PER_INCH;

// Helper: build a landscape rectangle (longer side first) from a pair of
// dimensions in the given unit.
const rect = (id, category, a, b, defaultUnit) => {
  const longer = Math.max(a, b);
  const shorter = Math.min(a, b);
  const toCm = defaultUnit === 'in' ? fromInches : (n) => n;
  return {
    id,
    category,
    name: `${longer}×${shorter} ${defaultUnit}`,
    widthCm: toCm(longer),
    heightCm: toCm(shorter),
    defaultUnit,
  };
};

export const DIMENSIONS = [
  { id: 'ref-human', category: 'reference', name: 'Human', widthCm: 50, heightCm: 170, defaultUnit: 'cm', shape: 'person' },

  rect('photo-1x1in',  'photo', 1,  1,  'in'),
  rect('photo-4x3in',  'photo', 4,  3,  'in'),
  rect('photo-16x9in', 'photo', 16, 9,  'in'),
  rect('photo-5x4in',  'photo', 5,  4,  'in'),
  rect('photo-7x5in',  'photo', 7,  5,  'in'),
  rect('photo-3x2in',  'photo', 3,  2,  'in'),

  rect('canvas-13x13cm', 'canvas', 13, 13, 'cm'),
  rect('canvas-15x15cm', 'canvas', 15, 15, 'cm'),
  rect('canvas-30x30cm', 'canvas', 30, 30, 'cm'),
  rect('canvas-25x20cm', 'canvas', 25, 20, 'cm'),
  rect('canvas-50x40cm', 'canvas', 50, 40, 'cm'),
  rect('canvas-18x13cm', 'canvas', 18, 13, 'cm'),
  rect('canvas-13x9cm',  'canvas', 13, 9,  'cm'),
  rect('canvas-21x15cm', 'canvas', 21, 15, 'cm'),
  rect('canvas-19x13cm', 'canvas', 19, 13, 'cm'),
  rect('canvas-15x10cm', 'canvas', 15, 10, 'cm'),
  rect('canvas-30x20cm', 'canvas', 30, 20, 'cm'),
  rect('canvas-45x30cm', 'canvas', 45, 30, 'cm'),
  rect('canvas-23x15cm', 'canvas', 23, 15, 'cm'),
  rect('canvas-60x30cm', 'canvas', 60, 30, 'cm'),
  rect('canvas-90x30cm', 'canvas', 90, 30, 'cm'),
];

export const DIMENSION_BY_ID = Object.fromEntries(DIMENSIONS.map((d) => [d.id, d]));

export const round2 = (n) => Math.round(n * 100) / 100;

export const proportionOf = (d) => round2(Math.max(d.widthCm / d.heightCm, d.heightCm / d.widthCm));

const toInches = (cm) => cm / CM_PER_INCH;

export const display = (d) => {
  if (d.defaultUnit === 'cm') {
    return {
      primary: `${formatCm(d.widthCm)}×${formatCm(d.heightCm)} cm`,
      secondary: `${formatIn(toInches(d.widthCm))}×${formatIn(toInches(d.heightCm))} in`,
    };
  }
  return {
    primary: `${formatIn(toInches(d.widthCm))}×${formatIn(toInches(d.heightCm))} in`,
    secondary: `${formatCm(d.widthCm)}×${formatCm(d.heightCm)} cm`,
  };
};

const formatCm = (n) => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

const formatIn = (n) => {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/\.?0+$/, '');
};

// Group selected dimensions by proportion, clustering values that fall within
// PROPORTION_TOLERANCE of an established bucket centroid. "Similar not exact"
// — close aspects (e.g. 1.46 and 1.50) cluster; clearly distinct ones (1.5,
// 1.78) stay separate.
export const PROPORTION_TOLERANCE = 0.05;

export const groupByProportion = (items) => {
  const buckets = [];
  for (const item of items) {
    const p = proportionOf(item);
    let bucket = buckets.find((b) => Math.abs(b.centroid - p) <= PROPORTION_TOLERANCE);
    if (!bucket) {
      bucket = { centroid: p, items: [] };
      buckets.push(bucket);
    }
    bucket.items.push(item);
    bucket.centroid = bucket.items.reduce((s, i) => s + proportionOf(i), 0) / bucket.items.length;
  }
  buckets.sort((a, b) => a.centroid - b.centroid);
  for (const b of buckets) {
    b.label = round2(b.centroid).toFixed(2);
    b.byCategory = groupBy(b.items, (i) => i.category);
  }
  return buckets;
};

const groupBy = (items, keyFn) => {
  const out = new Map();
  for (const item of items) {
    const k = keyFn(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
};
