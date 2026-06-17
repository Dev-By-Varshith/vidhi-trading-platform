const fs = require('fs');
const workerCode = fs.readFileSync('worker.js', 'utf8');

const match = workerCode.match(/_transpile\(e\)\{[\s\S]*?return \w+\.join\([^)]+\)/);

if (match) {
    const transpilerFnStr = match[0] + '}';
    const code = `def on_tick(state, orders):
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
`;

    try {
        const fn = new Function('e', 'var _transpile = ' + transpilerFnStr.replace('_transpile(e)', 'function(e)') + ';\nreturn _transpile.call(this, e);');
        const jsCode = fn.call({_transpile: fn}, code);
        console.log("JS CODE:\n" + jsCode);
        
        try {
            new Function('state', 'orders', jsCode);
            console.log("Function compilation successful.");
        } catch (err) {
            console.error("Function compilation failed:", err.message);
        }
    } catch(err) {
        console.error("Transpiler evaluation failed:", err);
    }
} else {
    console.log("Transpiler not found");
}
