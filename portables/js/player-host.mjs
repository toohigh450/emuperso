// Chaque tentative de source vit dans une iframe neuve : pas de mélange de moteurs.
let counter = 0;
export function createBrowserHost(container, { timeoutMs = 60000 } = {}) {
  window.__portablesBoots = window.__portablesBoots || {};
  return {
    async create(boot, events) {
      const sources = boot.enginePaths.slice();
      let frame, id, timer, destroyed = false, ready = false, attempt = 0;
      const dispose = () => {
        clearTimeout(timer);
        if (id) delete window.__portablesBoots[id];
        if (frame) { frame.src = 'about:blank'; frame.remove(); }
      };
      const next = (reason = '') => {
        dispose();
        if (destroyed) return;
        ready = false;
        const token = ++attempt;
        const source = sources.shift();
        if (!source) { events.onError(`Impossible de préparer EmulatorJS. ${reason}`); return; }
        id = `b${Date.now().toString(36)}${counter++}`;
        const live = () => !destroyed && token === attempt;
        const fail = (message) => {
          if (!live()) return;
          if (ready) { events.onError(message); return; }
          next(message);
        };
        window.__portablesBoots[id] = { boot, source, events: {
          onReady() { if (live()) { ready = true; clearTimeout(timer); events.onReady(); } },
          onStart() { if (live()) events.onStart(); },
          onExit() { if (live()) events.onExit(); },
          onError: fail,
        } };
        frame = document.createElement('iframe');
        frame.className = 'player-frame';
        frame.title = 'Émulateur';
        frame.setAttribute('allow', 'autoplay; gamepad; fullscreen');
        frame.setAttribute('allowfullscreen', '');
        frame.src = `player.html?id=${encodeURIComponent(id)}`;
        timer = setTimeout(() => fail('Délai de préparation dépassé. Vérifie le moteur local ou la connexion Internet.'), timeoutMs);
        container.replaceChildren(frame);
      };
      next();
      return { destroy() { destroyed = true; attempt++; dispose(); } };
    },
  };
}
