# ── Stage 1: Build Go control plane ──────────────────────────────────────────
FROM golang:latest AS go-builder

WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o vidhi-control ./main.go

# ── Stage 2: Build C++ Game Master binary ────────────────────────────────────
FROM gcc:13-bookworm AS cpp-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        cmake \
        && rm -rf /var/lib/apt/lists/*

WORKDIR /gm
# Copy game-master source and dataset for PGO training
COPY game-master/ .
COPY data/ticks/public_99k.bin /data/ticks/public_99k.bin

# Build with aggressive Profile-Guided Optimizations (PGO)
RUN rm -rf build build_pgo CMakeCache.txt CMakeFiles \
    && cmake -B build_pgo -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_FLAGS="-fprofile-generate -O3 -march=x86-64 -std=c++20 -DVIDHI_NATIVE_BUILD" \
    && cmake --build build_pgo --target vidhi-gm --parallel $(nproc) \
    && ./build_pgo/vidhi-gm --ticks 100000 --dataset /data/ticks/public_99k.bin || true \
    && cmake -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_FLAGS="-fprofile-use -fprofile-correction -O3 -march=x86-64 -std=c++20 -DVIDHI_NATIVE_BUILD -flto" \
    && cmake --build build --target vidhi-gm --parallel $(nproc)

# ── Stage 3: Final runtime image (Go + C++ binary + Python/Numba forge) ──────
FROM python:3.11-slim-bookworm

# System deps: binutils for ELF validation (nm), file for MIME checks
RUN apt-get update && apt-get install -y --no-install-recommends \
        binutils \
        file \
        gcc \
        g++ \
        python3-dev \
        && rm -rf /var/lib/apt/lists/*

# Python forge dependencies (pinned)
COPY backend/forge/requirements.txt /tmp/forge-requirements.txt
RUN pip install --no-cache-dir -r /tmp/forge-requirements.txt

WORKDIR /app

# Go control plane binary
COPY --from=go-builder /app/vidhi-control .

# C++ Game Master binary
COPY --from=cpp-builder /gm/build/vidhi-gm ./vidhi-gm
COPY --from=cpp-builder /usr/local/lib64/libstdc++.so.6 /usr/lib/x86_64-linux-gnu/libstdc++.so.6
RUN chmod +x ./vidhi-gm

# Forge pipeline scripts
COPY backend/forge/ ./forge/

# Vidhi SDK stub (imported by contestant code, whitelisted by scanner)
COPY backend/vidhi_sdk/ ./vidhi_sdk/

# Runtime directories
RUN mkdir -p /tmp/vidhi/so /uploads/so

EXPOSE 8080

CMD ["./vidhi-control"]
