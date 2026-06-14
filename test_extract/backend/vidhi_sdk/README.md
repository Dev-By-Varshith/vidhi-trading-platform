# Vidhi SDK

Welcome to the **Vidhi Algo Trading Platform SDK**. This SDK provides the Python API stub for writing ultra-low latency trading strategies for the IICPC algorithmic trading competitions.

## Quick Start

To write a trading strategy, create a file named `trader.py` and import `vidhi_sdk`:

```python
from vidhi_sdk import *

def on_tick(state: MarketState, orders: OrderProxy) -> None:
    # 1. Initialize state on first tick
    if state.tick_count == 0:
        state.ema_fast = state.mid_price
        state.ema_slow = state.mid_price

    # 2. Update your indicators
    state.ema_fast = 0.95 * state.ema_fast + 0.05 * state.mid_price
    state.ema_slow = 0.99 * state.ema_slow + 0.01 * state.mid_price
    
    # 3. Trading logic
    signal = state.ema_fast - state.ema_slow
    
    if signal > 0.05 and state.position < POSITION_LIMIT:
        orders.market_buy(10)
    elif signal < -0.05 and state.position > -POSITION_LIMIT:
        orders.market_sell(10)
```

## API Reference

### `MarketState`

A read-only view of the current market snapshot and your persistent state.

- **Market Data:**
  - `state.bid_price` (float): Best bid in the LOB.
  - `state.ask_price` (float): Best ask in the LOB.
  - `state.mid_price` (float): `(bid + ask) / 2`
  - `state.spread` (float): `ask - bid`
  - `state.bid_volume` (int): Volume at best bid.
  - `state.ask_volume` (int): Volume at best ask.
  - `state.last_trade_price` (float): Price of the most recent trade.
  - `state.underlying_signal` (float): Fair-value signal.

- **Account Data:**
  - `state.position` (int): Your current net position.
  - `state.cash` (float): Cash balance in USD.
  - `state.pnl` (float): Mark-to-market PnL vs starting capital.
  - `state.tick_count` (int): Current tick number (starts at 0).

- **Persistent State:**
  - You own the slots `state.ema_fast`, `state.ema_slow`, `state.my_position`, `state.s0` through `state.s7`.
  - Use these variables to store your custom calculations. Their values persist across ticks!

### `OrderProxy`

Submit orders. Note: maximum of 4 orders per tick.

- `orders.limit_buy(price, volume)`
- `orders.limit_sell(price, volume)`
- `orders.market_buy(volume)`
- `orders.market_sell(volume)`

## How it Works Under the Hood

Your Python code is submitted to our Go Backend, which leverages a custom security AST scanner. If it passes, your code is transpiled and compiled Ahead-Of-Time (AOT) using Numba to native x86_64 C++ equivalent shared objects (`.so`). 

This means your Python script will execute with the speed of native C++ in our ultra-low latency C++ Game Master, easily meeting the strict 100µs runtime limit!
