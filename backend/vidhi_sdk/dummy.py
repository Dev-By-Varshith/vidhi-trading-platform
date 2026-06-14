from vidhi_sdk import *

def on_tick(state, orders):
    # Simple moving average crossover mock
    if state.tick_count == 0:
        state.ema_fast = state.mid_price
        state.ema_slow = state.mid_price

    state.ema_fast = (state.mid_price * 0.1) + (state.ema_fast * 0.9)
    state.ema_slow = (state.mid_price * 0.05) + (state.ema_slow * 0.95)

    if state.ema_fast > state.ema_slow and state.position < 100:
        orders.market_buy(10)
    elif state.ema_fast < state.ema_slow and state.position > -100:
        orders.market_sell(10)
