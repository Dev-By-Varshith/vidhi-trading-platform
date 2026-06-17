"""
forge/local_gm.py — Vidhi Local Game Master (Python fallback)
Runs when the C++ vidhi-gm binary is unavailable (dev / Windows).
Simulates a FULL 5-bot LOB environment against the contestant's code.
Outputs binary telemetry packets (type 0x01) matching main.go's parser,
then a final JSON result on stdout.
"""
import os
import sys
import struct
import json
import argparse
import importlib.util
import time
import math

# ─── TICK RECORD FORMAT ────────────────────────────────────────────────────────
MAGIC = b'VIDHI\x00\x00\x00'
TICK_FMT = '<q' + 'd' * 10
TICK_BYTES = struct.calcsize(TICK_FMT)

# ─── CONSTANTS ─────────────────────────────────────────────────────────────────
TICK_SIZE      = 0.01
POSITION_LIMIT = 1000

# ─── BOT CONFIG PARSER ─────────────────────────────────────────────────────────
def parse_bot_config(s):
    """Parse 'MM:1.0,MOM:0.5,MR:1.0,NOISE:1.0,SNIPER:0.5' → dict"""
    cfg = {'MM': 1.0, 'MOM': 1.0, 'MR': 1.0, 'NOISE': 1.0, 'SNIPER': 1.0}
    if not s:
        return cfg
    for part in s.split(','):
        part = part.strip()
        if ':' in part:
            k, v = part.split(':', 1)
            try:
                cfg[k.strip().upper()] = float(v.strip())
            except ValueError:
                pass
    return cfg

# ─── SIMPLE LOB ────────────────────────────────────────────────────────────────
class SimpleLOB:
    def __init__(self):
        self.bids = {}   # price → volume
        self.asks = {}   # price → volume
        self.last_trade_price = 0.0
        self.last_trade_volume = 0

    def _round(self, p):
        return round(p / TICK_SIZE) * TICK_SIZE

    def add_order(self, side, price, volume):
        p = self._round(price)
        book = self.bids if side == 'buy' else self.asks
        book[p] = book.get(p, 0) + volume

    def best_bid(self):
        return max(self.bids.keys()) if self.bids else 0.0

    def best_ask(self):
        return min(self.asks.keys()) if self.asks else float('inf')

    def mid(self):
        bb = self.best_bid(); ba = self.best_ask()
        if bb == 0 or ba == float('inf'):
            return self.last_trade_price or 1500.0
        return (bb + ba) / 2.0

    def spread(self):
        return self.best_ask() - self.best_bid()

    def market_order(self, side, volume):
        """Execute market order, return fills list [{price, volume}]"""
        fills = []
        remaining = volume
        book = self.asks if side == 'buy' else self.bids
        prices = sorted(book.keys()) if side == 'buy' else sorted(book.keys(), reverse=True)
        for p in prices:
            if remaining <= 0:
                break
            avail = book[p]
            filled = min(avail, remaining)
            fills.append({'price': p, 'volume': filled})
            remaining -= filled
            avail -= filled
            if avail <= 0:
                del book[p]
            else:
                book[p] = avail
            self.last_trade_price = p
            self.last_trade_volume = filled
        return fills

    def depth(self, side, n=5):
        book = self.bids if side == 'bid' else self.asks
        prices = sorted(book.keys(), reverse=(side == 'bid'))[:n]
        return [{'price': p, 'volume': book[p]} for p in prices]

    def snapshot(self):
        bb = self.best_bid()
        ba = self.best_ask()
        return {
            'bid_price':  bb,
            'ask_price':  ba if ba != float('inf') else bb + TICK_SIZE,
            'mid_price':  self.mid(),
            'spread':     max(self.spread(), 0.0) if ba != float('inf') else TICK_SIZE,
            'last_trade': self.last_trade_price,
            'bid_depth':  self.depth('bid'),
            'ask_depth':  self.depth('ask'),
        }

# ─── BOT IMPLEMENTATIONS ───────────────────────────────────────────────────────
class MarketMakerBot:
    def __init__(self, lob, scale):
        self.lob = lob
        self.scale = scale
        self.inventory = 0
        self.fills = 0

    def compute(self, snap, fair_value, volatility):
        if self.scale == 0:
            return
        skew   = self.inventory * 0.002
        spread = max(2 * TICK_SIZE, snap['spread'] * 0.8 + volatility * 0.5)
        bid_p  = round((fair_value - spread / 2 - skew) / TICK_SIZE) * TICK_SIZE
        ask_p  = round((fair_value + spread / 2 - skew) / TICK_SIZE) * TICK_SIZE
        vol    = max(1, round(50 * self.scale))
        self.lob.add_order('buy',  bid_p, vol)
        self.lob.add_order('sell', ask_p, vol)


class MomentumBot:
    def __init__(self, lob, scale):
        self.lob = lob
        self.scale = scale
        self.ema = 0.0
        self.fills = 0

    def compute(self, snap, fair_value, volatility):
        if self.scale == 0:
            return
        mid = snap['mid_price']
        self.ema = 0.97 * self.ema + 0.03 * mid if self.ema else mid
        sig = mid - self.ema
        vol = max(1, round(30 * self.scale))
        if sig > 3 * TICK_SIZE:
            f = self.lob.market_order('buy', vol)
            self.fills += len(f)
        elif sig < -3 * TICK_SIZE:
            f = self.lob.market_order('sell', vol)
            self.fills += len(f)


class MeanReversionBot:
    def __init__(self, lob, scale):
        self.lob = lob
        self.scale = scale
        self.fills = 0

    def compute(self, snap, fair_value, volatility):
        if self.scale == 0:
            return
        dev = snap['mid_price'] - fair_value
        vol = max(1, round(80 * self.scale))
        if dev > 5 * TICK_SIZE:
            self.lob.add_order('sell', snap['mid_price'] - TICK_SIZE, vol)
        elif dev < -5 * TICK_SIZE:
            self.lob.add_order('buy', snap['mid_price'] + TICK_SIZE, vol)


class NoiseTraderBot:
    def __init__(self, lob, scale):
        self.lob = lob
        self.scale = scale
        self._seed = 0xCAFEBABE
        self.fills = 0

    def _rng(self):
        x = self._seed
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= (x >> 17) & 0xFFFFFFFF
        x ^= (x << 5)  & 0xFFFFFFFF
        self._seed = x & 0xFFFFFFFF
        return (self._seed & 0xFFFFFFFF) / 0xFFFFFFFF

    def compute(self, snap, fair_value, volatility):
        if self.scale == 0 or self._rng() > 0.4:
            return
        vol  = max(1, round((10 + self._rng() * 30) * self.scale))
        side = 'buy' if self._rng() > 0.5 else 'sell'
        price_base = snap['bid_price'] if side == 'buy' else snap['ask_price']
        offset = (round(self._rng() * 5) - 2) * TICK_SIZE
        self.lob.add_order(side, price_base + offset, vol)


class SniperBot:
    def __init__(self, lob, scale):
        self.lob = lob
        self.scale = scale
        self.fills = 0

    def compute(self, snap, fair_value, volatility):
        if self.scale == 0:
            return
        vol = max(1, round(100 * self.scale))
        if snap['ask_price'] < fair_value - TICK_SIZE:
            f = self.lob.market_order('buy', min(vol, 100))
            self.fills += len(f)
        if snap['bid_price'] > fair_value + TICK_SIZE:
            f = self.lob.market_order('sell', min(vol, 100))
            self.fills += len(f)


# ─── SDK STUBS (for contestant code) ──────────────────────────────────────────
class State:
    __slots__ = [
        'bid_price', 'ask_price', 'mid_price', 'spread',
        'last_trade_price', 'last_trade_volume', 'underlying_signal', 'volatility',
        'bid_depth', 'ask_depth',
        'position', 'cash', 'pnl', 'fill_count', 'total_fills', 'fills',
        'ema_fast', 'ema_slow', 'tick_count', 'my_position',
        's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7',
    ]
    def __init__(self):
        for f in self.__slots__:
            setattr(self, f, 0)
        self.bid_depth = []
        self.ask_depth = []
        self.fills = []
        self.cash = 100_000.0

class Orders:
    def __init__(self):
        self.pending = []
    def limit_buy(self, price, volume):
        self.pending.append({'type': 'LIMIT', 'side': 'BUY', 'price': float(price), 'volume': int(volume)})
    def limit_sell(self, price, volume):
        self.pending.append({'type': 'LIMIT', 'side': 'SELL', 'price': float(price), 'volume': int(volume)})
    def market_buy(self, volume):
        self.pending.append({'type': 'MARKET', 'side': 'BUY', 'volume': int(volume)})
    def market_sell(self, volume):
        self.pending.append({'type': 'MARKET', 'side': 'SELL', 'volume': int(volume)})
    def cancel(self, order_id):
        pass


# ─── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Vidhi Local Game Master')
    parser.add_argument('--so',         type=str, required=True,  help='Path to contestant .py (or .so placeholder)')
    parser.add_argument('--ticks',      type=int, default=100000, help='Max ticks to simulate')
    parser.add_argument('--dataset',    type=str, default='',     help='Path to .bin tick dataset')
    parser.add_argument('--run-id',     type=str, default='',     help='Run ID for logging')
    parser.add_argument('--bot-config', type=str, default='',     help='Bot aggressiveness e.g. MM:1.0,MOM:0.5')
    args = parser.parse_args()

    # ── Locate contestant .py ──────────────────────────────────────────────────
    so_dir  = os.path.dirname(os.path.abspath(args.so))
    py_path = os.path.join(so_dir, (args.run_id or '') + '.py') if args.run_id else args.so
    if not os.path.exists(py_path):
        py_path = args.so
    if not os.path.exists(py_path):
        print(f"[GM] Could not find bot python file at {py_path}", file=sys.stderr)
        sys.exit(1)

    # ── Load contestant module ─────────────────────────────────────────────────
    spec = importlib.util.spec_from_file_location("contestant_bot", py_path)
    bot_module = importlib.util.module_from_spec(spec)
    sys.modules["contestant_bot"] = bot_module
    try:
        spec.loader.exec_module(bot_module)
    except Exception as e:
        print(f"[GM] Bot failed to load: {e}", file=sys.stderr)
        sys.exit(1)

    if not hasattr(bot_module, 'on_tick'):
        print("[GM] Bot has no on_tick function", file=sys.stderr)
        sys.exit(1)

    # ── Parse bot config ──────────────────────────────────────────────────────
    bc = parse_bot_config(args.bot_config)
    print(f"[GM] Bot config: {bc}", file=sys.stderr)

    # ── Load dataset ──────────────────────────────────────────────────────────
    dataset_prices = None
    fair_values    = None
    dataset_path   = args.dataset

    if dataset_path and not os.path.exists(dataset_path):
        dataset_path = os.path.join('..', args.dataset)
    if dataset_path and not os.path.exists(dataset_path):
        dataset_path = None

    if dataset_path:
        try:
            with open(dataset_path, 'rb') as f:
                magic = f.read(8)
                if magic == MAGIC:
                    n_ticks = struct.unpack('<q', f.read(8))[0]
                    n_ticks = min(n_ticks, args.ticks)
                    records = []
                    for _ in range(n_ticks):
                        raw = f.read(TICK_BYTES)
                        if len(raw) < TICK_BYTES:
                            break
                        records.append(struct.unpack(TICK_FMT, raw))
                    dataset_prices = records
                    print(f"[GM] Loaded dataset: {len(dataset_prices)} ticks", file=sys.stderr)
        except Exception as e:
            print(f"[GM] Dataset load failed: {e} — using GBM fallback", file=sys.stderr)

    # ── Initialise LOB + bots ─────────────────────────────────────────────────
    lob = SimpleLOB()

    mm     = MarketMakerBot(lob,     bc.get('MM',     1.0))
    mom    = MomentumBot(lob,        bc.get('MOM',    1.0))
    mr     = MeanReversionBot(lob,   bc.get('MR',     1.0))
    noise  = NoiseTraderBot(lob,     bc.get('NOISE',  1.0))
    sniper = SniperBot(lob,          bc.get('SNIPER', 1.0))
    bots   = [mm, mom, mr, noise, sniper]

    # ── Contestant tracking ───────────────────────────────────────────────────
    state = State()
    position   = 0
    cash       = 100_000.0
    total_fills = 0
    fill_count  = 0

    all_latencies     = []
    chunk_latencies   = []
    pnl_history       = []

    # Bot activity counters matching frontend key names
    bot_activity = {
        'BOT_MARKET_MAKER':   0,
        'BOT_MOMENTUM':       0,
        'BOT_MEAN_REVERSION': 0,
        'BOT_NOISE':          0,
        'BOT_SNIPER':         0,
    }

    base_price = 1500.0
    gbm_price  = base_price
    gbm_seed   = 42

    def gbm_next():
        nonlocal gbm_price, gbm_seed
        # xorshift32
        x = gbm_seed
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= (x >> 17) & 0xFFFFFFFF
        x ^= (x << 5)  & 0xFFFFFFFF
        gbm_seed = x & 0xFFFFFFFF
        r1 = gbm_seed / 0xFFFFFFFF
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= (x >> 17) & 0xFFFFFFFF
        x ^= (x << 5)  & 0xFFFFFFFF
        gbm_seed = x & 0xFFFFFFFF
        r2 = gbm_seed / 0xFFFFFFFF
        # Box-Muller
        r1 = max(1e-10, r1)
        z = math.sqrt(-2 * math.log(r1)) * math.cos(2 * math.pi * r2)
        drift = -0.001 * (gbm_price - base_price)
        gbm_price += drift + 0.0003 * gbm_price * z
        gbm_price = max(base_price * 0.7, min(base_price * 1.3, gbm_price))
        vol = abs(z) * 0.0003 * gbm_price
        return gbm_price, vol

    n_ticks = len(dataset_prices) if dataset_prices else args.ticks

    # Seed LOB with some initial liquidity
    fv0 = dataset_prices[0][3] if dataset_prices else base_price
    snap0 = {'bid_price': fv0 - 0.05, 'ask_price': fv0 + 0.05, 'mid_price': fv0, 'spread': 0.10,
             'last_trade': fv0, 'bid_depth': [], 'ask_depth': []}
    mm.compute(snap0, fv0, 0.01)

    for tick_id in range(n_ticks):
        # ── Get fair value ──────────────────────────────────────────────────
        if dataset_prices and tick_id < len(dataset_prices):
            rec = dataset_prices[tick_id]
            fair_value = rec[3]  # mid_price field
            volatility = abs(rec[6]) if len(rec) > 6 else 0.01
        else:
            fair_value, volatility = gbm_next()

        snap = lob.snapshot()

        # ── Run bots ────────────────────────────────────────────────────────
        mm.compute(snap, fair_value, volatility)
        bot_activity['BOT_MARKET_MAKER'] += mm.fills; mm.fills = 0

        mom.compute(snap, fair_value, volatility)
        bot_activity['BOT_MOMENTUM'] += mom.fills; mom.fills = 0

        mr.compute(snap, fair_value, volatility)
        bot_activity['BOT_MEAN_REVERSION'] += mr.fills; mr.fills = 0

        noise.compute(snap, fair_value, volatility)
        bot_activity['BOT_NOISE'] += noise.fills; noise.fills = 0

        sniper.compute(snap, fair_value, volatility)
        bot_activity['BOT_SNIPER'] += sniper.fills; sniper.fills = 0

        # ── Refresh snap after bots ─────────────────────────────────────────
        snap = lob.snapshot()

        # ── Populate state for contestant ───────────────────────────────────
        state.bid_price         = snap['bid_price']
        state.ask_price         = snap['ask_price']
        state.mid_price         = snap['mid_price']
        state.spread            = snap['spread']
        state.last_trade_price  = snap['last_trade']
        state.underlying_signal = fair_value
        state.volatility        = volatility
        state.bid_depth         = snap['bid_depth']
        state.ask_depth         = snap['ask_depth']
        state.position          = position
        state.cash              = cash
        state.pnl               = cash + position * snap['mid_price'] - 100_000.0
        state.fill_count        = fill_count
        state.total_fills       = total_fills
        state.tick_count        = tick_id
        state.my_position       = position
        fill_count = 0

        # ── Run contestant ──────────────────────────────────────────────────
        orders = Orders()
        t0 = time.perf_counter_ns()
        try:
            bot_module.on_tick(state, orders)
        except Exception as e:
            print(f"[GM] Bot crashed on tick {tick_id}: {e}", file=sys.stderr)
        t1 = time.perf_counter_ns()
        latency = t1 - t0
        all_latencies.append(latency)
        chunk_latencies.append(latency)

        # ── Process contestant orders ───────────────────────────────────────
        for o in orders.pending:
            if abs(position) >= POSITION_LIMIT:
                if (position > 0 and o['side'] == 'BUY') or (position < 0 and o['side'] == 'SELL'):
                    continue

            if o['side'] == 'BUY':
                if o['type'] == 'MARKET':
                    fills = lob.market_order('buy', o['volume'])
                else:
                    # Limit buy: fill if price >= ask
                    if o['price'] >= snap['ask_price']:
                        fills = lob.market_order('buy', o['volume'])
                    else:
                        lob.add_order('buy', o['price'], o['volume'])
                        fills = []
                for f in fills:
                    cash     -= f['price'] * f['volume']
                    position += f['volume']
                    total_fills += 1
                    fill_count  += 1

            elif o['side'] == 'SELL':
                if o['type'] == 'MARKET':
                    fills = lob.market_order('sell', o['volume'])
                else:
                    if o['price'] <= snap['bid_price']:
                        fills = lob.market_order('sell', o['volume'])
                    else:
                        lob.add_order('sell', o['price'], o['volume'])
                        fills = []
                for f in fills:
                    cash     += f['price'] * f['volume']
                    position -= f['volume']
                    total_fills += 1
                    fill_count  += 1

        # ── MTM PnL ─────────────────────────────────────────────────────────
        cur_mid = lob.mid()
        pnl = cash + position * cur_mid - 100_000.0
        pnl_history.append(pnl)

        # ── Binary telemetry packet every 1000 ticks (matches main.go parser) ──
        if tick_id % 1000 == 999:
            if chunk_latencies:
                sl = sorted(chunk_latencies)
                p50 = sl[len(sl) // 2]
                p99 = sl[min(int(len(sl) * 0.99), len(sl) - 1)]
            else:
                p50 = p99 = 0

            packet = struct.pack('<BqqqqqddddiI4x',
                0x01,                        # packet type
                tick_id,                     # tick_id  (int64)
                int(pnl * 1_000_000),        # pnl_fp   (int64, microdollars)
                position,                    # pos      (int64)
                p50,                         # lat_p50  (int64, ns)
                p99,                         # lat_p99  (int64, ns)
                snap['bid_price'],           # bid      (float64)
                snap['ask_price'],           # ask      (float64)
                snap['spread'],              # spread   (float64)
                snap['last_trade'],          # last_trade (float64)
                fill_count,                  # fill_count (int32)
                0,                           # pad      (uint32)
            )
            sys.stdout.buffer.write(packet)
            sys.stdout.buffer.flush()
            chunk_latencies = []
            time.sleep(0.02)  # small yield so Go goroutine can read

    # ── Final metrics ──────────────────────────────────────────────────────────
    if all_latencies:
        sl = sorted(all_latencies)
        final_p50 = sl[len(sl) // 2]
        final_p99 = sl[min(int(len(sl) * 0.99), len(sl) - 1)]
    else:
        final_p50 = final_p99 = 0

    final_mid = lob.mid()
    final_pnl = cash + position * final_mid - 100_000.0
    pnl_pct   = (final_pnl / 100_000.0) * 100.0

    result = {
        "pnl":          round(final_pnl, 6),
        "pnl_pct":      round(pnl_pct,   6),
        "p50_ns":       final_p50,
        "p99_ns":       final_p99,
        "total_ticks":  n_ticks,
        "tle_count":    0,
        "position":     position,
        "total_fills":  total_fills,
        "correctness":  1.0,
        "violations":   0,
        "bot_activity": bot_activity,
    }
    # Write final JSON to stdout (main.go reads this after binary packets)
    sys.stdout.buffer.write(json.dumps(result).encode())
    sys.stdout.buffer.flush()

if __name__ == '__main__':
    main()
