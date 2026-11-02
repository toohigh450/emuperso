// Chaque tentative de source vit dans une iframe neuve : pas de mélange de moteurs.
let counter = 0;
export function createBrowserHost(container, { timeoutMs = 60000, startTimeoutMs = 120000 } = {}) {
  window.__portablesBoots = window.__portablesBoots || {};
  return {
    async create(boot, events) {
      const sources = boot.enginePaths.slice();
      let frame, id, timer, destroyed = false, ready = false, starting = false, started = false, failed = false, attempt = 0, entry = null;
      const dispose = () => {
        clearTimeout(timer);
        if (id) delete window.__portablesBoots[id];
        if (frame) { frame.src = 'about:blank'; frame.remove(); }
      };
      const next = (reason = '') => {
        dispose();
        if (destroyed) return;
        ready = false;
        starting = started = failed = false;
        const token = ++attempt;
        const source = sources.shift();
        if (!source) { events.onError(`Impossible de préparer EmulatorJS. ${reason}`); return; }
        id = `b${Date.now().toString(36)}${counter++}`;
        const live = () => !destroyed && token === attempt;
        const fail = (message) => {
          if (!live() || failed) return;
          if (ready || starting || started) { failed = true; clearTimeout(timer); events.onError(message); return; }
          next(message);
        };
        entry = window.__portablesBoots[id] = { boot, source, events: {
          onReady() { if (live() && !ready && !failed) { ready = true; if (!starting) clearTimeout(timer); events.onReady(); } },
          onStarting() {
            if (!live() || failed || starting || started) return;
            starting = true;
            clearTimeout(timer);
            events.onStarting?.();
            timer = setTimeout(() => fail('Délai de démarrage du cœur dépassé. Réessaie ou choisis un autre cœur compatible.'), startTimeoutMs);
          },
          onStart() { if (live() && !failed && !started) { started = true; clearTimeout(timer); events.onStart(); } },
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
      // control : API exposée par player.html une fois le moteur chargé (codes, états, sauvegardes).
      return {
        async destroy() {
          const control = ready && entry && entry.control;
          destroyed = true;
          attempt++;
          // Registre et minuterie libérés tout de suite ; l'iframe reste le temps d'écrire la sauvegarde.
          clearTimeout(timer);
          if (id) delete window.__portablesBoots[id];
          // Sauvegarde de cartouche écrite avant de détruire le moteur (changement de jeu, fermeture).
          if (control && typeof control.flush === 'function') {
            try { await control.flush(); } catch { /* le moteur peut déjà être arrêté */ }
          }
          dispose();
          entry = null;
        },
        control: () => (ready && entry && entry.control) || null,
      };
    },
  };
}
