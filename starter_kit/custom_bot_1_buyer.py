from vidhi_sdk import State, Orders

def on_tick(state: State, orders: Orders):
    """
    Called every time there is a new order book update.
    This bot aggressively buys the asset if the ask price is below 5050.
    """
    if state.ask_price > 0 and state.ask_price < 5050:
        # Buy 1 unit at the best ask price
        orders.market_buy(volume=1)
