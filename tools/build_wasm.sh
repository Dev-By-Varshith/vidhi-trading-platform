#!/bin/bash
# Builds the Game Master C++ engine into a WASM module using Emscripten.
# Output is placed directly into the frontend's public folder.

set -e

echo "[WASM BUILD] Starting Emscripten build for Game Master..."

# Ensure we are in the root directory
cd "$(dirname "$0")/.."

# Check if emcc is available
if ! command -v emcc &> /dev/null; then
    echo "[ERROR] emcc not found. Please install Emscripten (emsdk) and activate it."
    echo "  git clone https://github.com/emscripten-core/emsdk.git"
    echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh"
    exit 1
fi

# Build directory
mkdir -p game-master/build-wasm
cd game-master/build-wasm

# Configure with emcmake
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release

# Build the WASM target
emmake make vidhi-gm-wasm -j$(nproc 2>/dev/null || echo 4)

# Copy to frontend public dir
mkdir -p ../../vidhi_context/public/wasm
cp vidhi-gm.js ../../vidhi_context/public/wasm/
cp vidhi-gm.wasm ../../vidhi_context/public/wasm/

echo "[WASM BUILD] Success! WASM module copied to vidhi_context/public/wasm/"
