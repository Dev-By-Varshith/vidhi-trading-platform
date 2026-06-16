const code = `def on_tick(state, orders):
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

let jsCode = code
  .replace(/@\w+[^\n]*/g, '')
  .replace(/^from\s+\S+\s+import.*$/gm, '')
  .replace(/^import\s+.*$/gm, '')
  .replace(/^def\s+on_tick\s*\([^)]*\)\s*:/m, '/* on_tick */');

jsCode = jsCode
  .replace(/\bTrue\b/g, 'true')
  .replace(/\bFalse\b/g, 'false')
  .replace(/\bNone\b/g, 'null')
  .replace(/\band\b/g, '&&')
  .replace(/\bor\b/g, '||')
  .replace(/\bnot\b(?!\w)/g, '!')
  .replace(/\*\*([^*])/g, '**$1');

console.log('Transpiled JS code:\n' + jsCode);

try {
  new Function('state', 'orders', jsCode);
  console.log('SUCCESS');
} catch (e) {
  console.error('ERROR: ' + e.message);
}
