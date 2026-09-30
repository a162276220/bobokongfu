"""Try to boot a chromium-family browser under the confined Windows sandbox.

Chrome self-terminates because its Crashpad handler is denied OpenProcess.
This script tries fallbacks and reports which one yields a live CDP endpoint.
"""
import json
import os
import subprocess
import sys
import tempfile
import time

CANDIDATES = {
    "system-chrome": r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "pw-chromium": r"C:\Users\HUAWEI\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe",
    "pw-headless-shell": r"C:\Users\HUAWEI\AppData\Local\ms-playwright\chromium_headless_shell-1234\chrome-headless-shell-win64\chrome-headless-shell.exe",
    "edge": r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
}

BASE_ARGS = [
    "--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-features=Translate,CrashReporting",
    "--remote-debugging-port=9333", "--window-size=1280,900", "about:blank",
]


def try_one(name, exe):
    if not os.path.exists(exe):
        return {"name": name, "ok": False, "reason": "missing"}
    prof = tempfile.mkdtemp(prefix=f"cdp-{name}-")
    # The sandbox forbids inheriting pipe handles into the child, so let Chrome
    # write its own log file via --log-file and keep stdio fully detached.
    logfile = os.path.join(prof, "chrome.log")
    args = [exe] + BASE_ARGS + [f"--user-data-dir={prof}", f"--log-file={logfile}"]
    env = dict(os.environ)
    env["CHROME_HEADLESS"] = "1"
    try:
        proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
    except OSError as e:
        return {"name": name, "ok": False, "reason": f"spawn:{e}"}
    endpoint = None
    deadline = time.time() + 15
    while time.time() < deadline:
        if proc.poll() is not None:
            tail = ""
            try:
                with open(logfile, "rb") as fh:
                    tail = fh.read()[-1200:].decode("utf-8", "replace")
            except OSError:
                pass
            return {"name": name, "ok": False, "reason": f"exit={proc.returncode}", "log": tail}
        # Probe the fixed CDP port directly.
        probe = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9333/json/version' -TimeoutSec 3).Content"],
            capture_output=True, text=True, timeout=20)
        if probe.returncode == 0:
            try:
                endpoint = json.loads(probe.stdout)["webSocketDebuggerUrl"]
                break
            except Exception:
                pass
        time.sleep(1)
    if endpoint is None:
        proc.kill()
        return {"name": name, "ok": False, "reason": "no-endpoint"}
    proc.kill()
    return {"name": name, "ok": True, "endpoint": endpoint, "profile": prof}


def main():
    results = []
    for name, exe in CANDIDATES.items():
        r = try_one(name, exe)
        results.append(r)
        print(json.dumps(r, ensure_ascii=False), flush=True)
        if r["ok"]:
            break
    print("SUMMARY", json.dumps([{"name": r["name"], "ok": r["ok"], "reason": r.get("reason")} for r in results], ensure_ascii=False))


if __name__ == "__main__":
    main()
