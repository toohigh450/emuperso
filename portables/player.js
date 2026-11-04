// Page du moteur (iframe du lanceur) : variables EmulatorJS, codes, sauvegardes, manette, journal.
// Script classique, chargé à la place de l'ancien script intégré à player.html : la règle de sécurité
// (CSP) du lanceur peut ainsi interdire tout script intégré.
(function () {
  var id = new URLSearchParams(location.search).get('id');
  var entry = window.parent && window.parent.__portablesBoots && window.parent.__portablesBoots[id];
  if (!entry) { document.body.textContent = 'Session introuvable.'; return; }
  var boot = entry.boot, events = entry.events;
  var source = entry.source;
  var layout = import('./js/player-layout.mjs');
  function updateLayout() {
    layout.then(function (m) { m.installPlayerLayout(window.EJS_emulator); }).catch(function (err) { events.onError('Disposition des commandes indisponible : ' + err.message); });
  }
  var phase = 'préparation du moteur';
  function starting() {
    if (phase === 'exécution du jeu') return;
    phase = 'démarrage du cœur';
    if (events.onStarting) events.onStarting();
  }
  // Le délai de démarrage commence au clic, pas pendant l'attente de l'utilisateur.
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.ejs_start_button')) starting();
  }, true);

  // Variables globales lues par EmulatorJS.
  Object.keys(boot.ejs).forEach(function (k) { window[k] = boot.ejs[k]; });
  // Le fichier est créé dans CE document (et non dans la page parente) pour éviter les
  // problèmes d'instanceof entre fenêtres, puis la page parente libère sa copie en mémoire.
  window.EJS_gameUrl = new File([boot.rom.file || boot.rom.bytes], boot.rom.name);
  boot.rom.file = window.EJS_gameUrl;
  boot.rom.bytes = null;
  if (boot.bios) {
    window.EJS_biosUrl = new File([boot.bios.file || boot.bios.bytes], boot.bios.name);
    boot.bios.file = window.EJS_biosUrl;
    boot.bios.bytes = null;
  }
  window.EJS_player = '#game';
  // Arcade (MAME 2003-Plus, FBNeo) : le cœur dit dans son journal s'il a reconnu le romset. Le lanceur en a
  // besoin pour passer seul à l'autre cœur ; ces lignes ne sortent qu'avec le journal détaillé d'EmulatorJS.
  var arcade = boot.arcade || null, arcadeVerdict = null, arcadeCheat = null;
  function arcadeDecide(ok, reason) {
    if (!arcade || arcadeVerdict !== null) return;
    arcadeVerdict = ok;
    note(ok ? 'arcade' : 'arcade refusé', (arcade.core === 'fbneo' ? 'FBNeo' : 'MAME 2003-Plus') + ' : ' + reason);
    try { if (boot.onArcadeVerdict) boot.onArcadeVerdict(ok, reason); } catch (err) { console.error(err); }
  }
  if (arcade) {
    window.EJS_DEBUG_XX = true;
    ['log', 'info', 'warn', 'error'].forEach(function (level) {
      var original = console[level];
      console[level] = function () {
        var text = Array.prototype.join.call(arguments, ' ');
        if (/Succesfully loaded ROMs|\[FBNeo\] Romset found at/.test(text)) arcadeDecide(true, 'romset reconnu');
        else if (/Game driver not found|\[Content\]: Failed to load content/.test(text)) arcadeDecide(false, 'romset inconnu de ce cœur');
        return original.apply(console, arguments);
      };
    });
    // cheat.dat de MAME 2003-Plus : téléchargé pendant que le moteur se prépare (voir EJS_ready).
    if (arcade.cheatUrl) arcadeCheat = fetch(arcade.cheatUrl, { cache: 'force-cache' }).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).catch(function () { return null; });
  }
  // Les codes passent uniquement par le panneau du lanceur : le menu du moteur est masqué,
  // car plusieurs cœurs (fceumm, mGBA, DeSmuME) ignorent l'état « désactivé » d'un code.
  window.EJS_Buttons = Object.assign({}, window.EJS_Buttons, { cheat: false });
  var activeCodes = (boot.codes || []).slice(); // codes activés choisis avant le lancement
  // Carte mémoire PSP de ppsspp (dossier de sauvegarde du moteur, vérifié avec un vrai jeu).
  var SAVEDATA = '/data/saves/PPSSPP/PSP/SAVEDATA';
  function manager() {
    var emulator = window.EJS_emulator;
    if (!emulator || !emulator.gameManager) throw new Error('Moteur pas encore prêt.');
    return emulator.gameManager;
  }
  function applyCodes() {
    var gm = manager();
    // Le moteur peut avoir mémorisé d'anciens codes (localStorage) : on les écarte.
    window.EJS_emulator.cheats = [];
    gm.resetCheat();
    for (var i = 0; i < activeCodes.length; i++) gm.setCheat(i, 1, activeCodes[i]);
  }
  // Snes9x ignore parfois un redémarrage demandé dans la même image qu'une capture d'état :
  // on le reporte à l'image suivante (10 essais sur 10 réussis, contre des échecs sinon).
  function restartNextFrame() {
    requestAnimationFrame(function () { try { manager().restart(); } catch (err) { console.error(err); } });
  }
  entry.control = {
    setCodes: function (codes) {
      activeCodes = codes.slice();
      if (window.EJS_emulator && window.EJS_emulator.started) applyCodes();
    },
    supportsStates: function () { return manager().supportsStates(); },
    getState: function () { return manager().getState(); },
    loadState: function (bytes) { manager().loadState(new Uint8Array(bytes)); },
    getSave: function () { return manager().getSaveFile(); },
    importSave: function (bytes) {
      var gm = manager();
      var path = gm.getSaveFilePath();
      var parts = path.split('/'), dir = '';
      for (var i = 0; i < parts.length - 1; i++) {
        if (!parts[i]) continue;
        dir += '/' + parts[i];
        if (!gm.FS.analyzePath(dir).exists) gm.FS.mkdir(dir);
      }
      if (gm.FS.analyzePath(path).exists) gm.FS.unlink(path);
      gm.FS.writeFile(path, new Uint8Array(bytes));
      gm.loadSaveFiles();
      restartNextFrame();
    },
    // PSP : la sauvegarde n'est pas un fichier unique mais des dossiers de la carte mémoire virtuelle
    // (PSP/SAVEDATA/<identifiant du jeu>…). Lecture des dossiers dont le nom commence par prefix.
    listSaveData: function (prefix) {
      var gm = manager(), out = [];
      if (!gm.FS.analyzePath(SAVEDATA).exists) return out;
      function walk(dir, rel) {
        gm.FS.readdir(dir).forEach(function (name) {
          if (name === '.' || name === '..') return;
          var path = dir + '/' + name, st = gm.FS.stat(path);
          if (gm.FS.isDir(st.mode)) walk(path, rel + name + '/');
          else out.push({ name: rel + name, bytes: gm.FS.readFile(path) });
        });
      }
      gm.FS.readdir(SAVEDATA).forEach(function (name) {
        if (name === '.' || name === '..' || name.indexOf(prefix) !== 0) return;
        if (gm.FS.isDir(gm.FS.stat(SAVEDATA + '/' + name).mode)) walk(SAVEDATA + '/' + name, name + '/');
      });
      return out;
    },
    // Écrit des fichiers sous PSP/SAVEDATA (chemins déjà contrôlés par le lanceur), puis redémarre le jeu
    // si restart (le cœur ppsspp nightly se fige au redémarrage : le lanceur demande alors de rouvrir le jeu).
    writeSaveData: function (files, restart) {
      var gm = manager();
      files.forEach(function (f) {
        var parts = (SAVEDATA + '/' + f.name).split('/'), dir = '';
        for (var i = 0; i < parts.length - 1; i++) {
          if (!parts[i]) continue;
          dir += '/' + parts[i];
          if (!gm.FS.analyzePath(dir).exists) gm.FS.mkdir(dir);
        }
        gm.FS.writeFile(SAVEDATA + '/' + f.name, new Uint8Array(f.bytes));
      });
      return entry.control.flush().then(function () { if (restart !== false) restartNextFrame(); });
    },
    restart: function () { manager(); restartNextFrame(); },
    // Arcade : ouvre le menu de MAME 2003-Plus (L3), dont l'entrée « Cheat » liste les codes du jeu.
    openArcadeMenu: function () { manager(); pressSequence([RETRO_L3]); },
    // Nouveaux réglages de manette appliqués tout de suite (profil, zone morte, commandes tactiles).
    setPad: function (settings) { if (padInput) padInput.update(settings); },
    // Mode « déplacer les boutons » : résout avec les nouvelles positions quand l'utilisateur touche Terminé.
    editTouch: function () { return padInput ? padInput.editTouch() : Promise.reject(new Error('Commandes tactiles pas encore prêtes.')); },
    enginePath: source.path, // source réellement chargée (la PSP peut repasser de nightly à 4.2.3)
    screenshot: function () { return manager().screenshot(); },
    // Écrit la sauvegarde de la cartouche dans IndexedDB tout de suite (le moteur ne le fait
    // sinon qu'à intervalles), avant une fermeture, un changement de jeu ou une mise en arrière-plan.
    flush: function () {
      return new Promise(function (resolve) {
        try {
          var emulator = window.EJS_emulator;
          if (!emulator || !emulator.started) { resolve(false); return; }
          var gm = manager();
          gm.saveSaveFiles();
          setTimeout(function () { resolve(false); }, 2000);
          gm.FS.syncfs(false, function () { resolve(true); });
        } catch (err) { console.error(err); resolve(false); }
      });
    },
  };
  // Android peut tuer un onglet en arrière-plan : on écrit la sauvegarde dès que la page est cachée.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') entry.control.flush();
  });
  window.addEventListener('pagehide', function () { entry.control.flush(); });
  window.EJS_ready = function () {
    phase = 'attente du démarrage';
    var emulator = window.EJS_emulator;
    if (emulator && typeof emulator.on === 'function') {
      // 4.2.3 émet saveSaveFiles, mais son loader ne branche pas EJS_onSaveUpdate.
      if (typeof emulator.enableSaveUpdateEvent !== 'function') {
        emulator.on('saveSaveFiles', function (save) { if (save) window.EJS_onSaveUpdate({ save: save }); });
      }
      emulator.on('exit', function () { events.onExit(); });
      // Arcade : cheat.dat déposé dans le dossier système du cœur (« / ») avant le démarrage ; MAME 2003-Plus
      // n'en garde que les codes du jeu lancé et les propose dans son menu (bouton « Cheats du jeu »).
      if (arcadeCheat) {
        emulator.on('saveDatabaseLoaded', function (FS) {
          arcadeCheat.then(function (buf) {
            if (!buf) { note('arcade', 'cheat.dat indisponible : jeu lancé sans cheats'); return; }
            try {
              if (!FS.analyzePath('/mame2003-plus').exists) FS.mkdir('/mame2003-plus');
              FS.writeFile('/mame2003-plus/cheat.dat', new Uint8Array(buf));
            } catch (err) { console.error('cheat.dat non écrit', err); }
          });
        });
      }
      // PSP : fichier CWCheat écrit une fois la carte mémoire montée, avant que ppsspp lise le jeu.
      if (boot.pspCheats) {
        emulator.on('saveDatabaseLoaded', function (FS) {
          try {
            var parts = boot.pspCheats.path.split('/'), dir = '';
            for (var i = 0; i < parts.length - 1; i++) {
              if (!parts[i]) continue;
              dir += '/' + parts[i];
              if (!FS.analyzePath(dir).exists) FS.mkdir(dir);
            }
            FS.writeFile(boot.pspCheats.path, boot.pspCheats.text);
          } catch (err) { console.error('Fichier de codes PSP non écrit', err); }
        });
      }
    }
    events.onReady();
    updateLayout();
    if (window.EJS_startOnLoaded) starting();
  };
  // Manette selon le profil EMUPERSO (Authentique, Confort moderne ou Natif) : voir js/pad-input.mjs.
  var padInput = null;
  function startPad() {
    if (!boot.pad) return;
    import('./js/pad-input.mjs').then(function (m) {
      padInput = m.installPadInput(window.EJS_emulator, boot.pad.system, boot.pad.settings, function (padId) {
        try { if (boot.onPad) boot.onPad(padId); } catch (err) { console.error(err); }
      });
    }).catch(function (err) { console.error('Manette EMUPERSO indisponible', err); });
  }
  // Options du cœur imposées au démarrage (performance PSP), même si le moteur en avait mémorisé d'autres.
  function applyCoreOptions() {
    if (!boot.coreOptions) return;
    var gm = manager();
    Object.keys(boot.coreOptions).forEach(function (k) { try { gm.setVariable(k, boot.coreOptions[k]); } catch (err) { console.error(err); } });
  }
  window.EJS_onGameStart = function () {
    phase = 'exécution du jeu';
    updateLayout();
    try { applyCoreOptions(); } catch (err) { console.error(err); }
    startPad();
    // PSP : les codes de départ sont déjà dans le fichier du jeu ; ici ppsspp ne connaît pas encore
    // l'identifiant du disque et les écrirait ailleurs.
    if (!boot.pspCheats && !arcade) { try { applyCodes(); } catch (err) { console.error(err); } }
    if (arcade) {
      // MAME 2003-Plus affiche un avertissement de droits d'auteur qui reste par-dessus son menu : il se ferme
      // avec Gauche puis Droite (« tape OK »). FBNeo n'en a pas.
      if (arcade.core === 'mame2003_plus') setTimeout(function () { pressSequence([RETRO_LEFT, RETRO_RIGHT]); }, 1200);
      // Sans signe du cœur, un romset reconnu affiche pourtant son jeu : verdict prudent au bout de 20 s.
      setTimeout(function () { arcadeDecide(arcade.core === 'mame2003_plus', 'aucun message du cœur'); }, 20000);
    }
    events.onStart();
  };
  window.EJS_onExit = function () { events.onExit(); };
  window.EJS_onSaveUpdate = function (e) {
    try { if (boot.onSaveUpdate) boot.onSaveUpdate(e); } catch (err) { console.error(err); }
  };

  var RETRO_LEFT = 6, RETRO_RIGHT = 7, RETRO_L3 = 14;
  function pressSequence(ids) {
    var gm = window.EJS_emulator && window.EJS_emulator.gameManager;
    if (!gm) return;
    ids.forEach(function (id, i) {
      setTimeout(function () { gm.simulateInput(0, id, 1); setTimeout(function () { gm.simulateInput(0, id, 0); }, 120); }, i * 400);
    });
  }
  function note(kind, message) { try { if (boot.onLog) boot.onLog(kind, message); } catch (err) { /* lanceur fermé */ } }
  // Refus sans gravité du navigateur : garder l'écran allumé (wake lock) ou passer en plein écran pendant que
  // l'onglet est caché (« The requesting page is not visible »). Le cœur PSP nightly le demande : il ne doit
  // jamais arrêter la partie (plantage constaté par Karl sur Gran Turismo en changeant de fenêtre).
  function harmless(reason) {
    var name = reason && reason.name, text = reason && (reason.message || String(reason));
    return name === 'NotAllowedError' || /not visible|wake ?lock|fullscreen|pointer ?lock|user gesture|play\(\) request/i.test(text || '');
  }
  window.addEventListener('error', function (e) {
    note('erreur moteur', 'Pendant ' + phase + (e.message ? ' : ' + e.message : ''));
    events.onError('Erreur pendant ' + phase + (e.message ? ' : ' + e.message : '.'));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason && (e.reason.message || String(e.reason));
    if (harmless(e.reason)) { e.preventDefault(); note('refus ignoré', reason || 'refus du navigateur'); return; }
    note('erreur moteur', 'Promesse rejetée pendant ' + phase + (reason ? ' : ' + reason : ''));
    // Partie en cours : on signale sans couper le jeu ; avant, un échec de préparation reste bloquant.
    if (phase === 'exécution du jeu') { e.preventDefault(); return; }
    events.onError('Moteur interrompu pendant ' + phase + (reason ? ' : ' + reason : '.'));
  });
  window.EJS_pathtodata = source.path;
  function loadEngine() {
    var script = document.createElement('script');
    script.src = source.path + 'loader.js';
    if (source.integrity) { script.integrity = source.integrity; script.crossOrigin = 'anonymous'; }
    script.onerror = function () { events.onError('Chargeur absent ou contrôle d’intégrité refusé.'); };
    document.body.appendChild(script);
  }
  // Reprise d'une sauvegarde à l'ancien nom (GB/GBC/GBA/DS), avant que le moteur ne lise sa base :
  // l'ancien moteur est déjà fermé à ce stade. Un échec n'empêche pas le démarrage.
  var prepare;
  try { prepare = boot.prepareSaves ? boot.prepareSaves() : null; } catch (err) { console.error(err); }
  Promise.resolve(prepare).catch(function (err) { console.error(err); }).then(loadEngine);
})();
