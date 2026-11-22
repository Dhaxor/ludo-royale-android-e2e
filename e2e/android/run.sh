#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner once the emulator is up:
# installs the APK (no permissions pre-granted, so the notification prompt is
# real), records logcat, starts Appium and runs the walkthrough.
set -x
mkdir -p shots
adb devices
adb shell getprop ro.build.version.release
adb shell dumpsys webviewupdate | grep -i "current webview package" | head -3
adb install -r app.apk
# A cold-booted emulator is still busy (the launcher often freezes for a while):
# let it settle on the home screen before the walkthrough starts.
sleep 45
adb shell input keyevent 3
sleep 5
adb logcat -c
adb logcat -v time > shots/logcat.txt 2>&1 &
LOGCAT=$!
appium --log shots/appium.log --log-level info > /dev/null 2>&1 &
APPIUM=$!
for i in $(seq 1 30); do curl -s http://127.0.0.1:4723/status | grep -q ready && break; sleep 2; done
node e2e/android/walkthrough.mjs 2>&1 | tee shots/walkthrough.log
adb exec-out screencap -p > shots/zz-final.png
adb shell dumpsys package com.dhaxor.ludoroyale | sed -n '/requested permissions/,/install permissions/p' > shots/permissions.txt
adb shell dumpsys meminfo com.dhaxor.ludoroyale | head -40 > shots/meminfo.txt
kill $APPIUM $LOGCAT || true
grep -E "FATAL|AndroidRuntime|ReactNativeJS|chromium" shots/logcat.txt | tail -200 > shots/logcat-app.txt || true
exit 0
