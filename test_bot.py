def on_tick(state, orders):
    if state.mid_price < state.underlying_signal - 0.5:
        if state.position < 100:
            orders.market_buy(10)
    elif state.mid_price > state.underlying_signal + 0.5:
        if state.position > -100:
            orders.market_sell(10)
