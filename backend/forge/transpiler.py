#!/usr/bin/env python3
"""
forge/transpiler.py — AST Transpiler Shim
Transforms contestant's clean on_tick(state, orders) API
into the raw Numba cfunc signature:
    on_tick__cfunc(int64 tick_id, int64* market_data, int64* order_out)
All state.* accesses are rewritten as array index reads.
All orders.* calls are rewritten as array index writes.
Called by Go: python3 transpiler.py <raw.py> <transformed.py>
"""
import ast
import sys

# ─── Memory layout (must match rendezvous.hpp SharedMem layout) ──────────────
# market_data[] (read-only, 64 slots of int64 fixed-point)
MARKET_DATA_SLOTS = {
    'bid_price':         0,   # × 1e6 fixed-point
    'ask_price':         1,
    'mid_price':         2,
    'spread':            3,
    'last_trade_price':  4,
    'last_trade_volume': 5,
    'underlying_signal': 6,
    'volatility':        7,
    # bid_depth / ask_depth are array calls handled natively
    'position':          29,   # signed int64
    'cash':              30,   # × 1e6 fixed-point (microdollars)
    'pnl':               31,   # × 1e6 fixed-point (microdollars)
    'fill_count':        33,
    # fills[0..3]: [order_id, price_fp, volume, side]
    'fill0_price':       35,
    'fill0_volume':      36,
    'fill0_side':        37,
    'fill1_price':       39,
    'fill1_volume':      40,
    'fill1_side':        41,
    'fill2_price':       43,
    'fill2_volume':      44,
    'fill2_side':        45,
    'fill3_price':       47,
    'fill3_volume':      48,
    'fill3_side':        49,
}

# order_out[] (write, 64 slots)
ORDER_OUT_SLOTS = {
    'order_count':     0,   # how many orders (0-4)
    # order 0: [type, price, vol, id]
    'o0_type':         1,   
    'o0_price':        2,   
    'o0_volume':       3,
    'o0_id':           4,   
    # order 1
    'o1_type':         5,
    'o1_price':        6,
    'o1_volume':       7,
    'o1_id':           8,
    # order 2
    'o2_type':         9,
    'o2_price':       10,
    'o2_volume':      11,
    'o2_id':          12,
    # order 3
    'o3_type':        13,
    'o3_price':       14,
    'o3_volume':      15,
    'o3_id':          16,
    # persistent state (16 slots, preserved between ticks)
    'ema_fast':       48,
    'ema_slow':       49,
    'tick_count':     50,
    'my_position':    51,
    's0': 52, 's1': 53, 's2': 54, 's3': 55,
    's4': 56, 's5': 57, 's6': 58, 's7': 59,
}

FIXED_POINT = 1_000_000  # 1e6

class OrdersProxy:
    """Represents the orders.* call → array write transformation."""
    pass

class TranspilerVisitor(ast.NodeTransformer):
    """Rewrites the AST of on_tick to use raw array accesses."""

    def __init__(self):
        self.state_param  = 'state'
        self.orders_param = 'orders'
        self.order_idx    = 0  # tracks which order slot we're writing

    def _market_read(self, field: str, lineno: int):
        """state.field → int64_to_float(market_data[SLOT])"""
        if field == 'bid_depth':
            node = ast.Call(
                func=ast.Name(id='get_bid_depth', ctx=ast.Load()),
                args=[ast.Name(id='_md', ctx=ast.Load())],
                keywords=[]
            )
            ast.copy_location(node, ast.parse('x').body[0].value)
            node.lineno = lineno
            node.col_offset = 0
            return node
        elif field == 'ask_depth':
            node = ast.Call(
                func=ast.Name(id='get_ask_depth', ctx=ast.Load()),
                args=[ast.Name(id='_md', ctx=ast.Load())],
                keywords=[]
            )
            ast.copy_location(node, ast.parse('x').body[0].value)
            node.lineno = lineno
            node.col_offset = 0
            return node

        slot = MARKET_DATA_SLOTS.get(field)
        if slot is not None:
            node = ast.BinOp(
                left=ast.Subscript(
                    value=ast.Name(id='_md', ctx=ast.Load()),
                    slice=ast.Constant(value=slot),
                    ctx=ast.Load()
                ),
                op=ast.Div(),
                right=ast.Constant(value=float(FIXED_POINT))
            )
            ast.copy_location(node, ast.parse('x').body[0].value)
            node.lineno = lineno
            node.col_offset = 0
            return node

        slot = ORDER_OUT_SLOTS.get(field)
        if slot is not None:
            node = ast.BinOp(
                left=ast.Subscript(
                    value=ast.Name(id='_oo', ctx=ast.Load()),
                    slice=ast.Constant(value=slot),
                    ctx=ast.Load()
                ),
                op=ast.Div(),
                right=ast.Constant(value=float(FIXED_POINT))
            )
            ast.copy_location(node, ast.parse('x').body[0].value)
            node.lineno = lineno
            node.col_offset = 0
            return node

        raise ValueError(f"Unknown state field: '{field}'")

    def _state_write(self, field: str, value_node: ast.expr, lineno: int):
        """state.field = x → _oo[SLOT] = int(x * FIXED_POINT)"""
        slot = ORDER_OUT_SLOTS.get(field)
        if slot is None:
            # Unknown field — just emit a comment (no-op)
            return ast.Pass()
        target = ast.Subscript(
            value=ast.Name(id='_oo', ctx=ast.Store()),
            slice=ast.Constant(value=slot),
            ctx=ast.Store()
        )
        value = ast.Call(
            func=ast.Name(id='int', ctx=ast.Load()),
            args=[ast.BinOp(left=value_node, op=ast.Mult(), right=ast.Constant(value=float(FIXED_POINT)))],
            keywords=[]
        )
        assign = ast.Assign(targets=[target], value=value)
        assign.lineno = lineno; assign.col_offset = 0
        return assign

    def visit_Attribute(self, node):
        """Rewrite state.X reads and state.X writes."""
        self.generic_visit(node)
        if isinstance(node.value, ast.Name) and node.value.id == self.state_param:
            if isinstance(node.ctx, ast.Load):
                return self._market_read(node.attr, node.lineno)
        return node

    def visit_Assign(self, node):
        """Rewrite state.X = Y assignments."""
        self.generic_visit(node)
        if (len(node.targets) == 1 and
            isinstance(node.targets[0], ast.Attribute) and
            isinstance(node.targets[0].value, ast.Name) and
            node.targets[0].value.id == self.state_param):
            field = node.targets[0].attr
            return self._state_write(field, node.value, node.lineno)
        return node

    def visit_Call(self, node):
        """Rewrite orders.limit_buy(p, v) etc. → _oo writes."""
        self.generic_visit(node)
        if (isinstance(node.func, ast.Attribute) and
            isinstance(node.func.value, ast.Name) and
            node.func.value.id == self.orders_param):

            method = node.func.attr
            idx    = self.order_idx
            base   = 1 + idx * 4  # slot for o{idx}_type
            self.order_idx = (idx + 1) % 4

            stmts = []
            if method == 'limit_buy' and len(node.args) >= 2:
                stmts = self._emit_order(base, 1, node.args[0], node.args[1], node.lineno)
            elif method == 'limit_sell' and len(node.args) >= 2:
                stmts = self._emit_order(base, 2, node.args[0], node.args[1], node.lineno)
            elif method == 'market_buy' and len(node.args) >= 1:
                stmts = self._emit_order(base, 3, ast.Constant(value=0.0), node.args[0], node.lineno)
            elif method == 'market_sell' and len(node.args) >= 1:
                stmts = self._emit_order(base, 4, ast.Constant(value=0.0), node.args[0], node.lineno)
            elif method == 'cancel' and len(node.args) >= 1:
                stmts = self._emit_cancel(base, node.args[0], node.lineno)

            if stmts:
                # Increment order_count
                inc = ast.AugAssign(
                    target=ast.Subscript(value=ast.Name(id='_oo', ctx=ast.Store()),
                                         slice=ast.Constant(value=0), ctx=ast.Store()),
                    op=ast.Add(),
                    value=ast.Constant(value=1)
                )
                inc.lineno = node.lineno; inc.col_offset = 0
                # Return a placeholder — caller must handle stmt list
                node._transpiled_stmts = [inc] + stmts
            return node
        return node

    def _emit_order(self, base, otype, price_node, vol_node, lineno):
        def make_assign(slot, value):
            a = ast.Assign(
                targets=[ast.Subscript(value=ast.Name(id='_oo', ctx=ast.Store()),
                                       slice=ast.Constant(value=slot), ctx=ast.Store())],
                value=value
            )
            a.lineno = lineno; a.col_offset = 0
            return a

        return [
            make_assign(base,   ast.Constant(value=otype)),
            make_assign(base+1, ast.Call(func=ast.Name(id='int', ctx=ast.Load()),
                                         args=[ast.BinOp(left=price_node, op=ast.Mult(),
                                                          right=ast.Constant(value=float(FIXED_POINT)))],
                                         keywords=[])),
            make_assign(base+2, ast.Call(func=ast.Name(id='int', ctx=ast.Load()),
                                         args=[vol_node], keywords=[])),
            make_assign(base+3, ast.Constant(value=0)),
        ]

    def visit_Expr(self, node):
        self.generic_visit(node)
        if hasattr(node.value, '_transpiled_stmts'):
            return node.value._transpiled_stmts
        return node

    def visit_For(self, node):
        self.generic_visit(node)
        # Check if iterating over state.fills
        if isinstance(node.iter, ast.Attribute) and isinstance(node.iter.value, ast.Name):
            if node.iter.value.id == self.state_param and node.iter.attr == 'fills':
                if isinstance(node.target, ast.Name):
                    fill_var = node.target.id
                    
                    # Create `range(int(_md[11]))`
                    range_call = ast.Call(
                        func=ast.Name(id='range', ctx=ast.Load()),
                        args=[ast.Call(
                            func=ast.Name(id='int', ctx=ast.Load()),
                            args=[ast.Subscript(
                                value=ast.Name(id='_md', ctx=ast.Load()),
                                slice=ast.Constant(value=11),
                                ctx=ast.Load()
                            )],
                            keywords=[]
                        )],
                        keywords=[]
                    )
                    
                    # Create `fill = Fill(...)`
                    fill_assign = ast.Assign(
                        targets=[ast.Name(id=fill_var, ctx=ast.Store())],
                        value=ast.Call(
                            func=ast.Name(id='Fill', ctx=ast.Load()),
                            args=[
                                ast.BinOp(
                                    left=ast.Subscript(
                                        value=ast.Name(id='_md', ctx=ast.Load()),
                                        slice=ast.BinOp(
                                            left=ast.Constant(value=12),
                                            op=ast.Add(),
                                            right=ast.BinOp(left=ast.Name(id='_f_idx', ctx=ast.Load()), op=ast.Mult(), right=ast.Constant(value=6))
                                        ),
                                        ctx=ast.Load()
                                    ),
                                    op=ast.Div(),
                                    right=ast.Constant(value=float(FIXED_POINT))
                                ),
                                ast.Subscript(
                                    value=ast.Name(id='_md', ctx=ast.Load()),
                                    slice=ast.BinOp(
                                        left=ast.Constant(value=14),
                                        op=ast.Add(),
                                        right=ast.BinOp(left=ast.Name(id='_f_idx', ctx=ast.Load()), op=ast.Mult(), right=ast.Constant(value=6))
                                    ),
                                    ctx=ast.Load()
                                ),
                                ast.Subscript(
                                    value=ast.Name(id='_md', ctx=ast.Load()),
                                    slice=ast.BinOp(
                                        left=ast.Constant(value=16),
                                        op=ast.Add(),
                                        right=ast.BinOp(left=ast.Name(id='_f_idx', ctx=ast.Load()), op=ast.Mult(), right=ast.Constant(value=6))
                                    ),
                                    ctx=ast.Load()
                                )
                            ],
                            keywords=[]
                        )
                    )
                    
                    node.iter = range_call
                    node.target = ast.Name(id='_f_idx', ctx=ast.Store())
                    node.body.insert(0, fill_assign)
                    ast.fix_missing_locations(node)
        return node

    def _emit_cancel(self, base, order_id_node, lineno):
        def make_assign(slot, value):
            a = ast.Assign(
                targets=[ast.Subscript(value=ast.Name(id='_oo', ctx=ast.Store()),
                                       slice=ast.Constant(value=slot), ctx=ast.Store())],
                value=value
            )
            a.lineno = lineno; a.col_offset = 0
            return a
        return [
            make_assign(base,   ast.Constant(value=5)),   # CANCEL type
            make_assign(base+1, ast.Constant(value=0)),
            make_assign(base+2, ast.Constant(value=0)),
            make_assign(base+3, order_id_node),
        ]


def _make_assign(name: str, value_name: str, lineno: int) -> ast.Assign:
    """Build:  name = value_name  (both as Name nodes)"""
    node = ast.Assign(
        targets=[ast.Name(id=name, ctx=ast.Store())],
        value=ast.Name(id=value_name, ctx=ast.Load()),
    )
    node.lineno = lineno; node.col_offset = 0
    ast.fix_missing_locations(node)
    return node


def transpile(source: str) -> str:
    """Return transformed Python source with raw array accesses.

    Pipeline:
      1. Parse original source into AST.
      2. Rename on_tick → on_tick__impl; replace args (state, orders) with
         (_state_unused, _orders_unused) so they don't shadow internal names.
      3. Inject two assignment stmts at the top of the function body:
             _md = market_data   # raw int64* (read-only)
             _oo = order_out     # raw int64* (read-write)
         The Numba cfunc wrapper passes these as positional args named exactly
         market_data / order_out so the injected assignments bind them to the
         short names used throughout the transformed body.
      4. Run TranspilerVisitor to rewrite state.X reads and orders.*(…) calls
         into _md[slot] / _oo[slot] array accesses.
      5. Unparse back to source text.
    """
    tree = ast.parse(source)
    transformer = TranspilerVisitor()

    # ── Step 1: Find and rename on_tick ──────────────────────────────────────
    target_fn = None
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == 'on_tick':
            target_fn = node
            break

    if target_fn is None:
        raise ValueError("Required function 'on_tick(state, orders)' not found")

    target_fn.name = 'on_tick__impl'
    
    # Ensure it gets JIT compiled so the cfunc wrapper can call it
    njit_dec = ast.parse("@numba.njit(inline='always')\ndef f(): pass").body[0].decorator_list[0]
    target_fn.decorator_list.insert(0, njit_dec)

    # Rename original parameters so they don't collide with injected names
    for arg in target_fn.args.args:
        if arg.arg == 'state':  arg.arg = '_state_unused'
        if arg.arg == 'orders': arg.arg = '_orders_unused'

    # ── Step 2: Add new parameters _md and _oo (raw array args from cfunc) ──
    # Replace the argument list entirely: on_tick__impl(_md, _oo)
    start_lineno = target_fn.lineno
    target_fn.args.args = [
        ast.arg(arg='_md', annotation=None, lineno=start_lineno, col_offset=4),
        ast.arg(arg='_oo', annotation=None, lineno=start_lineno, col_offset=8),
    ]
    target_fn.args.defaults      = []
    target_fn.args.kwonlyargs    = []
    target_fn.args.kw_defaults   = []
    target_fn.args.posonlyargs   = []

    # ── Step 3: Inject _md / _oo bindings at top of function body ────────────
    # These are identity assignments so the transformer's _md/_oo references
    # resolve even if Numba later rewrites argument names in the wrapper.
    # (No-ops at the Python level but make the name → array binding explicit.)
    inject_md = _make_assign('_md', '_md', start_lineno + 1)
    inject_oo = _make_assign('_oo', '_oo', start_lineno + 2)
    target_fn.body = [inject_md, inject_oo] + target_fn.body

    # ── Step 4: Rewrite state.X and orders.*() throughout ────────────────────
    transformer.visit(tree)
    ast.fix_missing_locations(tree)

    # Step 5: Unparse to source
    header = (
        "# AUTO-GENERATED by forge/transpiler.py - DO NOT EDIT\n"
        "# state.* -> _md[slot] / 1e6  |  orders.*() -> _oo[slot] writes\n\n"
    )
    try:
        return header + ast.unparse(tree)
    except AttributeError:
        # Python < 3.9
        import astunparse
        return header + astunparse.unparse(tree)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: transpiler.py <input.py> <output.py>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        source = f.read()

    try:
        transformed = transpile(source)
    except Exception as e:
        print(f"[TRANSPILE ERROR] {e}", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        f.write(transformed)

    print(f"[TRANSPILE OK] {sys.argv[1]} -> {sys.argv[2]}")
    sys.exit(0)
