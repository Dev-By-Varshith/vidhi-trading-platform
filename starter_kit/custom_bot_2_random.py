import random
from vidhi_sdk import State, Orders

def on_tick(state: State, orders: Orders):
    """
    Called every time there is a new order book update.
    This bot randomly decides to buy or sell to test the matching engine.
    """
    if state.ask_price == 0 or state.bid_price == 0:
        return

    # Randomly decide to buy or sell
    decision = random.choice(["BUY", "SELL", "HOLD"])

    if decision == "BUY":
        orders.market_buy(volume=2)
    elif decision == "SELL":
        orders.market_sell(volume=2)
