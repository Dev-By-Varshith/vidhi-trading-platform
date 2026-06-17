def on_tick(state, orders):
    if state.mid_price < state.underlying_signal - 0.5:
        orders.market_buy(10)
