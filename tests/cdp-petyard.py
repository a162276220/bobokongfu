"""Verify the 淘金矿工小屋 desk-pet wiring via CDP against Playwright's
chrome-headless-shell.

Notes on this environment: full Chrome and Playwright's chromium die in
Crashpad (sandbox denies OpenProcess to the crash handler); shells spawned by
node's child_process die with 0x80000003; pip is blocked so the WebSocket
client is hand-rolled. The proven-good path is Python subprocess.Popen with
stdio DEVNULL plus a fixed CDP port. The browser-level socket resets once
session event traffic floods it, so each command group runs on its own fresh
page-level connection created through Target.createTarget on a *stable*
browser socket, and seed + navigation happen before any other traffic.
"""
import base64
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request

SHELL = r"C:\Users\HUAWEI\AppData\Local\ms-playwright\chromium_headless_shell-1234\chrome-headless-shell-win64\chrome-headless-shell.exe"
PAGE = "file:///D:/桌宠/淘金矿工小屋/淘金矿工小屋·自律工作台.html"
PORT = 9333
OUT = os.path.join(tempfile.gettempdir(), "cdpet-shots")
os.makedirs(OUT, exist_ok=True)

SEED = """(() => {
  const pets = [
    { id: 'pet_a', shopId: 'p_bobo', petId: 'huhu-carrot', name: '胡胡', type: '胡胡', icon: 'deskpet:huhu-carrot', hunger: 80, mood: 80, health: 100, level: 1, exp: 0, adoptedAt: new Date().toISOString(), lastUpdate: new Date().toISOString() },
    { id: 'pet_b', shopId: 'p_dundun', petId: 'dundun-office', name: '墩墩', type: '墩墩', icon: 'deskpet:dundun-office', hunger: 75, mood: 75, health: 100, level: 1, exp: 0, adoptedAt: new Date().toISOString(), lastUpdate: new Date().toISOString() },
    { id: 'pet_c', shopId: 'p_raccoon', petId: 'raccoon-typing', name: '打工卜', type: '打工卜', icon: 'deskpet:raccoon-typing', hunger: 70, mood: 70, health: 100, level: 1, exp: 0, adoptedAt: new Date().toISOString(), lastUpdate: new Date().toISOString() },
    { id: 'pet_d', shopId: 'p_huhu_office', petId: 'huhu-carrot-office', name: '办公胡胡', type: '胡胡·办公', icon: 'deskpet:huhu-carrot-office', hunger: 85, mood: 85, health: 100, level: 1, exp: 0, adoptedAt: new Date().toISOString(), lastUpdate: new Date().toISOString() }
  ];
  const ts = new Date().toISOString();
  const state = {
    version: '1.0', coins: 9999,
    stats: { totalEarned: 9999, totalSpent: 0, totalClaims: 0, monthlyEarned: 0, monthlySpent: 0 },
    tasks: { diet: { records: [], claimDates: [] }, exercise: { records: [], claimDates: [] }, accounting: { records: [], claimDates: [] }, vocabulary: { words: [], todayWords: [], todayWordsDate: null, claimDates: [] }, amazon: { notes: [], todayVideoIdx: 0, todayVideoDate: null, claimDates: [] }, xiaohongshu: { projects: [], claimDates: [] } },
    pets, inventory: [], cabin: { placed: new Array(24).fill(null), theme: 'default' },
    achievements: [], reports: { daily: [], weekly: [], monthly: [] },
    checkinHistory: [{ date: ts.slice(0, 10), timestamp: ts, taskKey: 'diet', taskName: '饮食记录', coins: 5 }],
    settings: { dailyReset: true, notifications: true, petRemind: true },
    lastActiveDate: ts.slice(0, 10), createdAt: ts,
  };
  localStorage.setItem('goldminer_workbench_data', JSON.stringify(state));
})()"""


class WSRaw:
    """Minimal WebSocket client (client-side masking; text/binary/ctrl frames)."""

    def __init__(self, url, timeout=60):
        assert url.startswith("ws://")
        rest = url[len("ws://"):]
        hostport, _, path = rest.partition("/")
        host, _, port = hostport.partition(":")
        port = int(port or 80)
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
               f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.sock.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("handshake closed")
            buf += chunk
        head, _, leftover = buf.partition(b"\r\n\r\n")
        if b"101" not in head.split(b"\r\n")[0]:
            raise RuntimeError("bad handshake: " + head.decode(errors="replace")[:200])
        self.buf = leftover
        self.mid = 0

    def _recv_exact(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("socket closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv_msg(self):
        while True:
            b1, b2 = self._recv_exact(2)
            opcode = b1 & 0x0F
            masked = b2 & 0x80
            ln = b2 & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", self._recv_exact(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", self._recv_exact(8))[0]
            mask = self._recv_exact(4) if masked else b""
            payload = self._recv_exact(ln)
            if masked:
                payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
            if opcode == 0x8:
                return None
            if opcode in (0x9, 0xA):  # ping/pong: answer ping, then keep reading
                continue
            if opcode in (0x1, 0x2, 0x0):
                return json.loads(payload.decode("utf-8"))

    def send_msg(self, obj):
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        n = len(data)
        header = bytes([0x81])
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        masked = bytes(c ^ mask[i % 4] for i, c in enumerate(data))
        self.sock.sendall(header + mask + masked)

    def call(self, method, params=None, session_id=None):
        self.mid += 1
        msg = {"id": self.mid, "method": method, "params": params or {}}
        if session_id:
            msg["sessionId"] = session_id
        self.send_msg(msg)
        while True:
            resp = self.recv_msg()
            if resp is None:
                raise RuntimeError("ws closed mid-call")
            if resp.get("id") == self.mid:
                return resp
        # unreachable

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


def browser_ws_url(port):
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=3) as r:
                return json.load(r)["webSocketDebuggerUrl"]
        except Exception:
            time.sleep(0.4)
    raise RuntimeError("no CDP endpoint")


def main():
    profile = tempfile.mkdtemp(prefix="cdpet-")
    logfile = os.path.join(profile, "chrome.log")
    args = [SHELL, "--no-sandbox", "--no-first-run",
            "--log-file=" + logfile, "--user-data-dir=" + profile,
            f"--remote-debugging-port={PORT}", "--window-size=1280,900", "about:blank"]
    env = dict(os.environ); env["CHROME_HEADLESS"] = "1"
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
    try:
        ws_url = browser_ws_url(PORT)
    except RuntimeError:
        if proc.poll() is not None:
            tail = ""
            if os.path.exists(logfile):
                with open(logfile, "r", errors="replace") as fh:
                    tail = fh.read()[-1200:]
            print("BOOT-FAIL exit", proc.returncode, "\n", tail, flush=True)
        else:
            print("BOOT-FAIL no endpoint", flush=True)
        proc.kill()
        return 1
    print("BOOT-OK", flush=True)

    # The sandbox intermittently resets localhost sockets; retry the handshake.
    bws = None
    for attempt in range(1, 21):
        try:
            bws = WSRaw(ws_url)
            break
        except OSError as e:
            print("ws retry %d: %s" % (attempt, e), flush=True)
            time.sleep(0.5)
    if bws is None:
        print("WS-FAIL could not open a stable socket", flush=True)
        proc.kill()
        return 1
    # Create the target and attach; the session-scoped commands below ride on
    # this same browser socket, which stays alive as long as we do not let the
    # event backlog grow unhandled.
    tgt = bws.call("Target.createTarget", {"url": "about:blank"})
    target_id = tgt["result"]["targetId"]
    att = bws.call("Target.attachToTarget", {"targetId": target_id, "flatten": True})
    sid = att["result"]["sessionId"]
    print("ATTACHED target=%s session=%s" % (target_id[:8], sid[:8]), flush=True)

    # Session-scoped commands reset the socket afterwards (sandbox behaviour).
    # Reconnect + re-attach transparently; the shell keeps page state.
    _state = {"sid": sid}

    def reconnect():
        for attempt in range(1, 21):
            try:
                nws = WSRaw(ws_url)
                att = nws.call("Target.attachToTarget", {"targetId": target_id, "flatten": True})
                _state["sid"] = att["result"]["sessionId"]
                return nws
            except OSError as e:
                print("reconnect %d: %s" % (attempt, e), flush=True)
                time.sleep(0.5)
        raise RuntimeError("reconnect failed")

    def pcmd(method, params=None):
        # bws lives in an outer local; rebind on reconnect
        nonlocal bws
        try:
            return bws.call(method, params, _state["sid"])
        except OSError:
            bws = reconnect()
            return bws.call(method, params, _state["sid"])

    def eval_js(expression):
        r = pcmd("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
        res = r.get("result", {})
        if res.get("exceptionDetails"):
            return {"__error": res["exceptionDetails"].get("exception", {}).get("description", "eval error")}
        return res.get("result", {}).get("value")

    def screenshot(name):
        r = pcmd("Page.captureScreenshot", {"format": "png"})
        p = os.path.join(OUT, name)
        with open(p, "wb") as fh:
            fh.write(base64.b64decode(r["result"]["data"]))
        return p

    pcmd("Page.enable")
    pcmd("Runtime.enable")
    # Seed before navigation so the page boots with the seeded save.
    pcmd("Page.addScriptToEvaluateOnNewDocument", {"source": SEED})
    pcmd("Page.navigate", {"url": PAGE})
    time.sleep(4)

    boot = eval_js("({ hasPM: !!window.PetManager, playerCount: window.PetManager ? Object.keys(PetManager.players).length : -1, navOk: typeof navTo === 'function' })")
    print("BOOT", json.dumps(boot, ensure_ascii=False), flush=True)

    eval_js("navTo('pet-yard')")
    time.sleep(2.5)

    yard = eval_js("""(() => {
      const stages = Array.from(document.querySelectorAll('.pet-stage[data-petid]'));
      const players = window.PetManager ? Object.keys(PetManager.players).length : -1;
      const petInfo = stages.map(s => {
        const img = s.querySelector('img');
        const bg = s.querySelector('div[style*="background-image"]');
        return {
          petId: s.getAttribute('data-petid'),
          w: s.clientWidth, h: s.clientHeight,
          imgNaturalW: img ? img.naturalWidth : null,
          imgLoaded: img ? img.complete : null,
          imgSrc: img ? img.getAttribute('src') : null,
          bgSize: bg ? bg.style.backgroundSize : null,
          bgPos: bg ? bg.style.backgroundPosition : null,
        };
      });
      return { stages: stages.length, players, petInfo, cards: document.querySelectorAll('.pet-card').length };
    })()""")
    print("YARD", json.dumps(yard, ensure_ascii=False), flush=True)
    shot1 = screenshot("pet-yard.png")

    eval_js("(() => { const pet = getState().pets[0]; PetManager.playTransient(pet, 'done', true); return true; })()")
    time.sleep(0.7)
    transient = eval_js("(() => { const p = PetManager.players['huhu-carrot']; return { track: p ? p.currentTrack : null, timers: p ? { t: !!p.timer, chain: !!p.chainTimer, bump: !!p.bumpTimer } : null }; })()")
    print("TRANSIENT", json.dumps(transient, ensure_ascii=False), flush=True)
    time.sleep(2.2)
    after = eval_js("(() => { const p = PetManager.players['huhu-carrot']; return { track: p ? p.currentTrack : null, players: Object.keys(PetManager.players).length }; })()")
    print("AFTER-TRANSIENT", json.dumps(after, ensure_ascii=False), flush=True)

    eval_js("navTo('mine')"); time.sleep(1.2)
    away = eval_js("Object.keys(PetManager.players).length")
    eval_js("navTo('pet-yard')"); time.sleep(1.5)
    back = eval_js("Object.keys(PetManager.players).length")
    print("LEAK away=%s back=%s" % (away, back), flush=True)

    eval_js("navTo('shop')"); time.sleep(1.2)
    shop = eval_js("""(() => {
      const thumbs = Array.from(document.querySelectorAll('.si-image')).map(el => {
        const img = el.querySelector('img'); const bg = el.querySelector('div[style*="background-image"]');
        return { img: img ? img.naturalWidth : null, bg: bg ? bg.style.backgroundSize : null };
      });
      return { thumbs };
    })()""")
    print("SHOP", json.dumps(shop, ensure_ascii=False), flush=True)
    shot2 = screenshot("shop.png")

    migrate = eval_js("(() => { const oldLike = { id: 'pet_old', shopId: 'p_bobo', name: '老卜卜', type: '胡胡', icon: 'images/bobo.png', hunger: 60, mood: 60, health: 90, level: 1, exp: 0 }; return normalizePet(oldLike); })()")
    print("MIGRATE", json.dumps(migrate, ensure_ascii=False), flush=True)

    report = {"boot": boot, "yard": yard, "transient": transient, "afterTransient": after,
              "leak": {"away": away, "back": back}, "shop": shop, "migrate": migrate,
              "shots": [shot1, shot2], "outDir": OUT}
    with open(r"D:\桌宠\tests\report.json", "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)

    bws.close()
    proc.kill()
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
