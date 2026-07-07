# Générer l'APK Android (v0)

L'APK v0 est un **APK debug** (signé avec la clé debug, installable directement).

## Option A — GitHub Actions (recommandé, aucune install locale)

Le workflow [`.github/workflows/android.yml`](../.github/workflows/android.yml)
compile l'APK sur un runner GitHub.

1. Onglet **Actions** du dépôt → workflow **Build Android APK** → **Run workflow**
   (ou il se déclenche à chaque push sur la branche de dev).
2. À la fin du run, télécharger l'artefact **`runner-arena-v0-debug-apk`**.
3. Transférer le `.apk` sur un téléphone Android et l'installer (autoriser les
   « sources inconnues »).

> Le sandbox de développement ne peut pas compiler l'APK : l'hôte `dl.google.com`
> (SDK Android + artefacts Google Maven / AndroidatX / Android Gradle Plugin) est
> bloqué par la politique réseau. Les runners GitHub, eux, y ont accès.

## Option B — En local (machine avec accès réseau)

Prérequis : Node 20, JDK 17, Android SDK (platform 34, build-tools 34).

```bash
npm ci
npm run build
npx cap add android        # si le dossier android/ n'existe pas encore
npx cap sync android
cd android && ./gradlew assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

Ou ouvrir `android/` dans **Android Studio** et lancer *Run*.

## Notes v0

- `appId` : `fr.hullu.runnerarena` · `appName` : `Runner Arena` (voir
  `capacitor.config.json`). Verrouillage **portrait** natif.
- Permission **localisation** ajoutée automatiquement par
  `@capacitor/geolocation`. Sur device, l'app utilise le **vrai GPS** ; le
  simulateur ne sert qu'au desktop / à l'émulateur sans capteur.
- Icône : icône Capacitor par défaut pour la v0. Pour l'icône Runner Arena :
  `npx @capacitor/assets generate --iconBackgroundColor '#0b1524'` (source
  `resources/icon.png`).
- Pour un APK **release** signé (Play Store), générer un keystore et configurer
  `android/app/build.gradle` (`signingConfigs`) — hors périmètre v0.
