# ── Stage 1: Build Go control plane ──────────────────────────────────────────
FROM golang:alpine AS go-builder
WORKDIR /app
COPY backend/ .
RUN go mod download && CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o vidhi-control ./main.go

# ── Stage 2: Build C++ Game Master binary ────────────────────────────────────
FROM debian:bookworm-slim AS cpp-builder
WORKDIR /gm
COPY game-master/ .
RUN apt-get update && apt-get install -y --no-install-recommends g++ make cmake && rm -rf /var/lib/apt/lists/* \
    && rm -rf build CMakeCache.txt CMakeFiles \
    && cmake -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_FLAGS="-O3 -march=x86-64 -std=c++20 -DVIDHI_NATIVE_BUILD" \
    && cmake --build build --target vidhi-gm --parallel $(nproc)

# ── Stage 3: Final runtime image (Go + C++ binary + Python/Numba forge) ──────
FROM python:3.11-slim-bookworm
WORKDIR /app

# Combine system deps and python deps into a single RUN layer to save space
COPY backend/forge/ ./forge/
COPY backend/vidhi_sdk/ ./vidhi_sdk/
COPY --from=go-builder /app/vidhi-control .
COPY --from=cpp-builder /gm/build/vidhi-gm ./vidhi-gm
COPY --from=cpp-builder /gm/build/vidhi-loader ./vidhi-loader
COPY backend/data/ ./data/
# Don't try to copy libstdc++.so.6 from builder, just install it via apt to avoid missing path errors
RUN apt-get update && apt-get install -y --no-install-recommends \
        binutils file gcc g++ python3-dev libstdc++6 \
    && pip install --no-cache-dir -r forge/requirements.txt \
    && rm -rf /var/lib/apt/lists/* \
    && chmod +x ./vidhi-gm ./vidhi-loader \
    && mkdir -p /tmp/vidhi/so /uploads/so

EXPOSE 8080
CMD ["./vidhi-control"]
