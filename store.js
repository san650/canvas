import { COMMANDS, isNoOp } from './commands.js';
import { History } from './history.js';
import { loadState, saveState, requestPersistence } from './db.js';

const initialState = () => ({
  selectedIds: ['canvas-30x20cm', 'photo-3x2in'],
  // 'custom' is the user-defined arrangement; the others snap to presets.
  mode: 'centered',
  // Persisted user-dragged positions in workspace cm. Independent of the
  // current mode — coming back to Custom restores these.
  customPositions: {},
  // Color slot per selected item, 0..PALETTE_SIZE-1. Assigned on select,
  // released on deselect, so each chosen size keeps its color.
  colorAssignments: { 'canvas-30x20cm': 0, 'photo-3x2in': 1 },
  // Optional mat/frame per item in cm. Both default to 0 (none).
  decorations: {},
  // User-added dimensions. Same shape as a built-in dimension.
  customDimensions: [],
});

class Store {
  constructor() {
    this.state = initialState();
    this.history = new History();
    this.listeners = new Set();
    this.ready = this.#hydrate();
  }

  async #hydrate() {
    const persisted = await loadState();
    if (persisted) {
      if (persisted.state) this.state = { ...initialState(), ...persisted.state };
      if (persisted.history) this.history.hydrate(persisted.history);
    }
    requestPersistence();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #notify() { for (const fn of this.listeners) fn(this.state); }

  async #persist() {
    try {
      await saveState({ state: this.state, history: this.history.serialize() });
    } catch (err) {
      console.error('persist failed', err);
    }
  }

  reset() {
    this.state = initialState();
    this.history.clear();
    this.#persist();
    this.#notify();
  }

  dispatch(cmd) {
    if (isNoOp(cmd)) return;
    const def = COMMANDS[cmd.type];
    if (!def) throw new Error(`Unknown command: ${cmd.type}`);
    const next = structuredClone(this.state);
    def.apply(next, cmd.payload);
    this.state = next;
    this.history.record(cmd);
    this.#persist();
    this.#notify();
  }

  undo() {
    const cmd = this.history.popUndo();
    if (!cmd) return null;
    const next = structuredClone(this.state);
    COMMANDS[cmd.type].revert(next, cmd.payload);
    this.state = next;
    this.history.pushFuture(cmd);
    this.#persist();
    this.#notify();
    return cmd;
  }

  redo() {
    const cmd = this.history.popRedo();
    if (!cmd) return null;
    const next = structuredClone(this.state);
    COMMANDS[cmd.type].apply(next, cmd.payload);
    this.state = next;
    this.history.pushPast(cmd);
    this.#persist();
    this.#notify();
    return cmd;
  }

  canUndo() { return this.history.canUndo(); }
  canRedo() { return this.history.canRedo(); }
}

export const store = new Store();
