from vidhi_sdk import *

def on_tick(state: MarketState, orders: OrderProxy):
    """
    Intermediate Strategy: Statistical Arbitrage / Market Making
    This algorithm provides liquidity on both sides of the book based on
    a calculation of the "fair value" (underlying signal).
    """
    # Calculate a running estimate of fair value based on recent trades
    if state.tick_count == 0:
        state.fair_value_estimate = state.mid_price
        
    # Smooth the underlying signal slightly
    state.fair_value_estimate = (state.fair_value_estimate * 0.9) + (state.underlying_signal * 0.1)
    
    # We want to place limit orders around our fair value estimate
    spread_edge = 0.5 # We want to capture 50 cents of edge
    
    # Cancel previous stale limit orders
    # Note: Real SDK would require you to track your Order IDs
    # For this example, we'll aggressively hit the market if it crosses our edge
    
    # If the market is offering to sell to us below our fair value edge
    if state.ask_price < (state.fair_value_estimate - spread_edge):
        if state.position < 200:
            orders.market_buy(25)
            
    # If the market is offering to buy from us above our fair value edge
    elif state.bid_price > (state.fair_value_estimate + spread_edge):
        if state.position > -200:
            orders.market_sell(25)
            
    # Position Management (Mean Reversion)
    # If we accumulate too much position, flatten out slightly to reduce risk
    if state.position > 150:
        orders.market_sell(10)
    elif state.position < -150:
        orders.market_buy(10)
