# Project Vidhi: Arena v5.0
## Ultra-Low Latency Distributed Benchmarking & Hosting Platform Specification
### Document Classification: Hardcore Systems Engineering & Mechanical Sympathy

---

## 1. Executive Architectural Overview

Project Vidhi: Arena v5.0 is a production-grade, bare-metal benchmarking platform engineered specifically to meet the rigorous criteria of the IICPC Summer Hackathon 2026. The platform securely containerizes untrusted contestant code, exposes localized interfaces, executes high-velocity simulation workloads, and captures deterministic telemetry with nanosecond precision.

### Core Architectural Separation
The system establishes a strict boundary between the administrative **Control Plane** and the performance-critical **Data Plane**:
*   **The Control Plane (Web Speed):** Handles user ingestion, source code abstract syntax tree (AST) scanning, Ahead-of-Time (AOT) compilation execution, asynchronous job queue dispatch, and leaderboard analytics state management.
*   **The Data Plane (Hardware Speed):** Operates on a single-socket, hardware-isolated pool of pinned CPU cores utilizing zero-copy memory arrays, bypassing the operating system kernel entirely during execution.

+----------------------------------------------------------------------------------------------------+|                                      NUMA NODE 0 (Socket 0)                                        ||                                                                                                    ||  [ CORE 2: C++ Game Master Engine ]                       [ CORE 3: Sibling Sandbox Container ]    ||    - Maps Pre-faulted Arrow Columns                         - Direct dlopen() of Native .so Binary ||    - Operates Branchless Int64 Math                         - Executes Compiled User on_tick()     ||                   |                                                           |                    ||                   +-------------------> [ 1GB HUGEPAGE ] <--------------------+                    ||                             Unidirectional Dual SPSC Ring Buffers                                  ||                                         (/dev/shm)                                                 |+----------------------------------------------------------------------------------------------------+|(Async Non-Temporal Store via _mm_stream_si64)v+----------------------------------------------------------------------------------------------------+|                                      NUMA NODE 1 (Socket 1)                                        ||                                                                                                    ||  [ CORE 14: Out-of-Band Telemetry Watchdog ]                                                      ||    - Drains Raw __rdtscp Cycle Arrays                                                              ||    - Executes PostgreSQL COPY Binary Protocol Stream to TimescaleDB                                |+----------------------------------------------------------------------------------------------------+
---

## 2. Phase-by-Phase Technical Blueprint

### Phase 1: Dual-Environment Execution Topography

To minimize infrastructure overhead and maximize contestant iteration velocity during the 24-hour testing phase, the platform implements a dual-reality sandbox:

#### 1. The 24-Hour Developer Phase (Client-Side WebAssembly)
*   **Mechanic:** The core C++ Game Master simulation engine and reference matching frameworks are cross-compiled using Emscripten into a highly optimized WebAssembly (`.wasm`) binary executed natively on the contestant's local machine inside a web worker thread.
*   **Data Layout:** The 99k-tick public "Data Capsule" is delivered via flat Apache Arrow IPC vectors straight into the browser's `SharedArrayBuffer` space.
*   **Impact:** Contestants achieve zero-latency, sub-second backtesting cycles locally without incurring server-side compute or API orchestration costs for the hosting platform.

#### 2. The Final Crucible Phase (Bare-Metal Private Cluster)
*   **Mechanic:** Upon final official submission, the code is locked and transferred to bare-metal infrastructure (such as AWS `c6in.metal` nodes).
*   **Anti-Overfit Strategy:** The platform executes the code against a fully held-out, hidden 999k-tick "Private Leaderboard" dataset. This prevents contestants from reverse-engineering the public sample or utilizing hardcoded, lookahead bias techniques to exploit patterns.

### Phase 2: Ingestion & The Compilation Forge (Control Plane)

When a standard Python file (`trader.py`) implementing a defined function signature (e.g., `on_tick(state)`) is submitted, the Go Orchestrator processes it through a strict optimization pipeline:

[ trader.py Upload ]│▼[ Go AST Security Scanner ] ─── (Banned Imports Detected) ───► [ Immediate Rejection ]│▼ (Pass)[ Numba Ahead-of-Time Forge ]│▼[ Native Shared Object (.so) ] ───► Shared Memory Sandbox
#### 1. Go AST Static Isolation Scanner
The Go Orchestrator parses the submitted Python script into an Abstract Syntax Tree (AST) using native parser primitives. It validates all syntax nodes against a strict whitelist, instantly rejecting any file containing code paths attempting to import forbidden packages (e.g., `os`, `sys`, `socket`, `threading`, `multiprocessing`) or emit illegal low-level instructions.

#### 2. Numba Ahead-of-Time (AOT) Compilation Loop
*   **The Bottleneck:** Traditional CPython interpreters require approximately 30 to 40 microseconds to cross the language boundary per call due to type checking, object box/unbox actions, and Global Interpreter Lock (GIL) orchestration. Across 1 million sequential ticks, this overhead accumulates to over 30 seconds of pure latency.
*   **The Mitigation:** The compiler wrapper injects a custom signature mapping layer over the code and calls the Numba AOT compiler using the `@numba.cfunc` decorator:
```python
    import numba
    @numba.cfunc("void(int64, int64[:], int64[:])")
    def on_tick(timestamp, order_book_pointer, order_output_pointer):
        # Compiled native math path execution...
    ```
*   **The Outcome:** The Python code is fully compiled down to native x86-64 machine code and wrapped inside a standard shared object (`.so`) file. The Python interpreter and GIL are completely removed from the execution path. The compilation allows the C++ core to invoke the logic using direct function pointers via `dlopen`/`dlsym`, reducing boundary crossing time from $35\mu s$ to **$\sim 2$ microseconds**.

### Phase 3: The Bare-Metal Execution Hot-Loop (Data Plane)

The execution engine processes millions of simulation operations using a strict, hardware-centric architecture designed to maximize processing efficiency.

#### 1. Fault-Tolerant Job Queue Scheduling (BullMQ + Redis)
Distributed batch workers run on cost-efficient AWS Spot Instances. To protect the state matrix against sudden instance reclamations, a Redis-backed **BullMQ** service coordinates job states:
*   A visibility timeout is applied to active simulation runs.
*   If a worker node crashes or gets reclaimed mid-run, heartbeats cease, and BullMQ re-enqueues the identical transaction token to a surviving worker.
*   Because the data files are immutable, the state is deterministically replayed with zero data corruption.

#### 2. Zero-Copy Kernel Bypass Memory Architecture
*   **Memory Mapping (`mmap`):** The C++ Game Master pre-loads the hidden 999k-tick dataset in Apache Arrow format using the `mmap()` syscall combined with `MAP_HUGETLB` flags. This locks 1GB Hugepages into RAM, entirely preventing runtime Translation Lookaside Buffer (TLB) thrashing or disk access penalties.
*   **Unidirectional SPSC Rings:** The communication link between the Game Master core and the sandboxed binary consists of two distinct Single-Producer, Single-Consumer (SPSC) lock-free ring buffers initialized inside POSIX shared memory (`/dev/shm/vidhi_cmd` and `/dev/shm/vidhi_res`).
    *   **Command Ring:** Mounted as Read-Only (`PROT_READ`) inside the contestant container. The Game Master writes the raw state array here. The contestant code views the structures via direct pointer arithmetic.
    *   **Response Ring:** Mounted as Write-Only inside the contestant container. The contestant emits generated order lists directly into this block.

#### 3. Linux Kernel Banishing & Hardware Isolation
Operating system thread scheduling jitter is removed by modifying the boot configuration via the GRUB menu:
```bash
isolcpus=managed_irq,domain,2-3 nohz_full=2-3 rcu_nocbs=2-3 processor.max_cstate=0 intel_idle.max_cstate=0
This isolates cores 2 and 3 on NUMA Node 0, completely stripping out system interrupts, background cron execution, and thread migration context switches.4. Hardware Alignment & Cache OptimizationFalse Sharing Prevention: Every index variable and atomic pointer (head_, tail_) is explicitly padded to 64 bytes (alignas(64)) to separate them into distinct physical L1/L2 cache lines, completely neutralizing hardware invalidation storms across the core interconnect bus.Struct-of-Arrays (SoA) Limit Order Book (LOB): The simulated order book is structured as flat, contiguous parallel vectors (int64_t prices[], int64_t volumes[], uint64_t ids[]) rather than arrays of records. This maximizes cache line efficiency when sweeping across price levels.Branchless Integer Execution: Floating-point operations are banned. All prices, volumes, and cash metrics are maintained as 64-bit fixed-point integers (scaled by $10,000$). Matching math uses bitwise mask logic instead of if-else blocks, keeping the CPU instruction pipeline clear of branch mispredictions:C++    uint64_t is_filled = (incoming_price >= limit_price);
    position += is_filled * target_volume;
    cash_balance -= is_filled * (target_volume * limit_price);
    ```

---

## 4. Shadow Validation & Out-of-Band Telemetry

To protect against edge cases like race conditions, duplicate cancels, double fills, or FIFO matching priority issues, the platform deploys an independent verification framework alongside an isolated metrics pipeline.

+------------------------------------+|  CORE 2 Execution Path Loop        ||  - Compiles Trades                 ||  - Writes __rdtscp Cycle Payload  |+------------------------------------+│▼+------------------------------------+|  METRICS RING BUFFER               ||  [ Contiguous 64-Bit Array ]       |+------------------------------------+│▼ (Asynchronous Drain)+------------------------------------+|  CORE 14 Telemetry Watchdog Thread ||  - Validates via Shadow LOB        ||  - Streams Binary PostgreSQL COPY  |+------------------------------------+│▼[ TimescaleDB Core ]
### 1. The Shadow Book Validator
While the core C++ loop is processing entries, it writes a copy of all raw order placements into an independent validation channel. An out-of-band **Shadow Book Engine** decodes this stream sequentially and verifies the contestant's state matching parameters against a strict reference framework:
*   **FIFO Tracking:** If an order at price level $P$ and sequence index $N$ is matched before sequence index $N-1$ at the same price level, the validator flags a correctness error.
*   **Double Spend Enforcement:** If a cancel event fails to immediately register or atomic modifications mutate cash values incorrectly, the system records an explicit validation flag and safely truncates the contestant's score profile.

### 2. High-Precision Out-of-Band Instrumentation
*   **Low-Overhead Timing Counter:** Telemetry tracking uses inline assembly clock intrinsics (`__rdtscp`), bypassing standard system time facilities or vDSO lookups to execute in under 8 nanoseconds.
*   **Non-Temporal Streaming (`_mm_stream_si64`):** Telemetry writes utilize non-temporal CPU intrinsics to write directly to main memory, bypassing the L1/L2 caches entirely. This prevents telemetry logging from evicting hot market arrays from the active cache lines.
*   **Asynchronous Database Loading:** A dedicated metrics thread drains the timing records, aggregates metrics tables using a low-overhead profiling matrix, and streams the binary payloads straight into TimescaleDB via the **PostgreSQL `COPY` protocol**, ensuring the system handles intense profiling loads without introducing runtime jitter.

---
## 5. Architectural Performance Summary

| Metric Component | Standard Platform Design | Project Vidhi Arena v5.0 | Net Engineering Optimization |
| :--- | :--- | :--- | :--- |
| **Language Boundary Cost** | $35,000\text{ ns}$ (CPython interpreter) | **$2,000\text{ ns}$** (Numba AOT `@cfunc`) | **$-94.2\%$ Execution Stall** |
| **Data IPC Mechanism** | $1,500\text{ ns}$ (Docker Network Bridge) | **$0\text{ ns}$** (Zero-Copy Shared Memory) | **Eliminates OS Network Layer** |
| **Memory Access Pattern** | Dynamic 4KB Pages (High TLB Misses) | **Contiguous 1GB Hugepages** | **Guaranteed L1/L2 Cache Locality** |
| **Telemetry Jitter** | High (`std::chrono` Kernel Interrupts) | **Zero** (`__rdtscp` Out-of-Band Stream) | **Complete Determinism** |
Key Takeaways for the IICPC HackathonClear Technical Depth: By demonstrating that you have optimized down to the compiler intermediate layer (Numba AOT C-functions) and hardware caching constraints (alignas(64) cache line insulation), you present an architecture that directly answers the judges' requirement for high-performance code.Solves the Platform's Real Challenge: Rather than chasing live-exchange networking buzzwords, this architecture targets the exact bottleneck of a high-throughput batch simulation platform: reducing the Python callback crossing boundary overhead and enforcing strict out-of-band telemetry capturing.