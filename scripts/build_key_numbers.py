#!/usr/bin/env python3
"""One-time builder for the Gridiron NFL key number table.

Run it by hand when you want fresh numbers. The app never runs it and never
downloads anything for this: the output is embedded in deploy/index.html as the
KEYNUM constant.

    pip install nflreadpy
    python scripts/build_key_numbers.py                  # writes scripts/key_numbers.json
    python scripts/build_key_numbers.py --embed          # also rewrites KEYNUM in deploy/index.html
    python scripts/build_key_numbers.py --seasons 15     # use fewer seasons (default 20)

Data: nflreadpy load_schedules (github.com/nflverse/nflreadpy, MIT licensed, used
as a library, none of its code is copied here). The schedule data is nflverse
data. Only the columns result and spread_line are read, plus season.

What it builds. For every closing spread size from pick'em to 14.5 in half
point steps, the probability of each final margin from the favorite's side
(positive means the favorite won by that much). In nflverse, spread_line is
positive when the home team is favored and result is home score minus away
score, so the favorite's margin is result when spread_line is positive and
minus result when it is negative. Pick'em games count in both directions, so
that row is symmetric.

Thin buckets. A single line holds only 50 to 350 games even over twenty
seasons, so each row pools its neighbors with a triangular weight over line
distance. The bandwidth is the smallest one that gets the row to MIN_EFF
weighted games. Pooling is done on raw margins, never shifted, so the spikes
at 3 and 7 stay where they are. A pooled row has the wrong mean (a neighbor one
point away is one point off), so each row is then exponentially tilted back to
the mean predicted by a straight line fit of margin on spread over all games
(through the origin, so pick'em is exactly symmetric).
A tilt reweights margins smoothly and cannot move or blur a key number.
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path

LINES = [i / 2 for i in range(0, 30)]      # 0.0, 0.5, ... 14.5
M_MIN, M_MAX = -40, 50                      # favorite's margin range, ends absorb outliers
SCALE = 100000                              # probabilities are stored as integers out of this
MIN_EFF = 500                               # target weighted games per row
BANDWIDTHS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6]   # 0.5 means no pooling

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts" / "key_numbers.json"
APP = ROOT / "deploy" / "index.html"
BEGIN, END = "/*KEYNUM-BEGIN*/", "/*KEYNUM-END*/"


def load_games(n_seasons):
    import nflreadpy as nfl
    import polars as pl

    # Load every season, then keep the last n_seasons that have finished games.
    df = nfl.load_schedules(True)
    df = df.filter(pl.col("result").is_not_null() & pl.col("spread_line").is_not_null())
    last = df["season"].max()
    first = last - n_seasons + 1
    df = df.filter(pl.col("season") >= first)
    rows = list(zip(df["season"].to_list(), df["spread_line"].to_list(), df["result"].to_list()))
    return rows, first, last


def build(rows):
    nm = M_MAX - M_MIN + 1
    counts = [[0.0] * nm for _ in LINES]
    n = [0.0] * len(LINES)
    xs, ys = [], []                          # for the straight line fit of margin on spread
    clamp = lambda m: min(M_MAX, max(M_MIN, m))
    for _season, line, result in rows:
        s = abs(line)
        li = int(round(s * 2))
        if li >= len(LINES):
            continue
        if line == 0:
            for m in (result, -result):      # pick'em: count both directions, half weight each
                counts[li][clamp(int(m)) - M_MIN] += 0.5
            n[li] += 1
            xs += [0.0, 0.0]
            ys += [float(result), float(-result)]
            continue
        fav = result if line > 0 else -result
        counts[li][clamp(int(fav)) - M_MIN] += 1
        n[li] += 1
        xs.append(s)
        ys.append(float(fav))
    # Least squares through the origin: mean favorite margin = b * spread. The origin is
    # fixed so the pick'em row is exactly symmetric.
    b = sum(x * y for x, y in zip(xs, ys)) / sum(x * x for x in xs)
    a = 0.0

    pmf, bw_used, eff_used, targets = [], [], [], []
    for li, s in enumerate(LINES):
        chosen = None
        for bw in BANDWIDTHS:
            w = [max(0.0, 1 - abs(s - t) / bw) if bw > 0.5 else (1.0 if t == s else 0.0) for t in LINES]
            eff = sum(wj * nj for wj, nj in zip(w, n))
            chosen = (bw, w, eff)
            if eff >= MIN_EFF:
                break
        bw, w, eff = chosen
        row = [sum(w[j] * counts[j][i] for j in range(len(LINES))) for i in range(nm)]
        tot = sum(row)
        row = [v / tot for v in row]
        target = a + b * s
        row = tilt_to_mean(row, target)
        pmf.append(row)
        bw_used.append(bw)
        eff_used.append(round(eff, 1))
        targets.append(round(target, 3))
    return counts, n, pmf, bw_used, eff_used, targets, (a, b)


def mean_of(p):
    return sum((M_MIN + i) * v for i, v in enumerate(p))


def tilt_to_mean(p, target):
    """p_i * exp(lam * margin), with lam found by bisection so the mean is target."""
    def tilted(lam):
        c = M_MIN + (M_MAX - M_MIN) // 2   # centering keeps exp() tame
        q = [v * math.exp(lam * (M_MIN + i - c)) for i, v in enumerate(p)]
        t = sum(q)
        return [v / t for v in q]
    lo, hi = -0.5, 0.5
    for _ in range(100):
        mid = (lo + hi) / 2
        if mean_of(tilted(mid)) < target:
            lo = mid
        else:
            hi = mid
    return tilted((lo + hi) / 2)


def to_ints(p):
    """Round to integers out of SCALE that sum to exactly SCALE (largest remainder)."""
    raw = [v * SCALE for v in p]
    fl = [int(math.floor(v)) for v in raw]
    short = SCALE - sum(fl)
    order = sorted(range(len(p)), key=lambda i: raw[i] - fl[i], reverse=True)
    for i in order[:short]:
        fl[i] += 1
    return fl


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, default=20, help="how many seasons back to use (minimum 15)")
    ap.add_argument("--embed", action="store_true", help="also rewrite the KEYNUM constant in deploy/index.html")
    args = ap.parse_args()
    if args.seasons < 15:
        sys.exit("Use at least 15 seasons.")

    rows, first, last = load_games(args.seasons)
    counts, n, pmf, bw, eff, targets, (a, b) = build(rows)
    out = {
        "version": 1,
        "source": "nflverse schedules via nflreadpy load_schedules, result and spread_line",
        "seasons": [first, last],
        "games": len(rows),
        "scale": SCALE,
        "margin_min": M_MIN,
        "margin_max": M_MAX,
        "lines": LINES,
        "n": [int(round(x)) for x in n],
        "bandwidth": bw,
        "mean_fit": [round(a, 4), round(b, 4)],
        "pmf": [to_ints(p) for p in pmf],
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(rows)} games, seasons {first} to {last}; mean margin = {b:.3f} * spread")
    print("line   games  bandwidth  eff    P(3)    P(7)    P(push at line)")
    for i, s in enumerate(LINES):
        p = [v / SCALE for v in out["pmf"][i]]
        push = p[int(s) - M_MIN] if s == int(s) else 0.0
        print(f"{s:4.1f} {out['n'][i]:6d} {bw[i]:8.1f} {eff[i]:7.0f} {p[3 - M_MIN]:7.4f} {p[7 - M_MIN]:7.4f} {push:9.4f}")
    print("wrote", OUT.relative_to(ROOT))

    if args.embed:
        html = APP.read_text(encoding="utf-8")
        pat = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END), re.S)
        if not pat.search(html):
            sys.exit("Markers not found in deploy/index.html: add " + BEGIN + " and " + END + " first.")
        const = BEGIN + "\nconst KEYNUM=" + json.dumps(out, separators=(",", ":")) + ";\n" + END
        APP.write_text(pat.sub(lambda _m: const, html, count=1), encoding="utf-8")
        print("embedded in", APP.relative_to(ROOT))


if __name__ == "__main__":
    main()
