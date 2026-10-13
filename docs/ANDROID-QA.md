# Android QA release gate

Run this from the `beta-final-fixes-android` branch before handing over an APK:

```powershell
npm.cmd run test:android-qa
```

The command writes a timestamped report, command logs, and failure artifacts to
`test-results/android-qa/`. Its final line is the release decision. A skipped
critical check blocks the release gate; a skip is not a pass.

## What it checks

- lint, type checking, a production Vite build, and the existing deterministic
  audio, Quit Game, saved-room recovery, reliability, roster, and mobile-layout
  regressions;
- the four required mobile browser viewports (320×568, 360×800, 393×852 and
  412×915), including a rendered Results action that is reachable rather than
  clipped;
- an isolated browser fixture for saved-game recovery, explicit Resume Game,
  retryable Leave Room failure, and server-confirmed Quit Game;
- the real four-browser Base44 smoke test, including its normal UI cleanup of
  the isolated room after the test;
- Capacitor sync, a fresh debug APK, and installation on an Android emulator;
- a fresh Android launch, explicit saved-game prompt after restart, Resume,
  Android hardware Back confirmation, cancel, Quit Game, post-leave restart,
  visible main-menu control, logcat crashes/JavaScript exceptions/network
  failures, and Android failure screenshots/UI dumps.

Audio coverage validates playback state, first-interaction unlocking, looping,
volume/mute persistence, lifecycle pause/resume, and that only one music
element is created. It cannot judge musical quality; that remains a listening
check on a real device.

## Required local tools

The project needs its normal Node dependencies, Playwright plus Chromium for
browser coverage, the existing Android SDK/emulator, a usable JDK, and an
Android Virtual Device. The runner looks first at `ANDROID_SDK_ROOT` or
`ANDROID_HOME`, then at the existing `D:\AndroidDev\SDK` location.
Set `UNREVIEWED_JAVA_HOME` if the automatically selected Java runtime is not
the one used by the local Android project.

It will only clear and exercise an emulator (`emulator-*`); a connected physical
phone is intentionally never wiped. If no emulator is already running and more
than one AVD exists, choose one explicitly:

```powershell
$env:UNREVIEWED_ANDROID_AVD = "Your AVD name"
npm.cmd run test:android-qa
```

`UNREVIEWED_QA_MULTIPLAYER=0` deliberately suppresses the real Base44 room
smoke test for maintenance work. The report will mark that check as skipped and
will keep the release gate blocked. The live test uses an isolated room and
leaves it through the normal in-app Leave Game dialog; it never changes prompts,
schemas, or existing rooms.

## Manual checks that remain

- Listen to the music and effects on a physical Android device (automated tests
  deliberately do not claim that audio sounds good).
- Verify touch feel and visual quality on the intended hardware.
- Perform the final signed-release/install validation; this gate uses a debug
  APK only.
