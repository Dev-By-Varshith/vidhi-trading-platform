#!/usr/bin/env python3
"""
backend/forge/vidhi_sdk.py
──────────────────────────────────────────────────────────────────────────────
Vidhi Arena Contestant SDK — Type stubs & helpers for the clean on_tick() API

This module is imported by contestants who write `from vidhi_sdk import *`.
The AST scanner allows it, and the transpiler converts all SDK calls to raw
array accesses matching the SharedMem layout in rendezvous.hpp.

NOTE: This module is only used for IDE completion / local testing.
      At forge time, the transpiler replaces all SDK references with
      direct int64* array reads/writes — so this file is never loaded
      inside the Game Master sandbox.

Usage in contestant code:
    from vidhi_sdk import State, Orders, Fill

    def on_tick(state: State, orders: Orders):
        if state.bid_price > state.underlying_signal:
            orders.limit_sell(price=state.ask_price + 0.01, volume=10)
"""

from collections import namedtuple

# ─── Fixed-point scale (must match FIXED_POINT in rendezvous.hpp) ────────────
FIXED_POINT = 1_000_000  # 1e6 — all prices stored as int64 × 1e6

# ─── Fill notification (read from state.fills in on_tick) ────────────────────
Fill = namedtuple('Fill', ['price', 'volume', 'side'])
"""
A trade fill from a previous tick's order.

Attributes:
    price  (float): Fill price in dollars (e.g., 1500.25)
    volume (int):   Number of shares filled
    side   (str):   'buy' if you bought, 'sell' if you sold
"""


# ─── Open order (read from state.open_orders) ─────────────────────────────────
class OpenOrder:
    """
    A resting limit order currently in the LOB.
    Access via: state.open_orders[i]
    """
    def __init__(self, order_id: int, price: float, volume: int, side: str):
        self.id     = order_id   # Use this with orders.cancel(order_id=...)
        self.price  = price      # Limit price in dollars
        self.volume = volume     # Remaining (unfilled) volume
        self.side   = side       # 'buy' or 'sell'


# ─── State object — passed as first arg to on_tick() ─────────────────────────
class State:
    """
    Live market state for the current tick.
    All fields are read-only — write via the Orders object instead.

    Market data (bots have already responded to YOUR last tick's orders):
        bid_price         (float): Best bid in the LOB right now
        ask_price         (float): Best ask in the LOB right now
        mid_price         (float): (bid + ask) / 2
        spread            (float): ask - bid (widens when market maker is scared)
        last_trade_price  (float): Price of the most recent trade
        last_trade_volume (int):   Volume of the most recent trade
        underlying_signal (float): Platform's reference fair value (GBM or dataset)
        volatility        (float): Realized volatility estimate
        bid_depth         (tuple): 5 levels of bid volume [best, best-1, ..., best-4]
        ask_depth         (tuple): 5 levels of ask volume [best, best+1, ..., best+4]

    Your state:
        position          (int):   Net long/short position (+ = long, - = short)
        cash              (float): Your current cash balance in dollars
        pnl               (float): Mark-to-market PnL = cash + position × last_price - 100,000
        fill_count        (int):   Number of fills this tick (0-4)
        fills             (list):  List of Fill(price, volume, side) from PREVIOUS tick

    Persistent state (survives between ticks, ~0ns overhead):
        ema_fast, ema_slow, tick_count, my_position — and s0..s7 for custom int state
    """
    # ── Market ────────────────────────────────────────────────────────────
    bid_price:          float = 0.0
    ask_price:          float = 0.0
    mid_price:          float = 0.0
    spread:             float = 0.0
    last_trade_price:   float = 0.0
    last_trade_volume:  int   = 0
    underlying_signal:  float = 0.0
    volatility:         float = 0.0
    bid_depth:          tuple = (0, 0, 0, 0, 0)
    ask_depth:          tuple = (0, 0, 0, 0, 0)

    # ── Your account ──────────────────────────────────────────────────────
    position:   int   = 0
    cash:       float = 100_000.0
    pnl:        float = 0.0
    fill_count: int   = 0
    fills:      list  = []         # List[Fill]

    # ── Persistent state (16 int64 slots, preserved across ticks) ─────────
    ema_fast:    int = 0
    ema_slow:    int = 0
    tick_count:  int = 0
    my_position: int = 0
    s0: int = 0; s1: int = 0; s2: int = 0; s3: int = 0
    s4: int = 0; s5: int = 0; s6: int = 0; s7: int = 0


# ─── Orders object — passed as second arg to on_tick() ───────────────────────
class Orders:
    """
    Submit orders for this tick. Maximum 4 orders per tick.

    Methods:
        limit_buy(price, volume)     Place a limit buy order
        limit_sell(price, volume)    Place a limit sell order
        market_buy(volume)           Immediately buy at best ask
        market_sell(volume)          Immediately sell at best bid
        cancel(order_id)             Cancel a resting limit order
    """

    def limit_buy(self, price: float, volume: int) -> None:
        """
        Post a limit buy at `price` for `volume` shares.
        Sits in the LOB until filled or cancelled. FIFO priority at same price.
        """
        pass

    def limit_sell(self, price: float, volume: int) -> None:
        """
        Post a limit sell at `price` for `volume` shares.
        """
        pass

    def market_buy(self, volume: int) -> None:
        """
        Immediately buy `volume` shares at the best available ask price.
        Warning: Takes liquidity — you pay the spread every time.
        """
        pass

    def market_sell(self, volume: int) -> None:
        """
        Immediately sell `volume` shares at the best available bid price.
        """
        pass

    def cancel(self, order_id: int) -> None:
        """
        Cancel a resting limit order by ID.
        Use state.open_orders[i].id to get the order ID.
        """
        pass


# ─── Position limit (enforced by platform — breach = −10% PnL penalty) ───────
POSITION_LIMIT = 1000

# ─── Tick limit ───────────────────────────────────────────────────────────────
TICKS_PER_ROUND = 100_000  # public phase; final phase: 1,000,000

# ─── TLE deadline ─────────────────────────────────────────────────────────────
TLE_DEADLINE_US = 100  # microseconds — order treated as HOLD if exceeded
