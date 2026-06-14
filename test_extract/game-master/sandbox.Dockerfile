# game-master/sandbox.Dockerfile
# Minimal execution environment for contestant code (.so)
FROM gcc:13-bookworm AS loader-builder

WORKDIR /src
# Copy loader and all headers it depends on
COPY loader.cpp rendezvous.hpp seccomp_filter.hpp ./
# Build the loader with aggressive optimizations, link librt for shm_open, libdl for dlopen
RUN g++ -O2 -march=native -std=c++17 -o vidhi-loader loader.cpp -ldl -lrt

# Final Stage: The absolute minimum required to run the loader and the .so
FROM debian:bookworm-slim

# Install libgomp for OpenMP support if numba compiled with it
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 \
        && rm -rf /var/lib/apt/lists/*

WORKDIR /sandbox

COPY --from=loader-builder /src/vidhi-loader /bin/vidhi-loader

# The .so will be mounted into /uploads/so by the Go Orchestrator
# The /dev/shm rings will be mapped by Docker --ipc=host (or explicitly mounted)

CMD ["/bin/vidhi-loader"]
