// SPDX-License-Identifier: MIT
// Serialize only from the runtime's postMainLoop callback. A browser timer can
// run while the N64 Asyncify coroutine is suspended inside a CPU instruction.
export function createFrameCapture({ read, resume, pause, isPaused, isClosed, frameNumber = () => null, timeout = 4000 }) {
  let pending = null, queue = Promise.resolve();
  const fault = (code, message) => Object.assign(new Error(message), { code });
  function onFrame() {
    const request = pending;
    if (!request) return;
    // An Asyncify yield can finish a frontend iteration without completing an
    // emulated frame. Wait for the native counter to advance as well.
    try {
      if (request.frame !== null && frameNumber() === request.frame) return;
      pending = null;
      request.resolve(read());
    } catch (error) { pending = null; request.reject(error); }
  }
  function cancel() {
    const request = pending; pending = null;
    request?.reject(fault('E_SESSION_CLOSED', 'Session interrompue pendant la capture.'));
  }
  function capture() {
    const operation = queue.then(async () => {
      if (isClosed()) throw fault('E_SESSION_CLOSED', 'Session moteur fermée.');
      const wasPaused = isPaused();
      let timer, request;
      const frame = new Promise((resolve, reject) => {
        request = { resolve, reject, frame: frameNumber() }; pending = request;
        timer = setTimeout(() => {
          if (pending === request) pending = null;
          reject(fault('E_CAPTURE_FRAME_TIMEOUT', 'Le moteur n’a pas confirmé une trame sûre pour la capture. Aucune sauvegarde remplacée.'));
        }, timeout);
      });
      try {
        // Audio must resume too: a suspended AudioContext can hold the coroutine.
        const [bytes] = await Promise.all([frame, resume()]);
        return bytes;
      } finally {
        clearTimeout(timer);
        if (pending === request) pending = null;
        if (wasPaused && !isClosed()) await pause();
      }
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return Object.freeze({ capture, onFrame, cancel });
}

// The pinned runtime copies postMainLoop during initialization, before its
// GameManager is constructed. Supply the hook through its module options.
export function installRuntimeFrameHook(target, onFrame) {
  let runtime;
  Object.defineProperty(target, 'EJS_Runtime', {
    configurable: true,
    get: () => runtime,
    set(fn) {
      if (fn === runtime) return;
      runtime = function(options = {}) {
        const previous = options.postMainLoop;
        return fn.call(this, { ...options, postMainLoop() { previous?.(); onFrame(); } });
      };
    }
  });
}
