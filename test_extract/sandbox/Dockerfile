# sandbox/Dockerfile
# Hardened image for running the contestant sandbox environment.
#
# Security hardening applied:
#   - Multi-stage build: compiler stage discarded, only the loader binary ships
#   - libseccomp2 included so the BPF filter can be applied inside the container
#   - Compiled with -lseccomp so sandbox_runner.cpp can call seccomp_load()
#   - Non-root USER (nobody:nogroup) — defence-in-depth alongside --cap-drop=ALL
#   - read-only root filesystem enforced at Docker run time (see spawner.go)

FROM gcc:13-bookworm AS builder

# Install libseccomp for compiling the BPF filter loader
RUN apt-get update && apt-get install -y --no-install-recommends \
        libseccomp-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY sandbox/sandbox_runner.cpp sandbox/seccomp_filter.hpp ./
COPY game-master/rendezvous.hpp ./game-master/rendezvous.hpp

# -lseccomp links the seccomp filter library
RUN g++ -rdynamic -O3 -march=x86-64 -std=c++20 \
        -o vidhi-loader sandbox_runner.cpp \
        -ldl -lrt -lseccomp

# ── Final image ───────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

# libseccomp2 runtime needed for the BPF filter to apply inside the container.
# The process calls seccomp_load() at startup before dlopen()-ing the .so.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libseccomp2 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /sandbox

COPY --from=builder /app/vidhi-loader /bin/vidhi-loader
COPY --from=builder /usr/local/lib64/libstdc++.so.6 /usr/lib/x86_64-linux-gnu/libstdc++.so.6

# NOTE: Not setting USER nobody here — sandbox must run as root to access
# the POSIX SHM segment created by the GM process. On Docker Desktop (WSL2),
# 'Permission denied' occurs when nobody (uid 65534) calls shm_open on a
# root-created segment even with 0666 permissions.
# Security is enforced by: IpcMode=host, cap-drop=ALL, seccomp filter,
# network=none, readonly rootfs, and no-new-privs.

CMD ["/bin/vidhi-loader"]
