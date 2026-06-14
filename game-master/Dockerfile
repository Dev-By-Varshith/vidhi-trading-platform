# Dockerfile for the contestant sandbox container
# This is a minimal image that only contains:
#   - The compiled vidhi-gm binary (Game Master)
#   - The shared memory / dlopen runtime
# The contestant's .so is bind-mounted in at runtime (read-only)
# Network access is disabled by the spawner (--network=none)

FROM ubuntu:22.04 AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake libpthread-stubs0-dev \
        && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY . .

# Build the Game Master binary
RUN cmake -DCMAKE_BUILD_TYPE=Release -B build . && \
    cmake --build build --target vidhi-gm -j$(nproc)

# ── Minimal runtime image ─────────────────────────────────────────────────────
FROM ubuntu:22.04-minimal 2>/dev/null || FROM ubuntu:22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 \
        && rm -rf /var/lib/apt/lists/*

# Create sandbox user (non-root, no shell)
RUN useradd -r -s /bin/false -u 65534 sandbox

# Copy binary
COPY --from=builder /build/build/vidhi-gm /vidhi-gm
RUN chmod 555 /vidhi-gm

# Sandbox dir where .so will be bind-mounted
RUN mkdir -p /sandbox && chown sandbox:sandbox /sandbox

USER sandbox
WORKDIR /sandbox

# The entrypoint is overridden by the spawner (--cmd flag)
ENTRYPOINT ["/vidhi-gm"]
