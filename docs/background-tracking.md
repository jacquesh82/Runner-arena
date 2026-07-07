# Suivi GPS écran éteint & optimisation de batterie

## Le problème (avant)

La v0 n'enregistrait le GPS que via `@capacitor/geolocation` (`watchPosition`),
une API **de premier plan** liée à la WebView. Dès que l'écran s'éteint ou que
l'app passe en arrière-plan, Android **suspend la WebView** et applique **Doze**
→ les positions arrêtent d'arriver et le GPX est tronqué. De plus le manifeste
ne déclarait que `INTERNET` : aucune permission de localisation ni service de
premier plan. Résultat : **capture interrompue écran éteint**, et le processus
pouvait être **tué par l'optimiseur de batterie**.

## La solution

Sur mobile natif, `LocationService` utilise
[`@capacitor-community/background-geolocation`](https://github.com/capacitor-community/background-geolocation),
qui démarre un **service au premier plan** (foreground service) :

- notification persistante + `android:foregroundServiceType="location"` ;
- le processus **reste vivant écran éteint / app en arrière-plan** ;
- un service de premier plan de type `location` est **exempté de Doze** et de
  l'optimiseur de batterie **tant qu'il tourne** — c'est le mécanisme sanctionné
  par Android pour ne pas être tué pendant un enregistrement.

Le plugin fusionne automatiquement dans le manifeste (donc valable même si le
dossier `android/` est régénéré en CI) :
`ACCESS_FINE/COARSE_LOCATION`, `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_LOCATION` (Android 14+), `POST_NOTIFICATIONS` (Android 13+)
et la déclaration du service.

`@capacitor/geolocation` ne sert plus que de **repli sur le Web** (aperçu
navigateur). Le **simulateur** reste réservé à l'aperçu navigateur (jamais de
bascule silencieuse vers le simulateur sur mobile).

## Accéléromètre & autres capteurs

L'accélération est captée via `@capacitor/motion` pendant la course et jointe à
chaque point GPS (`ax, ay, az, am`). Le service de premier plan maintient le
processus vivant, ce qui prolonge la capture des capteurs de mouvement.
⚠️ Pour un log brut haute fréquence **garanti écran totalement éteint**, un
service natif dédié au `SensorManager` serait nécessaire (piste d'évolution).

## Fiabilité maximale (constructeurs agressifs)

Certains OEM (Xiaomi, Huawei, Samsung…) tuent quand même les apps malgré le
service de premier plan. L'écran **Options → « Suivi écran éteint » → Régler**
ouvre les réglages de l'app (`BackgroundGeolocation.openSettings()`) pour
autoriser Runner Arena à **ignorer l'optimisation de batterie**.

## Vérification

- Web/CI : build Vite OK, aperçu navigateur régressif OK (course simulée
  enregistrée, GPX exportable).
- Android : la capacité écran-éteint dépend du service de premier plan et se
  **valide sur appareil physique** (non testable dans le sandbox de dev, où
  l'APK est compilé par GitHub Actions).
