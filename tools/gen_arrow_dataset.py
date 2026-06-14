#!/usr/bin/env python3
"""
tools/gen_arrow_dataset.py — Generate synthetic tick datasets in Apache Arrow IPC format

Produces two files:
  data/ticks/public_99k.arrow   — 99,000 ticks (given to contestants)
  data/ticks/private_999k.arrow — 999,000 ticks (held-out, used for final scoring)

Each Arrow file contains columns:
  tick_id        : int64    — monotonically increasing tick index
  bid_price      : float64  — best bid (USD)
  ask_price      : float64  — best ask (USD)
  mid_price      : float64  — (bid + ask) / 2
  fair_value     : float64  — underlying GBM signal
  spread         : float64  — ask - bid
  volatility     : float64  — rolling realized vol estimate
  bid_vol        : int64    — volume at best bid
  ask_vol        : int64    — volume at best ask
  last_trade_px  : float64  — last matched trade price
  is_news_event  : bool     — true on major price shock ticks

The file is written in Arrow IPC streaming format for use with:
  - Browser: apache-arrow JS library → SharedArrayBuffer
  - C++ GM:  Arrow C++ mmap reader or direct flat binary fallback
  - Python:  pyarrow.ipc.open_file()

Usage:
  python3 tools/gen_arrow_dataset.py [--seed 42] [--output ./data/ticks]
"""

import argparse
import math
import os
import struct
import sys
import random

try:
    import pyarrow as pa
    import pyarrow.ipc as ipc
    ARROW_AVAILABLE = True
except ImportError:
    ARROW_AVAILABLE = False
    print("[WARN] pyarrow not installed — falling back to raw binary format")
    print("       Install with: pip install pyarrow")

# ─── GBM + Mean Reversion Price Signal (matches C++ PriceSignal exactly) ──────
class PriceSignal:
    def __init__(self, seed: int = 42, base: float = 1500.0, vol: float = 0.0003, mean_rev: float = 0.001):
        self.price    = base
        self.base     = base
        self.vol      = vol
        self.mean_rev = mean_rev
        self.rng      = seed & 0xFFFFFFFFFFFFFFFF

    def xorshift(self) -> int:
        x = self.rng
        x ^= (x << 13) & 0xFFFFFFFFFFFFFFFF
        x ^= (x >> 7)  & 0xFFFFFFFFFFFFFFFF
        x ^= (x << 17) & 0xFFFFFFFFFFFFFFFF
        self.rng = x & 0xFFFFFFFFFFFFFFFF
        return self.rng

    def rand_uniform(self) -> float:
        return (self.xorshift() & 0xFFFFFF) / 0x1000000

    def randn(self) -> float:
        u1 = max(1e-10, self.rand_uniform())
        u2 = self.rand_uniform()
        return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)

    def next(self, tick_id: int) -> dict:
        drift = -self.mean_rev * (self.price - self.base)
        is_news = (tick_id % 10_000 == 0) and (tick_id > 0)
        news = self.randn() * 2.0 if is_news else 0.0
        self.price += drift + self.vol * self.price * self.randn() + news
        self.price  = max(self.base * 0.7, min(self.base * 1.3, self.price))

        # Simulate spread (widens during volatility)
        spread   = max(0.01, abs(news) * 0.5 + 0.05)
        bid      = round(self.price - spread / 2, 2)
        ask      = round(self.price + spread / 2, 2)
        mid      = (bid + ask) / 2
        bid_vol  = int(50 + (self.xorshift() % 100))
        ask_vol  = int(50 + (self.xorshift() % 100))

        return {
            "tick_id":       tick_id,
            "bid_price":     bid,
            "ask_price":     ask,
            "mid_price":     mid,
            "fair_value":    self.price,
            "spread":        round(ask - bid, 4),
            "volatility":    round(self.vol * self.price, 4),
            "bid_vol":       bid_vol,
            "ask_vol":       ask_vol,
            "last_trade_px": round(mid + (self.randn() * spread * 0.1), 2),
            "is_news_event": is_news,
        }


def generate_ticks(n: int, seed: int, base: float = 1500.0, vol: float = 0.0003, mean_rev: float = 0.001) -> dict:
    """Generate n ticks and return column-oriented dict."""
    sig = PriceSignal(seed=seed, base=base, vol=vol, mean_rev=mean_rev)
    cols = {
        "tick_id":       [],
        "bid_price":     [],
        "ask_price":     [],
        "mid_price":     [],
        "fair_value":    [],
        "spread":        [],
        "volatility":    [],
        "bid_vol":       [],
        "ask_vol":       [],
        "last_trade_px": [],
        "is_news_event": [],
    }
    for i in range(n):
        row = sig.next(i)
        for k, v in row.items():
            cols[k].append(v)
    return cols


def write_arrow(cols: dict, path: str):
    """Write columns to Apache Arrow IPC file."""
    schema = pa.schema([
        pa.field("tick_id",       pa.int64()),
        pa.field("bid_price",     pa.float64()),
        pa.field("ask_price",     pa.float64()),
        pa.field("mid_price",     pa.float64()),
        pa.field("fair_value",    pa.float64()),
        pa.field("spread",        pa.float64()),
        pa.field("volatility",    pa.float64()),
        pa.field("bid_vol",       pa.int64()),
        pa.field("ask_vol",       pa.int64()),
        pa.field("last_trade_px", pa.float64()),
        pa.field("is_news_event", pa.bool_()),
    ])
    table = pa.table({k: pa.array(v) for k, v in cols.items()}, schema=schema)
    with ipc.new_file(path, schema) as writer:
        writer.write_table(table, max_chunksize=10_000)
    size_mb = os.path.getsize(path) / (1024 * 1024)
    print(f"[ARROW] Written {path} ({len(cols['tick_id']):,} ticks, {size_mb:.2f} MB)")


def write_flat_binary(cols: dict, path: str):
    """Fallback: write as raw flat binary (12 float64 + 1 int64 per tick).
    C++ can mmap this directly without Arrow dependency.
    Layout per tick (96 bytes):
      [0]  tick_id       int64
      [1]  bid_price     float64
      [2]  ask_price     float64
      [3]  mid_price     float64
      [4]  fair_value    float64
      [5]  spread        float64
      [6]  volatility    float64
      [7]  bid_vol       float64 (cast from int)
      [8]  ask_vol       float64 (cast from int)
      [9]  last_trade_px float64
      [10] is_news_event float64 (0.0 or 1.0)
    """
    n = len(cols["tick_id"])
    with open(path, "wb") as f:
        # Header: magic + n_ticks
        f.write(b"VIDHI\x00\x00\x00")
        f.write(struct.pack("<q", n))
        for i in range(n):
            f.write(struct.pack("<q",  cols["tick_id"][i]))
            f.write(struct.pack("<d",  cols["bid_price"][i]))
            f.write(struct.pack("<d",  cols["ask_price"][i]))
            f.write(struct.pack("<d",  cols["mid_price"][i]))
            f.write(struct.pack("<d",  cols["fair_value"][i]))
            f.write(struct.pack("<d",  cols["spread"][i]))
            f.write(struct.pack("<d",  cols["volatility"][i]))
            f.write(struct.pack("<d",  float(cols["bid_vol"][i])))
            f.write(struct.pack("<d",  float(cols["ask_vol"][i])))
            f.write(struct.pack("<d",  cols["last_trade_px"][i]))
            f.write(struct.pack("<d",  1.0 if cols["is_news_event"][i] else 0.0))
    size_mb = os.path.getsize(path) / (1024 * 1024)
    print(f"[BIN]   Written {path} ({n:,} ticks, {size_mb:.2f} MB) — flat binary fallback")


def write_csv(cols: dict, path: str):
    """Write columns to CSV format for local testing."""
    import csv
    keys = list(cols.keys())
    with open(path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(keys)
        # Transpose columns to rows
        rows = zip(*[cols[k] for k in keys])
        writer.writerows(rows)
    size_mb = os.path.getsize(path) / (1024 * 1024)
    print(f"[CSV]   Written {path} ({len(cols['tick_id']):,} ticks, {size_mb:.2f} MB)")


def print_stats(cols: dict, label: str):
    bids = cols["bid_price"]
    print(f"\n--- {label} stats ----------------------------")
    print(f"  Ticks     : {len(bids):,}")
    print(f"  Bid range : ${min(bids):.2f} - ${max(bids):.2f}")
    print(f"  News ticks: {sum(1 for x in cols['is_news_event'] if x):,}")
    avg_spread = sum(cols['spread']) / len(cols['spread'])
    print(f"  Avg spread: ${avg_spread:.4f}")


def main():
    parser = argparse.ArgumentParser(description="Generate Vidhi Arena tick datasets")
    parser.add_argument("--seed",   type=int,  default=42,              help="RNG seed")
    parser.add_argument("--output", type=str,  default="./data/ticks",  help="Output directory")
    parser.add_argument("--public-n",  type=int, default=100_000,       help="Public dataset size")
    parser.add_argument("--asset",  type=str,  default="public_100k",   help="Asset name to generate (e.g. SEASHELLS)")
    parser.add_argument("--base-price", type=float, default=1500.0,     help="Base price for the asset")
    parser.add_argument("--vol",    type=float, default=0.0003,         help="Volatility per tick")
    parser.add_argument("--mean-rev", type=float, default=0.001,        help="Mean reversion strength")
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    print(f"[GEN] Generating {args.asset} dataset ({args.public_n:,} ticks, seed={args.seed})...")
    public_cols = generate_ticks(args.public_n, seed=args.seed, base=args.base_price, vol=args.vol, mean_rev=args.mean_rev)
    print_stats(public_cols, args.asset)

    public_arrow  = os.path.join(args.output, f"{args.asset}.arrow")
    public_bin    = os.path.join(args.output, f"{args.asset}.bin")
    public_csv    = os.path.join(args.output, f"{args.asset}.csv")

    print()
    if ARROW_AVAILABLE:
        write_arrow(public_cols,  public_arrow)
    else:
        write_flat_binary(public_cols,  public_bin)

    write_flat_binary(public_cols,  public_bin)
    write_csv(public_cols, public_csv)

    print("\n[DONE] Dataset generation complete.")
    print(f"  Asset Arrow : {public_arrow}")
    print(f"  Asset Binary: {public_bin}  (C++ mmap target)")
    print(f"  Asset CSV   : {public_csv}  (Local testing)")


if __name__ == "__main__":
    main()
