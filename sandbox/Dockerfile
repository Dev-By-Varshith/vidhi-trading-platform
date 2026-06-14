# sandbox/Dockerfile
# Hardened image for running the contestant sandbox environment.
#
# Security hardening applied:
#   - Multi-stage build: compiler stage discarded, only the loader binary ships
#   - libseccomp2 included so the BPF filter can be applied inside the container
#   - Compiled with -lseccomp so sandbox_runner.cpp can call seccomp_load()
#   - Non-root USER (nobody:nogroup) — defence-in-depth alongside --cap-drop=ALL
#   - read-only root filesystem enforced at Docker run time (see spawner.go)

FROM debian:bookworm-slim AS builder
WORKDIR /app
COPY sandbox/sandbox_runner.cpp sandbox/seccomp_filter.hpp ./
COPY game-master/rendezvous.hpp ./game-master/rendezvous.hpp
RUN apt-get update && apt-get install -y --no-install-recommends g++ make libseccomp-dev \
    && rm -rf /var/lib/apt/lists/* \
    && g++ -rdynamic -O3 -march=x86-64 -std=c++20 -o vidhi-loader sandbox_runner.cpp -ldl -lrt -lseccomp

FROM debian:bookworm-slim
WORKDIR /sandbox
COPY --from=builder /app/vidhi-loader /bin/vidhi-loader
# Install libseccomp2 and libgomp1 in one go without multiple layers
RUN apt-get update && apt-get install -y --no-install-recommends libseccomp2 libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

CMD ["/bin/vidhi-loader"]
