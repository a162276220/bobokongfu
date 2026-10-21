#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""淘金矿工小屋 · 灵感抓取（本地）

抓取 B 站热搜 + 百度热搜 + 微博热搜 + 小红书热榜，写入 spark_feed.js / spark_feed.json。
页面加载时会读取 spark_feed.js，把新条目并入「灵感候选区」（不会直接进选题池，
要你在候选区里逐条采纳）。

用法:
    python tools/spark_scraper.py                抓一轮
    python tools/spark_scraper.py --limit 30     每个来源最多 30 条
    python tools/spark_scraper.py --keyword 教育 只保留标题含关键词的条目（可写多个）
    python tools/spark_scraper.py --dry-run      只打印，不写文件

设计要点:
    - 只抓公开热榜接口，不需要任何 key
    - 保留 KEEP_DAYS 天，超期条目自动淘汰（避免 feed 无限膨胀）
    - 按「日期 + 标题归一化」算 md5 做 _id，跨天同标题视为不同条目、当天重复自动去重
    - 抓取失败不影响旧 feed：一轮全失败就原样保留
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEED_JS = os.path.join(BASE, "spark_feed.js")
FEED_JSON = os.path.join(BASE, "spark_feed.json")
LOG_FILE = os.path.join(BASE, "spark_run.log")
KEEP_DAYS = 7

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


def log(msg):
    line = "[%s] %s" % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg)
    try:
        if sys.stdout:
            print(line)
    except Exception:
        pass
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def http_get(url, timeout=15, referer=None):
    headers = {"User-Agent": UA, "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def to_heat(v):
    """热度归一成整数：兼容 1234567、947.5w（英文 w 也是万）、1.2亿。"""
    s = str(v or "").strip()
    if not s:
        return 0
    m = re.search(r"[\d.]+", s)
    if not m:
        return 0
    n = float(m.group())
    if "亿" in s:
        n *= 1e8
    elif "万" in s or "w" in s.lower():
        n *= 1e4
    return int(n)


def fetch_bilibili(limit):
    """B 站热搜榜（公开接口，返回 hotword 列表）。"""
    raw = http_get("https://s.search.bilibili.com/main/hotword",
                   referer="https://www.bilibili.com/")
    data = json.loads(raw.decode("utf-8"))
    out = []
    for i, it in enumerate(data.get("list", [])[:limit], 1):
        title = (it.get("keyword") or it.get("show_name") or "").strip()
        if title:
            out.append((title, "B站热搜 #%d" % i, to_heat(it.get("heat_score"))))
    return out


def fetch_baidu(limit):
    """百度实时热搜榜（解析榜单页 HTML）。"""
    raw = http_get("https://top.baidu.com/board?tab=realtime",
                   referer="https://top.baidu.com/")
    html = raw.decode("utf-8", "replace")
    blocks = re.findall(
        r'<div class="category-wrap_iQLoo.*?c-single-text-ellipsis[^>]*>(.*?)</div>'
        r'.*?hot-index_[^>]*>(.*?)</div>',
        html, re.S)
    out, seen = [], set()
    for i, (title, score) in enumerate(blocks, 1):
        title = re.sub(r"<[^>]+>", "", title)
        title = re.sub(r"\s+", " ", title).strip()
        if not title or title in seen:
            continue
        seen.add(title)
        out.append((title, "百度热搜 #%d" % i, to_heat(score)))
        if len(out) >= limit:
            break
    return out


def norm(s):
    return re.sub(r"\s+", "", str(s or "")).lower()


def fetch_weibo(limit):
    """微博热搜：官方 ajax 直连，失败退回 uapis 聚合接口。"""
    try:
        raw = http_get("https://weibo.com/ajax/side/hotSearch",
                       referer="https://weibo.com/")
        data = json.loads(raw.decode("utf-8"))
        items = []
        for x in (data.get("data") or {}).get("realtime") or []:
            title = (x.get("word") or "").strip().lstrip("#").strip()
            if title:
                items.append((title, to_heat(x.get("num"))))
        if items:
            return [(t, "微博热搜 #%d" % i, h) for i, (t, h) in enumerate(items[:limit], 1)]
    except Exception as e:
        log("微博 ajax 直连失败（%s: %s），改走 uapis" % (type(e).__name__, e))

    raw = http_get("https://uapis.cn/api/v1/misc/hotboard?type=weibo")
    data = json.loads(raw.decode("utf-8"))
    out = []
    for i, x in enumerate((data.get("list") or [])[:limit], 1):
        title = (x.get("title") or "").strip()
        if title:
            out.append((title, "微博热搜 #%d" % i, to_heat(x.get("hot_value"))))
    return out


def fetch_xhs(limit):
    """小红书热榜：uapis 聚合接口（无 key）。"""
    raw = http_get("https://uapis.cn/api/v1/misc/hotboard?type=xiaohongshu")
    data = json.loads(raw.decode("utf-8"))
    out = []
    for i, x in enumerate((data.get("list") or [])[:limit], 1):
        title = (x.get("title") or "").strip()
        if title:
            out.append((title, "小红书热榜 #%d" % i, to_heat(x.get("hot_value"))))
    return out


def topic_id(date, title):
    h = hashlib.md5((date + "|" + norm(title)).encode("utf-8")).hexdigest()[:10]
    return "spark-%s-%s" % (date.replace("-", ""), h)


def load_feed():
    if not os.path.exists(FEED_JSON):
        return {"topics": [], "runs": []}
    try:
        with open(FEED_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("bad feed")
        data.setdefault("topics", [])
        data.setdefault("runs", [])
        return data
    except Exception as e:
        log("读取旧 feed 失败，按空库处理: %s" % e)
        return {"topics": [], "runs": []}


def write_feed(feed):
    feed["generated_at"] = datetime.datetime.now().isoformat(timespec="seconds")
    payload = json.dumps(feed, ensure_ascii=False, indent=2)
    with open(FEED_JSON, "w", encoding="utf-8") as f:
        f.write(payload)
    with open(FEED_JS, "w", encoding="utf-8") as f:
        f.write("/* 由 tools/spark_scraper.py 自动生成，请勿手改 */\n")
        f.write("window.SPARK_FEED = ")
        f.write(payload)
        f.write(";\n")


def main():
    ap = argparse.ArgumentParser(description="抓取热榜并写入 spark_feed.js")
    ap.add_argument("--limit", type=int, default=20, help="每个来源最多抓多少条（默认 20）")
    ap.add_argument("--keyword", nargs="*", default=None, help="只保留标题包含这些关键词的条目")
    ap.add_argument("--dry-run", action="store_true", help="只打印结果，不写文件")
    args = ap.parse_args()

    today = datetime.date.today().isoformat()
    got, collected, ok_srcs = 0, [], []

    SOURCES = (
        ("B站热搜", fetch_bilibili),
        ("百度热搜", fetch_baidu),
        ("微博热搜", fetch_weibo),
        ("小红书热榜", fetch_xhs),
    )
    for name, fn in SOURCES:
        try:
            items = fn(args.limit)
            log("%s 抓到 %d 条" % (name, len(items)))
            got += len(items)
            collected.extend(items)
            ok_srcs.append(name)
        except Exception as e:
            log("%s 抓取失败: %s: %s" % (name, type(e).__name__, e))

    if not collected:
        log("本轮没有拿到任何数据，保留旧 feed 不变")
        return 1

    if args.keyword:
        kws = [k for k in args.keyword if k]
        before = len(collected)
        collected = [(t, s, h) for (t, s, h) in collected if any(k in t for k in kws)]
        log("关键词过滤: %d -> %d 条" % (before, len(collected)))

    if args.dry_run:
        for t, s, h in collected:
            print("  %s  |  热度 %-8s  |  %s" % (s, h, t))
        log("dry-run：候选 %d 条，未写文件" % len(collected))
        return 0

    feed = load_feed()
    topics = feed.get("topics", [])

    keep_from = (datetime.date.today() - datetime.timedelta(days=KEEP_DAYS)).isoformat()
    topics = [t for t in topics if (t.get("日期") or "") >= keep_from]
    by_title = {norm(t.get("选题标题")): t for t in topics if t.get("选题标题")}

    added = 0
    for title, source, heat in collected:
        key = norm(title)
        if key in by_title:
            old = by_title[key]
            if heat > (old.get("热度") or 0):
                old["热度"] = heat
            continue
        item = {
            "_id": topic_id(today, title),
            "日期": today,
            "选题标题": title,
            "热点来源": source,
            "热度": heat,
            "文案要点": "",
        }
        topics.append(item)
        by_title[key] = item
        added += 1

    topics.sort(key=lambda t: (t.get("日期") or "", t.get("热点来源") or ""))
    feed["topics"] = topics

    now_hm = datetime.datetime.now().strftime("%H%M%S")
    feed["runs"] = (feed.get("runs") or []) + [{
        "_id": "run-%s-%s" % (today.replace("-", ""), now_hm),
        "日期": today,
        "来源": "+".join(ok_srcs) if ok_srcs else "（全部失败）",
        "采集条数": got,
        "入库条数": added,
        "备注": "本地定时抓取",
    }]
    feed["runs"] = feed["runs"][-60:]

    write_feed(feed)
    log("完成：候选 %d 条，新增 %d 条，feed 现有 %d 条" % (got, added, len(topics)))
    return 0


if __name__ == "__main__":
    try:
        if sys.stdout and hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
