#!/usr/bin/env python3
"""
forge/scanner.py — AST Security Scanner
Validates contestant code before compilation.
Exits 0 if safe, exits 1 with error message if violation found.
Called by Go: python3 scanner.py <path_to_trader.py>
"""
import ast
import sys
import os

# ─── Banned identifiers ───────────────────────────────────────────────────────
BANNED_IMPORTS = {
    'os', 'sys', 'socket', 'subprocess', 'threading', 'multiprocessing',
    'ctypes', 'importlib', 'pickle', 'shelve', 'http', 'urllib', 'requests',
    'asyncio', 'concurrent', 'signal', 'fcntl', 'mmap', 'struct',
    'io', 'pathlib', 'shutil', 'tempfile', 'glob', 'fnmatch',
    'inspect', 'dis', 'gc', 'weakref', 'tracemalloc',
}

BANNED_BUILTINS = {
    'eval', 'exec', 'compile', '__import__', 'open', 'input',
    'print', 'breakpoint', 'memoryview', 'vars', 'dir',
    'globals', 'locals', 'getattr', 'setattr', 'delattr', 'hasattr',
    # FIX #12: type() enables sandbox escape via type(()).__subclasses__()
    # which reaches os._wrap_close and allows arbitrary code execution.
    # Contestants have no legitimate use for type() — they should use
    # isinstance() instead (which is safe and not banned).
    'type',
    # Additional reflection / code-generation builtins
    'chr', 'ord',   # can be used to construct banned strings character-by-character
    'format',       # can be used with __format__ dunder to bypass attribute checks
    'id',           # exposes memory addresses (minor info leak)
}

ALLOWED_MODULES = {
    'math', 'random',  # safe stdlib — no I/O, no network, no unsafe memory access
    # NOTE: 'numba' is intentionally EXCLUDED. The transpiler injects @numba.cfunc
    # automatically — contestants must not import numba directly.
    # numba internals (numba.core.unsafe, numba.typed, numba.cuda) are exploitable.
}

REQUIRED_FUNCTION = 'on_tick'
REQUIRED_ARGS     = {'state', 'orders'}

class SecurityVisitor(ast.NodeVisitor):
    def __init__(self):
        self.errors = []

    def visit_Import(self, node):
        for alias in node.names:
            top = alias.name.split('.')[0]
            if top not in ALLOWED_MODULES:
                self.errors.append(f"Line {node.lineno}: Banned import '{alias.name}'")
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        if node.module:
            top = node.module.split('.')[0]
            if top not in ALLOWED_MODULES and node.module != 'vidhi_sdk':
                self.errors.append(f"Line {node.lineno}: Banned import 'from {node.module}'")
        self.generic_visit(node)

    def visit_Call(self, node):
        # Check for banned builtins
        if isinstance(node.func, ast.Name):
            if node.func.id in BANNED_BUILTINS:
                self.errors.append(f"Line {node.lineno}: Banned call '{node.func.id}()'")
        # Check for __dunder__ attribute access used as calls
        if isinstance(node.func, ast.Attribute):
            if node.func.attr.startswith('__') and node.func.attr.endswith('__'):
                self.errors.append(f"Line {node.lineno}: Banned dunder call '{node.func.attr}'")
        self.generic_visit(node)

    def visit_Attribute(self, node):
        # No accessing __class__, __bases__, __mro__, etc.
        if node.attr.startswith('__') and node.attr.endswith('__'):
            dangerous = {'__class__', '__bases__', '__mro__', '__subclasses__',
                         '__globals__', '__builtins__', '__dict__', '__code__'}
            if node.attr in dangerous:
                self.errors.append(f"Line {node.lineno}: Banned attribute access '{node.attr}'")
        self.generic_visit(node)

    def visit_Global(self, node):
        self.errors.append(f"Line {node.lineno}: 'global' statement is not allowed")

    def visit_Nonlocal(self, node):
        # nonlocal is fine — it's for nested function state
        self.generic_visit(node)


def check_signature(tree):
    """Ensure on_tick(state, orders) exists with correct signature."""
    errors = []
    found  = False
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == REQUIRED_FUNCTION:
            found = True
            arg_names = {a.arg for a in node.args.args}
            missing   = REQUIRED_ARGS - arg_names
            if missing:
                errors.append(f"on_tick() missing required arguments: {missing}")
            break
    if not found:
        errors.append(f"Missing required function '{REQUIRED_FUNCTION}(state, orders)'")
    return errors


def scan(path: str) -> list[str]:
    try:
        with open(path, 'r', encoding='utf-8') as f:
            source = f.read()
    except Exception as e:
        return [f"Could not read file: {e}"]

    try:
        tree = ast.parse(source, filename=path)
    except SyntaxError as e:
        return [f"Syntax error at line {e.lineno}: {e.msg}"]

    visitor = SecurityVisitor()
    visitor.visit(tree)
    sig_errors = check_signature(tree)
    return visitor.errors + sig_errors


if __name__ == '__main__':
    import json

    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "errors": ["Usage: scanner.py <trader.py>"], "first_error": "no input file"}))
        sys.exit(1)

    errors = scan(sys.argv[1])
    if errors:
        result = {
            "ok":          False,
            "errors":      errors,
            "first_error": errors[0],
        }
        print(json.dumps(result))
        sys.exit(1)

    print(json.dumps({"ok": True, "errors": []}))
    sys.exit(0)
