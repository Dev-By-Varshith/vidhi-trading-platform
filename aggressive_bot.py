def on_tick(state, orders):
    # Initialize EMA on the first tick to avoid starting from 0
    if state.ema_fast == 0:
        state.ema_fast = state.mid_price
        
    # Track the short-term trend
    alpha = 0.2 
    state.ema_fast = alpha * state.mid_price + (1 - alpha) * state.ema_fast
    
    # Very aggressive trading to trigger massive LOB engagement
    # We use large volumes (50-100) to chew through the Market Maker's depth
    
    if state.mid_price > state.ema_fast:
        # Price is spiking up! Aggressively buy at market to front-run the Momentum bot
        if state.position < 800:
            orders.market_buy(50)
            
        # Place aggressive limit buys inside the spread to dominate the bid
        if state.position < 1000:
            orders.limit_buy(state.bid_price + 0.01, 100)
            
    elif state.mid_price < state.ema_fast:
        # Price is crashing! Aggressively sell at market to hit the bids
        if state.position > -800:
            orders.market_sell(50)
            
        # Place aggressive limit sells inside the spread to dominate the ask
        if state.position > -1000:
            orders.limit_sell(state.ask_price - 0.01, 100)
