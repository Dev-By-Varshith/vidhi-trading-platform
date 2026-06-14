#!/usr/bin/env python3
"""
data/ticks/generate_dataset.py
──────────────────────────────────────────────────────────────────────────────
Deterministic Tick Dataset Generator for Vidhi Arena

Generates a binary tick tape in the VIDHI flat binary format:
    HEADER: "VIDHI\0\0\0" (8 bytes magic) + n_ticks (int64, 8 bytes)
    RECORDS: n_ticks × TickRecord (each 88 bytes, see TickRecord below)

TickRecord layout matches game-master/price_signal.hpp:
    tick_id        int64   (8B)
    bid_price      float64 (8B)
    ask_price      float64 (8B)
    mid_price      float64 (8B)
    fair_value     float64 (8B)
    spread         float64 (8B)
    volatility     float64 (8B)
    bid_vol        float64 (8B)
    ask_vol        float64 (8B)
    last_trade_px  float64 (8B)
    is_news_flag   float64 (8B)  — 0.0=normal, 1.0=news event

USAGE:
    python3 generate_dataset.py                  # → public_99k.bin  (99,000 ticks)
    python3 generate_dataset.py --ticks 1000000  # → eval_1m.bin  (1,000,000 ticks)
    python3 generate_dataset.py --help
"""

import struct
import math
import argparse
import os
import sys


# ─── TickRecord struct format (matches C++ #pragma pack(push,1) layout) ──────
MAGIC         = b'VIDHI\x00\x00\x00'   # 8 bytes
TICK_FMT      = '<q' + 'd' * 10        # 1 int64 + 10 float64s, little-endian
TICK_BYTES    = struct.calcsize(TICK_FMT)  # 88 bytes
assert TICK_BYTES == 88, f"TickRecord size mismatch: {TICK_BYTES}"


# ─── Deterministic GBM price generator ────────────────────────────────────────
class DeterministicGBM:
    """
    Geometric Brownian Motion with mean reversion and regime changes.
    Seeded with a fixed seed → fully deterministic for all contestants.

    Parameters match realistic equity intraday behavior:
        S0    = 1500.0  (starting fair value)
        sigma = 0.0003  (per-tick volatility ~0.03%)
        kappa = 0.001   (mean reversion speed)
    """

    def __init__(self, seed: int = 42):
        # xorshift64 for fast deterministic noise
        self._rng = (seed ^ 0xDEADBEEFCAFEBABE) & 0xFFFFFFFFFFFFFFFF if seed != 0 else 0x123456789ABCDEF
        self.price       = 1500.0
        self.volatility  = 0.0003    # realized vol estimate
        self.tick_size   = 0.01
        self.mean_rev    = 0.001

    @staticmethod
    def _clamp(v, lo, hi):
        return max(lo, min(hi, v))

    def _xorshift(self):
        x = self._rng & 0xFFFFFFFFFFFFFFFF
        x ^= (x << 13) & 0xFFFFFFFFFFFFFFFF
        x ^= (x >> 7)  & 0xFFFFFFFFFFFFFFFF
        x ^= (x << 17) & 0xFFFFFFFFFFFFFFFF
        self._rng = x
        return x

    def _randn(self):
        """Box-Muller transform using xorshift — matches C++ GBM fallback."""
        u1 = ((self._xorshift() & 0xFFFFFF) + 1) / 0x1000001
        u2 = (self._xorshift()  & 0xFFFFFF)       / 0x1000000
        return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)

    def _rand_uniform(self):
        return (self._xorshift() & 0xFFFFFF) / float(0x1000000)

    def next_tick(self, tick_id: int):
        """Advance one tick; return TickRecord tuple."""
        # Volatility regime: every 10,000 ticks, vol can spike (news event)
        is_news = (tick_id % 10_000 == 0) and self._rand_uniform() < 0.3
        if is_news:
            news_shock = self._randn() * 2.0
        else:
            news_shock = 0.0

        # Volatility estimation (EWMA)
        instant_vol = abs(self._randn() * 0.0003)
        self.volatility = 0.99 * self.volatility + 0.01 * instant_vol

        # Price process: GBM + mean reversion + news shock
        drift = -self.mean_rev * (self.price - 1500.0)
        shock = self.volatility * self.price * self._randn()
        self.price += drift + shock + news_shock
        self.price = self._clamp(self.price, 1050.0, 1950.0)

        # Spread: wider when volatile, compressed when calm
        half_spread = max(0.01, self.volatility * self.price * 2.0)
        if is_news:
            half_spread *= 3.0
        spread = half_spread * 2.0

        bid = self.price - half_spread
        ask = self.price + half_spread
        mid = self.price

        # Volume: realistic random depth (100–1000 at best, tapering)
        bid_vol = float(100 + int((self._xorshift() % 900)))
        ask_vol = float(100 + int((self._xorshift() % 900)))

        # Last trade: random within bid-ask
        alpha = (self._xorshift() % 1000) / 1000.0
        last_trade = bid + alpha * spread

        return (
            tick_id,
            round(bid, 6),
            round(ask, 6),
            round(mid, 6),
            round(self.price, 6),   # fair_value
            round(spread, 6),
            round(self.volatility * self.price, 6),  # absolute vol
            bid_vol,
            ask_vol,
            round(last_trade, 6),
            1.0 if is_news else 0.0,
        )


def generate(output_path: str, n_ticks: int, seed: int = 42):
    """Write a deterministic VIDHI binary tick file."""
    gbm = DeterministicGBM(seed=seed)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    with open(output_path, 'wb') as f:
        # Header
        f.write(MAGIC)
        f.write(struct.pack('<q', n_ticks))

        # Tick records
        for tick_id in range(n_ticks):
            record = gbm.next_tick(tick_id)
            f.write(struct.pack(TICK_FMT, *record))

            if tick_id % 100_000 == 0 and tick_id > 0:
                pct = tick_id / n_ticks * 100
                print(f"  {pct:.0f}% ({tick_id:,}/{n_ticks:,} ticks) price={record[3]:.2f}",
                      flush=True)

    size_mb = os.path.getsize(output_path) / 1024 / 1024
    print(f"[OK] Written: {output_path}  ({n_ticks:,} ticks, {size_mb:.1f} MB)")


# ─── Verify: read back and check magic ────────────────────────────────────────
def verify(path: str):
    with open(path, 'rb') as f:
        magic = f.read(8)
        if magic != MAGIC:
            print(f"[FAIL] VERIFY FAIL: bad magic {magic!r}", file=sys.stderr)
            return False
        n = struct.unpack('<q', f.read(8))[0]
        # Read first and last tick to sanity-check
        first = struct.unpack(TICK_FMT, f.read(TICK_BYTES))
        f.seek(8 + 8 + (n - 1) * TICK_BYTES)
        last  = struct.unpack(TICK_FMT, f.read(TICK_BYTES))
    print(f"[OK] VERIFY OK: {n:,} ticks | "
          f"first_price={first[3]:.2f} | last_price={last[3]:.2f}")
    return True


# ─── CLI ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Generate deterministic VIDHI tick dataset')
    parser.add_argument('--ticks', type=int, default=99_000,
                        help='Number of ticks (default: 99000 → public_99k.bin)')
    parser.add_argument('--output', type=str, default='',
                        help='Output file path (default: auto-named in data/ticks/)')
    parser.add_argument('--seed', type=int, default=42,
                        help='RNG seed — MUST be the same for all contestants (default: 42)')
    parser.add_argument('--verify', action='store_true',
                        help='Verify the written file after generation')
    args = parser.parse_args()

    # Auto-name output based on tick count
    if not args.output:
        script_dir  = os.path.dirname(os.path.abspath(__file__))
        if args.ticks == 99_000:
            fname = 'public_99k.bin'
        elif args.ticks == 1_000_000:
            fname = 'eval_1m.bin'
        else:
            fname = f'ticks_{args.ticks}.bin'
        args.output = os.path.join(script_dir, fname)

    print(f"Generating {args.ticks:,} ticks -> {args.output}  (seed={args.seed})")
    generate(args.output, args.ticks, seed=args.seed)

    if args.verify:
        verify(args.output)
