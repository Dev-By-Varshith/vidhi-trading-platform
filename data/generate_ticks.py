#!/usr/bin/env python3
"""
data/generate_ticks.py — Deterministic Tick Dataset Generator for Vidhi Arena
==============================================================================

Generates binary tick datasets in the format expected by price_signal.hpp.

TickRecord layout (little-endian, matches C++ struct):
  int64_t  tick_id
  double   bid_price
  double   ask_price
  double   mid_price
  double   fair_value
  double   spread
  double   volatility
  double   bid_vol
  double   ask_vol
  double   last_trade_px
  double   is_news_flag

File header:
  char[8]  magic = "VIDHI\0\0\0"
  int64_t  n_ticks

IMPORTANT: All datasets use a fixed random seed (default 42) so every
contestant gets the SAME price path. This makes scoring fair.
"""

import struct
import math
import random
import os
import argparse
import hashlib

# ── Binary format constants ─────────────────────────────────────────────────
TICK_RECORD_FMT = "<q10d"       # 1 int64 + 10 doubles = 88 bytes
TICK_RECORD_SIZE = struct.calcsize(TICK_RECORD_FMT)
MAGIC = b"VIDHI\x00\x00\x00"
HEADER_FMT = "<8sq"             # 8-byte magic + int64 n_ticks

assert TICK_RECORD_SIZE == 88, f"Expected 88 bytes per record, got {TICK_RECORD_SIZE}"


def box_muller(rng: random.Random) -> float:
    """Generate one standard-normal sample using Box-Muller transform."""
    u1 = rng.random()
    u2 = rng.random()
    if u1 <= 1e-12:
        u1 = 1e-12
    return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


def generate_ticks(filename: str, n_ticks: int, seed: int = 42) -> None:
    """
    Generate a deterministic price path using Geometric Brownian Motion
    with mean-reversion and periodic news events.

    Parameters
    ----------
    filename : str  Output binary file path.
    n_ticks  : int  Number of ticks to generate.
    seed     : int  Random seed (default 42 — all contestants use same path).
    """
    print(f"[GEN] Generating {n_ticks:,} ticks -> {filename}  (seed={seed})")

    # Fixed-seed RNG — must NOT use global random state
    rng = random.Random(seed)

    price     = 1500.0          # starting mid price
    vol       = 0.0003          # annualised vol per tick
    mean_rev  = 0.001           # mean-reversion speed
    fair      = 1500.0          # long-run fair value

    os.makedirs(os.path.dirname(os.path.abspath(filename)), exist_ok=True)

    with open(filename, "wb") as f:
        # Write file header
        f.write(struct.pack(HEADER_FMT, MAGIC, n_ticks))

        for tick_id in range(n_ticks):
            # ── Price dynamics ──────────────────────────────────────────────
            drift  = -mean_rev * (price - fair)
            randn  = box_muller(rng)

            # Periodic news shock every 10,000 ticks
            news = 0.0
            if tick_id > 0 and tick_id % 10_000 == 0:
                news = box_muller(rng) * price * 0.005  # ±0.5% shock

            # GBM step + mean reversion + news
            price += drift + vol * price * randn + news
            price  = max(1050.0, min(1950.0, price))   # hard price bounds

            # ── LOB parameters ─────────────────────────────────────────────
            # Spread widens during news ticks and high-vol regimes
            base_spread = 0.01
            if news != 0.0:
                base_spread = 0.05   # 5x wider spread on news
            spread      = base_spread * (1 + rng.randint(0, 3))
            mid_price   = price
            bid_price   = mid_price - spread / 2.0
            ask_price   = mid_price + spread / 2.0
            fair_value  = fair + randn * 0.1   # tiny signal noise

            # ── Volume ─────────────────────────────────────────────────────
            volatility     = vol * price
            bid_vol        = float(rng.randint(50, 150))
            ask_vol        = float(rng.randint(50, 150))
            last_trade_px  = mid_price + rng.choice([-1.0, 1.0]) * (spread / 2.0)
            is_news_flag   = 1.0 if news != 0.0 else 0.0

            # ── Write record ───────────────────────────────────────────────
            packed = struct.pack(
                TICK_RECORD_FMT,
                tick_id,
                bid_price,
                ask_price,
                mid_price,
                fair_value,
                spread,
                volatility,
                bid_vol,
                ask_vol,
                last_trade_px,
                is_news_flag,
            )
            f.write(packed)

            # Progress indicator every 100k ticks
            if (tick_id + 1) % 100_000 == 0:
                pct = (tick_id + 1) / n_ticks * 100
                print(f"  {pct:5.1f}%  tick={tick_id+1:,}  price=${price:.2f}")

    # ── Integrity checksum ──────────────────────────────────────────────────
    with open(filename, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    size_kb = os.path.getsize(filename) / 1024
    print(f"[GEN] OK {filename}  ({size_kb:.0f} KB)  sha256={digest[:16]}...")
    return digest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate deterministic Vidhi Arena tick datasets"
    )
    parser.add_argument(
        "--public", action="store_true",
        help="Generate public_99k.bin (100,000 ticks, seed=42)"
    )
    parser.add_argument(
        "--eval", action="store_true",
        help="Generate eval_1m.bin (1,000,000 ticks, seed=42)"
    )
    parser.add_argument(
        "--seed", type=int, default=42,
        help="Random seed for reproducibility (default: 42)"
    )
    parser.add_argument(
        "--out-dir", default="data/ticks",
        help="Output directory (default: data/ticks)"
    )
    args = parser.parse_args()

    generated = []

    if args.public or (not args.public and not args.eval):
        out = os.path.join(args.out_dir, "public_99k.bin")
        d = generate_ticks(out, 100_000, seed=args.seed)
        generated.append((out, d))

    if args.eval or (not args.public and not args.eval):
        out = os.path.join(args.out_dir, "eval_1m.bin")
        d = generate_ticks(out, 1_000_000, seed=args.seed)
        generated.append((out, d))

    print()
    print("=" * 60)
    print("DATASET MANIFEST (include these hashes in contest docs):")
    for path, digest in generated:
        print(f"  {os.path.basename(path)}: sha256={digest}")
    print("=" * 60)
