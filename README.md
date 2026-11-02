# EMUPERSO 🎮

**Un portail expérimental d'émulation rétro dans le navigateur, développé et testé console par console.**

EMUPERSO réunit plusieurs chantiers d'émulation Web dans **un même dépôt GitHub**, avec un objectif : proposer, après validation, **une seule adresse Web et une seule interface** pour les consoles prises en charge. Le projet vise les ordinateurs et les téléphones, avec des contrôles adaptés aux appareils.

> **Statut au 2 novembre 2026 : développement actif.** Les démonstrations et les branches alpha ne constituent pas une certification de compatibilité complète. La branche `main` conserve encore le **laboratoire N64 synthétique historique**; elle n'est **pas** la version unifiée à huit consoles.

## Consoles et branches

| Consoles | État du chantier | Où regarder |
| --- | --- | --- |
| NES / Famicom et SNES / Super Famicom | Intégration alpha au portail commun, essais de compatibilité en cours | [`feature/nes-snes-unified`](../../tree/feature/nes-snes-unified) |
| Game Boy, Game Boy Color, Game Boy Advance, Nintendo DS | Lanceurs alpha, sauvegardes et compatibilité en cours de vérification | [`emulateur-portable`](../../tree/emulateur-portable), [`feature/nes-snes-unified`](../../tree/feature/nes-snes-unified) |
| Nintendo 64 | Émulateur réel expérimental distinct du laboratoire synthétique | [`alpha/n64-vercel-playable`](../../tree/alpha/n64-vercel-playable) |
| PlayStation 1 | Émulateur Web expérimental | [`alpha/ps1-vercel-playable`](../../tree/alpha/ps1-vercel-playable) |
| PlayStation Portable (PSP) | **Chantier en préparation / développement**, non validé ici | Pas encore de livraison PSP déclarée stable |
| GameCube | Faisabilité à l'étude ; **pas de moteur navigateur validé** | Aucun port GameCube annoncé comme fonctionnel |

Les huit premières consoles représentent la cible du **portail unifié en développement**, pas une promesse de compatibilité totale ni l'état du site principal.

## Essais et aperçu

- [Projet GitHub](https://github.com/toohigh450/emuperso)
- [Site principal Vercel](https://emuperso.vercel.app) — peut encore présenter une version antérieure pendant la consolidation.
- [N64 alpha](https://emuperso-n64-alpha.vercel.app)
- [PS1 alpha](https://emuperso-ps1-alpha.vercel.app)
- [Branche du portail NES / SNES et portables](../../tree/feature/nes-snes-unified)

**Important :** certains liens sont des aperçus expérimentaux. Une page accessible ou un écran de démarrage ne démontre pas que tous les jeux, manettes, sons et sauvegardes fonctionnent.

## ROMs, BIOS et données personnelles

**Aucune ROM commerciale ni aucun BIOS propriétaire n'est fourni avec ce projet.** Les jeux sont sélectionnés par l'utilisateur à partir de ses propres fichiers locaux, lorsqu'un lanceur le permet. Les dossiers personnels, les sauvegardes et les preuves privées ne doivent pas être envoyés sur GitHub ni déployés sur Vercel.

Les tests sont conduits sur des copies ou dans des environnements isolés. La protection des sauvegardes, les imports/exports, les identités de ROMs et les risques de régression font partie des points de contrôle prioritaires. Avant d'utiliser une version alpha avec une progression importante, conserver une sauvegarde indépendante.

## Méthode de développement

- Branches dédiées et **pull requests** pour les changements ; pas de fusion sur `main` sans autorisation de Karl.
- Tests réels avec des jeux autorisés à être utilisés, comparés à des essais synthétiques et à des vérifications automatisées.
- Rapports qui distinguent **observé**, **reproduit**, **annoncé** et **non testé**.
- Audits et corrections indépendants par **Claude, Codex, GPT et Méo (Muse)**, selon les chantiers ; **Karl** décide des validations, versions et publications.
- Aucun correctif déclaré résolu uniquement parce qu'un test unitaire ou un déploiement est vert.

### Audits en cours

La migration des sauvegardes des portables est travaillée sur `feature/nes-snes-unified`. Les corrections proposées par Codex pour plusieurs risques identifiés sont suivies dans la [PR #2](../../pull/2), **sans présumer de leur fusion**. Les résultats d'audit dépendent de la version et de l'environnement testés.

## Le laboratoire N64 historique sur `main`

Le présent `main` comprend toujours **N64 Web Lab — Phase 1A**, un **banc synthétique sans moteur N64 réel, sans ROM ni jeu jouable**. Sa candidate `1.0.2` ne remplace pas automatiquement la référence `1.0.1`.

Pour l'historique détaillé et ses limites, consulter [README-FR.md](README-FR.md), [CHANGELOG.md](CHANGELOG.md) et [docs/](docs/). Le laboratoire synthétique ne prouve ni la compatibilité de Conker PAL ni une correction du moteur N64 réel.

---

*EMUPERSO : un seul portail visé, des vérifications reproductibles et les originaux toujours protégés.*
