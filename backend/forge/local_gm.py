import os
import sys
import struct
import json
import argparse
import importlib.util
import time

# ─── TICK RECORD FORMAT ────────────────────────────────────────────────────────
MAGIC = b'VIDHI\x00\x00\x00'
TICK_FMT = '<q' + 'd' * 10
TICK_BYTES = struct.calcsize(TICK_FMT)

# ─── SDK STUBS ────────────────────────────────────────────────────────────────
class State:
    def __init__(self):
        self.bid_price = 0.0
        self.ask_price = 0.0
        self.mid_price = 0.0
        self.spread = 0.0
        self.last_trade_price = 0.0
        self.last_trade_volume = 0
        self.underlying_signal = 0.0
        self.volatility = 0.0
        self.bid_depth = (0,0,0,0,0)
        self.ask_depth = (0,0,0,0,0)
        
        self.position = 0
        self.cash = 100_000.0
        self.pnl = 0.0
        self.fill_count = 0
        self.total_fills = 0
        self.fills = []
        
        self.ema_fast = 0
        self.ema_slow = 0
        self.tick_count = 0
        self.my_position = 0
        self.s0 = 0; self.s1 = 0; self.s2 = 0; self.s3 = 0
        self.s4 = 0; self.s5 = 0; self.s6 = 0; self.s7 = 0

class Orders:
    def __init__(self):
        self.pending = []
    
    def limit_buy(self, price, volume):
        self.pending.append({'type': 'LIMIT', 'side': 'BUY', 'price': price, 'volume': volume})

    def limit_sell(self, price, volume):
        self.pending.append({'type': 'LIMIT', 'side': 'SELL', 'price': price, 'volume': volume})

    def market_buy(self, volume):
        self.pending.append({'type': 'MARKET', 'side': 'BUY', 'volume': volume})

    def market_sell(self, volume):
        self.pending.append({'type': 'MARKET', 'side': 'SELL', 'volume': volume})

    def cancel(self, order_id):
        pass

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--so', type=str, help='Path to .py bot')
    parser.add_argument('--ticks', type=int, default=100000)
    parser.add_argument('--dataset', type=str)
    parser.add_argument('--run-id', type=str)
    args = parser.parse_args()

    # We expect .py for local fallback, if .so is passed by Go, we look for the .py raw
    so_dir = os.path.dirname(args.so)
    py_path = os.path.join(so_dir, args.run_id + '.py')
    if not os.path.exists(py_path):
        py_path = args.so
    
    if not os.path.exists(py_path):
        print(f"[GM] Could not find bot python file at {py_path}", file=sys.stderr)
        sys.exit(1)

    # Import the bot
    spec = importlib.util.spec_from_file_location("contestant_bot", py_path)
    bot = importlib.util.module_from_spec(spec)
    sys.modules["contestant_bot"] = bot
    try:
        spec.loader.exec_module(bot)
    except Exception as e:
        print(f"[GM] Bot failed to load: {e}", file=sys.stderr)
        sys.exit(1)

    # Read dataset
    dataset_path = args.dataset
    if not os.path.exists(dataset_path):
        # Try looking one level up (if running from backend/)
        dataset_path = os.path.join("..", args.dataset)
    if not os.path.exists(dataset_path):
        print(f"[GM] Dataset not found: {args.dataset}", file=sys.stderr)
        print(json.dumps({"pnl_pct": 0.0, "p50_ns": 0, "p99_ns": 0, "total_ticks": 0, "tle_count": 0}))
        sys.exit(0)

    with open(dataset_path, 'rb') as f:
        magic = f.read(8)
        if magic != MAGIC:
            print("[GM] Bad dataset magic", file=sys.stderr)
            sys.exit(1)
        n_ticks = struct.unpack('<q', f.read(8))[0]
        n_ticks = min(n_ticks, args.ticks)
        
        state = State()
        all_latencies = []
        current_chunk_latencies = []
        
        for tick_id in range(n_ticks):
            record = struct.unpack(TICK_FMT, f.read(TICK_BYTES))
            
            # Record format:
            # tick_id, bid, ask, mid, fair_value, spread, vol, bid_vol, ask_vol, last_trade, is_news
            state.bid_price = record[1]
            state.ask_price = record[2]
            state.mid_price = record[3]
            state.underlying_signal = record[4]
            state.spread = record[5]
            state.volatility = record[6]
            state.last_trade_price = record[9]
            state.tick_count = tick_id

            orders = Orders()
            t0 = time.perf_counter_ns()
            try:
                bot.on_tick(state, orders)
            except Exception as e:
                print(f"[GM] Bot crashed on tick {tick_id}: {e}", file=sys.stderr)
                # Keep going to simulate C++ behavior
            t1 = time.perf_counter_ns()
            latency = t1 - t0
            all_latencies.append(latency)
            current_chunk_latencies.append(latency)

            # Process contestant orders natively
            for o in orders.pending:
                if o['side'] == 'BUY':
                    exec_price = state.ask_price if o['type'] == 'MARKET' else min(o['price'], state.ask_price)
                    if o['type'] == 'MARKET' or o['price'] >= state.ask_price:
                        # Filled
                        cost = exec_price * o['volume']
                        state.cash -= cost
                        state.position += o['volume']
                        state.fill_count += 1
                        state.total_fills += 1
                elif o['side'] == 'SELL':
                    exec_price = state.bid_price if o['type'] == 'MARKET' else max(o['price'], state.bid_price)
                    if o['type'] == 'MARKET' or o['price'] <= state.bid_price:
                        # Filled
                        revenue = exec_price * o['volume']
                        state.cash += revenue
                        state.position -= o['volume']
                        state.fill_count += 1
                        state.total_fills += 1

            # Basic Bot Market Maker effect
            # If the user buys a lot, the ask price goes up
            if orders.pending:
                net_vol = sum(o['volume'] if o['side'] == 'BUY' else -o['volume'] for o in orders.pending)
                # Small impact
                impact = (net_vol / 1000.0) * 0.05
                # We don't write back to the CSV, but we could carry state over here.
                # In this basic Python GM, we just calculate PnL based on the prints

            # MTM PnL
            state.pnl = state.cash + (state.position * state.last_trade_price) - 100_000.0

            # Binary Telemetry Output
            if tick_id % 1000 == 999:
                if not current_chunk_latencies:
                    chunk_p50 = 0
                    chunk_p99 = 0
                else:
                    current_chunk_latencies.sort()
                    chunk_p50 = current_chunk_latencies[len(current_chunk_latencies) // 2]
                    # Make sure index doesn't go out of bounds
                    p99_idx = min(int(len(current_chunk_latencies) * 0.99), len(current_chunk_latencies) - 1)
                    chunk_p99 = current_chunk_latencies[p99_idx]
                
                packet = struct.pack('<Bqqqqqddddi4x',
                    1,                      # type 0x01
                    tick_id,                # tick_id
                    int(state.pnl * 1000000), # pnl_fp
                    state.position,         # pos
                    chunk_p50,              # lat_p50
                    chunk_p99,              # lat_p99
                    state.bid_price,        # bid
                    state.ask_price,        # ask
                    state.spread,           # spread
                    state.last_trade_price, # last_trade
                    state.fill_count        # fill_count
                )
                sys.stdout.buffer.write(packet)
                sys.stdout.buffer.flush()
                state.fill_count = 0
                current_chunk_latencies = []
                time.sleep(0.05)


    if not all_latencies:
        final_p50 = 0
        final_p99 = 0
    else:
        all_latencies.sort()
        final_p50 = all_latencies[len(all_latencies) // 2]
        final_p99 = all_latencies[min(int(len(all_latencies) * 0.99), len(all_latencies) - 1)]

    pnl_pct = (state.pnl / 100_000.0) * 100.0
    print(json.dumps({
        "pnl_pct": pnl_pct,
        "p50_ns": final_p50,
        "p99_ns": final_p99,
        "total_ticks": n_ticks,
        "tle_count": 0,
        "position": state.position,
        "total_fills": state.total_fills
    }))

if __name__ == '__main__':
    main()
