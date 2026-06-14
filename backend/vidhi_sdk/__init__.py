"""
vidhi_sdk — Contestant SDK stub
Provides the clean Python API for Vidhi Arena trading strategies.

Usage (in contestant code):
    from vidhi_sdk import *

    def on_tick(state, orders):
        if state.bid_price > state.ema_fast:
            orders.limit_buy(state.bid_price, 10)

The scanner.py allows this import. At runtime (inside the Numba cfunc),
all state.* and orders.* calls are rewritten by transpiler.py to raw
array accesses — this module is only used for editor autocomplete / linting.
"""

# ─── Type stubs (for IDE / linting only) ─────────────────────────────────────

class MarketState:
    """Read-only view of the current market snapshot + contestant state."""
    bid_price:         float  # Best bid in the LOB × 1e6 fixed-point → float
    ask_price:         float  # Best ask in the LOB
    mid_price:         float  # (bid + ask) / 2
    spread:            float  # ask - bid
    bid_volume:        int    # Volume at best bid
    ask_volume:        int    # Volume at best ask
    last_trade_price:  float  # Price of the most recent trade
    underlying_signal: float  # Fair-value signal from GBM model

    # Contestant's own state
    position:    int    # Net long/short position (signed)
    cash:        float  # Cash balance in USD (cents precision)
    pnl:         float  # Mark-to-market PnL vs starting capital

    # Fill notifications from previous tick (list of dicts)
    fills: list         # [{'price': float, 'volume': int, 'side': 'buy'|'sell'}]

    # Persistent state slots — survive across ticks (you own these)
    ema_fast:    float  # Slot 0 — fast EMA (or any float you want)
    ema_slow:    float  # Slot 1 — slow EMA
    tick_count:  int    # Slot 2 — number of ticks processed
    my_position: int    # Slot 3 — shadow position tracker
    s0: float; s1: float; s2: float; s3: float  # Extra state slots 4-7
    s4: float; s5: float; s6: float; s7: float  # Extra state slots 8-11


class OrderProxy:
    """Write-only order submission proxy."""

    def limit_buy(self, price: float, volume: int) -> None:
        """Post a limit buy order at price with volume."""

    def limit_sell(self, price: float, volume: int) -> None:
        """Post a limit sell order at price with volume."""

    def market_buy(self, volume: int) -> None:
        """Send a market buy (takes from best ask). Volume capped at 1000."""

    def market_sell(self, volume: int) -> None:
        """Send a market sell (hits best bid). Volume capped at 1000."""

    def cancel(self, order_id: int) -> None:
        """Cancel an open limit order by ID (from state.open_orders)."""


# ─── Constants ────────────────────────────────────────────────────────────────
POSITION_LIMIT   = 1000      # Hard position limit — breach = 10% PnL penalty
MAX_ORDERS_TICK  = 4         # Max orders submitted per tick
STARTING_CAPITAL = 100_000.0 # Starting cash balance (USD)
BASE_PRICE       = 1500.0    # Reference mid price for the public dataset

# Order type constants (for reading state.fills)
BUY  = 'buy'
SELL = 'sell'

# ─── Required function signature ─────────────────────────────────────────────
def on_tick(state: MarketState, orders: OrderProxy) -> None:
    """
    Required entry point. Called once per market tick.

    Args:
        state:  Read-only snapshot of market + your contestant state.
        orders: Write-only order submission proxy (max 4 orders/tick).

    Constraints:
        - No imports (only math, random, numba allowed if needed)
        - No I/O, no network, no global state (use state.ema_fast/ema_slow etc.)
        - Runtime limit: 100µs — exceed it and your tick is treated as HOLD
        - Position limit: ±1000 — breach = -10% PnL penalty
    """
    pass
