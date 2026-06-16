const fs = require('fs');

const lines = `def on_tick(state, orders):
    """
    A simple algorithmic trading strategy
    Evaluates market mispricings against the underlying signal.
    """
    # Buy when the market is under-pricing the asset
    if state.mid_price < state.underlying_signal - 0.5:
        if state.position < 100:
            orders.market_buy(10)
            
    # Sell when the market is over-pricing the asset
    elif state.mid_price > state.underlying_signal + 0.5:
        if state.position > -100:
            orders.market_sell(10)
`.replace(/"""[\s\S]*?"""/g, '')
 .replace(/'''[\s\S]*?'''/g, '')
 .replace(/@\w+[^\n]*/g, '')
 .replace(/^from\s+\S+\s+import.*$/gm, '')
 .replace(/^import\s+.*$/gm, '')
 .replace(/^def\s+on_tick\s*\([^)]*\)\s*:/m, '/* on_tick */')
 .split('\n');

const out = [];
const indentStack = [0];
let prevWasBlockOpen = false;

const getIndent = (line) => {
    const m = line.match(/^(\s*)/);
    return m ? m[1].replace(/\t/g, '    ').length : 0;
};

for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '' || raw.trim().startsWith('#')) {
        out.push('');
        continue;
    }
    const indent = getIndent(raw);
    let line = raw.trim();

    while (indent < indentStack[indentStack.length - 1]) {
        indentStack.pop();
        const closeIndent = indentStack[indentStack.length - 1];
        out.push(' '.repeat(closeIndent) + '}');
    }

    line = line.replace(/#[^'"\n]*$/, '').trimEnd();
    if (!line) { out.push(''); continue; }

    line = line.replace(/\bTrue\b/g, 'true')
        .replace(/\bFalse\b/g, 'false')
        .replace(/\bNone\b/g, 'null')
        .replace(/\band\b/g, '&&')
        .replace(/\bor\b/g, '||')
        .replace(/\bnot\b(?!\w)/g, '!')
        .replace(/\*\*([^*])/g, '**$1');

    const isBlockOpen = /^(if|elif|else|for|while|def|try|except|finally|with)\b.*:$/.test(line);
    const isElif = /^elif\b/.test(line);
    const isElse = /^else\s*:/.test(line);
    const isExcept = /^except\b/.test(line);
    const isFinally = /^finally\s*:/.test(line);

    const pfx = ' '.repeat(indent);

    if (isElif) {
        const cond = line.replace(/^elif\s+/, '').replace(/:$/, '').trim();
        if (out.length > 0 && out[out.length - 1].trim() === '}') {
            out[out.length - 1] = out[out.length - 1] + ` else if (${cond}) {`;
        } else {
            out.push(`${pfx}} else if (${cond}) {`);
        }
        prevWasBlockOpen = true;
        indentStack.push(indent + 4);
        continue;
    }
    if (isElse) {
        if (out.length > 0 && out[out.length - 1].trim() === '}') {
            out[out.length - 1] = out[out.length - 1] + ' else {';
        } else {
            out.push(`${pfx}} else {`);
        }
        prevWasBlockOpen = true;
        indentStack.push(indent + 4);
        continue;
    }
    if (isExcept) {
        const spec = line.replace(/^except\s*/, '').replace(/:$/, '').trim();
        if (out.length > 0 && out[out.length - 1].trim() === '}') {
            out[out.length - 1] = out[out.length - 1] + ` catch(${spec || '_e'}) {`;
        } else {
            out.push(`${pfx}} catch(${spec || '_e'}) {`);
        }
        prevWasBlockOpen = true;
        indentStack.push(indent + 4);
        continue;
    }
    if (isFinally) {
        if (out.length > 0 && out[out.length - 1].trim() === '}') {
            out[out.length - 1] = out[out.length - 1] + ' finally {';
        } else {
            out.push(`${pfx}} finally {`);
        }
        prevWasBlockOpen = true;
        indentStack.push(indent + 4);
        continue;
    }

    if (isBlockOpen) {
        line = line.slice(0, -1);
        if (/^if\b/.test(line)) {
            const cond = line.replace(/^if\s+/, '').trim();
            out.push(`${pfx}if (${cond}) {`);
        } else if (/^for\b/.test(line)) {
            const m = line.match(/^for\s+(\w+)\s+in\s+range\((\d+)\)\s*$/);
            if (m) {
                out.push(`${pfx}for (let ${m[1]} = 0; ${m[1]} < ${m[2]}; ${m[1]}++) {`);
            } else {
                const m2 = line.match(/^for\s+(\w+)\s+in\s+(.+)\s*$/);
                if (m2) out.push(`${pfx}for (const ${m2[1]} of ${m2[2]}) {`);
                else out.push(`${pfx}{ /* for */ `);
            }
        } else if (/^while\b/.test(line)) {
            const cond = line.replace(/^while\s+/, '').trim();
            out.push(`${pfx}while (${cond}) {`);
        } else if (/^def\b/.test(line)) {
            out.push(`${pfx}/* def skipped */`);
            indentStack.push(indent + 4);
            prevWasBlockOpen = true;
            continue;
        } else if (/^try\b/.test(line)) {
            out.push(`${pfx}try {`);
        } else if (/^with\b/.test(line)) {
            out.push(`${pfx}{ /* with */`);
        } else {
            out.push(`${pfx}${line} {`);
        }
        indentStack.push(indent + 4);
        prevWasBlockOpen = true;
        continue;
    }

    out.push(`${pfx}${line}`);
}

while (0 < indentStack[indentStack.length - 1]) {
    indentStack.pop();
    const closeIndent = indentStack[indentStack.length - 1];
    out.push(' '.repeat(closeIndent) + '}');
}

const jsCode = out.join('\n');
console.log('--- JS ---');
console.log(jsCode);
console.log('--- TEST COMPILE ---');
try {
    new Function('state', 'orders', jsCode);
    console.log('SUCCESS');
} catch (e) {
    console.error('ERROR:', e.message);
}
