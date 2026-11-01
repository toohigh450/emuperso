# Étude GameHacking.org — Enrichissement du catalogue PS1

**Date** : 1er novembre 2026
**Contexte** : Audit GPT RC-1.3 recommande d'étudier GameHacking.org comme source complémentaire à libretro-database.
**Statut** : ÉTUDE UNIQUEMENT — aucun import effectué, aucun scraping.

## Constats

### Pas d'API publique pour import en masse
- GameHacking.org ne propose **pas d'API publique** pour télécharger les codes par jeu/ID (constaté 2021, toujours d'actualité).
- Téléchargement manuel possible (fichier texte par jeu), mais pas d'accès programmatique documenté.
- Un contributeur note : "It'd be nice if gamehacking.org would have an API to download the codes."

### Partenariats existants
GameHacking.org est la **source officielle** de cheats pour :
- MiSTer (communauté FPGA)
- RetroArch
- Clone systems (Retron5)
- Flash devices (Everdrive)

Ils **acceptent les partenariats** avec des projets. Leur site invite : "Join our Discord to inquire how your project can benefit from our site."

### Licence des contenus
- Les codes individuels sont souvent sous **Creative Commons Attribution** (ex: CC BY 3.0 US pour les codes de uolamer).
- Le site dans son ensemble n'a pas de licence unique affichée pour réutilisation en masse.
- **Recommandation** : contacter l'équipe via Discord avant tout import.

### Contenu pertinent pour PS1
- Base de données couvrant de nombreux systèmes rétro dont PlayStation 1.
- Formats supportés : GameShark, Action Replay, CodeBreaker, etc.
- Conversion entre formats disponible sur leur plateforme.

## Recommandations pour EMUPERSO

### À FAIRE
1. **Contacter GameHacking.org via Discord** pour demander :
   - Accès API ou export en masse (si disponible)
   - Conditions de réutilisation pour un projet open-source non commercial
   - Attribution requise
2. **En attendant** : continuer avec libretro-database (CC BY-SA 4.0, licence claire).
3. **Si partenariat accordé** : scripts de conversion + déduplication + tests de format.

### À NE PAS FAIRE
- ❌ Scraper le site sans permission (contre leurs ToS, irrespectueux)
- ❌ Redistribuer leurs codes sans attribution ni accord
- ❌ Supposer qu'une absence d'API = autorisation de scraping

## Alternatives
- **libretro-database** (actuel) : CC BY-SA 4.0, 1 394 jeux PS1, 18 640 codes. Licence claire, déjà intégré.
- **Contributions communautaires** : permettre aux utilisateurs d'ajouter leurs codes testés (déjà supporté via saisie manuelle).

## Conclusion
GameHacking.org est une source **potentiellement précieuse** mais nécessite un **contact préalable**. En attendant leur réponse, le catalogue libretro-database reste la base légale et fonctionnelle. L'effort prioritaire doit aller à la **qualité** (validation en jeu, régions, mods) plutôt qu'à la **quantité** brute.

---
*Étude réalisée le 2026-11-01. Aucune donnée importée. Aucun contact établi à ce jour.*
