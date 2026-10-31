# État d'avancement — Mission 1 (démo homebrew) — 31 octobre 2026

## Fait
- Source de la démo (`main.c`) : affichage, compteur, boutons A/B, tonalité sur A (libdragon).
- `Makefile` standard libdragon, `LICENSE` (MIT **proposée**), `README.md`.

## Bloqué
- **Compilation impossible dans mon environnement** : pas de chaîne MIPS, pas de libdragon, réseau désactivé.
  → La ROM `.z64` n'existe pas encore. Aucun test réalisé.

## Risques connus (à vérifier à la compilation)
- Noms d'API libdragon (joypad, audio, graphics) écrits de mémoire : ajuster à la version installée si erreur.
- Taille de buffer audio : vérifier `audio_get_buffer_length()` (échantillons stéréo).

## Prochain pas
1. Quelqu'un avec réseau/Docker compile (Codex, ou GitHub Actions sur une branche séparée) et corrige les erreurs d'API.
2. Karl teste la ROM dans Chrome (EmulatorJS + mupen64plus_next).
3. Karl tranche : licence + titulaire du copyright, nom de la branche (proposition : `emulateur-reel`).

## Non fait (Mission 2)
- Intégration moteur, instrumentation du Lab, statut « Threads OFF » / V9 améliorée : non abordés, aucune info reçue.
