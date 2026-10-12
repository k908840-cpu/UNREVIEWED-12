# Android packaging (Capacitor)

This repository now has a local Capacitor Android wrapper configuration. It
does not change the browser deployment or the Base44 backend. The Android
application ID is `app.unreviewed.game`; confirm that this is the intended,
available Google Play application ID before uploading the first build because
it cannot change after release.

## What is prepared

- Capacitor core, CLI, and Android dependencies.
- `capacitor.config.ts` using Vite's `dist` folder.
- A ready Capacitor configuration for generating the `android/` Gradle project.
- HTTPS-only WebView content (`allowMixedContent: false`).

No Android Gradle project, release key, keystore, signing configuration, APK,
AAB, or Play Console artifact has been created or stored in this repository.
On October 12, 2026, `npx cap add android` was attempted once and was blocked
before project generation by the local Node runtime (`uv_os_get_passwd` returned
`ENOMEM`). Android Studio/SDK tooling is also not installed here.

## Required tools not installed on this machine

1. Android Studio (current stable) and an Android SDK platform/build-tools
   version supported by the generated Android project.
2. A compatible JDK (Android Studio's bundled JDK is the simplest option).
3. Android Platform Tools / ADB for device testing.
4. A physical Android device or emulator with network access.

## Build the web bundle for the native wrapper

The current local Vite build intentionally warns when Base44 variables are
absent. An Android bundle must be built with the approved public Base44 values
for the existing app; it must not depend on the local Base44 development proxy.

Set only public build-time values in an uncommitted local environment file or
your CI secret store:

```text
VITE_BASE44_APP_ID=6aa4c596c49c09f8b6787685
VITE_BASE44_APP_BASE_URL=https://rate-your-mates.base44.app
VITE_BASE44_FUNCTIONS_VERSION=<approved deployed version, if required>
```

Do not put an admin token, service credential, database password, or signing
key in Vite environment variables. Before a device build, confirm with Base44
that the app ID/base URL pair permits requests from the Capacitor WebView origin
and that any login redirect allowlist includes the mobile callback flow.

From Windows PowerShell after tools are installed:

```powershell
npm.cmd run build
npx.cmd cap sync android
npx.cmd cap open android
```

In Android Studio, run a debug build on a device/emulator. Verify login (if
enabled), room create/join, four-player requests, reconnect behavior, audio
unlock on the first tap, keyboard visibility in nickname/answer fields, touch
targets, safe-area spacing, and the Android back button. The app uses
`BrowserRouter`, so test route restoration after process recreation before
considering it ready for release.

## Back button and keyboard follow-up

Capacitor's default Android back behavior should be tested against the existing
route stack before adding a native handler. Do not add an exit-on-back handler
until a device test demonstrates a concrete navigation problem; leaving a room
must still go through the in-app Quit Game confirmation.

The existing screens use responsive Tailwind layouts and native HTML inputs.
Test on a small Android phone with the keyboard open; if the WebView is covered,
configure Capacitor keyboard resize behavior in a separate reviewed change
rather than changing game layouts globally.

## Debug APK and release AAB

After device testing succeeds:

```powershell
cd android
.\gradlew.bat assembleDebug
.\gradlew.bat bundleRelease
```

`assembleDebug` produces an installable testing APK. `bundleRelease` must not
be distributed until Android signing is configured locally through Android
Studio/Gradle using a new, protected release keystore. Keep that keystore,
passwords, and `key.properties` outside Git. Google Play upload, internal
testing enrollment, data-safety declarations, and signing remain manual steps.
