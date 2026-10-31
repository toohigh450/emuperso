// UI ordering only: does not alter journal records, hashes or controller state.
export function createLatestResultGate() {
  let current;
  return Object.freeze({
    issue() {
      const ticket = Symbol('render');
      current = ticket;
      return () => current === ticket;
    },
    invalidate() { current = undefined; }
  });
}
