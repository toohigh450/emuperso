// Hôte navigateur : un iframe « player.html » par partie. Détruire l'iframe libère le moteur,
// la mémoire WebAssembly et l'audio : c'est ce qui garantit un seul jeu actif à la fois.

let counter = 0;

export function createBrowserHost(container) {
  window.__portablesBoots = window.__portablesBoots || {};
  return {
    async create(boot, events) {
      const id = `b${Date.now().toString(36)}${counter++}`;
      window.__portablesBoots[id] = { boot, events };
      const frame = document.createElement('iframe');
      frame.className = 'player-frame';
      frame.title = 'Émulateur';
      frame.setAttribute('allow', 'autoplay; gamepad; fullscreen');
      frame.setAttribute('allowfullscreen', '');
      frame.src = `player.html?id=${encodeURIComponent(id)}`;
      container.replaceChildren(frame);
      return {
        destroy() {
          delete window.__portablesBoots[id];
          frame.src = 'about:blank';
          frame.remove();
        },
      };
    },
  };
}
