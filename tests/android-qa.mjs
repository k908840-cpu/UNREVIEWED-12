/**
 * UNREVIEWED release gate for the Android build.
 *
 * This runner deliberately has no test-only application hooks. It first runs
 * deterministic regressions, then uses Playwright (when installed) for the
 * browser/mobile checks and ADB/UI Automator (when an emulator is available)
 * for the installed APK. A skipped prerequisite remains a SKIP and blocks the
 * release gate; it is never reported as a passing test.
 *
 * Optional environment variables:
 *   UNREVIEWED_ANDROID_AVD=<AVD name>     select an installed emulator
 *   UNREVIEWED_QA_PORT=<port>             local Vite preview port (default 4173)
 *   UNREVIEWED_BASE_URL=<url>             production target for multiplayer
 *   UNREVIEWED_QA_LIVE_MULTIPLAYER=1      OPT IN to the live four-player Base44 smoke test.
 *                                         Without it the live backend is never contacted.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const RESULTS = path.join(ROOT, "test-results", "android-qa", RUN_ID);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const DEFAULT_LIVE_URL = "https://rate-your-mates.base44.app";
const APP_ID = "app.unreviewed.game";

class SkippedCheck extends Error {}
const skip = (reason) => { throw new SkippedCheck(reason); };

const results = [];
let reportWritten = false;

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

function commandForSpawn(command, args) {
  // Node on Windows can usually launch .cmd files itself, but wrapping them
  // through ComSpec also works on locked-down developer machines where that
  // association is disabled. Native SDK executables are left untouched.
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) {
    const quote = (value) => /[\s"]/u.test(value) ? `"${String(value).replaceAll('"', '\\"')}"` : String(value);
    return {
      executable: process.env.ComSpec || "cmd.exe",
      arguments: ["/d", "/s", "/c", [quote(command), ...args.map(quote)].join(" ")],
    };
  }
  return { executable: command, arguments: args };
}

async function writeLog(name, output) {
  const outputPath = path.join(RESULTS, `${safeName(name)}.log`);
  await writeFile(outputPath, output || "(no output)\n");
  return outputPath;
}

async function runProcess(command, args, {
  name = [command, ...args].join(" "),
  cwd = ROOT,
  env = process.env,
  timeout = 120_000,
  log = true,
} = {}) {
  const started = Date.now();
  let child;
  try {
    const invocation = commandForSpawn(command, args);
    child = spawn(invocation.executable, invocation.arguments, { cwd, env, windowsHide: true });
  } catch (error) {
    return { code: null, error, stdout: "", stderr: "", durationMs: Date.now() - started };
  }
  const stdout = [];
  const stderr = [];
  child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const settled = await new Promise((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: null, error, timedOut }); });
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, timedOut }); });
  });
  const output = Buffer.concat(stdout).toString("utf8");
  const errorOutput = Buffer.concat(stderr).toString("utf8");
  const data = { ...settled, stdout: output, stderr: errorOutput, durationMs: Date.now() - started };
  if (log) data.logPath = await writeLog(name, `$ ${command} ${args.join(" ")}\n\n${output}${errorOutput ? `\n[stderr]\n${errorOutput}` : ""}`);
  return data;
}

async function runBinary(command, args, options = {}) {
  const child = spawn(command, args, { cwd: options.cwd || ROOT, env: options.env || process.env, windowsHide: true });
  const chunks = [];
  const errChunks = [];
  child.stdout?.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => errChunks.push(Buffer.from(chunk)));
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  return { code, stdout: Buffer.concat(chunks), stderr: Buffer.concat(errChunks).toString("utf8") };
}

async function check(name, task, { critical = true } = {}) {
  const startedAt = new Date().toISOString();
  try {
    const detail = await task();
    results.push({ name, status: "PASS", critical, startedAt, detail: detail || "Completed." });
  } catch (error) {
    if (error instanceof SkippedCheck) {
      results.push({ name, status: "SKIP", critical, startedAt, detail: error.message });
      return;
    }
    results.push({ name, status: "FAIL", critical, startedAt, detail: error?.stack || error?.message || String(error) });
  }
}

function requireSuccess(run, description) {
  if (run.error) throw new Error(`${description} could not start: ${run.error.message}`);
  if (run.timedOut) throw new Error(`${description} exceeded its timeout. See ${run.logPath}`);
  if (run.code !== 0) throw new Error(`${description} failed (exit ${run.code}). See ${run.logPath}`);
}

function isBlockedAndroidHostRuntime(run) {
  const message = [run?.stdout, run?.stderr, run?.error?.message].filter(Boolean).join("\n");
  // These are failures in this automation host before Capacitor, Gradle, ADB,
  // or the app can execute. They are reported as explicit prerequisite skips,
  // never as a product pass. Any normal Android command failure remains a FAIL.
  return /uv_os_get_passwd returned ENOMEM|Cannot mkdir .*\.android.*Permission denied/i.test(message);
}

async function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForUrl(url, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local preview did not become available at ${url}: ${lastError?.message || "unknown error"}`);
}

function startPreview(port) {
  const invocation = commandForSpawn(npm, ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"]);
  const child = spawn(invocation.executable, invocation.arguments, {
    cwd: ROOT,
    env: process.env,
    windowsHide: true,
  });
  const output = [];
  child.stdout?.on("data", (chunk) => output.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => output.push(Buffer.from(chunk)));
  return {
    child,
    async stop() {
      if (child.exitCode === null && child.pid) {
        if (process.platform === "win32") {
          // `npm.cmd` launches Vite through nested cmd/node processes. Killing
          // only the wrapper leaves Vite listening in the background and can
          // keep this gate alive after it has written its report.
          await new Promise((resolve) => {
            const killer = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "taskkill", "/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
            killer.once("error", resolve);
            killer.once("close", resolve);
          });
        } else {
          child.kill("SIGTERM");
        }
      }
      await writeLog("vite-preview", Buffer.concat(output).toString("utf8"));
    },
  };
}

async function hasPlaywright() {
  try { await import("playwright"); return true; } catch { return false; }
}

async function runNodeTest(label, script, env = {}) {
  const run = await runProcess(process.execPath, [script], {
    name: label,
    env: { ...process.env, ...env },
    timeout: 180_000,
  });
  requireSuccess(run, label);
  return `Passed. Log: ${run.logPath}`;
}

function androidSdkCandidates() {
  return [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    "D:\\AndroidDev\\SDK",
  ].filter(Boolean);
}

async function locateAndroidTools() {
  for (const sdk of androidSdkCandidates()) {
    const adb = path.join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
    const emulator = path.join(sdk, "emulator", process.platform === "win32" ? "emulator.exe" : "emulator");
    if (await exists(adb) && await exists(emulator)) return { sdk, adb, emulator };
  }
  return null;
}

async function locateJavaHome() {
  const candidates = [
    process.env.UNREVIEWED_JAVA_HOME,
    process.env.JAVA_HOME,
    "C:\\Users\\ASUS\\.jdks\\jbr-21.0.11",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const java = path.join(candidate, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (await exists(java)) return candidate;
  }
  return null;
}

function parseAdbDevices(output) {
  return output.split(/\r?\n/)
    .map((line) => /^([^\s]+)\s+device\b/.exec(line.trim())?.[1])
    .filter(Boolean);
}

async function adb(tools, args, options = {}) {
  const run = await runProcess(tools.adb, args, { name: `adb-${args.slice(0, 3).join("-")}`, timeout: 45_000, ...options });
  if (run.error) throw new Error(`ADB could not start: ${run.error.message}`);
  return run;
}

async function waitForAndroidBoot(tools, serial, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const run = await adb(tools, ["-s", serial, "shell", "getprop", "sys.boot_completed"], { log: false, timeout: 10_000 });
    if (run.code === 0 && run.stdout.trim() === "1") return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Android emulator ${serial} did not complete boot within ${timeout / 1000}s.`);
}

async function ensureEmulator(tools) {
  const listed = await adb(tools, ["devices"]);
  if (isBlockedAndroidHostRuntime(listed)) {
    skip("ADB cannot access its Windows .android directory in this execution host. Run the gate from an interactive Windows PowerShell session with the Android SDK user profile available.");
  }
  requireSuccess(listed, "ADB device discovery");
  const online = parseAdbDevices(listed.stdout);
  const emulator = online.find((serial) => serial.startsWith("emulator-"));
  if (emulator) return { serial: emulator, startedByQa: false };
  if (online.length) skip(`An Android device is connected (${online.join(", ")}), but the QA gate will not clear a physical device. Start an emulator or set up an emulator-only test device.`);

  const avdRun = await runProcess(tools.emulator, ["-list-avds"], { name: "android-avds", timeout: 30_000 });
  requireSuccess(avdRun, "Android AVD discovery");
  const avds = avdRun.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const requested = process.env.UNREVIEWED_ANDROID_AVD;
  const selected = requested || (avds.length === 1 ? avds[0] : "");
  if (!selected) skip(`No online emulator and ${avds.length} AVDs are available. Set UNREVIEWED_ANDROID_AVD to the AVD that may be used for QA.`);
  if (!avds.includes(selected)) skip(`UNREVIEWED_ANDROID_AVD=${selected} is not installed. Available AVDs: ${avds.join(", ") || "none"}.`);

  const emulatorProcess = spawn(tools.emulator, ["-avd", selected, "-no-snapshot-save"], { cwd: ROOT, windowsHide: true, detached: false, stdio: "ignore" });
  const deadline = Date.now() + 60_000;
  let serial = "";
  while (Date.now() < deadline) {
    const devices = await adb(tools, ["devices"], { log: false, timeout: 10_000 });
    serial = parseAdbDevices(devices.stdout).find((value) => value.startsWith("emulator-")) || "";
    if (serial) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (!serial) {
    emulatorProcess.kill();
    throw new Error(`Started AVD ${selected}, but no online emulator appeared within 60 seconds.`);
  }
  await waitForAndroidBoot(tools, serial);
  return { serial, startedByQa: true };
}

function xmlNodes(xml) {
  return (xml.match(/<node\b[^>]*\/?>(?:<\/node>)?/g) || []).map((node) => {
    const attributes = Object.fromEntries([...node.matchAll(/([^\s=]+)="([^"]*)"/g)].map(([, key, value]) => [key, value.replace(/&amp;/g, "&").replace(/&quot;/g, '"')]));
    return attributes;
  });
}

function boundsCenter(bounds) {
  const match = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(bounds || "");
  if (!match) return null;
  const [, left, top, right, bottom] = match.map(Number);
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2), left, top, right, bottom };
}

function findUiNode(xml, expected) {
  const matcher = expected instanceof RegExp ? expected : new RegExp(`^${String(expected).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  return xmlNodes(xml).find((node) => matcher.test(node.text || "") || matcher.test(node["content-desc"] || ""));
}

async function dumpUi(tools, serial) {
  const dump = await adb(tools, ["-s", serial, "shell", "uiautomator", "dump", "/sdcard/unreviewed-qa.xml"], { log: false, timeout: 20_000 });
  if (dump.code !== 0) throw new Error(`UI Automator dump failed: ${dump.stderr || dump.stdout}`);
  const read = await adb(tools, ["-s", serial, "shell", "cat", "/sdcard/unreviewed-qa.xml"], { log: false, timeout: 20_000 });
  if (read.code !== 0) throw new Error(`UI Automator XML read failed: ${read.stderr || read.stdout}`);
  return read.stdout;
}

async function waitForUi(tools, serial, expected, description, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastXml = "";
  while (Date.now() < deadline) {
    lastXml = await dumpUi(tools, serial);
    const node = findUiNode(lastXml, expected);
    if (node) return { node, xml: lastXml };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}. Last UI dump saved with the failure artifact.`);
}

async function tapUi(tools, serial, expected, description) {
  const { node } = await waitForUi(tools, serial, expected, description);
  const center = boundsCenter(node.bounds);
  assert(center, `${description} has no tappable bounds.`);
  const tap = await adb(tools, ["-s", serial, "shell", "input", "tap", String(center.x), String(center.y)], { log: false });
  if (tap.code !== 0) throw new Error(`Could not tap ${description}: ${tap.stderr || tap.stdout}`);
}

async function tapFirstEditText(tools, serial) {
  const xml = await dumpUi(tools, serial);
  const node = xmlNodes(xml).find((item) => item.class === "android.widget.EditText");
  const center = boundsCenter(node?.bounds);
  assert(center, "Profile nickname input was not exposed to UI Automator.");
  const tap = await adb(tools, ["-s", serial, "shell", "input", "tap", String(center.x), String(center.y)], { log: false });
  if (tap.code !== 0) throw new Error("Could not focus the profile nickname input.");
}

async function captureAndroidFailure(tools, serial, name) {
  const screenshotPath = path.join(RESULTS, `${safeName(name)}.png`);
  try {
    const image = await runBinary(tools.adb, ["-s", serial, "exec-out", "screencap", "-p"]);
    if (image.code === 0) await writeFile(screenshotPath, image.stdout);
  } catch {}
  try {
    const xml = await dumpUi(tools, serial);
    await writeFile(path.join(RESULTS, `${safeName(name)}.xml`), xml);
  } catch {}
  return screenshotPath;
}

async function assertNoFatalLogcat(tools, serial) {
  const logcat = await adb(tools, ["-s", serial, "logcat", "-d", "-v", "brief"], { name: "android-logcat" });
  if (logcat.code !== 0) throw new Error(`Could not collect Android logcat: ${logcat.stderr || logcat.stdout}`);
  const fatal = /FATAL EXCEPTION|AndroidRuntime: Process:|Uncaught (?:TypeError|ReferenceError)|\bnet::ERR_[A-Z_]+\b/i.exec(logcat.stdout);
  if (fatal) throw new Error(`Android logcat contains a crash, JavaScript exception, or failed network request (${fatal[0]}). See ${logcat.logPath}`);
  return logcat.logPath;
}

async function runInstalledAndroidChecks(tools, serial, apk) {
  const clearLog = await adb(tools, ["-s", serial, "logcat", "-c"]);
  requireSuccess(clearLog, "Android log reset");
  const install = await adb(tools, ["-s", serial, "install", "-r", apk], { name: "android-install", timeout: 120_000 });
  requireSuccess(install, "APK installation");
  const clear = await adb(tools, ["-s", serial, "shell", "pm", "clear", APP_ID]);
  requireSuccess(clear, "fresh-app data reset");
  const launch = async () => {
    const started = await adb(tools, ["-s", serial, "shell", "am", "start", "-n", `${APP_ID}/.MainActivity`]);
    requireSuccess(started, "app launch");
  };

  try {
    await launch();
    await waitForUi(tools, serial, /^UNREVIEWED$/i, "the fresh main menu title");
    await waitForUi(tools, serial, /^Play$/i, "the fresh main menu Play button");
    const fresh = await dumpUi(tools, serial);
    assert(!findUiNode(fresh, /Saved game found|Resume Game|You.?re the Subject/i), "A fresh app launch must not enter or offer an old room.");

    // This creates a dedicated single-player lobby, then leaves it via the
    // application UI. It never touches prompt data or existing rooms.
    await tapUi(tools, serial, /^Play$/i, "Play");
    await tapUi(tools, serial, /^Create a Room/i, "Create a Room");
    await tapUi(tools, serial, /^Let.?s go$/i, "host configuration confirmation");
    await tapFirstEditText(tools, serial);
    const type = await adb(tools, ["-s", serial, "shell", "input", "text", "AndroidQA"], { log: false });
    if (type.code !== 0) throw new Error(`Could not type AndroidQA nickname: ${type.stderr || type.stdout}`);
    await adb(tools, ["-s", serial, "shell", "input", "keyevent", "4"], { log: false }); // Hide keyboard only; room is not active yet.
    await tapUi(tools, serial, /^Join Room$/i, "profile Join Room");
    await waitForUi(tools, serial, /Players \(1\/8\)/i, "created lobby");

    const stopped = await adb(tools, ["-s", serial, "shell", "am", "force-stop", APP_ID]);
    requireSuccess(stopped, "app restart force-stop");
    await launch();
    await waitForUi(tools, serial, /Saved game found/i, "explicit saved-game choice after restart");
    await tapUi(tools, serial, /^Resume Game$/i, "Resume Game");
    await waitForUi(tools, serial, /Players \(1\/8\)/i, "resumed lobby");

    const back = await adb(tools, ["-s", serial, "shell", "input", "keyevent", "4"]);
    requireSuccess(back, "Android hardware Back");
    await waitForUi(tools, serial, /Leave the game\?/i, "Quit Game confirmation after Android Back");
    await tapUi(tools, serial, /^Stay in Game$/i, "Quit Game cancel");
    await waitForUi(tools, serial, /Players \(1\/8\)/i, "lobby after cancel");

    await adb(tools, ["-s", serial, "shell", "input", "keyevent", "4"]);
    await waitForUi(tools, serial, /Leave the game\?/i, "Quit Game confirmation before leave");
    await tapUi(tools, serial, /^Leave Game$/i, "server-confirmed Leave Game");
    await waitForUi(tools, serial, /^Play$/i, "main menu after leaving room");
    const afterLeave = await dumpUi(tools, serial);
    assert(!findUiNode(afterLeave, /Saved game found|Resume Game/i), "A successful leave must clear the saved session.");

    await adb(tools, ["-s", serial, "shell", "am", "force-stop", APP_ID]);
    await launch();
    await waitForUi(tools, serial, /^Play$/i, "main menu after restart following leave");
    const finalUi = await dumpUi(tools, serial);
    assert(!findUiNode(finalUi, /Saved game found|Resume Game/i), "The app must not rejoin a room after Leave Game.");

    const display = await adb(tools, ["-s", serial, "shell", "wm", "size"]);
    requireSuccess(display, "Android viewport inspection");
    const play = findUiNode(finalUi, /^Play$/i);
    const bounds = boundsCenter(play?.bounds);
    assert(bounds && bounds.top >= 0, "Main-menu Play action must remain visible and tappable.");
    const logPath = await assertNoFatalLogcat(tools, serial);
    return `Fresh launch, saved-session choice, Resume, Quit Game, Android Back, restart, viewport visibility, crash and logcat checks passed. Logcat: ${logPath}`;
  } catch (error) {
    const screenshotPath = await captureAndroidFailure(tools, serial, "android-ui-failure");
    throw new Error(`${error.message}\nFailure screenshot: ${screenshotPath}`);
  }
}

async function writeReport() {
  if (reportWritten) return;
  reportWritten = true;
  const failed = results.filter((result) => result.status === "FAIL");
  const skipped = results.filter((result) => result.status === "SKIP");
  const criticalSkipped = skipped.filter((result) => result.critical);
  const ready = failed.length === 0 && criticalSkipped.length === 0;
  const lines = [
    "UNREVIEWED Android QA report",
    `Run: ${RUN_ID}`,
    "",
    ...results.map((result) => `${result.status.padEnd(4)} ${result.name}${result.critical ? " [release gate]" : ""}\n      ${result.detail}`),
    "",
    `Totals: ${results.filter((result) => result.status === "PASS").length} passed, ${failed.length} failed, ${skipped.length} skipped.`,
    ready ? "RELEASE GATE: PASS — automated critical checks completed." : "RELEASE GATE: BLOCKED — fix failures and run every skipped critical check before treating an APK as release-ready.",
  ];
  const report = `${lines.join("\n")}\n`;
  await writeFile(path.join(RESULTS, "report.txt"), report);
  await writeFile(path.join(RESULTS, "report.json"), `${JSON.stringify({ runId: RUN_ID, ready, results }, null, 2)}\n`);
  console.log(report);
  if (!ready) process.exitCode = 1;
}

await mkdir(RESULTS, { recursive: true });
process.on("SIGINT", () => { void writeReport().finally(() => process.exit(130)); });

await check("Lint", async () => {
  // Capacitor/Gradle emits generated JavaScript below android/. It is not
  // product source, and one generated bridge references an ESLint plugin this
  // web project does not install, so lint the maintained web/test sources.
  const run = await runProcess(npm, ["run", "lint", "--", "--ignore-pattern", "android/**"], { name: "lint", timeout: 180_000 });
  requireSuccess(run, "Lint");
  return `Passed. Log: ${run.logPath}`;
});

await check("Type check", async () => {
  const run = await runProcess(npm, ["run", "typecheck"], { name: "typecheck", timeout: 180_000 });
  requireSuccess(run, "Type check");
  return `Passed. Log: ${run.logPath}`;
});

for (const [label, script] of [
  ["Background audio regression", "tests/background-audio-regression.mjs"],
  ["Writing audio regression", "tests/writing-audio-regression.mjs"],
  ["Quit Game regression", "tests/quit-game-regression.mjs"],
  ["Saved-room recovery regression", "tests/saved-room-recovery-regression.mjs"],
  ["Game reliability regression", "tests/game-reliability-regression.mjs"],
  ["Roster request regression", "tests/roster-request-regression.mjs"],
  ["Room backend regression", "tests/room-backend-regression.mjs"],
  ["Live-test opt-in regression", "tests/live-test-optin-regression.mjs"],
  ["Room load simulation (four players, full game)", "tests/room-load-simulation.mjs"],
  ["Mobile layout regression", "tests/mobile-layout-regression.mjs"],
]) {
  await check(label, () => runNodeTest(label, script));
}

await check("Production web build", async () => {
  const run = await runProcess(npm, ["run", "build"], { name: "production-build", timeout: 240_000 });
  requireSuccess(run, "Production web build");
  return `Passed. Log: ${run.logPath}`;
});

const playwrightAvailable = await hasPlaywright();
if (!playwrightAvailable) {
  await check("Browser mobile viewports (320×568, 360×800, 393×852, 412×915)", async () => skip("Playwright is not installed in this checkout. Install the project-approved Playwright package and Chromium, then rerun the same command."));
  await check("Browser saved-session UI", async () => skip("Playwright is not installed in this checkout. The deterministic saved-room and Quit Game regressions ran, but browser UI coverage remains unavailable."));
  await check("Live Base44 multiplayer room", async () => skip("Playwright is not installed in this checkout, so the four-client browser smoke test could not run."));
} else {
  const port = Number(process.env.UNREVIEWED_QA_PORT) || await findOpenPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const preview = startPreview(port);
  try {
    await waitForUrl(baseUrl);
    await check("Browser mobile viewports (320×568, 360×800, 393×852, 412×915)", () => runNodeTest("mobile-browser-layout", "tests/mobile-results-layout.mjs", { UNREVIEWED_BASE_URL: baseUrl }));
    await check("Browser saved-session UI", () => runNodeTest("saved-room-browser", "tests/saved-room-browser-regression.mjs", { UNREVIEWED_BASE_URL: baseUrl }));
  } catch (error) {
    await check("Browser mobile viewports (320×568, 360×800, 393×852, 412×915)", async () => { throw error; });
    await check("Browser saved-session UI", async () => skip("Local Vite preview was unavailable; see vite-preview.log."));
  } finally {
    await preview.stop();
  }
  if (process.env.UNREVIEWED_QA_LIVE_MULTIPLAYER !== "1") {
    await check("Live Base44 multiplayer room", async () => skip("Not run: the live four-player smoke test contacts the real Base44 backend and requires explicit opt-in (UNREVIEWED_QA_LIVE_MULTIPLAYER=1). This is a skip, not a pass."));
  } else {
    await check("Live Base44 multiplayer room", () => runNodeTest("live-multiplayer-smoke", "tests/multiplayer-smoke.mjs", {
      UNREVIEWED_BASE_URL: process.env.UNREVIEWED_BASE_URL || DEFAULT_LIVE_URL,
      UNREVIEWED_CLEANUP: "1",
      UNREVIEWED_QA_LIVE_MULTIPLAYER: "1",
    }));
  }
}

await check("Capacitor Android sync and debug APK build", async () => {
  if (!await exists(path.join(ROOT, "android"))) skip("The existing android/ Capacitor project is unavailable in this checkout.");
  const sync = await runProcess(npx, ["--no-install", "cap", "sync", "android"], { name: "capacitor-sync", timeout: 240_000 });
  if (isBlockedAndroidHostRuntime(sync)) {
    skip("Node cannot access the Windows account profile required by Capacitor in this execution host (uv_os_get_passwd returned ENOMEM). Run the gate from an interactive Windows PowerShell session.");
  }
  requireSuccess(sync, "Capacitor Android sync");
  const gradlew = path.join(ROOT, "android", process.platform === "win32" ? "gradlew.bat" : "gradlew");
  if (!await exists(gradlew)) throw new Error(`Android Gradle wrapper is missing at ${gradlew}.`);
  const javaHome = await locateJavaHome();
  if (!javaHome) skip("No usable Java runtime was found. Set UNREVIEWED_JAVA_HOME to a JDK used by the Android Gradle build.");
  const gradle = await runProcess(gradlew, ["assembleDebug", "--console=plain"], {
    name: "android-debug-build",
    cwd: path.join(ROOT, "android"),
    env: { ...process.env, JAVA_HOME: javaHome, Path: `${path.join(javaHome, "bin")};${process.env.Path || ""}` },
    timeout: 600_000,
  });
  requireSuccess(gradle, "Android debug build");
  const apk = path.join(ROOT, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  if (!await exists(apk)) throw new Error(`Gradle reported success but no debug APK exists at ${apk}.`);
  const info = await stat(apk);
  return `Built ${apk} (${info.size} bytes). Sync: ${sync.logPath}; Gradle: ${gradle.logPath}`;
});

await check("Installed Android APK lifecycle and UI", async () => {
  const tools = await locateAndroidTools();
  if (!tools) skip("Android SDK platform-tools/adb and emulator were not found. Set ANDROID_SDK_ROOT (or install the Android SDK) and rerun.");
  const apk = path.join(ROOT, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  if (!await exists(apk)) skip("No debug APK was built, so installation and device QA cannot run.");
  const emulator = await ensureEmulator(tools);
  try {
    return await runInstalledAndroidChecks(tools, emulator.serial, apk);
  } finally {
    if (emulator.startedByQa) {
      const stopped = await adb(tools, ["-s", emulator.serial, "emu", "kill"], { name: "android-emulator-stop", timeout: 30_000 });
      if (stopped.code !== 0) console.warn(`Could not stop QA-created emulator ${emulator.serial}: ${stopped.stderr || stopped.stdout}`);
    }
  }
});

await writeReport();
// A browser driver or an npm.cmd child can leave a Windows pipe handle open
// after its browser/process has already been closed. The report is fully
// flushed above, so explicitly end this CLI instead of leaving CI or a local
// release check hanging without further work to perform.
process.exit(process.exitCode || 0);
