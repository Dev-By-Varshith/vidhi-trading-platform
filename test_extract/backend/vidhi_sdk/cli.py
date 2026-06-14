import os
import sys
import argparse
import csv
import importlib.util
from typing import List, Dict

from vidhi_sdk import MarketState, OrderProxy

class LocalMarketState(MarketState):
    def __init__(self):
        self.bid_price = 1500.0
        self.ask_price = 1500.5
        self.mid_price = 1500.25
        self.spread = 0.5
        self.bid_volume = 100
        self.ask_volume = 100
        self.last_trade_price = 1500.25
        self.underlying_signal = 1500.25
        
        self.position = 0
        self.cash = 100000.0
        self.pnl = 0.0
        
        self.fills: List[Dict] = []
        
        # Persistent state mock
        self.ema_fast = 0.0
        self.ema_slow = 0.0
        self.tick_count = 0
        self.my_position = 0
        self.s0 = 0.0; self.s1 = 0.0; self.s2 = 0.0; self.s3 = 0.0
        self.s4 = 0.0; self.s5 = 0.0; self.s6 = 0.0; self.s7 = 0.0

class LocalOrderProxy(OrderProxy):
    def __init__(self, state: LocalMarketState):
        self.state = state
        self.orders = []

    def limit_buy(self, price: float, volume: int) -> None:
        self.orders.append({'type': 'LIMIT_BUY', 'price': price, 'volume': volume})

    def limit_sell(self, price: float, volume: int) -> None:
        self.orders.append({'type': 'LIMIT_SELL', 'price': price, 'volume': volume})

    def market_buy(self, volume: int) -> None:
        self.orders.append({'type': 'MARKET_BUY', 'volume': min(volume, 1000)})

    def market_sell(self, volume: int) -> None:
        self.orders.append({'type': 'MARKET_SELL', 'volume': min(volume, 1000)})

    def cancel(self, order_id: int) -> None:
        self.orders.append({'type': 'CANCEL', 'order_id': order_id})

def simulate(strategy_path: str, dataset_path: str, max_ticks: int):
    print(f"[Vidhi CLI] Loading strategy from {strategy_path}...")
    
    spec = importlib.util.spec_from_file_location("contestant_strategy", strategy_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["contestant_strategy"] = module
    spec.loader.exec_module(module)
    
    if not hasattr(module, 'on_tick'):
        print("[Error] on_tick(state, orders) not found in the provided file.")
        sys.exit(1)
        
    on_tick = module.on_tick
    
    state = LocalMarketState()
    proxy = LocalOrderProxy(state)
    
    print(f"[Vidhi CLI] Loading historical market data from {dataset_path}...")
    ticks = []
    with open(dataset_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            ticks.append(row)
            if len(ticks) >= max_ticks:
                break
    
    print(f"[Vidhi CLI] Running local simulation for {len(ticks)} ticks...\n")
    
    for i, tick_data in enumerate(ticks):
        state.tick_count = i
        
        # Load real price movement from CSV
        state.mid_price = float(tick_data['mid_price'])
        state.bid_price = float(tick_data['bid_price'])
        state.ask_price = float(tick_data['ask_price'])
        state.spread = float(tick_data['spread'])
        state.bid_volume = int(float(tick_data['bid_vol']))
        state.ask_volume = int(float(tick_data['ask_vol']))
        state.underlying_signal = float(tick_data['fair_value'])
        state.last_trade_price = float(tick_data['last_trade_px'])
        
        # Clear previous fills
        state.fills = []
        proxy.orders = []
        
        # Call contestant code
        try:
            on_tick(state, proxy)
        except Exception as e:
            print(f"[Error] Exception in on_tick at tick {i}: {e}")
            break
            
        # Process orders (rudimentary matching against best bid/ask)
        for order in proxy.orders:
            vol = order.get('volume', 0)
            if order['type'] == 'MARKET_BUY':
                fill_price = state.ask_price
                state.position += vol
                state.cash -= fill_price * vol
                state.fills.append({'price': fill_price, 'volume': vol, 'side': 'buy'})
            elif order['type'] == 'MARKET_SELL':
                fill_price = state.bid_price
                state.position -= vol
                state.cash += fill_price * vol
                state.fills.append({'price': fill_price, 'volume': vol, 'side': 'sell'})
            elif order['type'] == 'LIMIT_BUY' and order['price'] >= state.ask_price:
                state.position += vol
                state.cash -= order['price'] * vol
                state.fills.append({'price': order['price'], 'volume': vol, 'side': 'buy'})
            elif order['type'] == 'LIMIT_SELL' and order['price'] <= state.bid_price:
                state.position -= vol
                state.cash += order['price'] * vol
                state.fills.append({'price': order['price'], 'volume': vol, 'side': 'sell'})
                
        # Update PnL (Mark to Market)
        state.pnl = (state.cash + (state.position * state.mid_price)) - 100000.0

    print("-" * 40)
    print("Simulation Complete!")
    print(f"Final PnL:      ${state.pnl:.2f}")
    print(f"Final Position: {state.position}")
    print(f"Final Cash:     ${state.cash:.2f}")
    print("-" * 40)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Vidhi Arena Local Testing CLI")
    parser.add_argument("strategy_file", help="Path to your python strategy file")
    parser.add_argument("--dataset", type=str, required=True, help="Path to the historical round CSV dataset")
    parser.add_argument("--ticks", type=int, default=1000, help="Number of ticks to simulate")
    args = parser.parse_args()
    
    if not os.path.exists(args.strategy_file):
        print(f"File not found: {args.strategy_file}")
        sys.exit(1)
        
    if not os.path.exists(args.dataset):
        print(f"Dataset not found: {args.dataset}")
        sys.exit(1)
        
    simulate(args.strategy_file, args.dataset, args.ticks)
