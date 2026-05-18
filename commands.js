// Every mutation flows through dispatch(command). Scaffolded for undo even
// though the UI doesn't surface it today.

const PALETTE_SIZE = 5;

const nextColorSlot = (assignments) => {
  const used = new Set(Object.values(assignments));
  for (let i = 0; i < PALETTE_SIZE; i++) {
    if (!used.has(i)) return i;
  }
  // All slots in use — cycle by reusing the smallest index.
  return Object.keys(assignments).length % PALETTE_SIZE;
};

const toggleId = (state, id) => {
  const next = new Set(state.selectedIds);
  const positions = { ...state.customPositions };
  const colors = { ...state.colorAssignments };
  const decorations = { ...state.decorations };
  if (next.has(id)) {
    next.delete(id);
    delete positions[id];
    delete colors[id];
    delete decorations[id];
  } else {
    next.add(id);
    colors[id] = nextColorSlot(colors);
  }
  state.selectedIds = [...next];
  state.customPositions = positions;
  state.colorAssignments = colors;
  state.decorations = decorations;
};

export const COMMANDS = {
  SET_MODE: {
    apply:  (s, p) => { s.mode = p.to; },
    revert: (s, p) => { s.mode = p.from; },
    coalesceKey: () => 'mode',
  },
  TOGGLE_SELECTION: {
    apply:  (s, p) => toggleId(s, p.id),
    revert: (s, p) => toggleId(s, p.id),
    coalesceKey: (p) => `sel:${p.id}`,
  },
  SET_DECORATION: {
    apply: (s, p) => {
      const prev = s.decorations[p.id] ?? { mat: 0, frame: 0 };
      s.decorations = { ...s.decorations, [p.id]: { ...prev, [p.kind]: p.to } };
    },
    revert: (s, p) => {
      const prev = s.decorations[p.id] ?? { mat: 0, frame: 0 };
      s.decorations = { ...s.decorations, [p.id]: { ...prev, [p.kind]: p.from } };
    },
    coalesceKey: (p) => `dec:${p.id}:${p.kind}`,
  },
  ADD_CUSTOM_DIMENSION: {
    apply:  (s, p) => { s.customDimensions = [...s.customDimensions, p.item]; },
    revert: (s, p) => { s.customDimensions = s.customDimensions.filter((d) => d.id !== p.item.id); },
    coalesceKey: (p) => `add:${p.item.id}`,
  },
  REMOVE_CUSTOM_DIMENSION: {
    apply: (s, p) => {
      s.customDimensions = s.customDimensions.filter((d) => d.id !== p.item.id);
      // Also drop any per-item state for the removed dimension.
      s.selectedIds = s.selectedIds.filter((id) => id !== p.item.id);
      const colors = { ...s.colorAssignments }; delete colors[p.item.id]; s.colorAssignments = colors;
      const decs   = { ...s.decorations };      delete decs[p.item.id];   s.decorations = decs;
      const pos    = { ...s.customPositions };  delete pos[p.item.id];    s.customPositions = pos;
    },
    revert: (s, p) => {
      s.customDimensions = [...s.customDimensions, p.item];
      if (p.wasSelected) s.selectedIds = [...s.selectedIds, p.item.id];
      if (p.color !== undefined)
        s.colorAssignments = { ...s.colorAssignments, [p.item.id]: p.color };
      if (p.decoration)
        s.decorations = { ...s.decorations, [p.item.id]: p.decoration };
      if (p.position)
        s.customPositions = { ...s.customPositions, [p.item.id]: p.position };
    },
    coalesceKey: (p) => `rm:${p.item.id}`,
  },
  MOVE_ITEM: {
    // Dragging anywhere lands us in Custom mode and records the new position.
    // The previous position (and the prior mode) ride along on the payload so
    // a future undo can reconstruct them exactly.
    apply: (s, p) => {
      s.mode = 'custom';
      s.customPositions = { ...s.customPositions, [p.id]: { x: p.toX, y: p.toY } };
    },
    revert: (s, p) => {
      s.mode = p.fromMode;
      if (p.fromX === undefined || p.fromY === undefined) {
        const { [p.id]: _, ...rest } = s.customPositions;
        s.customPositions = rest;
      } else {
        s.customPositions = { ...s.customPositions, [p.id]: { x: p.fromX, y: p.fromY } };
      }
    },
    coalesceKey: (p) => `move:${p.id}`,
  },
};

export const makeCommand = (type, payload) => ({ type, payload });

export const coalesceKeyOf = (cmd) =>
  `${cmd.type}:${COMMANDS[cmd.type].coalesceKey(cmd.payload)}`;

export const isNoOp = (cmd) => {
  if (cmd.type === 'TOGGLE_SELECTION') return false;
  if (cmd.type === 'MOVE_ITEM') return false;
  if (cmd.type === 'ADD_CUSTOM_DIMENSION') return false;
  if (cmd.type === 'REMOVE_CUSTOM_DIMENSION') return false;
  return cmd.payload.from === cmd.payload.to;
};
