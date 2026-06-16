from vidhi_sdk import *

def on_tick(state: MarketState, orders: OrderProxy):
    """
    Beginner Strategy: Simple Moving Average (SMA) Crossover
    This algorithm trades based on short-term vs long-term momentum.
    """
    # Initialize our variables on the first tick
    if state.tick_count == 0:
        state.ema_fast = state.mid_price
        state.ema_slow = state.mid_price
        
    # Update Simple Moving Averages using Exponential weighting
    state.ema_fast = (state.ema_fast * 0.95) + (state.mid_price * 0.05)
    state.ema_slow = (state.ema_slow * 0.99) + (state.mid_price * 0.01)
    
    # Calculate the momentum signal
    signal = state.ema_fast - state.ema_slow
    
    # Trading Logic
    # Buy if short-term momentum is strongly positive and we haven't maxed our position
    if signal > 0.5 and state.position < 100:
        orders.market_buy(10)
        
    # Sell if short-term momentum is strongly negative and we haven't maxed short position
    elif signal < -0.5 and state.position > -100:
        orders.market_sell(10)
