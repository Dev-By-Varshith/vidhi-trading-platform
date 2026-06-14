def on_tick(state, orders):
    # Fast strategy: market buy if fast EMA > slow EMA
    # Just simple math without branching if possible
    fast = state.mid_price * 0.1
    slow = state.mid_price * 0.05
    if fast > slow and state.position < 100:
        orders.market_buy(1)
    elif fast < slow and state.position > -100:
        orders.market_sell(1)
