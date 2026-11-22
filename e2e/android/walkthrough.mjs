// Android E2E walkthrough (Appium + UiAutomator2) for an EAS "e2e" APK on an
// emulator: first launch → onboarding → the warm-up's 3D board → the idle
// rescue (hand, then the game's own first roll) → the back button in a match
// → the daily sheet and the Android 13+ notification prompt → the shop and the
// Royal Club in Google Play wording → back-button navigation between screens.
// React Native exposes each testID as the view's resource-id on Android.
// Screenshots and results.json go to ../../shots (published by the workflow).
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { remote } from "webdriverio";

const PKG = "com.dhaxor.ludoroyale";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "../..");
const SHOTS = path.join(ROOT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const CAPS = {
  platformName: "Android",
  "appium:automationName": "UiAutomator2",
  "appium:appPackage": PKG,
  "appium:appActivity": ".MainActivity",
  "appium:noReset": true,
  "appium:dontStopAppOnReset": true, // a restarted session keeps the game where it was
  "appium:autoGrantPermissions": false,
  "appium:newCommandTimeout": 900,
  "appium:uiautomator2ServerInstallTimeout": 180000,
  "appium:uiautomator2ServerLaunchTimeout": 180000,
  "appium:adbExecTimeout": 120000,
  "appium:disableIdLocatorAutocompletion": true,
};
let driver;
async function startSession() {
  driver = await remote({ hostname: "127.0.0.1", port: 4723, logLevel: "warn", connectionRetryCount: 0, connectionRetryTimeout: 600000, capabilities: CAPS });
  // The 3D board animates without pause: never wait for the UI to go idle.
  await driver.updateSettings({ waitForIdleTimeout: 0, waitForSelectorTimeout: 0 });
}
// The test agent on the phone (UiAutomator2 server) can die when the emulator's
// software GPU stalls: start a fresh session and carry on with the next section.
const agentDied = (e) => /socket hang up|instrumentation process|ECONNREFUSED|not running|could not proxy/i.test(String(e?.message ?? e));
async function restartSession() {
  log("  ↻ restarting the Appium session");
  try {
    await driver.deleteSession();
  } catch {
    /* already gone */
  }
  await startSession();
}
await startSession();

const byId = (id) => `android=new UiSelector().resourceId("${id}")`;
const byText = (s) => `android=new UiSelector().textContains("${s}")`;

async function find(id, timeout = 8000) {
  const end = Date.now() + timeout;
  let polls = 0;
  do {
    const els = await driver.$$(byId(id));
    if (els.length) return els[0];
    // an "isn't responding" dialog hides the app from UiAutomator: deal with it
    if (++polls % 6 === 0) await dismissAnr();
    await sleep(400);
  } while (Date.now() < end);
  return null;
}
const exists = async (id, timeout = 1000) => !!(await find(id, timeout));
async function gone(id, timeout = 4000) {
  const end = Date.now() + timeout;
  do {
    if (!(await driver.$$(byId(id))).length) return true;
    await sleep(400);
  } while (Date.now() < end);
  return false;
}
async function tap(id, label = id, timeout = 6000) {
  const el = await find(id, timeout);
  if (!el) {
    log(`  (no ${label})`);
    return false;
  }
  await el.click();
  await sleep(700);
  return true;
}
async function textShown(sub, timeout = 4000) {
  const end = Date.now() + timeout;
  do {
    if ((await driver.$$(byText(sub))).length) return true;
    await sleep(400);
  } while (Date.now() < end);
  return false;
}
async function scrollToText(sub) {
  try {
    await driver.$(`android=new UiScrollable(new UiSelector().scrollable(true)).scrollTextIntoView("${sub}")`);
  } catch {
    /* not found */
  }
  return textShown(sub, 1500);
}
let shotN = 0;
async function shot(name) {
  const b64 = await driver.takeScreenshot();
  const file = path.join(SHOTS, `${String(++shotN).padStart(2, "0")}-${name}.png`);
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
  return file;
}
// How colourful the middle of the screen is (share of saturated pixels): the
// 3D board's red/green/yellow/blue squares score well above the navy backdrop.
function colourful(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width: w, height: h, data } = png;
  let n = 0;
  let sat = 0;
  for (let y = Math.floor(h * 0.25); y < h * 0.7; y += 4)
    for (let x = Math.floor(w * 0.1); x < w * 0.9; x += 4) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      n += 1;
      if (max > 90 && max - min > 70) sat += 1;
    }
  return n ? sat / n : 0;
}
async function back(label = "back") {
  log(`  ⟵ ${label}`);
  await driver.back();
  await sleep(1200);
}
// Android's "<app> isn't responding" dialog: record it and answer Wait, so one
// slow moment doesn't block every later check.
let anrs = 0;
async function dismissAnr() {
  const wait = await driver.$$('android=new UiSelector().resourceId("android:id/aerr_wait")').catch(() => []);
  if (!wait.length) return false;
  let title = "";
  try {
    const t = await driver.$$('android=new UiSelector().resourceId("android:id/alertTitle")');
    if (t.length) title = await t[0].getText();
  } catch {
    /* no title */
  }
  await shot("anr").catch(() => {});
  if (/ludo royale/i.test(title)) {
    // our own app froze: a real failure; let it carry on
    anrs += 1;
    log(`  ! '${title}': tapping Wait`);
    await wait[0].click().catch(() => {});
  } else if (/system/i.test(title)) {
    // Android itself (System UI, "Process system"): closing it restarts the phone
    log(`  ! '${title}': tapping Wait (never close Android itself)`);
    await wait[0].click().catch(() => {});
  } else {
    // another app (often the emulator's launcher on a cold boot): close it
    log(`  ! '${title || "another app isn't responding"}': closing that app`);
    const close = await driver.$$('android=new UiSelector().resourceId("android:id/aerr_close")').catch(() => []);
    await (close[0] ?? wait[0]).click().catch(() => {});
  }
  await sleep(1500);
  return true;
}
async function section(name, fn) {
  log(`== ${name}`);
  try {
    await dismissAnr();
    await fn();
  } catch (e) {
    check(`${name} (no crash)`, false, String(e?.message ?? e).slice(0, 300));
    if (agentDied(e)) await restartSession().catch((err) => log(`  restart failed: ${err?.message ?? err}`));
    try {
      await shot(`${name.toLowerCase()}-error`);
    } catch {
      /* ignore */
    }
  }
}

try {
  await section("LAUNCH", async () => {
    const onboarding = await find("onboarding-choose", 120000);
    await shot("launch");
    check("first launch shows onboarding", onboarding);
  });

  await section("ONBOARDING", async () => {
    await tap("starter-char_penguin", "starter penguin");
    await tap("onboarding-choose", "choose champion");
    const name = await find("onboarding-name", 8000);
    if (name) {
      await name.clearValue();
      await name.setValue("Droid");
      try {
        await driver.hideKeyboard();
      } catch {
        /* no keyboard */
      }
    }
    await shot("name");
    await tap("onboarding-done", "let's play");
    const board = await find("game3d", 30000);
    check("onboarding starts the warm-up", board);
  });

  await section("BOARD-3D", async () => {
    let best = 0;
    let file = "";
    for (let i = 0; i < 12 && best < 0.06; i++) {
      await sleep(2500);
      file = await shot(`board-${i}`);
      best = Math.max(best, colourful(file));
    }
    check("the 3D board renders in the WebView", best >= 0.06, `colourful share ${best.toFixed(3)}`);
  });

  await section("RESCUE", async () => {
    // Don't touch the dice: the hand comes at 8 s, the game rolls at 15 s.
    const nudge = await find("coach-nudge", 25000);
    if (nudge) await shot("nudge");
    check("idle warm-up: the hand points at Roll", nudge);
    const rolled = (await textShown("first roll", 20000)) || (await textShown("gold arrow", 3000));
    await shot("auto-roll");
    check("idle warm-up: the game makes the first roll", rolled);
  });

  await section("BACK-IN-MATCH", async () => {
    await back("open the leave question");
    const asked = await exists("confirm-leave", 4000);
    await shot("back-confirm");
    check("back in a match asks before leaving", asked);
    await back("close the question");
    check("back again closes the question", await gone("confirm-leave", 4000));
    await back("ask again");
    await tap("confirm-leave", "confirm leave", 4000);
    const lobby = await find("lobby-play", 20000);
    check("leaving the warm-up lands on Home", lobby);
    await shot("home");
  });

  // (The daily sheet itself only pops up after a finished match; leaving the
  // warm-up early doesn't count, so check the reward on the Rewards tab.)
  await section("REWARDS-AND-REMINDERS", async () => {
    if (!(await exists("lobby-play", 4000))) await tap("tab-home", "home tab");
    await tap("tab-rewards", "rewards tab");
    check("the Rewards tab shows the daily reward", await find("rewards-daily", 10000));
    await shot("rewards");
    await tap("tab-profile", "profile tab");
    if (!(await tap("profile-settings", "settings", 8000))) return check("settings open", false);
    if (!(await tap("settings-reminders", "reminders switch", 8000))) return check("the reminders switch", false);
    let allow = [];
    for (let i = 0; i < 8 && !allow.length; i++) {
      await sleep(800);
      allow = await driver.$$('android=new UiSelector().resourceId("com.android.permissioncontroller:id/permission_allow_button")');
    }
    await shot("notification-prompt");
    check("turning reminders on shows Android's notification prompt", allow.length > 0);
    if (allow.length) {
      await allow[0].click();
      await sleep(1500);
      const perms = await driver.execute("mobile: shell", { command: "dumpsys", args: ["package", "com.dhaxor.ludoroyale"] }).catch(() => "");
      check("notifications are allowed after the prompt", /POST_NOTIFICATIONS: granted=true/.test(String(perms)));
    }
    await back("leave settings");
    await back("leave Profile");
  });

  await section("BACK-ON-HOME", async () => {
    if (!(await exists("lobby-play", 4000))) await tap("tab-home", "home tab");
    await back("leave the app from Home");
    const state = await driver.queryAppState(PKG);
    check("back on Home leaves the app (Android default)", state !== 4, `app state ${state}`);
    await driver.activateApp(PKG);
    check("the game comes back on Home", await find("lobby-play", 30000));
  });

  await section("SHOP-GOOGLE-PLAY", async () => {
    await tap("tab-shop", "shop tab");
    check("the shop opens", await find("shop-coins", 10000));
    await shot("shop");
    const legal = await scrollToText("Google Play account");
    await shot("shop-legal");
    check("the shop's small print names Google Play", legal);
    const app = await scrollToText("App Store");
    check("no App Store wording in the shop", !app);
    // The emulator has no Play Store app, so billing can't connect.
    await driver.$(`android=new UiScrollable(new UiSelector().scrollable(true)).scrollToBeginning(10)`).catch(() => {});
    try {
      await driver.$('android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("buy-coins-1"))');
    } catch {
      /* not found */
    }
    const buy = (await find("buy-coins-1", 3000)) ? "buy-coins-1" : null;
    if (buy) {
      await tap(buy, "buy a coin pack");
      const msg = await textShown("Google Play is unavailable", 6000);
      await shot("shop-unavailable");
      check("buying without Google Play explains it in Play wording", msg);
    } else check("a coin pack price button", false);
  });

  await section("ROYAL-CLUB", async () => {
    if (!(await exists("shop-club", 2000))) await scrollToText("Royal Club");
    if (!(await tap("shop-club", "Royal Club banner", 6000))) return check("Royal Club opens from the shop", false);
    const terms = await find("club-terms", 10000);
    await shot("royal-club");
    const termsText = terms ? await terms.getText().catch(() => "") : "";
    check("Royal Club terms name Google Play", /Google Play/.test(termsText) && !/Apple|App Store/.test(termsText), termsText.slice(0, 90));
    check("Royal Club links Terms of Use (not Apple's EULA)", await textShown("Terms of Use", 3000) && !(await textShown("EULA", 1000)));
    await back("leave the Royal Club");
    check("back from the Royal Club returns to the shop", await find("shop-coins", 8000));
  });

  await section("BACK-NAVIGATION", async () => {
    await tap("tab-profile", "profile tab");
    if (await tap("profile-settings", "settings", 8000)) {
      check("settings open", await find("settings-automove", 8000));
      await back("leave settings");
      check("back from Settings returns to Profile", await find("profile-settings", 8000));
    }
    await back("leave Profile");
    check("back from a tab returns to Home", await find("lobby-play", 8000));
    await shot("home-again");
  });

  await section("SECOND-MATCH", async () => {
    if (!(await tap("lobby-play", "PLAY", 8000))) return check("PLAY starts a match", false);
    const board = await find("game3d", 30000);
    check("PLAY starts a match", board);
    await sleep(6000);
    await shot("match-2");
    // a player who left the warm-up early gets the how-to-play: Back closes it like Skip
    if (await exists("tutorial-skip", 6000)) {
      await back("close the how-to-play");
      check("back closes the how-to-play", await gone("tutorial-skip", 6000));
    }
    if (await tap("game-roll", "roll", 15000)) {
      await sleep(3000);
      await shot("match-2-rolled");
    }
    await back("ask to leave");
    await tap("confirm-leave", "confirm leave", 4000);
    check("back + Leave ends the match", await find("lobby-play", 20000));
  });
} finally {
  check("no 'isn't responding' dialogs", anrs === 0, `${anrs} seen`);
  fs.writeFileSync(path.join(SHOTS, "results.json"), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.ok);
  log(`DONE: ${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) log(`  FAILED ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  await driver.deleteSession().catch(() => {});
}
