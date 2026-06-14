#!/usr/bin/env python3
"""
backend/forge/test_scanner.py — Unit tests for the AST security scanner.
Run with: python3 -m pytest test_scanner.py -v

Tests cover:
  - All banned import paths
  - All banned builtins
  - The type() sandbox escape vector (FIX #12)
  - Dunder attribute access
  - global statement ban
  - Valid EMA algorithm accepted cleanly
  - Signature validation
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scanner import scan

# ─── Helper ──────────────────────────────────────────────────────────────────

def errors_from(code: str) -> list[str]:
    import tempfile, os
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
        f.write(code)
        path = f.name
    try:
        return scan(path)
    finally:
        os.unlink(path)

def assert_clean(code: str):
    errs = errors_from(code)
    assert errs == [], f"Expected clean but got: {errs}"

def assert_blocked(code: str, keyword: str = ''):
    errs = errors_from(code)
    assert len(errs) > 0, f"Expected violation for:\n{code}"
    if keyword:
        combined = ' '.join(errs)
        assert keyword.lower() in combined.lower(), \
            f"Expected keyword '{keyword}' in errors: {errs}"

# ─── Section 1: Valid submission passes ───────────────────────────────────────

VALID_EMA_ALGO = """
from vidhi_sdk import *

def on_tick(state, orders):
    state.ema_fast = 0.97 * state.ema_fast + 0.03 * state.bid_price
    if state.bid_price > state.ema_fast * 1.001:
        orders.market_buy(10)
    elif state.bid_price < state.ema_fast * 0.999:
        orders.market_sell(10)
"""

def test_valid_ema_algorithm_passes():
    assert_clean(VALID_EMA_ALGO)

def test_valid_algorithm_with_math_import():
    code = """
from vidhi_sdk import *
import math

def on_tick(state, orders):
    spread = state.ask_price - state.bid_price
    if math.log1p(spread) > 0.001:
        orders.limit_buy(state.bid_price - 0.01, 5)
"""
    assert_clean(code)

# ─── Section 2: Banned imports ────────────────────────────────────────────────

@pytest.mark.parametrize("module", [
    "os", "sys", "socket", "subprocess", "threading",
    "multiprocessing", "ctypes", "importlib", "pickle",
    "http", "urllib", "requests", "asyncio", "concurrent",
    "signal", "fcntl", "mmap", "struct", "io",
    "pathlib", "shutil", "tempfile", "glob",
    "inspect", "dis", "gc", "weakref", "tracemalloc",
])
def test_banned_import(module):
    code = f"""
import {module}
def on_tick(state, orders): pass
"""
    assert_blocked(code, module)

@pytest.mark.parametrize("module", [
    "os", "sys", "socket", "subprocess", "pickle",
])
def test_banned_from_import(module):
    code = f"""
from {module} import *
def on_tick(state, orders): pass
"""
    assert_blocked(code, module)

def test_numba_direct_import_blocked():
    code = """
import numba
def on_tick(state, orders): pass
"""
    assert_blocked(code, 'numba')

def test_vidhi_sdk_import_allowed():
    code = """
from vidhi_sdk import *
def on_tick(state, orders): pass
"""
    assert_clean(code)

# ─── Section 3: Banned builtins ───────────────────────────────────────────────

@pytest.mark.parametrize("builtin_call", [
    "eval('1+1')",
    "exec('x=1')",
    "compile('x=1', '<string>', 'exec')",
    "__import__('os')",
    "open('/etc/passwd')",
    "input('prompt')",
    "memoryview(b'hello')",
    "vars()",
    "dir()",
    "globals()",
    "locals()",
    "getattr(object, '__class__')",
    "setattr(object, 'x', 1)",
    "delattr(object, 'x')",
    "hasattr(object, '__class__')",
    "breakpoint()",
])
def test_banned_builtin_call(builtin_call):
    code = f"""
def on_tick(state, orders):
    x = {builtin_call}
"""
    assert_blocked(code)

# ─── Section 4: type() sandbox escape (FIX #12) ────────────────────────────

def test_type_builtin_blocked():
    """type(()) gives access to object.__subclasses__() → sandbox escape."""
    code = """
def on_tick(state, orders):
    t = type(())
"""
    assert_blocked(code, 'type')

def test_type_class_escape_attempt_blocked():
    """Full escape chain should be blocked at the type() call."""
    code = """
def on_tick(state, orders):
    subclasses = type(()).__bases__[0].__subclasses__()
    for c in subclasses:
        if 'wrap' in c.__name__:
            c.__init__.__globals__['__builtins__']['eval']('import os')
"""
    assert_blocked(code)  # blocked at: type(), __bases__, __subclasses__, __globals__

# ─── Section 5: Dunder attribute access ───────────────────────────────────────

@pytest.mark.parametrize("dunder", [
    "__class__", "__bases__", "__mro__", "__subclasses__",
    "__globals__", "__builtins__", "__dict__", "__code__",
])
def test_banned_dunder_attribute(dunder):
    code = f"""
def on_tick(state, orders):
    x = state.{dunder}
"""
    assert_blocked(code, dunder)

def test_dunder_method_call_blocked():
    code = """
def on_tick(state, orders):
    state.__class__()
"""
    assert_blocked(code)

# ─── Section 6: global statement banned ───────────────────────────────────────

def test_global_statement_blocked():
    code = """
counter = 0

def on_tick(state, orders):
    global counter
    counter += 1
"""
    assert_blocked(code, 'global')

# ─── Section 7: Signature validation ─────────────────────────────────────────

def test_missing_on_tick_function_blocked():
    code = """
from vidhi_sdk import *

def my_strategy(state, orders):
    orders.market_buy(10)
"""
    assert_blocked(code, 'on_tick')

def test_on_tick_missing_state_arg_blocked():
    code = """
def on_tick(orders):
    orders.market_buy(10)
"""
    assert_blocked(code, 'state')

def test_on_tick_missing_orders_arg_blocked():
    code = """
def on_tick(state):
    pass
"""
    assert_blocked(code, 'orders')

def test_on_tick_correct_signature_passes():
    code = """
def on_tick(state, orders):
    pass
"""
    assert_clean(code)

# ─── Section 8: Syntax error handling ────────────────────────────────────────

def test_syntax_error_returns_error():
    code = """
def on_tick(state orders):  # missing comma
    pass
"""
    errs = errors_from(code)
    assert len(errs) == 1
    assert 'syntax' in errs[0].lower() or 'error' in errs[0].lower()

def test_empty_file_missing_on_tick():
    errs = errors_from("")
    assert any('on_tick' in e for e in errs)

# ─── Section 9: Advanced bypass attempts ─────────────────────────────────────

def test_chr_builtin_blocked():
    """chr() can be used to build banned strings character by character."""
    code = """
def on_tick(state, orders):
    s = chr(111) + chr(115)  # builds 'os'
    m = __import__(s)
"""
    assert_blocked(code)  # blocked at: chr(), __import__()

def test_format_bypass_blocked():
    """format() used to call __format__ dunder."""
    code = """
def on_tick(state, orders):
    x = format(state, '__class__')
"""
    assert_blocked(code)  # blocked at: format()

def test_nonlocal_is_allowed():
    """nonlocal is legitimate for nested function state \u2014 should pass."""
    code = """
def on_tick(state, orders):
    x = [0]
    def inner():
        nonlocal x
        x[0] += 1
    inner()
"""
    assert_clean(code)

if __name__ == '__main__':
    pytest.main([__file__, '-v'])
