# KMM Trade Hub Mobile — Architecture

Statut : **décisions tranchées ("fait au mieux", validé par Paul le 2026-07-29). Phase 1 en cours.**

Ce document remplace les hypothèses du brief initial par ce qui existe *réellement* dans les trois dépôts concernés. Les points qui divergeaient du brief (§1, §3, §4, Q4) ont été tranchés avec ma meilleure recommandation ; ils restent documentés ici pour traçabilité, avec la décision retenue en tête de section.

---

## 0. Les trois dépôts en jeu

| Dépôt | Rôle réel | Supabase project |
|---|---|---|
| `/Users/paul/Desktop/TERMINAL` | Terminal Gold live (Next.js) + proxy Databento (`server/`, déployé sur Render) | `hchutwobpsafoutapxvq` |
| `/Users/paul/Desktop/kmmtradehub` | App web étudiant + back-office déjà en prod : cours, quiz, progression, communauté, DM, chat, lives, journal de trading, Stripe | `lazuufpwgzzaxjplrzpa` |
| `/Users/paul/Desktop/kmm-mobile` | App mobile Expo — **déjà démarrée**, 5 commits, pas un projet vierge | aucun (`.env` absent, tourne en SIM) |

**Le point le plus important de cet audit : ce sont deux projets Supabase distincts, sans utilisateur ni session partagés aujourd'hui.** Le brief demande "une seule application qui réunit le terminal et la formation" — cela suppose une unification d'identité qui n'existe pas encore. Voir §3.

---

## 1. ✅ TRANCHÉ — on garde le rendu natif Skia, pas de WebView

Le brief dit explicitement : *"Phase 1 : WebView authentifiée... Phase 4 : portage natif progressif... Ne commence pas par là."*

Ce n'est pas ce qui s'est passé. `kmm-mobile` existe depuis le 14 juillet, 5 commits, et a **déjà** :

- Choisi `@shopify/react-native-skia` comme moteur de rendu (pas de WebView — `grep` sur `WebView`/`react-native-webview` : zéro résultat dans tout le repo).
- Porté fidèlement la couche moteur du terminal web (`marketDataService.ts`, `pressureEngine.ts`, `TerminalEngineContext.tsx`, `instruments.ts`, `types.ts`, `domTapeEngine.ts`, `statsEngine.ts`) depuis `TERMINAL/app/terminal-v2/engine/`.
- Un premier jalon du Market Lens en Skia (raster de liquidité + ligne de prix), avec un split `.tsx`/`.web.tsx` déjà établi comme convention (CanvasKit/WASM pour le web, JSI natif pour iOS/Android).
- 4 écrans/tabs déjà en place : Accueil, Terminal (DOM + Time & Sales), Signals (Signals/News/Stats), Lens.
- Explicitement documenté comme "scoped port" : zones de contrôle, Auction Engine V9, particules et vue 3D sont **délibérément différés**, pas oubliés.

**Recommandation** : continuer sur la voie native-Skia déjà entamée plutôt que revenir en arrière vers une WebView. Raisons :
- Il y a déjà un jalon fonctionnel et un vrai travail d'ingénierie investi (pas un prototype jetable).
- Le rendu Canvas du terminal est très dense (le module Lens du web fait ~174 Ko) — une WebView aurait de toute façon posé des problèmes de perf/reconnexion WS/gestes tactiles qu'il aurait fallu contourner un jour ou l'autre ; autant traiter ces problèmes une fois, nativement.
- Le brief lui-même motivait le choix WebView par "aller vite d'abord" — mais "aller vite" a déjà été dépassé par du travail natif réel.

Ce que je propose de garder de l'esprit du brief : traiter la Phase "Terminal mobile" comme un travail **incrémental** sur l'existant (compléter les zones de contrôle, l'Auction Engine, les particules, le DOM/Footprint manquants) plutôt que de la refaire. Si tu préfères repartir sur une WebView pour livrer plus vite en attendant le natif complet, dis-le — c'est un choix produit, pas une évidence technique, et je ne le tranche pas ici.

---

## 2. Sécurité d'accès terminal — état réel

Le brief décrit l'accès terminal comme "magic link + allowlist". En réalité (`TERMINAL/middleware.ts`, `lib/terminal-auth.ts`, `supabase/migrations/001_allowed_emails.sql`, `002_email_cooldown.sql`) :

- **Onboarding** : un email doit être dans `allowed_emails` pour recevoir un lien d'invitation Supabase (`generateLink({ type: 'invite' })`), qui mène à une création de mot de passe.
- **Connexion au quotidien** : email + mot de passe classique (`signInWithPassword`), pas de lien magique à chaque session.
- **Gate d'accès** : `allowed_emails.is_active` + `expires_at` (nullable). ⚠️ Ces deux colonnes **n'ont pas de fichier de migration** — elles ont été ajoutées directement via le dashboard Supabase. Dette technique préexistante, hors périmètre de ce projet mais à signaler : si on touche à cette table, il faudra d'abord la "rattraper" avec une migration de baseline (non destructive, juste `CREATE TABLE IF NOT EXISTS`/documentation de l'état réel).
- **Session** : cookies JWT standards Supabase SSR (`@supabase/ssr`). Pont vers une WebView mobile possible sans travail serveur (le cookie jar de la WebView récupère les cookies `sb-*` si le login se fait dans la WebView elle-même) — mais on n'utilise plus de WebView pour le terminal (§1), donc ce pont ne sert pas ici ; il resert potentiellement pour un usage web futur.
- **Le WS Hub (`server/src/wsHub.js`) n'a aucune authentification par utilisateur** — seulement une allowlist d'origine optionnelle, vide par défaut (donc ouverte à qui connaît l'URL `wss://`). Pas bloquant pour la Phase 2 (le mobile natif appelle le même WS que le web, avec le même niveau de confiance qu'aujourd'hui), mais **à corriger avant toute Phase 5 "alertes marché poussées depuis le terminal"** si on veut que ce soit vraiment un accès contrôlé par utilisateur.

---

## 3. ✅ TRANCHÉ — kmmtradehub (`lazuufpwgzzaxjplrzpa`) devient le Supabase "maison" unique

Aujourd'hui :
- L'accès **terminal** vit dans le projet Supabase de `TERMINAL` (`hchutwobpsafoutapxvq`) : `allowed_emails`, comptes email+mot de passe.
- L'accès **formation/communauté/progression** vit dans le projet Supabase de `kmmtradehub` (`lazuufpwgzzaxjplrzpa`) : `profiles`, `modules`, `lessons`, `quizzes`, `student_progress`, `badges`, `streaks`, `community_*`, `direct_messages`, `lives`, `trading_journal`, plus Stripe (`api/checkout`, `api/webhook`).

Le but même du projet mobile ("une seule app qui réunit tout") implique de fusionner ces deux identités quelque part. Trois options, aucune neutre :

1. **kmmtradehub devient la maison unique** (recommandé) : c'est déjà le projet Supabase le plus riche (utilisateurs réels, Stripe, cours, communauté). On y ajoute les tables terminal-access (`allowed_emails` équivalent) et les nouvelles tables sécurité (`devices`, `sessions`, `security_events`). Le proxy Render (`server/`) n'a pas besoin de changer de projet Supabase — il n'en utilise aucun aujourd'hui (WS Hub sans auth, §2) ; on ajoute juste une vérification légère si on ferme ce trou plus tard.
2. **TERMINAL reste la maison, kmmtradehub migre vers lui.** Plus lourd : il faudrait rejouer tout le schéma cours/communauté/Stripe dans un nouveau projet, avec risque réel sur les données étudiantes déjà en prod.
3. **Les deux restent séparés**, l'app mobile gère deux sessions Supabase en parallèle. Techniquement possible mais complique tout (double login, double RLS, double webhook Stripe) pour un bénéfice nul à terme.

**Retenu : option 1.** Le proxy Render (`server/`) ne change pas — il n'utilise aucun projet Supabase aujourd'hui (WS Hub sans auth, §2), donc aucun impact sur le terminal live. TERMINAL garde son propre Supabase pour l'accès web existant (`allowed_emails`) tel quel, sans y toucher — le mobile ne parle qu'à kmmtradehub désormais.

---

## 4. Formation / Progression / Communauté — déjà largement construit dans kmmtradehub, on étend plutôt que remplacer

Le brief demande de concevoir ces piliers depuis zéro. **Ce serait une erreur** : `kmmtradehub` a déjà, en prod, la quasi-totalité du modèle de données demandé par le brief (section 5 du brief), sous des noms parfois différents :

| Demandé par le brief | Existe dans kmmtradehub | Écart |
|---|---|---|
| `profiles` | `profiles(id, email, full_name, avatar_url, role, onboarding_done)` | ✅ identique dans l'esprit |
| `subscriptions` (statut/plan/fin) | **absent — confirmé.** `app/api/webhook/route.ts` (Stripe `checkout.session.completed`) appelle `createOrInviteStudent()` (`lib/learning.ts:386`) qui invite l'email et laisse le trigger `handle_new_user()` créer la ligne `profiles`. C'est un **paiement unique = accès à vie**, aucune expiration, aucun renouvellement, aucune table d'abonnement nulle part. | On ajoute quand même une table `subscriptions` (statut/plan/`ends_at` nullable) plutôt que de coder en dur "profil existe = accès" : ça matérialise proprement l'écran "aucun accès actif" du brief, ça supporte le futur si le modèle évolue (offres à durée limitée, révocation manuelle par l'admin), et une ligne `ends_at = NULL` = accès à vie représente exactement le modèle actuel sans rien changer au comportement. Le webhook Stripe sera étendu pour créer cette ligne en plus du profil (migration additive, aucun impact sur le flux existant). |
| `courses → modules → lessons` (3 niveaux) | `modules → lessons` (**2 niveaux seulement**) | il manque un niveau "Parcours" au-dessus des modules actuels |
| `lesson_resources` | `lesson_resources(type: pdf/audio/video/link, url)` | existe, mais le type `video` = simple lien de fichier Storage ouvert dans un nouvel onglet — **aucun vrai player, aucune reprise de lecture** |
| `enrollments` | pas de table dédiée ; le déblocage séquentiel est calculé en code applicatif (`lib/learning.ts:getAccessState`), pas en RLS | à faire évoluer pour respecter la règle "vérification côté serveur" du brief |
| `lesson_progress` (position en secondes, % vu) | `student_progress(completed BOOLEAN, completed_at)` — **binaire seulement, aucune position/pourcentage** | à étendre (colonnes additives) |
| `quizzes` / `quiz_attempts` | `quizzes` + `quiz_questions` + `quiz_answers` + `quiz_results` | ✅ équivalent, juste un nom différent (`quiz_results` = `quiz_attempts`) |
| `announcements` | **inexistant côté serveur** — le `NotificationBell` actuel dérive les "nouveautés" côté client depuis `community_posts`/`badges`/`lives`, état lu stocké en `localStorage` (pas multi-appareil) | à construire, table réelle |
| `notification_tokens` | **inexistant** — aucune infra push nulle part (pas de web-push, pas de Firebase/OneSignal, pas de dépendance push dans `package.json`) | 100 % à construire |

En plus de ça, kmmtradehub a **déjà** des choses que le brief ne demandait pas mais qui font partie du produit réel : communauté (posts/commentaires/réactions/signalements), chat live, DM 1:1 (Realtime activé), calendrier de lives/coaching, réservation d'appels, journal de trading, streaks, badges. Tout ça devra probablement aussi être exposé côté mobile à terme (le brief le mentionne comme pilier D), donc c'est une bonne nouvelle : le gros du travail serveur existe déjà.

**Dette existante à noter** : kmmtradehub n'a pas de dossier `supabase/migrations/` versionné — c'est une série de fichiers SQL plats (`schema.sql`, `community.sql`, `community_v2.sql`, etc.) exécutés à la main, plus au moins une dérive de schéma déjà constatée (§2, colonnes `is_active`/`expires_at` côté TERMINAL — pattern similaire probable côté kmmtradehub). Je propose d'adopter la discipline de migrations versionnées du brief **à partir de maintenant**, en commençant par une migration de "baseline" qui documente l'état actuel sans rien exécuter de destructif, puis toute nouvelle table en migration versionnée avec rollback commenté comme demandé.

---

## 5. Vidéo — recommandation d'hébergeur

Aucune infra vidéo réelle n'existe aujourd'hui (juste un lien de fichier Supabase Storage ouvert en externe). À remplacer entièrement.

**Recommandation : Bunny Stream, en solution principale.**

| Fournisseur | Modèle de coût | Pour ~200 élèves | URLs signées | Watermark natif |
|---|---|---|---|---|
| **Bunny Stream** (recommandé) | Stockage ~0,005 $/Go/mois + diffusion ~0,005–0,01 $/Go selon zone, pas de minimum mensuel | Le moins cher des trois à ce volume ; encodage inclus | Oui (jetons signés, expiration configurable) | Non — à faire côté client (voir plus bas) |
| **Cloudflare Stream** | 5 $/1000 min stockées/mois + 1 $/1000 min diffusées | Simple à prévoir, très fiable, bon si vous êtes déjà sur l'écosystème Cloudflare | Oui (URLs signées) | Non |
| **Mux** | ~0,024–0,040 $/min encodée + ~0,001 $/min diffusée, analytics avancées incluses | Le plus cher des trois, mais le plus "clé en main" (analytics, qualité adaptative très soignée) | Oui (JWT playback) | Non |

Aucun des trois ne fait de watermark dynamique par spectateur "au clic". Le brief demande un watermark discret avec l'email de l'élève — je propose de l'implémenter **côté client**, en overlay semi-transparent (email + timestamp, position qui bouge légèrement dans le temps) posé au-dessus du composant `expo-video`, indépendant du fournisseur choisi. C'est la pratique standard pour ce budget (le watermarking "provider-side" existe surtout chez les gros acteurs DRM type Mux Enterprise/Panopto et coûte nettement plus cher).

**Estimation chiffrée** : je n'ai pas encore le volume réel (nombre de parcours, heures de vidéo source, heures visionnées/mois) — c'est une des questions en fin de document. Dès que j'ai ces chiffres je peux donner un coût mensuel précis pour les trois options plutôt qu'une fourchette générique.

---

## 6. Sécurité d'accès mobile (device binding) — 100 % à construire

Rien de ce que demande le brief ici (limite 2 appareils, session unique par appareil, cooldown 14 jours, détection d'anomalie IP/pays, `security_events`) n'existe dans aucun des deux repos existants. C'est un sous-système neuf, à construire entièrement en Phase 1, côté serveur (edge functions + RLS), conformément à la règle du brief. Aucune divergence à signaler ici — je suivrai le brief tel quel une fois la décision du §3 tranchée (ces tables doivent vivre dans le Supabase "maison").

---

## 7. Contrainte App Store / Google Play

Confirmé compatible avec l'existant : kmmtradehub gère déjà l'achat via Stripe côté web (`api/checkout`, `api/webhook`), complètement hors de toute app mobile. Le mobile n'aura donc qu'à lire un état d'accès (§3 — sous réserve de clarifier si `subscriptions`/statut d'abonnement explicite existe ou doit être ajouté), jamais à vendre. Pas de divergence.

---

## 8. Stack — écarts avec ce qui est déjà installé dans kmm-mobile

Déjà en place : Expo SDK 57, React 19 / RN 0.86, `expo-router` (variante `src/app/`), `@shopify/react-native-skia`, `react-native-reanimated`/`worklets`, `react-native-gesture-handler`.

**Manquants, à ajouter en Phase 1/3** (aucun n'est installé aujourd'hui) : `zustand`, `@tanstack/react-query`, `expo-video`, `expo-notifications`, `expo-secure-store`, `expo-screen-capture`. Aucune dépendance lourde supplémentaire proposée au-delà de celles déjà listées dans le brief.

`app.json` n'a pas encore d'`ios.bundleIdentifier`/`android.package` — à définir avant la Phase 5 (soumission stores), pas urgent avant.

---

## 9. Phases — révisées à la lumière de l'existant

Je garde la structure du brief mais j'ajuste le contenu du Phase 2/3 pour repartir de l'existant plutôt que de tout refaire, et je déplace le calage Supabase (§3) en tout début de Phase 1 puisque tout le reste en dépend.

- **Phase 1 — Décision Supabase (§3) + socle sécurité.** Auth + device binding + `security_events`, sur le projet Supabase choisi.
- **Phase 2 — Terminal natif, suite (pas WebView, §1).** Compléter le Market Lens Skia existant (zones de contrôle, Auction Engine, particules), porter DOM/Footprint restants.
- **Phase 3 — Formation + progression, en extension de kmmtradehub.** Migrations additives (§4), pas de nouveau schéma parallèle. Intégration vidéo (§5).
- **Phase 4 — Notifications + annonces.** Comme le brief, table `announcements` réelle + `notification_tokens`.
- **Phase 5 — Vue 3D/particules/Auction restants si non finis, durcissement WS Hub (§2), stores.**

---

## 10. Décisions — statut

Les 4 décisions d'architecture (§1, §3, §4, Q. `subscriptions`) sont **tranchées** ("fait au mieux", 2026-07-29) selon mes recommandations ci-dessus. Le détail et la justification de chaque choix restent dans les sections correspondantes pour traçabilité.

**Volumes encore inconnus** (nombre de parcours, heures de vidéo, budget hébergement, cohortes vs accès individuel, croissance à 12 mois) : pas de réponse à ce stade. Je ne bloque pas dessus — je construis Phase 1 (auth/sécurité, aucune dépendance au volume de contenu) et je pose des hypothèses conservatrices, documentées à chaque endroit où elles comptent, pour la suite :
- Devis vidéo (§5) : je donnerai un chiffre précis dès que ces volumes seront connus ; Bunny Stream reste le bon choix par défaut quel que soit l'ordre de grandeur à ~200 élèves.
- `subscriptions.plan` : un seul plan (`vip`) par défaut, extensible sans migration destructive si plusieurs offres apparaissent.
- Device binding / `security_events` : dimensionné pour ~200-1000 comptes, aucun changement d'architecture nécessaire pour une croissance modérée.

## 11. État d'avancement

- **Phase 0 — Audit** : ✅ terminé.
- **Phase 1 — Socle + sécurité** : en cours (voir résumé livré séparément après implémentation).
