#!/bin/bash
# backend/forge/forge_cpp.sh
# Native C++ compiler pipeline for Vidhi Arena

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <input.cpp> <output.so>"
    exit 1
fi

INPUT_CPP="$1"
OUTPUT_SO="$2"

# Compile with g++ using maximum optimizations and position independent code
# The contestant's code MUST export: extern "C" void on_tick__cfunc(int64_t tick_id, int64_t* market_data, int64_t* order_out)
g++ -I/app/vidhi_sdk -O3 -march=native -shared -fPIC -Wall -Wextra -std=c++20 "$INPUT_CPP" -o "$OUTPUT_SO"

if [ $? -eq 0 ]; then
    echo "[FORGE_CPP OK] Compiled native C++ directly to $OUTPUT_SO"
    exit 0
else
    echo "[FORGE_CPP ERROR] C++ compilation failed" >&2
    exit 1
fi
