// Session de jeu : un seul jeu actif à la fois.
// Démarrer un nouveau jeu ferme d'abord l'ancien (et attend sa destruction complète).

export class Session {
  /**
   * @param {{create: (boot:any, events:any)=>Promise<{destroy:()=>Promise<void>|void}>}} host
   * @param {(snapshot:any)=>void} onChange
   */
  constructor(host, onChange = () => {}) {
    this.host = host;
    this.onChange = onChange;
    this.state = 'idle'; // idle | starting | running | stopping
    this.current = null;
    this.handle = null;
    this.token = 0;
    this.lastError = null;
    this.detail = '';
  }

  snapshot() {
    return { state: this.state, game: this.current, error: this.lastError, detail: this.detail };
  }

  _set(state, extra = {}) {
    this.state = state;
    if ('error' in extra) this.lastError = extra.error;
    if ('detail' in extra) this.detail = extra.detail;
    this.onChange(this.snapshot());
  }

  async start(game, boot) {
    if (this.handle || this.state !== 'idle') await this.stop();
    const token = ++this.token;
    this.current = game;
    let ready = false;
    let started = false;
    this._set('starting', { error: null, detail: 'Chargement du moteur…' });
    let handle;
    try {
      handle = await this.host.create(boot, {
        onReady: () => {
          if (token !== this.token || ready) return;
          ready = true;
          boot.onLifecycle?.('ready');
          if (this.state === 'starting') this._set('starting', { detail: 'Moteur prêt. Appuie sur Démarrer dans la fenêtre du jeu.' });
        },
        onStart: () => {
          if (token !== this.token || started) return;
          started = true;
          boot.onLifecycle?.('started');
          this._set('running', { detail: 'Jeu lancé.' });
        },
        onExit: () => {
          if (token === this.token) this.stop();
        },
        onError: (message) => {
          if (token === this.token) this._fail(message);
        },
      });
    } catch (err) {
      if (token === this.token) this._fail(err && err.message ? err.message : String(err));
      return false;
    }
    if (token !== this.token) {
      // Un autre démarrage ou un arrêt est passé entre-temps : on détruit ce qu'on vient de créer.
      await handle.destroy();
      return false;
    }
    this.handle = handle;
    return true;
  }

  async _fail(message) {
    const h = this.handle;
    this.handle = null;
    const token = ++this.token;
    if (h) await h.destroy();
    if (token !== this.token) return;
    this.current = null;
    this._set('idle', { error: message, detail: '' });
  }

  async stop() {
    const token = ++this.token;
    const h = this.handle;
    this.handle = null;
    if (h) {
      this._set('stopping', { detail: 'Fermeture du jeu…' });
      await h.destroy();
    }
    if (token !== this.token) return;
    this.current = null;
    this._set('idle', { detail: '' });
  }

  get hasActiveGame() {
    return this.state !== 'idle';
  }
}
