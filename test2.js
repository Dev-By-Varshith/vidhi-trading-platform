const fs = require('fs');
const code = fs.readFileSync('vidhi_context/src/engine/simulation.worker.js', 'utf8');
const start = code.indexOf('function pythonToJs(pythonCode) {');
const end = code.indexOf('self.onmessage =');
const fn = code.substring(start, end);
eval(fn);

const testCode = `def on_tick(state, orders):
    short_window = 10
    long_window = 50
    if len(state.history) < long_window:
        return
    short_mavg = sum(state.history[-short_window:]) / short_window
    long_mavg = sum(state.history[-long_window:]) / long_window
    if short_mavg > long_mavg:
        if state.position < 100:
            orders.market_buy(10)
    elif short_mavg < long_mavg:
        if state.position > -100:
            orders.market_sell(10)
`;

console.log("Transpiled JS:\n" + pythonToJs(testCode));

try {
    new Function('state', 'orders', pythonToJs(testCode));
    console.log("SUCCESS");
} catch(e) {
    console.log("ERROR: " + e.message);
}
