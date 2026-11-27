#!/usr/bin/env python3
"""Pull Florida-domain captures from a Common Crawl CDX index via data.commoncrawl.org.

Usage: cc_florida.py CRAWL OUTCSV
"""
import bisect, csv, gzip, io, json, subprocess, sys

CRAWL, OUT = sys.argv[1], sys.argv[2]
BASE = f"https://data.commoncrawl.org/cc-index/collections/{CRAWL}/indexes"
PREFIXES = ["us,fl,", "com,myflorida,", "gov,fl,"]

# cluster.idx: "<surt> <ts>\t<cdx file>\t<offset>\t<length>\t<n>"
keys, blocks = [], []
with open(f"/tmp/cc/cluster.idx", encoding="utf-8", errors="replace") as f:
    for line in f:
        k, fn, off, ln, _ = line.rstrip("\n").split("\t")
        keys.append(k)
        blocks.append((fn, int(off), int(ln)))


def fetch(fn, off, ln):
    r = subprocess.run(
        ["curl", "-sS", "-m", "120", "--retry", "3", "-r", f"{off}-{off+ln-1}",
         f"{BASE}/{fn}"], capture_output=True)
    if r.returncode:
        raise RuntimeError(r.stderr.decode())
    return gzip.decompress(r.stdout).decode("utf-8", "replace")


seen = set()
rows = 0
with open(OUT, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["surt", "timestamp", "url", "mime", "status", "digest",
                "warc_filename", "warc_offset", "warc_length"])
    for p in PREFIXES:
        lo = max(bisect.bisect_left(keys, p) - 1, 0)
        hi = lo
        while hi + 1 < len(keys) and keys[hi + 1].startswith(p):
            hi += 1
        hi = min(hi + 1, len(blocks) - 1)
        todo = [i for i in range(lo, hi + 1) if i not in seen]
        print(f"{p}: {len(todo)} blocks", flush=True)
        for i in todo:
            seen.add(i)
            text = fetch(*blocks[i])
            for line in text.splitlines():
                surt_ts, _, js = line.partition(" {")
                surt, _, ts = surt_ts.partition(" ")
                if not surt.startswith(p):
                    continue
                d = json.loads("{" + js)
                if d.get("status") != "200":
                    continue
                w.writerow([surt, ts, d.get("url"), d.get("mime"), d.get("status"),
                            d.get("digest"), d.get("filename"), d.get("offset"),
                            d.get("length")])
                rows += 1
print("rows", rows)
