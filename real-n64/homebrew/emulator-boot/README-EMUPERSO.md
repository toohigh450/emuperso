# IPL3 ouvert, variante de test émulateur 8 MiB

Source : copie du dossier boot de libdragon, commit
`e356bf3f56f7afbf7e5246329562f145965cfdfc`, sous Unlicense (LICENSE).

Modification du 31 octobre 2026 : dans le chemin cold-boot N64 standard, remplacer
la calibration physique RDRAM par la taille 8 MiB déjà allouée par le cœur testé.
Le RSP efface la mémoire en préservant la région réservée au loader, puis le chargeur
ELF habituel de libdragon s’exécute. `emulator-8mib.patch` est le diff exact.

Cette modification vise à éviter une incompatibilité du modèle RDRAM de l’ancien
Mupen64Plus avec l’étape d’apprentissage libdragon. Elle n’ajoute aucune simulation
du jeu : le moteur doit toujours exécuter le code MIPS de la démo, la vidéo, les
entrées et l’audio. Elle ne prouve pas que le moteur reproduit correctement le
boot matériel. Ne pas présenter cette ROM comme validée sur console N64 physique.

Aucune ROM commerciale ni bootcode Nintendo n’est inclus. Le trampoline signé
et le loader sont ceux fournis en code source par libdragon.

Compilation depuis homebrew : `N64_INST=<préfixe préparé> ./build-emulator.sh`.
La ROM produite est `demo-emuperso-emulator.z64`, distincte de la première ROM
standard `demo-emuperso.z64`, qui reste préservée.

Les avertissements de compilation observés (callback de calibration désormais
inutilisé, messages d’assembleur dans l’objet RDRAM non appelé, entrée ELF _start
non définie pour le header brut) sont consignés dans la preuve de build. Le succès
de compilation ne vaut pas réussite du démarrage : utiliser les essais navigateur
réels et leurs captures/diagnostics pour cette conclusion.
