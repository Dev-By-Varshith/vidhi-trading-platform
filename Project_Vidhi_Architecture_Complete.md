# PROJECT VIDHI: Arena v5.0
## Architecture & Engineering Design Document
> An Industry-Grade, Ultra-Low-Latency Algorithmic Trading Contest Platform

## Table of Contents
- [1. System Overview](#1-system-overview)
  - [1.1 What Vidhi Arena Is](#11-what-vidhi-arena-is)
  - [1.2 The Two Roles](#12-the-two-roles)
  - [1.3 Why Bots, and Why Private](#13-why-bots,-and-why-private)
  - [1.4 Document Roadmap](#14-document-roadmap)
- [2. High-Level Architecture](#2-high-level-architecture)
  - [2.1 The Two Planes](#21-the-two-planes)
  - [2.2 Component Inventory](#22-component-inventory)
  - [2.3 Per-Contestant Resource Allocation](#23-per-contestant-resource-allocation)
- [3. End-to-End Data Flow](#3-end-to-end-data-flow)
  - [3.1 The Two Journeys](#31-the-two-journeys)
  - [3.2 The Submission Journey (Seconds Timescale)](#32-the-submission-journey-(seconds-timescale))
  - [3.3 The Tick Journey (Nanosecond Timescale)](#33-the-tick-journey-(nanosecond-timescale))
- [4. Sandbox Engine](#4-sandbox-engine)
  - [4.1 The Core Problem](#41-the-core-problem)
  - [4.2 The Forge Pipeline](#42-the-forge-pipeline)
  - [4.3 The Five-Layer Defence-in-Depth Security Model](#43-the-five-layer-defence-in-depth-security-model)
- [1. AST Scan](#1-ast-scan)
- [2. ELF Validation](#2-elf-validation)
- [3. Linux Namespaces](#3-linux-namespaces)
- [4. Seccomp BPF Filter](#4-seccomp-bpf-filter)
- [5. User Namespace + cgroups v2](#5-user-namespace-+-cgroups-v2)
  - [4.4 The SIGKILL Watchdog](#44-the-sigkill-watchdog)
  - [4.5 Warm Sandbox Pool](#45-warm-sandbox-pool)
- [5. Bot Fleet & The Persistent Live Limit Order Book](#5-bot-fleet-&-the-persistent-live-limit-order-book)
  - [5.1 Why "Inline" Bots, Not a Separate Service](#51-why-"inline"-bots,-not-a-separate-service)
  - [5.2 The Five Bot Strategies](#52-the-five-bot-strategies)
  - [5.3 The Persistent Limit Order Book](#53-the-persistent-limit-order-book)
  - [5.4 Order Processing Order — Why Bots Go First](#54-order-processing-order-—-why-bots-go-first)
- [6. Telemetry & Validation](#6-telemetry-&-validation)
  - [6.1 The Telemetry Watchdog’s Three Jobs](#61-the-telemetry-watchdog’s-three-jobs)
  - [6.2 Why __rdtscp, Non-Temporal Stores, and a Fence](#62-why-__rdtscp,-non-temporal-stores,-and-a-fence)
  - [6.3 HDR Histogram Double-Buffering](#63-hdr-histogram-double-buffering)
  - [6.4 The Shadow LOB Validator](#64-the-shadow-lob-validator)
- [7. Real-Time Leaderboard](#7-real-time-leaderboard)
  - [7.1 The "No Query in the Hot Path" Principle](#71-the-"no-query-in-the-hot-path"-principle)
  - [7.2 Update Flow](#72-update-flow)
  - [7.3 WebSocket Resilience](#73-websocket-resilience)
- [8. Inter-Service Communication](#8-inter-service-communication)
  - [8.1 Two Very Different Kinds of "Communication"](#81-two-very-different-kinds-of-"communication")
  - [8.2 From SPSC Rings to a Rendezvous Protocol](#82-from-spsc-rings-to-a-rendezvous-protocol)
  - [8.3 The Shared Rendezvous Struct — Cache-Line Layout](#83-the-shared-rendezvous-struct-—-cache-line-layout)
  - [8.4 Control-Plane Communication Summary](#84-control-plane-communication-summary)
- [9. Data Stores](#9-data-stores)
  - [9.1 Three Stores, Three Jobs](#91-three-stores,-three-jobs)
  - [9.2 TimescaleDB Schema](#92-timescaledb-schema)
  - [9.3 Redis Usage](#93-redis-usage)
  - [9.4 S3 Layout](#94-s3-layout)
- [10. Infrastructure as Code](#10-infrastructure-as-code)
  - [10.1 Terraform Module Map](#101-terraform-module-map)
  - [10.2 Security Group Design](#102-security-group-design)
  - [10.3 The Bare-Metal Bootstrap Script](#103-the-bare-metal-bootstrap-script)
  - [10.4 Startup Self-Checks](#104-startup-self-checks)
  - [10.5 Cost Profile and Operational Posture](#105-cost-profile-and-operational-posture)
  - [0.5 vCPU / 1GB](#05-vcpu-/-1gb)
- [11. CI/CD Pipeline](#11-ci/cd-pipeline)
  - [11.1 Why the C++ Core Needs a Different Build Path](#111-why-the-c++-core-needs-a-different-build-path)
  - [11.2 Pipeline Stages](#112-pipeline-stages)
  - [11.3 Manual vs Automated Deployment — a Deliberate Asymmetry](#113-manual-vs-automated-deployment-—-a-deliberate-asymmetry)
- [12. Composite Scoring Algorithm](#12-composite-scoring-algorithm)
  - [12.1 Design Goal: Primary Metric Should Be Unambiguous](#121-design-goal:-primary-metric-should-be-unambiguous)
  - [12.2 The Formula](#122-the-formula)
  - [12.3 Walking Through Each Rule](#123-walking-through-each-rule)
  - [12.4 Where Correctness Penalties Fit In](#124-where-correctness-penalties-fit-in)
- [13. Technology Decisions](#13-technology-decisions)
- [14. Architecture Decision Records](#14-architecture-decision-records)
- [15. Performance Characteristics](#15-performance-characteristics)
  - [15.1 The Full Per-Tick Budget, Restated](#151-the-full-per-tick-budget,-restated)
  - [15.2 Multi-Contestant Throughput](#152-multi-contestant-throughput)
  - [1.6 seconds](#16-seconds)
  - [15.3 How These Numbers Were Measured](#153-how-these-numbers-were-measured)
- [16. Contestant Upload Flow](#16-contestant-upload-flow)
  - [16.1 Two-Phase Flow Overview](#161-two-phase-flow-overview)
  - [16.2 Phase 1 — Local Testing (Unlimited, No Deadline)](#162-phase-1-—-local-testing-(unlimited,-no-deadline))
  - [16.3 Phase 2 — Final Round Submission (Credit-Limited, Deadline-Bound)](#163-phase-2-—-final-round-submission-(credit-limited,-deadline-bound))
  - [16.4 What the Contestant Never Sees](#164-what-the-contestant-never-sees)
- [17. Security Model](#17-security-model)
  - [17.1 Threat Model](#171-threat-model)
  - [17.2 The Five Layers, Restated as a Security Narrative](#172-the-five-layers,-restated-as-a-security-narrative)
  - [17.3 The Sandbox Manager as a Privilege Boundary](#173-the-sandbox-manager-as-a-privilege-boundary)
  - [17.4 Reproducibility as a Security and Fairness Property](#174-reproducibility-as-a-security-and-fairness-property)
- [18. Build Status & Remaining Work](#18-build-status-&-remaining-work)
  - [18.1 Status Summary](#181-status-summary)
  - [18.2 Remaining Work (Non-Blocking)](#182-remaining-work-(non-blocking))
  - [18.3 Operational Runbook Pointers](#183-operational-runbook-pointers)
  - [18.4 Build History (for reference)](#184-build-history-(for-reference))
- [19. Appendix — Glossary & Reference Tables](#19-appendix-—-glossary-&-reference-tables)
  - [19.1 Glossary](#191-glossary)
  - [19.2 Repository File Map](#192-repository-file-map)
  - [19.3 Quick Reference — Key Numbers](#193-quick-reference-—-key-numbers)
- [20. Innovation Index & Design Philosophy](#20-innovation-index--design-philosophy)
  - [20.1 What Makes This Platform One-of-a-Kind](#201-what-makes-this-platform-one-of-a-kind)
  - [20.2 The Innovation Index](#202-the-innovation-index)
  - [20.3 High-Level Design Principles](#203-high-level-design-principles)
    - [Principle 1 — The measurement must not be the thing it measures](#principle-1--the-measurement-must-not-be-the-thing-it-measures)
    - [Principle 2 — Push correctness to compile time](#principle-2--push-correctness-to-compile-time)
    - [Principle 3 — Every shared resource has exactly one writer](#principle-3--every-shared-resource-has-exactly-one-writer)
    - [Principle 4 — Make the fair thing and the fast thing the same thing](#principle-4--make-the-fair-thing-and-the-fast-thing-the-same-thing)
  - [20.4 Low-Level Design Principles](#204-low-level-design-principles)
  - [20.5 Explaining the Hardest Ideas in Plain English](#205-explaining-the-hardest-ideas-in-plain-english)
    - [What is a cache line?](#what-is-a-cache-line)
    - [Why can't you just use a timeout?](#why-cant-you-just-use-a-timeout)
    - [Why do bots need to be inline?](#why-do-bots-need-to-be-inline)
    - [What does deterministic replay buy us?](#what-does-deterministic-replay-buy-us)
    - [Why is the scoring rule so simple?](#why-is-the-scoring-rule-so-simple)

---

# PROJECT VIDHI: Arena v5.0

## Architecture & Engineering Design Document

> An Industry-Grade, Ultra-Low-Latency Algorithmic Trading Contest Platform


# 1. System Overview

## 1.1 What Vidhi Arena Is

Project Vidhi Arena is a self-hosted competitive platform that lets contestants write algorithmic trading strategies in Python, have those strategies compiled to native machine code, and run them against a live, reactive simulated market — a limit order book populated by five distinct bot strategies that respond to the contestant’s own trades. It is modelled on the format popularised by IMC Prosperity, Jane Street’s Electronic Trading Challenge, and SIG’s Trading Puzzles, but built from the ground up with a single non-negotiable constraint: the platform itself must contribute as close to zero measurable latency as physics allows, so that the latency numbers shown on the leaderboard reflect the contestant’s code, not the platform’s overhead.


This single constraint — "the platform must be invisible to the measurement" — is the thread that runs through every architectural decision in this document. It is why the simulation core is C++ rather than Go or Python; why memory is shared rather than serialised; why the order book lives in a 24-kilobyte structure deliberately sized to fit in L1 cache; and why even the act of writing a telemetry timestamp is implemented with non-temporal CPU instructions so that it does not evict the very data being measured.


## 1.2 The Two Roles

The platform serves two distinct user roles, and the entire data model and permission system is built around this separation:


Role


What they do


What they see


Contest Creator


Creates contests, defines rounds (each round has its own asset, bot aggressiveness profile, and tick count), opens and closes submission windows, and publishes final results.


Full admin dashboard: all contestants’ scores, round configuration panel, system health.


Contestant (Student)


Browses open contests, writes a Python trading algorithm in the browser-based Code Arena, runs it locally against a private practice simulation as many times as they like, and submits a final version once per round.


Their own practice runs, their final submission status, and the public leaderboard (PnL % and latency tiebreaker only — no other contestant’s code or internal state).


## 1.3 Why Bots, and Why Private

The single most important conceptual decision in v5.0 — the one that separates this platform from a simple "replay history and compute PnL" backtester — is that the market each contestant trades against is not a static replay. It is a live, reactive limit order book populated by five bot strategies (a market maker, a momentum trader, a mean-reversion trader, a noise trader, and a sniper/arbitrageur) that see the contestant’s own orders land in the book and respond to them — widening spreads when the contestant takes too much liquidity, front-running detected momentum, fading aggressive moves, and arbitraging away any mispricing the contestant leaves behind.


Each contestant’s simulation is run in a completely private, isolated session: their own order book, their own instance of the five bots, their own core pair on the server. The bots never appear on the leaderboard and are invisible to other contestants. This design choice solves a problem that plagues most "replay" style contest platforms: in a pure replay, every contestant sees an identical, unreactive price path, so the contest degenerates into "who can best fit a static historical curve" — which rewards overfitting, not trading skill. By making the market reactive and private, two contestants who submit the same strategy will see different bot behaviour (because the bots react to what each contestant individually does), and a genuinely better strategy will outperform a worse one against the


same


underlying price signal and the


same


bot logic — which is the fairest possible comparison.


Engineering rationale: why this was the hardest decision in the project


Early versions of this platform (v1–v4, see the architecture decision records in Section 14) used a static tick-replay model where contestants traded against a pre-recorded price series with no feedback loop. This was simpler to build and easier to reason about for correctness — but it meant a contestant could, in principle, "solve" the contest by reverse-engineering the recorded price path rather than writing a genuinely good trading strategy. The v5.0 redesign introduced a persistent, per-contestant limit order book with inline bot strategies that react every tick. This added real engineering cost (Sections 4 and 5 below) but is the reason this platform can credibly claim to test


trading skill


, not pattern memorisation.


## 1.4 Document Roadmap

The remaining sections of this document are organised to mirror the system itself, moving from the 30,000-foot view down to individual CPU instructions and back out to the cloud deployment that hosts it all:


#


Section


What it covers


2


High-Level Architecture


The component map: every service, what language it is written in, and why.


3


End-to-End Data Flow


Tracing a single tick from the price-signal dataset through to a leaderboard update, with exact nanosecond budgets.


4


Sandbox Engine


How untrusted contestant Python becomes a native, dlopen-able shared object, and how it is contained.


5


Bot Fleet & Live LOB


The five inline bot strategies and the persistent limit order book they share with the contestant.


6


Telemetry & Validation


HDR histograms, the shadow order-book validator, and the watchdog that enforces the time limit.


7


Real-Time Leaderboard


How a tick-level event becomes a sub-second leaderboard update.


8


Inter-Service Communication


The rendezvous protocol, shared memory layout, and why it replaced ring buffers.


9


Data Stores


Postgres/TimescaleDB schema, Redis usage, S3 layout.


10


Infrastructure as Code


Terraform modules, NUMA/hugepage bootstrapping, the bare-metal vs Fargate split.


11


CI/CD Pipeline


GitHub Actions, build pipeline for the C++ core, deployment flow.


12


Composite Scoring Algorithm


PnL%, latency tiebreaker, and penalty rules in full.


13


Technology Decisions


Every "why X and not Y" decision in one place, for quick reference.


14


Architecture Decision Records


A chronological log of the v1 → v5 evolution and what changed at each step.


15


Performance Characteristics


The full nanosecond budget table and how it was measured.


16


Contestant Upload Flow


The complete journey of a student’s submitted file, end to end.


17


Security Model


The five-layer defence-in-depth model.


18


Build Status & Remaining Work


What is done, what is left, and the prioritised punch list.


19


Appendix — Glossary & Reference Tables


Terminology, file map, and quick-reference tables.


> **DIAGRAM PLACEHOLDER:** ▦ SCREENSHOT / IMAGE PLACEHOLDER

Figure 1.1 — Vidhi Arena landing page / leaderboard screenshot


Insert a full-width screenshot of the live Leaderboard.jsx page showing several contestants ranked by PnL%.


Caption suggestion: "The contestant-facing leaderboard, updated within one second of a submission completing."


# 2. High-Level Architecture

## 2.1 The Two Planes

Vidhi Arena is built as two largely independent planes that communicate through narrow, well-defined interfaces. This separation is the


single most important structural decision


in the entire platform, because it allows the two planes to be engineered, scaled, and reasoned about completely differently.


The Control Plane (Go + React + Postgres + Redis)


Everything a contestant or contest creator interacts with directly through a browser: the web dashboard, authentication, file upload, the AST security scanner, the compilation ("Forge") pipeline, the job queue, and the database that stores run history and leaderboard standings. This plane runs on standard, horizontally-scalable cloud infrastructure — ECS Fargate containers, managed Postgres, managed Redis — because its performance requirements are "respond within a few hundred milliseconds," which any conventional web stack satisfies comfortably.


The Data Plane (C++ on bare-metal EC2)


The actual simulation: the Game Master, the live order book, the five inline bots, the contestant’s sandboxed compiled code, and the telemetry watchdog. This plane runs on a single dedicated EC2 instance with kernel-level tuning — isolated CPU cores, hugepages, disabled C-states — because its performance requirement is "tens of nanoseconds per tick," which is two to three orders of magnitude tighter than anything a containerised, virtualised, or garbage-collected runtime can reliably deliver.


Why not run everything on Fargate?


This was an explicit, documented decision (see ADR-002 in Section 14). AWS Fargate does not expose the host’s CPU topology to the container — you cannot pin a thread to a physical core, you cannot disable C-states, and you cannot reserve hugepages, because Fargate runs your container inside its own micro-VM with a virtualised view of the CPU. For a service answering HTTP requests this is irrelevant. For the Game Master, where the entire performance budget is ~111 nanoseconds per tick (Section 15), losing the ability to pin a thread to an isolated core would introduce scheduler jitter of tens of


microseconds


— a thousand-fold increase over the entire platform budget. The simulation core therefore runs on a conventional EC2 instance (


c6i.2xlarge


or larger), provisioned and tuned via the bootstrap script described in Section 10.


> **DIAGRAM PLACEHOLDER:** ▦ DIAGRAM PLACEHOLDER

Figure 2.1 — Control Plane vs Data Plane component map


A two-column diagram. Left column "Control Plane" containing: React Frontend, Go Orchestrator (API, Auth, Forge pipeline trigger), Redis (queue + credits), Postgres/TimescaleDB, Sandbox Manager (Docker socket isolated service).


Right column "Data Plane" containing: C++ Game Master (Core 2), Contestant Sandbox (Core 3, dlopen .so), Telemetry Watchdog (Core 4), Shared rendezvous memory between them.


Draw one arrow crossing the boundary: Redis job → Job Worker (polls queue) → writes job to Data Plane via local IPC.


This is the single most important diagram in the document — it should be the one a new engineer sees first.


## 2.2 Component Inventory

Component


Language


Role


Frontend (vidhi_context)


React + Vite


Code Arena (Monaco editor), Leaderboard, Simulation Dashboard, Submissions history, Asset Wiki.


Go Orchestrator (backend)


Go


HTTP API, authentication, AST scan trigger, Forge pipeline orchestration, credit ledger, leaderboard queries, WebSocket broadcast.


Sandbox Manager


Go


The only service with Docker socket access. Spawns, pins, and tears down contestant sandbox containers on job-token request from Redis.


Forge pipeline (forge/)


Python (invoked by Go)


AST security scanner → AST-based transpiler shim → Numba AOT compiler → ELF validator.


C++ Game Master


C++ (-O3 -march=native)


Per-contestant simulation core: tick loop, live LOB, five inline bots, PnL tracking, position limits.


Sandbox Runner


C++


dlopen()s the contestant’s compiled .so and calls on_tick via a raw C function pointer inside a 5-layer-isolated process.


Telemetry Watchdog


C++


Drains the metrics ring, maintains HDR histograms, runs the shadow LOB validator, batch-writes to TimescaleDB, exports live percentiles via shared memory.


TimescaleDB / Postgres


SQL (managed RDS)


Run history, fills, PnL time series, leaderboard standings, credit ledger persistence.


Redis


In-memory store


Job queue, submission credit counters (atomic INCR), live leaderboard cache, rate limiting.


S3


Object storage


Frontend static assets (via CloudFront), deterministic tick datasets, submitted source code archive.


## 2.3 Per-Contestant Resource Allocation

At contest scale (20 simultaneous contestants on a 64-core server), the Data Plane assigns each contestant a dedicated pair of physical cores plus a shared telemetry core, following a strict, repeatable pattern:


Core 0–1:    OS + system daemons (NOT isolated)


Core 2–3:    Contestant slot 1   → Core 2 = Game Master + 5 bots (inline)


Core 3 = Sandbox (dlopen contestant.so)


Core 4–5:    Contestant slot 2   → same pattern


...


Core 40–41:  Contestant slot 20


Core 42–43:  Telemetry Watchdog A / B (drain slots 1–10 / 11–20)


Core 44+:    Control plane processes (Go job worker, Redis, etc.)


This layout is enforced both by GRUB kernel parameters at boot (isolating cores 2–43 from the OS scheduler entirely) and by an explicit sched_setaffinity() call made by each Game Master process at startup, which is then verified by a startup self-check (Section 10.4).


# 3. End-to-End Data Flow

## 3.1 The Two Journeys

There are two fundamentally different "data flows" in this system, operating at completely different timescales, and it is important to keep them mentally separate:


Journey


Timescale


Described in


The Submission Journey: a contestant uploads code, it is compiled, and a run is scheduled.


Seconds to tens of seconds (dominated by compilation and queueing)


Section 3.2 and Section 16 (full detail)


The Tick Journey: inside a single run, one simulation tick flows through the Game Master, bots, sandbox, and telemetry.


Tens to low hundreds of nanoseconds, repeated up to 1,000,000 times per run


Section 3.3 and Section 15 (full nanosecond budget)


## 3.2 The Submission Journey (Seconds Timescale)

Contestant writes Python in the Code Arena (Monaco editor) and clicks "Run Locally" as many times as desired — this triggers a local practice simulation (100k ticks) against the public dataset, shown on the Simulation Dashboard. These runs do not count toward the leaderboard and are not credit-limited.


When ready, the contestant clicks "Submit Final." The frontend sends a POST to /api/submit with their API key and source code.


The Go Orchestrator validates the API key, checks the Redis-backed submission credit ledger (5 full runs per 24 hours), writes a row to the runs table with status=’pending’, and pushes a job token to the queue.


The Forge pipeline runs (as a subprocess chain, invoked by the Go Orchestrator or the EC2 job worker): AST security scan → AST-based transpiler shim (rewrites the clean state.bid_price OOP interface into raw array/pointer accesses) → Numba ahead-of-time compilation to a native .so with a single exported on_tick__cfunc symbol → ELF validator (confirms no banned symbols, no unexpected exports, no executable-writable segments).


The Sandbox Manager (the only service with Docker socket access) receives a job token from Redis and prepares an isolated container — ideally from its warm pool (Section 4.5) to avoid cold-start latency — with the compiled .so mounted read-only.


The C++ Game Master, running on the bare-metal EC2 instance, executes the full round-configured tick count (100k / 200k / 1,000,000 depending on the round) against the deterministic dataset, with the contestant’s sandbox in the loop every tick.


On completion, the Telemetry Watchdog has already streamed batched results to TimescaleDB; the Go Orchestrator updates the runs row to status=’complete’ with the final PnL% and latency percentiles.


The frontend, which has been polling /api/runs/{run_id} (or listening on a WebSocket), shows the result and the leaderboard re-ranks within one second.


> **DIAGRAM PLACEHOLDER:** ▦ DIAGRAM PLACEHOLDER

Figure 3.1 — Submission Journey sequence diagram


A sequence diagram (swimlanes: Browser, Go Orchestrator, Redis, Forge subprocess, Sandbox Manager, Game Master, TimescaleDB).


Show the POST /api/submit call, the credit check, the Forge pipeline as a single collapsed box with an expand note pointing to Figure 16.1, the job handoff to the Sandbox Manager, the Game Master run, and the final WebSocket push back to the browser.


Annotate each arrow with its approximate latency (e.g. "Forge pipeline: 15–60s depending on cache hit", "Game Master run: ~300ms for 1M ticks").


## 3.3 The Tick Journey (Nanosecond Timescale)

This is the journey that matters for "ultra-low latency," and it is worth tracing in full because every subsequent section of this document is, in some sense, a deep-dive into one step of this loop. Every tick, on Core 2, the Game Master executes the following eleven steps — and the entire sequence, excluding the time the contestant’s own code takes to think, costs approximately 111 nanoseconds.


Step


What happens


Cost


Why this cost


1


Read the price signal for tick T from the pre-loaded Arrow/hugepage dataset (fair_value, volatility, tick_size, news_flag).


~4 ns


L1 cache hit — the whole dataset is hugepage-mapped (1GB hugepage) so there is exactly one TLB entry for the entire 1,000,000-tick series.


2


Snapshot the current live LOB state (best bid/ask, 5-level depth each side, last trade, spread).


~8 ns


The entire LOB hot structure is 24KB, deliberately sized to remain L1-resident (L1d is typically 32KB).


3


Compute all five bot orders inline, in C++, on the same core.


~10 ns total


No IPC, no virtual dispatch — each bot is a small struct with a direct, statically-resolved compute() call (Section 5.2).


4


Write the LOB snapshot and previous fills into the shared rendezvous struct using regular (cached) stores.


~15 ns


Regular stores, not non-temporal — the contestant sandbox reads this data on the very same tick, so it must stay in cache (see Section 8.3).


5


Signal the contestant sandbox: release-store an incrementing sequence number on gm_sequence.


~4 ns


A single atomic store with release semantics — the cache-coherency protocol itself does the signalling.


6


Spin-wait (_mm_pause loop on sb_sequence) for the sandbox to acknowledge, up to a 100µs deadline enforced by the watchdog thread.


contestant time


This is the only step whose duration depends on the contestant’s code. Everything else on this list is fixed platform overhead.


7


Read the contestant’s submitted orders from the rendezvous struct (up to 4 orders).


~4 ns


L1 cache hit — the sandbox wrote into the same cache lines the Game Master is now reading.


8


Process all pending orders (bot orders first — same-core, ~0ns transport — then the contestant’s, stable-sorted by arrival_tsc) into the LOB and produce fills.


~10 ns


Branchless best-pointer fast path — 99% of fills happen at the best bid/ask, which is a single 64-byte struct.


9


Distribute fills: contestant_fills back to the rendezvous struct, and notify_fill() on whichever bots were filled.


~5 ns


Simple array writes into the fill-notification slots of the rendezvous struct.


10


Update the contestant’s PnL using fixed-point (int64 with __int128 intermediate for overflow safety).


~3 ns


Fixed-point, not floating point — guarantees bit-identical replay across machines (Section 9.2).


11


Record telemetry: __rdtscp → tsc_delta, non-temporal stores (_mm_stream_si64) into the metrics ring, one _mm_sfence().


~26 ns


The only step that uses non-temporal stores — because this data is read once, asynchronously, by the Telemetry Watchdog on a different core (Section 6.2).


Two numbers, two purposes — ~89ns and ~111ns


Summing steps 1–5 and 7–11 in the table above gives


~89 nanoseconds


— this is the


per-tick instruction-level total


for the eleven-step loop as written, and the architecture spec separately states this as the


"physics floor"


: the absolute minimum achievable without removing the bot fleet or fill distribution entirely.


The Performance Budget (Section 15) reports


~111 nanoseconds


as the


measured, end-to-end v5.0 platform overhead


— the ~89ns instruction total plus additional fixed costs that arise once the loop runs inside the full system (watchdog bookkeeping, the persistent-LOB pool-allocator’s bounds checks, and fill-distribution across multiple bots) rather than in isolation. The


+35ns delta from v4.0’s ~76ns


is explicitly attributed, in Section 15, to exactly these additions — the cost of moving from a static replay (v4) to the persistent, reactive live LOB (v5, ADR-005).


Either number is


everything except


step 6. Step 6 is where the contestant’s actual trading logic runs, bounded above by the 100µs time limit enforced by the watchdog (Section 6.3). A trivial EMA-crossover strategy might add ~200ns; a strategy doing meaningful numerical work might add 1–2µs. At 111ns of overhead versus a 100,000ns time limit, the platform consumes well under 0.2% of the available budget.


> **DIAGRAM PLACEHOLDER:** ▦ DIAGRAM PLACEHOLDER

Figure 3.2 — The eleven-step tick loop, drawn as a circular/looping diagram


Draw the eleven steps as a loop (since tick T+1 begins immediately after tick T ends), with Core 2 (Game Master + bots) and Core 3 (Sandbox) as two lanes side by side, connected by the shared rendezvous memory in the middle.


Use colour to distinguish: green = fixed platform overhead steps (1,2,3,4,5,7,8,9,10,11), amber = the variable contestant-compute step (6).


Annotate the total: "Platform: ~111ns | Contestant: 0–100,000ns (TLE enforced)".


This diagram is the visual anchor for Section 15 (Performance Characteristics) and should be referenced again there.


# 4. Sandbox Engine

## 4.1 The Core Problem

A contestant uploads arbitrary Python. By the time their code runs, it must: (a) execute as


native machine code


with no interpreter overhead, because the entire performance budget is measured in tens of nanoseconds; (b) be


completely incapable


of accessing the network, the filesystem, other contestants’ processes, or the host system, because it is, by definition, untrusted; and (c) communicate with the Game Master through a channel with


zero serialisation cost


, because any per-tick marshalling overhead would dominate the budget. These three requirements are in tension — "fast," "isolated," and "zero-copy" do not usually coexist — and resolving that tension is the subject of this section.


## 4.2 The Forge Pipeline

The journey from trader.py to a safe, callable, native function is a four-stage pipeline, each stage acting as an independent checkpoint. A submission that fails any stage is rejected with a specific, actionable error shown to the contestant — it never silently falls back to a slower path.


Stage 1 — AST Security Scanner (scanner.py)


Before a single line of the contestant’s code is compiled, it is parsed into a Python Abstract Syntax Tree and walked by a NodeVisitor that rejects the submission outright if it finds: imports of os, sys, socket, subprocess, ctypes, or importlib; calls to eval, exec, compile, __import__, open, or input; any module-level mutable state; or a function signature that does not match the required on_tick(state, orders) contract. This is a pure allow-list — anything not explicitly understood is rejected, not passed through.


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 4.1 — AST scanner banned-node visitor


File: backend/forge/scanner.py


Paste the NodeVisitor class definition and its visit_Import / visit_Call methods, showing the exact ban list (os, sys, socket, subprocess, ctypes, importlib, eval, exec, compile, __import__, open, input, print) and the signature-matching check for on_tick(state, orders).


Stage 2 — AST-Based Transpiler Shim (transpiler.py)


Contestants write clean, readable OOP code:


state.bid_price


,


orders.limit_buy(price, volume)


. Internally, the Game Master communicates through raw arrays and pointers —


market_data[0]


, a fixed-size


order_out


buffer — because that is what a zero-overhead C function signature looks like. The transpiler bridges this gap


at the AST level


, using Python’s


ast.NodeTransformer


. It rewrites every


Attribute


node that resolves to


state.<field>


into the corresponding


market_data[i]


index,


including through aliases


(e.g.


s = state; s.bid_price


is correctly rewritten, because the transformer tracks the alias set across assignments, including chained assignments like


a = b = state


). It also injects a fixed random seed for any


random


module usage, so that runs are bit-for-bit reproducible.


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 4.2 — AST NodeTransformer for state.* → market_data[i] rewriting


File: backend/forge/transpiler.py


Paste the ShimTransformer class: the field-to-index MAPPING dict, the visit_Attribute override, and the AliasTracker visitor that handles chained assignment (a = b = state).


Stage 3 — Numba Ahead-of-Time Compilation (forge.py)


The transpiled code is compiled with


@numba.cfunc


using a


raw C pointer calling convention


—


CPointer(float64)


and


CPointer(int64)


, not Numba’s default


float64[:]


typed-array signature. This distinction matters enormously: Numba’s typed-array arguments carry an NRT (Numba Runtime) array descriptor — a struct of


{data_ptr, shape, strides, meminfo, parent}


— that must be constructed on every call, costing 50–200ns. A raw pointer argument is just a pointer; the call compiles down to a single CPU


CALL


instruction, costing roughly 5ns. The output is a single shared object (


contestant.so


) exporting exactly one symbol:


on_tick__cfunc


.


python


# Forge injects this signature, NOT the default float64[:] form


@numba.cfunc("void(uint64, CPointer(float64), CPointer(int64))")


def on_tick__cfunc(timestamp, market_data, order_out):


# transpiled contestant logic operates on raw pointers here


...


Stage 4 — ELF Validator (elf_validator.go)


The compiled .so is inspected with readelf and nm before it is ever loaded into a sandbox. Five checks must all pass: (1) the dynamic symbol table exports exactly one symbol, on_tick__cfunc; (2) the PLT contains no banned symbols (socket, connect, open, fopen, system, popen, fork, exec*); (3) no segment is simultaneously writable and executable (rules out self-modifying code or JIT shellcode); (4) the file size is within an expected range (catches embedded payloads); and (5) the ELF type is ET_DYN (a shared object, not an executable). This is the final, language-agnostic checkpoint — it does not trust that the AST scanner or the transpiler caught everything; it independently verifies the binary artefact.


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 4.3 — ELF validator five-check sequence


File: backend/validator/elf_validator.go


Paste the function that runs readelf --dyn-syms, nm --undefined, and the segment-permission check, showing the banned-symbol slice and the ET_DYN type assertion.


> **DIAGRAM PLACEHOLDER:** ▦ DIAGRAM PLACEHOLDER

Figure 4.1 — The Forge pipeline as a four-stage funnel


A horizontal funnel diagram: trader.py → [AST Scanner] → [AST Transpiler] → [Numba AOT] → [ELF Validator] → contestant.so.


At each stage, show a small "REJECT" branch peeling off with the error category (e.g. "banned import", "signature mismatch", "compile error", "banned symbol in PLT").


Annotate the SHA-256 dedup check before Stage 1: "If hash matches a cached .so, skip directly to job dispatch."


## 4.3 The Five-Layer Defence-in-Depth Security Model

Even after the Forge pipeline produces a clean .so, the process that loads and executes it is wrapped in five independent containment layers. The principle is that no single layer is trusted to be sufficient — a contestant would need to simultaneously defeat all five to do anything beyond compute on_tick().


Layer


Mechanism


What it stops


# 1. AST Scan

Static analysis of the Python source before compilation.


Obviously malicious imports/calls — the cheapest, earliest checkpoint.


# 2. ELF Validation

readelf/nm inspection of the compiled .so — a full 5-check scan: symbol imports, .rodata strings, PT_INTERP, file size, and ET_DYN type (Section 18, Session 3).


Anything that survived Stage 1 but produced a binary with banned symbols, multiple exports, or RWX segments.


# 3. Linux Namespaces

unshare(CLONE_NEWNET | CLONE_NEWNS | CLONE_NEWPID) — no network namespace, read-only mount namespace, isolated PID namespace.


Even if a banned syscall were somehow reached, there is no network interface to use and no other process to see.


# 4. Seccomp BPF Filter

A syscall allow-list — only mmap, munmap, mprotect, read, write, exit_group, clock_gettime, brk. Everything else raises SIGSYS → SIGKILL. Wired into the sandbox container via /etc/vidhi/seccomp.json, not "unconfined" (Section 18, Session 3).


socket(), connect(), fork(), exec() — instant process death, enforced by the kernel, not by userspace code that could itself be subverted.


# 5. User Namespace + cgroups v2

CLONE_NEWUSER (Docker UsernsMode=private) — the contestant process runs as an unprivileged UID inside its own user namespace, mapped to a non-root UID on the host — combined with cgroups v2 hard limits: memory.max=256M, cpu.max pinned to one core, pids.max=1 (no fork bombs), io.max=0 (no disk I/O). Added in Session 3 as the final layer.


Resource exhaustion (memory bombs, fork bombs, runaway CPU) AND privilege escalation — even a process that somehow gained root inside its namespace maps to an unprivileged UID on the host.


PR_SET_NO_NEW_PRIVS — a small flag with an outsized effect


One easily-overlooked addition (added in Session 1–2 of the build, see Section 18) is calling


prctl(PR_SET_NO_NEW_PRIVS, 1)


before the sandbox process executes the contestant code. This irrevocably prevents the process — and any children it might somehow spawn — from gaining privileges via a setuid binary, even if one were somehow reachable. It costs nothing and closes an entire class of privilege-escalation vectors. The kind of detail that separates "looks secure" from "is secure."


## 4.4 The SIGKILL Watchdog

The contestant’s code is, after Stage 3,


compiled native machine code


— not Python bytecode. This matters for one critical reason: the conventional Python timeout mechanism,


signal.alarm()


combined with


PyErr_SetInterrupt()


, works by setting a flag that the


CPython interpreter loop


checks between bytecode instructions. A compiled cfunc has no interpreter loop — it is a tight sequence of native instructions with no bytecode dispatch to interrupt. An infinite loop inside a Numba-compiled


on_tick


is therefore


completely invisible


to


PyErr_SetInterrupt()


. The only mechanism that reliably terminates running native code is a


process-level signal


.


The watchdog is implemented as a dedicated pthread, running on the same core as the Game Master, which:


Before sending a tick to the sandbox, records tick_start_tsc = __rdtsc() and sets an atomic tick_in_progress flag to true.


Spins (with _mm_pause) checking whether __rdtsc() - tick_start_tsc has exceeded deadline_tsc (the 100µs limit, expressed in calibrated TSC ticks — with the spin budget itself tuned from an initial 500,000 spins down to 20,000, the correct figure for a 100µs deadline, Section 18.4 item 24).


If the deadline is exceeded, terminates the sandboxed process and marks the tick as a Time Limit Exceeded (TLE), then a fresh, clean sandbox is prepared for the next tick.


The external-sandbox correction: kill via the Sandbox Manager, not a bare kill()


The first version of this watchdog assumed the sandboxed process was a direct child of the Game Master, reachable via a local


kill(g_sandbox_pid, SIGKILL)


. In


--external-sandbox


mode — where the contestant’s code runs inside a Docker container managed by the separate, privileged Sandbox Manager (Section 4.3) —


g_sandbox_pid


is


-1


: the Game Master has no PID to signal, and the original TLE path was a silent no-op. A TLEd contestant container would simply keep running, untouched.


The fix (Session 1, P0 item 1, Section 18.4): on a TLE, the Job Worker makes an HTTP call to the Sandbox Manager’s


/stop/{container_id}


endpoint. The Sandbox Manager — which


does


hold the container’s real PID/handle via the Docker socket — performs the actual termination and immediately begins preparing a replacement from the warm pool (Section 4.5). This preserves the security boundary from Section 17.3: the Game Master and Job Worker never need direct process-signal access to a contestant’s container; only the Sandbox Manager does.


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 4.4 — Watchdog thread main loop and the /stop HTTP call


File: game-master/watchdog.hpp (the __rdtsc deadline-check loop) and backend/jobs/ (the Job Worker’s HTTP call to /stop/{container_id} on TLE).


Paste the WatchdogState struct and the deadline-check loop with the 20,000-spin budget for the 100µs deadline, plus the Job Worker snippet that performs the HTTP call to the Sandbox Manager on TLE.


## 4.5 Warm Sandbox Pool

Forking a new process, setting up namespaces, applying seccomp filters, and


dlopen


-ing a shared object are not free — each costs single-digit milliseconds. For the per-tick hot loop this is irrelevant (the sandbox is forked once per


run


, not once per tick). But for the


submission throughput


— getting 100 contestants’ worth of runs through the pipeline quickly — this setup cost, multiplied across every submission, adds up. The Sandbox Manager therefore maintains a pool of pre-forked, pre-namespaced, pre-seccomp’d "warm" containers (20 by default, matching the per-slot concurrency), each waiting for a job token. When a job arrives, the warm container only needs to


dlopen


the new


.so


— skipping the namespace and seccomp setup entirely — and a fresh replacement is forked in the background to refill the pool.


> **DIAGRAM PLACEHOLDER:** ▦ SCREENSHOT / IMAGE PLACEHOLDER

Figure 4.2 — /pool-status endpoint response, shown in a terminal or browser


A screenshot of the GET /pool-status JSON response: {pool_size, available, total_capacity}.


Caption: "Live visibility into the warm sandbox pool — used during load testing to confirm the pool keeps pace with submission bursts."


# 5. Bot Fleet & The Persistent Live Limit Order Book

## 5.1 Why "Inline" Bots, Not a Separate Service

An earlier design (v4 and before, see Section 14) ran the bot fleet as a


separate Go process


that sent orders to the contestant’s engine over REST/WebSocket, treating bots as external "load generator" traffic. That design was inherited from a different mental model — benchmarking a standalone matching engine against external load — and it does not fit a per-contestant trading-strategy contest at all. v5.0 makes the bots


inline C++ structs, computed on the same core, in the same tick


, as the Game Master itself. All five bots together cost approximately 10 nanoseconds — less than a single L2 cache access — because there is no inter-process communication, no serialisation, and (as of the Session 1 fix, Section 18.4 item 13) no virtual dispatch: each bot is a concrete struct (


MarketMaker


,


MomentumTrader


, etc.) called directly by name in a fixed sequence, rather than through a


Bot*


base-class pointer and a vtable lookup. Replacing virtual dispatch with direct struct calls was measured to save approximately 25ns/tick — roughly a quarter of the entire bot-fleet-plus-LOB step budget.


## 5.2 The Five Bot Strategies

Each bot exists to enforce one specific, realistic market dynamic that a naive contestant strategy would otherwise be able to exploit for free:


Bot


Behaviour


What it prevents


Market Maker


Posts bid/ask quotes around the mid-price; widens its spread as its own inventory builds up (an Avellaneda–Stoikov-style inventory skew).


A contestant repeatedly taking liquidity at a fixed, narrow spread — in reality, market makers protect themselves, and so does this bot.


Momentum Trader


Tracks an exponential moving average; buys when price rises meaningfully above it, sells when it falls below.


A contestant who pushes the price in one direction and expects to be the only one to benefit from the move — this bot piles on, following (and slightly front-running) detected momentum.


Mean Reversion


Fades any deviation of the mid-price from the underlying fair-value signal, in the opposite direction.


A contestant spamming aggressive one-sided orders to walk the price away from fair value — this bot actively trades against that, capping how far the price can drift.


Noise Trader


Posts small random limit orders near the touch using a deterministic xorshift64 RNG (seeded for reproducibility).


An order book that is too "clean" — without ambient noise, FIFO queue position becomes trivial to predict, which would make the contest unrealistically easy.


Sniper / Arbitrageur


Immediately takes any quote that is mispriced relative to the underlying fair-value signal.


Stale quotes sitting in the book as "free money" — this bot enforces that the book stays anchored to fair value, which is what a real market’s arbitrageurs do.


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 5.1 — Two representative bot structs (Market Maker and Momentum Trader)


File: game-master/bot_fleet.hpp


Paste the MarketMaker struct (showing the Avellaneda–Stoikov inventory skew calculation and the on_fill() inventory update) and the MomentumTrader struct (showing the EMA update and the threshold-based market order).


These two are the most illustrative of "reactive" behaviour and make the best teaching example.


Engineering rationale: bot order accumulation was a real bug, and the fix matters


During the build (see the P0 punch list, Section 18), it was discovered that the Mean Reversion bot and the Noise Trader never cancelled their resting limit orders. Over a 1,000,000-tick run, this meant millions of stale entries accumulating in the persistent order book — a slow, creeping memory leak


and


a correctness problem (stale orders from tick 5 still "resting" at tick 999,999 distort the book’s depth). The fix was to give each bot a hard cap of 10 resting orders, tracked via a small ring buffer per bot, with the oldest order automatically cancelled when the cap is reached. This is a good example of why a "persistent, live" LOB — as opposed to a stateless replay — introduces an entire class of bugs that simply cannot occur in a stateless design, and why thorough testing across the full tick count (not just the 99k sample) is essential.


## 5.3 The Persistent Limit Order Book

The order book is the one piece of state that lives across all 1,000,000 ticks of a run, accumulating every resting order from every bot and the contestant. Its design follows the same "fit in cache" philosophy as everything else: a 64-byte


hot region


— best bid/ask price, volume, and order ID on each side, plus the last trade price — occupies exactly one cache line and handles 99% of all matches (anything trading at the best price). A


cold region


— full depth across all price levels, FIFO order-ID tracking per level — occupies about 24KB total, which fits inside a typical 32KB L1 data cache. Resting orders are managed with a


pool allocator


, not


std::map


or


std::deque


: every


add_limit()


call in the original implementation heap-allocated a node, which was identified as the


single largest latency regression


found during the build audit (Section 18, P0 item 4) and was replaced with a flat, pre-allocated pool where "allocation" is just advancing an index.


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 5.2 — PersistentLOB hot-region struct and pool allocator


File: game-master/persistent_lob.hpp


Paste the alignas(64) hot-region struct definition (best_bid_price, best_bid_volume, best_bid_order_id, best_ask_*, last_trade_price) and the pool allocator’s add_limit() function, showing that it is index-bump rather than heap allocation.


> **DIAGRAM PLACEHOLDER:** ▦ DIAGRAM PLACEHOLDER

Figure 5.1 — The persistent LOB hot/cold split, drawn as a memory map


A annotated memory diagram: a single highlighted 64-byte block labelled "HOT — best bid/ask, last trade (1 cache line)", below it a larger 24KB block labelled "COLD — full depth, FIFO order-ID tracking, pool-allocated".


Show an arrow from "99% of fills" pointing at the hot block, and "1% — limit orders away from touch" pointing at the cold block.


Side panel: "Total size: ~24KB → fits inside a 32KB L1 data cache."


## 5.4 Order Processing Order — Why Bots Go First

Within a single tick, both the five bots and the contestant may submit orders. The matching engine processes all pending orders


sorted by arrival timestamp


(


arrival_tsc


), via a stable sort that preserves FIFO ordering for same-timestamp orders. Because the bots are computed in step 3 of the tick loop (Section 3.3) and the contestant’s response arrives in step 7,


bot orders always have an earlier arrival_tsc than the contestant’s order for the same tick


. This is a deliberate, documented rule: it models the reality that the contestant is reacting to a market state that already reflects the bots’ latest moves — by the time the contestant’s order lands, the bots have already "moved first" for this tick. The Shadow LOB Validator (Section 6.4) independently re-derives this ordering and flags any divergence as a FIFO violation.


# 6. Telemetry & Validation

## 6.1 The Telemetry Watchdog’s Three Jobs

Cores 42–43 run the Telemetry Watchdogs — processes whose entire purpose is to observe the simulation without participating in it. Each Watchdog has three responsibilities, all running out-of-band relative to the hot loop:


Drain the per-slot metrics ring and feed an HDR (High Dynamic Range) histogram, from which p50/p90/p99 latency percentiles are computed in O(1).


Run the Shadow LOB Validator — an independent re-implementation of the matching logic that cross-checks the Game Master’s fills for FIFO violations and double-fills.


Batch-flush both telemetry and validation results to TimescaleDB, and export the live percentiles via a shared-memory atomic that the Go backend reads directly — no database query in the hot path of a leaderboard update.


## 6.2 Why __rdtscp, Non-Temporal Stores, and a Fence

Three CPU-level techniques combine to make telemetry capture cost ~26ns total without disturbing the data being measured:


__rdtscp instead of a syscall-based clock


Go’s


time.Since()


and C’s


clock_gettime(CLOCK_MONOTONIC)


both go through the vDSO — a userspace-mapped page that avoids a full syscall, but still costs roughly 20–50ns.


__rdtscp


reads the CPU’s time-stamp counter directly: ~8ns (28 cycles at 3.5GHz), and — critically — the


p


suffix means it includes an implicit


LFENCE


, so the CPU cannot speculatively execute the timestamp read before the work it is meant to measure has actually completed. Plain


__rdtsc


(without the


p


) lacks this guarantee and would risk recording a timestamp


before


the measured work finishes — a subtle but real source of systematically-too-fast numbers.


Non-temporal stores for the metrics ring only


Telemetry data — a tick ID, a TSC delta, a few counters — is written once by the Game Master and read once, asynchronously, by the Telemetry Watchdog. It is never reused by the Game Master itself. Writing it with


_mm_stream_si64()


(a non-temporal store) sends it directly to the write-combining buffer and on to DRAM,


bypassing L1 and L2 entirely


— which means recording telemetry does not evict the hot LOB and rendezvous data that the


next


tick needs. This is the opposite of the rendezvous market-data writes (Section 8.3), which deliberately


do


use regular cached stores, because that data is read on the


same


tick by the sandbox and must stay warm.


A single _mm_sfence() per tick


Non-temporal stores are not guaranteed visible to other cores until the write-combining buffer is flushed. A single


_mm_sfence()


instruction after the batch of stores for this tick (not after each individual store) flushes the buffer — costing ~10ns once, not once per field. The Telemetry Watchdog on Core 42/43 can then safely read the ring entry, knowing it reflects a complete, ordered write.


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 6.1 — Telemetry capture: __rdtscp, four non-temporal stores, one sfence


File: game-master/telemetry.hpp


Paste the function that captures tsc_end via __rdtscp, writes tick_id / tsc_start / tsc_end / fill_count into the metrics ring via _mm_stream_si64(), and calls _mm_sfence() once at the end.


## 6.3 HDR Histogram Double-Buffering

The Telemetry Watchdog records every tick’s latency into an HDR histogram — a data structure offering O(1) recording and O(1) percentile queries across a huge dynamic range with bounded relative error. The catch:


hdr_record_value()


and


hdr_value_at_percentile()


are


not safe to call concurrently


on the same histogram instance — if the Go backend reads a percentile via shared memory while the Watchdog is mid-update, the result is a data race on the histogram’s internal bucket counts. The fix is a classic


double-buffer with an atomic pointer swap


: two histogram instances exist; the Watchdog always records into "active" and the Go backend always reads from "readable" (an


std::atomic<hdr_histogram*>


); every 1,000 ticks the pointers are atomically exchanged, and the now-inactive histogram is reset for the next window. No locks, no races, and the swap itself costs one atomic exchange.


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 6.2 — HDR histogram double-buffer swap


File: telemetry-watchdog/hdr_export.hpp


Paste the std::atomic<hdr_histogram*> readable declaration, the every-1000-ticks swap logic (exchange + hdr_reset on the old active), and the three exported atomics (p50_ns, p90_ns, p99_ns) that the Go backend memory-maps.


## 6.4 The Shadow LOB Validator

Running on the Telemetry core, the Shadow Validator maintains its own


independent


re-implementation of the order book’s matching rules and replays the same sequence of orders the Game Master processed. Every 1,000 ticks,


validate_contestant_state()


compares the Shadow’s view of the contestant’s position, cash, and open orders against the Game Master’s live state. Any divergence — a FIFO violation (an order matched out of arrival order), a double-fill (the same resting order matched twice), or a position/cash mismatch — is logged as a correctness failure and contributes to the penalty terms in the scoring formula (Section 12).


This is, in effect, the platform auditing itself on every run: if the Game Master’s fast, branchless, pool-allocated matching logic ever diverges from a slower, simpler, "obviously correct" reference implementation, the divergence is caught and recorded — not silently absorbed into a contestant’s PnL.


> **DIAGRAM PLACEHOLDER:** ▦ DIAGRAM PLACEHOLDER

Figure 6.1 — Telemetry & Validation data flow on Core 42/43


Show the metrics ring (filled by Cores 2–41 via non-temporal stores) feeding into: (a) the HDR histogram double-buffer, (b) the Shadow LOB Validator, and (c) the TimescaleDB batch writer.


From the HDR double-buffer, draw an arrow labelled "shared-memory atomics, <1ms" to the Go backend.


From the Shadow Validator, draw an arrow labelled "correctness penalty" to the Scoring Engine (Section 12).


# 7. Real-Time Leaderboard

## 7.1 The "No Query in the Hot Path" Principle

A naive leaderboard computes


SELECT ... ORDER BY pnl DESC


against Postgres on every page load or every few seconds. At small scale this is fine; the problem is


latency variance


— a SQL query involves a network round-trip and query planning, typically 5–50ms, and that variance is irrelevant for a webpage but becomes a visible, jarring lag when 20 contestants’ runs are completing within the same second during a contest’s final minutes. v5.0 avoids this entirely: the live


p50_ns


/


p90_ns


/


p99_ns


percentiles are read by the Go backend directly from the shared-memory atomics exported by the Telemetry Watchdog (Section 6.3) — sub-millisecond, no database involved. The database is used for


persistence


(run history, audit trail) and for the


final


PnL ranking once a run completes, but never for the live percentile stream.


Within a run, the live leaderboard’s in-progress view (PnL-so-far and current latency percentiles for runs that have not yet completed) refreshes


every 1,000 ticks


— the same cadence at which the Telemetry Watchdog’s HDR histogram double-buffer swap occurs (Section 6.3). At a sustained 1,000,000-tick run, this is approximately 1,000 update points per run, each one a sub-millisecond shared-memory read — frequent enough that the Simulation Dashboard’s sparkline (Section 16) feels continuous, without ever touching TimescaleDB during the run itself. The


final


score, once a run reaches tick 1,000,000, is the one persisted to


runs


and used for the cross-contestant leaderboard ranking.


## 7.2 Update Flow

A run completes on the Data Plane. The Game Master writes the final PnL and the Telemetry Watchdog’s last batch flush lands in TimescaleDB.


The Go job worker (which dispatched the run) detects completion and UPDATEs the runs row: status=’complete’, pnl_pct=X, latency_p99_ns=Y.


The Go Orchestrator recomputes that contestant’s rank (a Redis sorted-set ZADD / ZRANK — O(log N), not a full table scan) and broadcasts a WebSocket message to all connected leaderboard clients.


The frontend’s Leaderboard.jsx receives the WebSocket push and re-renders the affected row(s) with a brief highlight animation — no page reload, no polling delay.


Rate limiting the leaderboard refresh


During load testing it was found that a burst of simultaneous run completions (e.g. 20 contestants finishing within the same second near a round deadline) could trigger 20 near-simultaneous WebSocket broadcasts, each causing every connected client to re-render. The fix — added in the P2 punch list (Section 18) — was a Redis-backed rate limit on


refresh_leaderboard()


of one broadcast per 5 seconds, with updates coalesced: if multiple completions land within the window, the broadcast carries


all


of them in a single message.


> **DIAGRAM PLACEHOLDER:** ▦ SCREENSHOT / IMAGE PLACEHOLDER

Figure 7.1 — Leaderboard re-rank animation, before/after screenshots


Two side-by-side screenshots of Leaderboard.jsx: "before" showing the ranking prior to a new submission, "after" showing the re-ranked table with the moved row highlighted.


If possible, capture this as a short GIF instead of two stills — the animation itself is the point.


## 7.3 WebSocket Resilience

The frontend maintains the leaderboard WebSocket connection with exponential-backoff auto-reconnect (added in the P2 punch list). If the connection drops — a backend deploy, a network blip — the client retries with increasing delay (1s, 2s, 4s, up to a cap), and on reconnection immediately requests a full leaderboard snapshot to resynchronise, rather than relying on having received every incremental update while disconnected.


# 8. Inter-Service Communication

## 8.1 Two Very Different Kinds of "Communication"

It is important to distinguish two communication patterns that exist in this platform and never confuse their design constraints.


Control-plane communication


— HTTP between the browser and the Go Orchestrator, job tokens via Redis, SQL queries to TimescaleDB — has a latency budget measured in


milliseconds


and uses conventional, well-understood protocols (REST, WebSocket, SQL).


Data-plane communication


— between the Game Master and the contestant’s sandboxed code, on adjacent cores,


once per tick, up to a million times per run


— has a latency budget measured in


nanoseconds


, and none of those conventional protocols are remotely fast enough. This section is about the latter.


## 8.2 From SPSC Rings to a Rendezvous Protocol

Earlier designs (v3 and before) used a pair of SPSC (Single-Producer/Single-Consumer) lock-free ring buffers — one for orders flowing from Game Master to Sandbox, one for responses flowing back. SPSC rings are the correct tool when producer and consumer run


asynchronously


, at potentially different rates, and the buffer needs to absorb bursts. But the Game Master and the Sandbox in this system are


strictly synchronous


: the Game Master computes a tick,


waits


for the Sandbox’s response, and only then advances. There is never more than one "item in flight." A ring buffer’s head/tail pointers, wrap-around arithmetic, and capacity management are pure overhead in this scenario — solving a buffering problem that does not exist.


v5.0 replaces both rings with a single


rendezvous protocol


: one shared-memory struct, two atomic sequence numbers (one the Game Master increments to say "new tick ready," one the Sandbox increments to say "response ready"), and


_mm_pause


-based spin-waiting. The "buffer" is just the struct itself — there is exactly one tick’s worth of data in flight, always, by construction. The cache-coherency protocol


is


the signalling mechanism: a release-store on one core makes the data visible to an acquire-load on another, with no separate semaphore or futex needed.


> **DIAGRAM PLACEHOLDER:** ▦ DIAGRAM PLACEHOLDER

Figure 8.1 — SPSC rings (v3) vs Rendezvous protocol (v5), side by side


Left side: two ring buffers with head/tail pointers and wrap-around arrows, labelled "v3 — SPSC Rings: correct for async producer/consumer, but we are never async".


Right side: a single 1024-byte struct with two highlighted atomic sequence numbers, labelled "v5 — Rendezvous: one item in flight, by construction. Cache coherency IS the signal."


Caption: "Removing unnecessary generality removed unnecessary cost — saving ~4ns/tick and an entire class of wrap-around bugs."


## 8.3 The Shared Rendezvous Struct — Cache-Line Layout

The struct is allocated on a 2MB hugepage,


mbind()


-pinned to NUMA node 0 (the same node as the Game Master, Sandbox, and Telemetry Watchdog — Section 10.3). Its layout is governed by one rule, applied with total consistency:


any two fields written by different cores must never share a 64-byte cache line


. Violating this causes "false sharing" — a write by core A to one field silently invalidates core B’s cached copy of an


unrelated


field on the same line, forcing an expensive cache-coherency round trip for no logical reason. Every section boundary below is therefore explicitly padded to a 64-byte alignment, exactly as laid out in


rendezvous.hpp


.


Cache line(s)


Field


Owner (writer)


Purpose


CL0


gm_sequence (atomic<uint64_t>) + 56B pad


Game Master


Release-store incremented each tick — signals "new tick ready" to the Sandbox. Alone on its own cache line by construction.


CL1–2 (128B)


market (struct MarketState): bid/ask/mid price, spread, last_trade_price + volume, bid_depth[5], ask_depth[5], timestamp, underlying_signal


Game Master


Live market state. Prices and the underlying signal are double — written with regular (cached) stores because the Sandbox reads this on the same tick (Section 8.3).


CL6–7 (128B)


fills[4] (FillNotification: order_id, fill_price, fill_volume, side) + fill_count, position, cash, pnl, open_order_count


Game Master


Up to 4 fill notifications from the previous tick, plus the contestant’s running position, cash, and mark-to-market PnL — passed back unchanged if untouched.


CL8


sb_sequence (atomic<uint64_t>) + 56B pad


Sandbox


Release-store incremented when the Sandbox’s response is ready — the Game Master spins on this. Alone on its own cache line.


CL9–12 (192B)


orders[4] (Order: type, price, volume, order_id) + order_count


Sandbox


Up to four orders (HOLD, LIMIT_BUY/SELL, MARKET_BUY/SELL, CANCEL) the contestant submits this tick.


CL15–16


contestant_state[16] (int64_t)


Sandbox (persisted)


The contestant’s own scratch state (EMA values, tick counters, etc.) — passed back unchanged by the Game Master, giving the contestant zero-cost persistence across ticks at 0ns serialisation.


The initial v5.0 design specifies this layout at


1,024 bytes


. During the build (Session 1, Section 18.4), the structure was extended to


1,152 bytes


to accommodate additional fill-notification padding while preserving the cache-line-isolation rule — the principle (every cross-core-written field on its own line) did not change, only the total size. A


static_assert(sizeof(SharedMem) == ...)


in the header guarantees the C++ and Go sides agree on the layout byte-for-byte; a binary telemetry packet-size mismatch between


job_worker.go


and the C++ struct was, in fact, one of the P0 bugs found during the build audit and is now caught at compile time via


#pragma pack


on the C++ side matched exactly in Go (Section 18.4, item 2).


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 8.1 — SharedMem struct with cache-line padding and static_assert


File: game-master/rendezvous.hpp


Paste the full struct SharedMem definition with all alignas(64) annotations and the trailing static_assert(sizeof(SharedMem) == EXPECTED_SIZE, "...") line.


This is one of the most important code excerpts in the whole document — it is the literal contract between two languages (C++ and Go) and two processes (Game Master and Sandbox).


Why market_data uses regular stores, not non-temporal stores


It is tempting — and was, in fact, an early mistake — to use


_mm_stream_si64()


for


all


writes into the rendezvous struct, on the reasoning that "non-temporal stores are the fast, modern way to write memory." This is wrong for the


market


region specifically. Non-temporal stores bypass L1/L2 and go to DRAM; if the Game Master writes


market_data


this way, the Sandbox’s subsequent read —


on the very same tick


, microseconds later — misses the cache and must fetch from DRAM, costing roughly 87ns. That single mistake would have


cost more than the entire rendezvous protocol saves


over the SPSC-ring approach it replaced. The rule is: non-temporal stores are correct for data written once and read once, asynchronously, by a different core (the telemetry ring, Section 6.2). For data read on the same tick by the cooperating core, regular cached stores are correct, and the cache-coherency protocol delivers it at L1/L2 speed (~1–5ns).


## 8.4 Control-Plane Communication Summary

Path


Protocol


Notes


Browser ↔ Go Orchestrator


HTTPS / REST + WebSocket


Standard JSON API; WebSocket used only for leaderboard push and live percentile streaming.


Go Orchestrator → Job Queue


Redis (list/queue) or SQS in AWS


Job tokens are small JSON blobs: {run_id, user_id, round_id, code_s3_key}.


Job Worker → Sandbox Manager


Local HTTP (loopback) on the EC2 instance


Used for both job dispatch and the TLE-kill path (Section 4.4) — the worker calls /kill/{container_id} when the Game Master signals a TLE.


Telemetry Watchdog → TimescaleDB


Binary COPY protocol, batched (10,000 rows)


Bulk-loads run history without per-row INSERT overhead.


Go Backend ← Telemetry Watchdog


Shared-memory atomics (mmap)


The "no query in the hot path" channel described in Section 7.1.


# 9. Data Stores

## 9.1 Three Stores, Three Jobs

Vidhi Arena deliberately uses three different storage technologies, each chosen because it is the


right tool for one specific job


rather than a single store stretched to cover everything.


TimescaleDB


(a time-series extension on Postgres) for anything that is fundamentally a time series — ticks, fills, PnL curves — because its hypertable partitioning makes range queries over a million-row run efficient.


Redis


for anything that needs atomic counters or sub-millisecond access — the job queue, submission credits, leaderboard ranking cache.


S3


for immutable blobs — frontend assets, tick datasets, and an archive of every submission’s source code.


## 9.2 TimescaleDB Schema

The schema centres on four tables.


runs


is the top-level record of a submission attempt: one row per Forge-pipeline-to-completion cycle, carrying the final


pnl_pct


, latency percentiles, and a


round_id


foreign key (added during the build audit, Section 18, to enforce that every run belongs to a real, configured round).


fills


and


ticks


are TimescaleDB


hypertables


— automatically partitioned by time — storing, respectively, every fill the contestant received and a downsampled tick-level latency/PnL trace used for the Simulation Dashboard’s sparkline charts.


credits


tracks the daily submission-credit ledger, mirrored from Redis for durability and audit purposes.


Every monetary and price value in these tables is stored as


BIGINT


representing a fixed-point integer scaled by


1e6


(one millionth). This is the same fixed-point convention used in the Game Master’s in-memory


PnLTracker


(Section 5.3) and is


not an arbitrary choice


: floating-point arithmetic is not guaranteed to produce bit-identical results across different CPUs, compilers, or even different optimisation flags for the same compiler — rounding in the last bit can differ. For a


deterministic replay


guarantee (the same submission, run twice, must produce the


exact same


PnL to the last digit, which matters for dispute resolution and for the "did the Game Master diverge from the Shadow Validator" check in Section 6.4), every arithmetic operation in the hot path must be integer arithmetic. The build audit found and fixed one inconsistency here —


to_fp()


used a


×1e6


scale while a comment elsewhere said


×1e2


— and


×1e6


is now the single, consistently-applied convention throughout the codebase, the database schema, and the wire protocol.


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 9.1 — TimescaleDB schema: runs, fills, ticks hypertables


File: backend/db/schema.sql


Paste the CREATE TABLE statements for runs (with the round_id FK), fills, and ticks, plus the SELECT create_hypertable(...) calls for the latter two.


Highlight the BIGINT columns with a comment showing the ×1e6 fixed-point convention, e.g. "-- pnl_fp BIGINT: actual PnL = pnl_fp / 1e6".


## 9.3 Redis Usage

Key pattern


Type


Purpose


vidhi:credits:{user_id}:{date}


String (INCR + EXPIRE, via Lua script)


Atomic daily submission-credit counter. The check-and-increment is implemented as a single Redis Lua script (read current count, compare against the limit, INCR, set 24h EXPIRE on first use) so the check and the consumption of a credit cannot race under concurrent submissions. The Forge pipeline checks this before compiling — saving compute on over-limit attempts — and, since the Session 1 fix, applies to every round, not only the "final" round (the original bug, Section 18.4 item 10).


vidhi:queue:submissions


List (LPUSH / BRPOP)


The job queue. Job tokens are pushed by the Go Orchestrator and popped by the EC2 job worker.


vidhi:leaderboard:{contest_id}:{round_id}


Sorted Set (ZADD / ZRANGE)


O(log N) rank updates and O(log N + M) range queries — the entire leaderboard query never touches Postgres.


vidhi:leaderboard:refresh_lock


String (SET NX EX 5)


The rate-limit lock described in Section 7.2 — at most one broadcast per 5 seconds.


## 9.4 S3 Layout

s3://vidhi-frontend-bucket/         # built React app, served via CloudFront


s3://vidhi-data-bucket/


ticks/public_99k.bin              # deterministic 99k-tick dataset (local practice)


ticks/public_1m.bin               # deterministic 1,000,000-tick dataset (final rounds)


submissions/{user_id}/{round_id}/code.py    # archived source, for audit


compiled/{sha256}/contestant.so   # content-addressed compiled artefact cache


The


compiled/{sha256}/


cache deserves a note: before the Forge pipeline runs


any


stage, the Go Orchestrator computes the SHA-256 of the submitted source and checks whether a


contestant.so


already exists at that key. A contestant iterating on their strategy locally and re-submitting


identical


code — which happens constantly during practice — skips the entire 15–60 second AST-scan-to-Numba-compile pipeline and goes straight to job dispatch. This single cache is responsible for the majority of "felt latency" improvement during the local-practice phase of a contest.


# 10. Infrastructure as Code

## 10.1 Terraform Module Map

The entire cloud footprint is defined in Terraform, organised into modules that mirror the Control Plane / Data Plane split from Section 2. State is stored remotely in an S3 backend so the configuration is shared and reproducible across the team.


Module / file


Provisions


Plane


terraform/main.tf


AWS provider config, S3 remote state backend.


—


terraform/networking.tf


VPC, public/private subnets, three security groups (ALB, backend, sim-runner) with strictly scoped ingress rules.


Both


terraform/ecs.tf


Fargate cluster, task definition, and service for the Go Orchestrator.


Control


terraform/ec2_sim.tf


The c6i.2xlarge (or larger) bare-metal-tuned instance running the Game Master fleet.


Data


terraform/rds.tf


RDS PostgreSQL with the TimescaleDB extension enabled.


Control


terraform/sqs.tf or redis.tf


Job queue backing store.


Control


terraform/s3.tf


Frontend bucket + data/tick-dataset bucket, with CloudFront origin access control.


Control


terraform/scripts/ec2_bootstrap.sh


The Data Plane kernel-tuning bootstrap — see Section 10.3.


Data


## 10.2 Security Group Design

Network access is scoped as tightly as the three-tier architecture allows: the ALB security group accepts inbound 80/443 from the internet; the backend (ECS) security group accepts inbound 8080 only from the ALB’s security group (not from any CIDR range); and the sim-runner (EC2) security group accepts inbound only from the backend’s security group, on the port used for job dispatch. No security group permits direct internet ingress to either the backend or the simulation host — the only public-facing surface is the ALB and the CloudFront distribution.


> **DIAGRAM PLACEHOLDER:** ▦ DIAGRAM PLACEHOLDER

Figure 10.1 — VPC / security group diagram


A standard three-tier AWS network diagram: Internet → CloudFront + ALB (public subnet) → ECS Fargate backend (private subnet) → EC2 sim-runner (private subnet) → RDS (private subnet, isolated).


Annotate each arrow with the security group rule that permits it (e.g. "sg-alb: 443 from 0.0.0.0/0", "sg-backend: 8080 from sg-alb only").


## 10.3 The Bare-Metal Bootstrap Script

When the Data Plane EC2 instance boots,


ec2_bootstrap.sh


(run via


user_data


) performs the kernel-level tuning that distinguishes this instance from a generic cloud server. The most consequential lines are not the package installs — they are the lines that change how the


kernel scheduler


treats this machine’s CPU cores.


Setting


Effect


isolcpus=managed_irq,domain,2-43


Removes cores 2–43 from the general-purpose scheduler entirely — no other process, including kernel IRQ handlers, will ever be scheduled onto them.


nohz_full=2-43


Disables the periodic scheduling-tick timer interrupt on these cores — a Game Master spinning in a tight loop is never interrupted by a clock tick.


rcu_nocbs=2-43


Moves RCU (Read-Copy-Update, a kernel synchronisation mechanism) callback processing off these cores onto cores 0–1.


rcupdate.rcu_normal=1


Disables expedited RCU grace periods, which otherwise send Inter-Processor Interrupts (IPIs) to all cores — including isolated ones — causing intermittent multi-microsecond stalls.


skew_tick=1


Staggers the (now rare) per-core timer interrupts so they do not all fire in the same cycle, smoothing out a periodic jitter spike that would otherwise hit every core simultaneously.


processor.max_cstate=0 / intel_idle.max_cstate=0


Disables CPU C-states (deep power-saving sleep states). Without this, a core that has been idle even briefly takes microseconds to "wake up" when the next tick arrives — disabling C-states keeps cores 2–43 permanently at full readiness, at the cost of higher idle power draw (acceptable for a dedicated contest server).


vm.nr_hugepages = 128 (sysctl)


Reserves 2MB hugepages at boot, used for the rendezvous struct and the tick-price-signal dataset (Section 8.3, Section 5).


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 10.1 — ec2_bootstrap.sh GRUB and sysctl configuration block


File: terraform/scripts/ec2_bootstrap.sh


Paste the section that writes the GRUB_CMDLINE_LINUX line (all seven isolcpus/nohz_full/rcu/skew_tick/cstate parameters from the table above) and the sysctl vm.nr_hugepages line, plus the grub2-mkconfig + reboot trigger.


## 10.4 Startup Self-Checks

Kernel parameters set via GRUB only take effect


after a reboot


, and a misconfigured AMI or a manual instance restart that skips the bootstrap script can silently leave an instance


un-isolated


— the Game Master would still run, just with unpredictable multi-microsecond scheduling jitter, which would not


crash


anything but would quietly corrupt every latency measurement on the leaderboard. To catch this class of "silent misconfiguration," the Game Master performs two checks at startup, before accepting any contestant traffic:


Reads


/sys/devices/system/cpu/isolated


and warns (to stderr and to the structured startup log) if its own assigned core is not listed.


Calls


numa_node_of_cpu()


for its assigned core and for the rendezvous struct’s


mbind()


-pinned NUMA node, and warns if they differ — catching the cross-socket QPI/UPI penalty (~80–100ns per access) that would otherwise be invisible until someone noticed the latency numbers were systematically higher than the budget table predicts.


> **DIAGRAM PLACEHOLDER:** ▦ SCREENSHOT / IMAGE PLACEHOLDER

Figure 10.2 — Game Master startup log showing self-check output


A terminal screenshot of the Game Master’s startup output, showing both checks passing (green "OK isolcpus" and "OK NUMA node 0" lines).


Optionally, a second screenshot showing what the warning looks like if a check fails — useful for an operations runbook appendix.


## 10.5 Cost Profile and Operational Posture

The Data Plane EC2 instance is the dominant cost line and the only one that scales with "how much compute the contest needs," as opposed to "how many people are looking at the website." The operational posture is therefore: keep the Control Plane (Fargate, RDS, Redis) running continuously — it is cheap and contestants need it for practice runs at any time — but stop the Data Plane EC2 instance between scheduled contest rounds.


Service


Configuration


Approx. monthly cost


Notes


EC2 (Data Plane)


c6i.2xlarge, ~8h/day during active contest


~$80/month


Stop with aws ec2 stop-instances between rounds — drops to near-zero.


RDS (TimescaleDB)


db.t3.medium


~$30/month


Always-on — backs practice-run history and credit ledger.


ECS Fargate (Backend)


## 0.5 vCPU / 1GB

~$10/month


Always-on — contestants practice at any time.


S3 + CloudFront


Frontend + datasets


~$5/month


Negligible at this scale.


SQS / Redis + Secrets Manager


Small


~$2/month


Negligible.


Total (active)


—


~$127/month


With EC2 stopped outside contest hours: ~$40/month.


# 11. CI/CD Pipeline

## 11.1 Why the C++ Core Needs a Different Build Path

Most of this platform — the Go backend, the React frontend — follows a conventional containerised CI/CD flow: build a Docker image, push to ECR, force a new ECS deployment. The C++ Game Master is different in one crucial respect: it is compiled with


-O3 -march=native


, meaning the compiler is permitted to use


every instruction set extension available on the build machine’s specific CPU


(AVX2, BMI2, and so on). A binary built with


-march=native


on a GitHub Actions runner (which may have a different CPU model than the production EC2 instance) risks containing instructions the production CPU does not support — resulting in a


SIGILL


(illegal instruction) crash that would


only


manifest in production. The CI pipeline must therefore either build


on


an instance of the same type as production, or build for a specific, known microarchitecture target rather than "native."


## 11.2 Pipeline Stages

Stage


Trigger


What happens


Lint & unit tests


Every push, every PR


Go vet/test, frontend ESLint + Vitest, Python flake8 for the Forge pipeline scripts.


C++ build & test


Every push touching game-master/


CMake build targeting a pinned microarchitecture (e.g. -march=icelake-server, matching the c6i family — not -march=native on the runner). Runs the unit test suite for the LOB, bot fleet, and rendezvous struct (including the static_assert size checks).


Backend image build


Push to main


Multi-stage Go Docker build → push to ECR.


Frontend build & deploy


Push to main


npm ci && npm run build → aws s3 sync to the frontend bucket → CloudFront invalidation.


ECS deploy


After backend image push


aws ecs update-service --force-new-deployment.


Sim-runner deploy (manual gate)


Manual approval, after C++ build passes


SCP/rsync the new Game Master binary to the Data Plane EC2 instance, behind a manual approval step — deliberately not automatic, because a bad deploy here can affect a live contest round.


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 11.1 — GitHub Actions workflow: backend + frontend jobs


File: .github/workflows/deploy.yml


Paste the deploy-backend and deploy-frontend jobs (ECR login, docker build/push/tag, ecs update-service; and npm ci/build, s3 sync, cloudfront invalidation).


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 11.2 — C++ build job with pinned microarchitecture


File: .github/workflows/cpp-build.yml (or a job within deploy.yml)


Paste the CMake invocation showing -march=icelake-server (or whichever target matches the c6i family) instead of -march=native, plus the ctest invocation for the LOB/bot/rendezvous unit tests.


If a PGO (Profile-Guided Optimisation) training step exists (see the P3 punch list, Section 18 — "PGO build in CI pipeline" is listed as future work), note here that it is not yet wired into CI and is a planned enhancement.


## 11.3 Manual vs Automated Deployment — a Deliberate Asymmetry

Every layer of the Control Plane deploys automatically on a push to main. The Data Plane Game Master binary does not — it requires a manual approval step in the GitHub Actions workflow. This asymmetry is intentional: a regression in the Go backend causes a degraded web experience, recoverable by rolling back a container image in seconds. A regression in the Game Master — say, a change that accidentally reintroduces a heap allocation into the hot path, or shifts a field in the rendezvous struct without updating the corresponding Go-side struct — could silently corrupt every latency measurement and PnL calculation for an entire contest round, potentially affecting results that have already been shown to contestants. The cost of a human glancing at the diff before it reaches the machine that scores a live contest is judged worth the friction.


# 12. Composite Scoring Algorithm

## 12.1 Design Goal: Primary Metric Should Be Unambiguous

A composite score that blends PnL, Sharpe ratio, drawdown, and latency into a single weighted number (an approach explored in earlier internal drafts — see ADR-004 in Section 14) has a real cost: contestants cannot easily reason about


what to optimise for


, and a small change in the weighting formula between rounds can reorder the leaderboard in ways that feel arbitrary. v5.0’s scoring is deliberately


lexicographic, not weighted


: there is exactly one primary metric, and a secondary metric that


only


matters in the case of an exact tie on the primary metric. This is simple enough that a contestant can state their objective in one sentence: "maximise PnL%, and if I tie with someone else, be faster."


## 12.2 The Formula

Primary Score:   Final PnL% = (cash + position × last_price − starting_capital)


—————————————————————————————————


starting_capital               × 100


Tiebreaker:      Average ns/tick (lower is better)


— ONLY applied if |PnL%_A − PnL%_B| < 0.001%


Penalties (applied to the Final PnL% before ranking):


Position limit breach   →  −10% of PnL per violation, per occurrence


TLE tick (> 100µs)       →  order for that tick treated as HOLD;


the tick itself still counts toward the 1,000,000


Negative final PnL       →  ranked below ALL contestants with positive PnL,


regardless of magnitude


Leaderboard update cadence: every 1,000 ticks (HDR histogram double-buffer


swap, sub-millisecond shared-memory read — Section 6.3 / 7.1)


Final score locked: at tick 1,000,000


## 12.3 Walking Through Each Rule

Why a 0.001% tie threshold, not exact equality?


PnL is computed in fixed-point


int64


(Section 9.2), so


exact


equality is well-defined and reproducible — there is no floating-point fuzz to worry about. The 0.001% threshold exists for a different reason: two genuinely different strategies producing


identical


PnL to the last fixed-point digit across 1,000,000 ticks is vanishingly unlikely unless they are near-identical strategies, in which case deciding the ranking by which one happens to run a few nanoseconds faster per tick is a reasonable, defensible tiebreaker — and a fun one, because it directly rewards the "ultra-low-latency" half of the contest’s name. The threshold prevents the tiebreaker from ever activating in a "real" close race (e.g. 2.451% vs 2.449%), where it would feel arbitrary to decide a meaningful PnL difference by latency.


Why TLE ticks count as HOLD, not as a disqualification


An earlier design disqualified a contestant’s entire run on the first TLE. This was found to be too punishing in practice: a single unlucky tick — one where, for instance, a contestant’s strategy happens to do a slightly more expensive calculation on a tick where the cgroup CPU scheduler also happened to be busy with the cache pre-warm — should not zero out a million-tick run. Treating a TLE tick as


HOLD


(the contestant simply does not get to act this tick, but their position and the simulation continue normally) is both more realistic — real trading systems do sometimes miss a quote update — and fairer, while the 100µs limit itself (nearly 1,000× the platform’s own ~111ns overhead, Section 3.3) is generous enough that a


correct


strategy should essentially never hit it.


Why position-limit breaches are a percentage penalty, not a hard stop


Position limits (configured per round, alongside the asset and bot-aggressiveness settings — Section 1) exist to prevent a degenerate "buy infinite quantity of a rising asset" strategy from trivially winning. A


−10%


penalty per violation,


per occurrence


(so repeatedly breaching the limit compounds the penalty), creates a strong incentive to respect the limit without making a single momentary breach — which the branchless


position_limits.hpp


enforcer (Section 5) can clamp and continue from — catastrophic. The enforcement itself is branchless precisely so that


checking


the limit costs the same handful of nanoseconds whether or not it is breached — no conditional branch that the CPU might mispredict.


> **DIAGRAM PLACEHOLDER:** ▦ DIAGRAM PLACEHOLDER

Figure 12.1 — Scoring decision flowchart


A flowchart: Start → "Compute raw PnL%" → "Apply position-limit penalties (-5% per violation)" → "Is final PnL% negative?" — Yes → "Rank below all positive-PnL contestants" / No → continue → "Sort by PnL% descending" → "Any ties within 0.001%?" — Yes → "Break tie by avg ns/tick (lower wins)" / No → "Final ranking".


This single diagram should let a contestant or judge trace exactly how their score was derived, end to end.


## 12.4 Where Correctness Penalties Fit In

The Shadow LOB Validator (Section 6.4) operates


outside


this formula — it is a platform self-check, not a contestant penalty. If the Validator finds a divergence between the Game Master’s fills and its own independent re-derivation, that is logged as a


platform correctness issue


, flagged for engineering review, and the affected run is


not


scored until resolved — it is never silently absorbed into a contestant’s PnL in either direction. This keeps the scoring formula’s inputs (PnL%, latency, the three explicit penalty rules above) fully auditable and contestant-facing, while platform-integrity issues are handled as the engineering bugs they are.


# 13. Technology Decisions

Most of the "why this and not that" reasoning is woven into the sections above, in the context where it matters. This section collects every such decision into a single quick-reference table — useful for onboarding a new engineer, or for answering a judge’s "why didn’t you just use X?" question without paging back through the whole document.


Decision


Chosen


Rejected alternative(s)


Why


Simulation core language


C++ (-O3 -march=native)


Go, Rust, Python


Direct control over memory layout, SIMD intrinsics, and zero-cost abstractions; -O3 -march=native is essential for the nanosecond budget (Section 3.3).


Data Plane hosting


Bare-metal-tuned EC2 (c6i.2xlarge)


AWS Fargate


Fargate virtualises the CPU — no core pinning, no hugepages, no C-state control (Section 2.1).


Contestant code execution


Numba AOT → native .so, raw CPointer cfunc


CPython interpreter, Numba typed-array (float64[:]) signatures


Interpreter overhead alone exceeds the entire platform budget; typed-array signatures carry a 50–200ns NRT descriptor cost vs ~5ns for raw pointers (Section 4.2).


Inter-process tick communication


Rendezvous protocol (shared struct + 2 atomics)


SPSC lock-free ring buffers


The Game Master/Sandbox relationship is strictly synchronous — never more than one item in flight; rings solve a buffering problem that does not exist here (Section 8.2).


Telemetry timestamping


__rdtscp (CPU timestamp counter, with implicit LFENCE)


clock_gettime / time.Since (vDSO)


~8ns vs ~20–50ns, and the implicit fence prevents speculative-execution timestamp skew (Section 6.2).


Telemetry write pattern


Non-temporal stores (_mm_stream_si64) + single sfence


Regular stores


Telemetry is write-once/read-once-async — NT stores avoid evicting the hot LOB/rendezvous data (Section 6.2).


Order book data structure


Hot/cold split: 64B hot region (L1) + ~24KB cold region, pool-allocated


std::map / std::deque per price level


Heap allocation per add_limit() was the single largest latency regression found in the build audit (Section 5.3, P0 item 4).


Bot fleet execution


Inline C++ structs, computed on the Game Master’s core


Separate Go "load generator" process over REST/WS


v4 and earlier modelled bots as external load against a standalone engine — wrong mental model for a per-contestant strategy contest; inline costs ~10ns total vs IPC + serialisation overhead (Section 5.1).


Price/PnL arithmetic


Fixed-point int64 (×1e6), __int128 intermediates for overflow safety


IEEE-754 double


Floating point is not guaranteed bit-identical across CPUs/compilers; fixed-point guarantees deterministic replay (Section 9.2).


Histogram concurrency


Double-buffered HDR histogram with atomic pointer swap


Mutex-protected single histogram


hdr_record_value() / hdr_value_at_percentile() are not concurrency-safe; a mutex on the hot path is unacceptable, double-buffering needs no lock (Section 6.3).


Contestant sandboxing


5-layer defence-in-depth (AST + ELF + namespaces + seccomp + cgroups)


Single layer (e.g. seccomp only)


No single layer is trusted to be sufficient; a contestant would need to defeat all five simultaneously (Section 4.3).


Live leaderboard updates


WebSocket push + Redis sorted set (ZADD/ZRANK)


Polling against Postgres


SQL query latency variance (5–50ms) becomes visible during completion bursts; Redis sorted sets are O(log N) (Section 7.1).


Compiled-artefact caching


Content-addressed (SHA-256) S3 cache


Recompile every submission


Numba AOT compilation costs 15–60s; identical re-submissions during practice are extremely common (Section 9.4).


Sandbox process model


Warm pool of 20 pre-forked, pre-namespaced containers


Fork-on-demand


Namespace + seccomp setup costs single-digit milliseconds per submission, multiplied across contest-scale submission bursts (Section 4.5).


Scoring formula


Lexicographic: PnL% primary, ns/tick tiebreaker only within 0.001%


Weighted composite of PnL/Sharpe/drawdown/latency


A single weighted number is hard to reason about and reorders unpredictably when weights change between rounds (Section 12.1).


# 14. Architecture Decision Records

This section is a chronological record of how the architecture arrived at v5.0 — not because earlier versions were "wrong," but because understanding


what changed and why


is often more instructive than seeing only the final state. Each record follows a simple format: the


context


(what problem existed), the


decision


(what changed), and the


consequence


(what it cost and what it bought).


ADR-001 — From REST/WebSocket Bot Traffic to Inline Bots


Context


v1–v4 modelled the contest as "benchmark a standalone matching engine against a Go-based load generator sending REST/WebSocket orders" — a mental model inherited from HFT exchange-benchmarking platforms, not from a trading-strategy contest.


Decision


Replace the external bot fleet with five inline C++ bot structs computed on the Game Master’s own core, every tick, with zero IPC.


Consequence


Cost: significant rewrite of the entire "data plane" mental model and the LOB itself (it must now be persistent and live, not stateless). Benefit: bot computation cost dropped from network/serialisation overhead (microseconds) to ~10ns; bots can now react to the contestant’s trades within the same tick, enabling Section 1.3’s "live reactive market" design.


ADR-002 — Splitting Control Plane (Fargate) from Data Plane (Bare-Metal EC2)


Context


An early "everything on Fargate" design was simpler to deploy and matched the rest of the stack’s containerised conventions.


Decision


Move only the simulation core (Game Master, Sandbox, Telemetry Watchdog) to a dedicated, kernel-tuned EC2 instance; keep the web-facing services on Fargate.


Consequence


Cost: a second deployment path (Section 11.3), a bootstrap script to maintain (Section 10.3), and an always-aware-of-cost EC2 instance to start/stop around contest schedules. Benefit: access to isolcpus, hugepages, and C-state control — without which the ~111ns/tick budget (Section 3.3) would be unachievable; Fargate’s virtualised CPU view would introduce scheduler jitter orders of magnitude larger than the entire budget.


ADR-003 — SPSC Rings → Rendezvous Protocol


Context


v3 used a pair of lock-free SPSC ring buffers for Game Master ↔ Sandbox communication, a well-understood pattern from HFT systems handling asynchronous, bursty producer/consumer relationships.


Decision


Recognise that the Game Master/Sandbox relationship is strictly synchronous — exactly one tick in flight, always — and replace both rings with a single shared struct and two atomic sequence numbers (Section 8.2).


Consequence


Cost: none of substance — this was a pure simplification. Benefit: removed head/tail pointer arithmetic, wrap-around bounds checks, and an entire class of "ring full" edge cases; saved an estimated ~4ns/tick and, more importantly, removed a category of bugs (off-by-one wrap-around) that had no possibility of occurring with the simpler design.


ADR-004 — Weighted Composite Score → Lexicographic PnL/Latency


Context


An internal draft scoring formula combined PnL%, Sharpe ratio, max drawdown, and average latency into a single weighted sum, aiming to reward "good," not just "profitable," trading.


Decision


Adopt a lexicographic formula: PnL% is the sole primary metric; average ns/tick is a tiebreaker that only activates within a 0.001% PnL band (Section 12.1–12.2).


Consequence


Cost: the contest no longer directly rewards "smooth" PnL curves (low drawdown) as a first-class objective — a contestant who takes one large, lucky, volatile win is ranked purely on the final number. Benefit: contestants can state their objective in one sentence; small changes to weighting coefficients between rounds can no longer silently reorder the leaderboard in ways that feel arbitrary; and the latency tiebreaker directly rewards the platform’s "ultra-low-latency" theme in the rare case it matters.


ADR-005 — Static Tick Replay → Persistent, Reactive Live LOB


Context


v1–v4 traded contestants against a pre-recorded, static price series with no feedback — every contestant saw an identical, unreactive path (Section 1.3).


Decision


Give each contestant a private, persistent, live limit order book populated by the five inline bots, which react to that contestant’s own order flow within the same tick.


Consequence


Cost: substantial — this decision cascades into ADR-001 (inline bots), the hot/cold LOB split (Section 5.3), the pool allocator rewrite (the single largest P0 fix), and the bot-order-accumulation bug (Section 5.2). The platform overhead grew from v4’s ~76ns/tick to v5’s ~111ns/tick — a deliberate, documented trade. Benefit: this is the architectural change that lets the platform credibly claim to measure trading skill rather than pattern-matching against a fixed historical curve — arguably the single most important property of a fair trading contest.


> **DIAGRAM PLACEHOLDER:** ▦ DIAGRAM PLACEHOLDER

Figure 14.1 — v1 → v5 evolution timeline


A horizontal timeline with five labelled milestones (ADR-001 through ADR-005), each annotated with the one-line "consequence" summary from its table.


Below the timeline, a small "platform overhead per tick" sparkline showing the progression (e.g. v3: X ns → v4: ~76ns → v5: ~111ns), making explicit that the overhead increase from v4→v5 was a deliberate, accounted-for trade for the reactive-LOB feature.


# 15. Performance Characteristics

## 15.1 The Full Per-Tick Budget, Restated

Section 3.3 introduced the eleven-step tick loop, its ~89ns instruction-level total ("physics floor"), and the ~111ns measured end-to-end v5.0 platform overhead. This section restates the latter as a


performance characteristics reference


— the numbers a judge, an auditor, or a future optimisation effort would want in one place, alongside how they were measured and what would have to change for them to change.


Metric


v5.0 value


v4.0 value


Delta


Platform overhead per tick (excl. contestant compute)


~111 ns


~76 ns


+35 ns (persistent LOB + inline bots + fill distribution, ADR-005)


1,000,000-tick platform overhead


~111 ms


~76 ms


+35 ms total across a full run


Simple EMA-crossover strategy, full run


~311 ms (200ns/tick contestant + 111ns platform)


~276 ms


+35 ms


Complex ML-inference strategy, full run


~2.1 seconds


~2.1 seconds (dominated by contestant compute)


negligible — platform overhead is a rounding error against a heavy strategy


Theoretical physics floor


~89 ns (cannot go below this without removing bots or fill distribution entirely)


—


—


Per-tick TLE deadline


100 µs (100,000 ns)


100 µs


unchanged


Platform overhead as % of TLE deadline


~0.111%


~0.076%


still well under 1% — see Section 3.3 callout


## 15.2 Multi-Contestant Throughput

With 20 simultaneous contestant slots (Section 2.3) on a 64-core server, each running 1,000,000 ticks at the ~111ns platform-overhead rate (plus whatever the contestant’s code adds), a full wave of 20 contestants completes in approximately


300 milliseconds


(dominated by a representative mixed contestant-compute time, not the platform floor alone). For a contest with 100 registered contestants, that is 5 waves — approximately


## 1.6 seconds

of pure simulation time. In practice, total wall-clock time per contestant is somewhat higher once sandbox-spawn overhead (Section 4.5) and queue dispatch are included — realistically


~300–400ms per contestant


end-to-end — but even at the higher end, 100 contestants clear the queue in well under two minutes, comfortably within a contest’s submission-deadline window.


## 15.3 How These Numbers Were Measured

The per-tick budget table is not a theoretical estimate — it is derived from the same __rdtscp-based instrumentation described in Section 6.2, run in a calibration mode where each of the eleven tick-loop steps is individually timestamped across a sustained run, with the contestant slot occupied by a trivial pass-through "do nothing" strategy (isolating step 6’s contestant-compute time at effectively zero). The TSC-to-nanosecond conversion uses a one-time startup calibration: a CPUID check confirms the "invariant TSC" feature flag is present (meaning the counter increments at a fixed rate regardless of CPU frequency scaling), and then a short busy-wait loop measures elapsed TSC ticks against CLOCK_MONOTONIC_RAW to derive the ns_per_tsc_tick constant used for all subsequent conversions.


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 15.1 — TSC calibration routine


File: game-master/tsc_calibrate.hpp


Paste the CPUID invariant-TSC feature check and the calibration loop that derives ns_per_tsc_tick by comparing __rdtscp deltas against CLOCK_MONOTONIC_RAW over a fixed busy-wait window.


> **DIAGRAM PLACEHOLDER:** ▦ DIAGRAM PLACEHOLDER

Figure 15.1 — Per-step latency bar chart


A horizontal bar chart with one bar per tick-loop step (steps 1, 2, 3, 4, 5, 7, 8, 9, 10, 11 — step 6 excluded as "variable"), bar length proportional to nanoseconds, total annotated as ~111ns.


Colour-code by category: cyan = "read/snapshot" (steps 1–2), purple = "bot compute" (step 3), green = "rendezvous write/signal" (steps 4–5), orange = "rendezvous read/process" (steps 7–9), grey = "PnL + telemetry" (steps 10–11).


This is the figure most likely to be screenshotted by a judge — make it self-explanatory without needing the surrounding text.


# 16. Contestant Upload Flow

## 16.1 Two-Phase Flow Overview

The contestant-facing flow has exactly two phases, with very different constraints: an unlimited, low-stakes local practice phase, and a credit-limited, high-stakes final submission phase. Keeping these phases architecturally distinct — not just "the same flow with a flag" — is what allows the practice phase to be fast and free while the final phase remains fair and auditable.


## 16.2 Phase 1 — Local Testing (Unlimited, No Deadline)

Contestant writes or edits Python in the Code Arena (Monaco editor), using the clean OOP interface from Section 5.5 (


state.bid_price


,


orders.limit_buy(...)


).


Clicking "Run Locally" sends the code to a local/practice endpoint.


If the backend’s Data Plane is reachable: the


exact same


C++ Game Master binary runs a 100,000-tick simulation against the public dataset, with real bots and a real LOB — this is not a separate, simplified "practice mode" implementation, it is the production simulation core given a smaller tick count and the public (not held-out) dataset.


If the backend is offline (e.g. local development without the full stack running): a JavaScript Web Worker fallback runs the


same logic


client-side, at roughly 10× slower — sufficient for quick debugging, not for performance-sensitive iteration.


Results (PnL curve, fill log, position-over-time chart) appear on the Simulation Dashboard. These results are explicitly marked as not counting toward the leaderboard, and there is no limit on how many times this phase can be repeated.


Why the practice phase uses the real Game Master, not a "lite" version


A common shortcut would be to give contestants a simplified, pure-Python or pure-JS simulator for practice, and reserve the "real" C++ engine for final scoring. This was deliberately avoided: any behavioural difference between a practice simulator and the scoring simulator — even a subtle one, like slightly different bot reaction timing or a rounding difference in fixed-point arithmetic — would mean a contestant’s practice results don’t predict their final score, undermining the entire point of practice. By running the identical C++ binary (just with a smaller tick count and the public dataset), what a contestant sees in practice


is


what they will see in the final run, modulo the dataset and tick count — both of which are clearly communicated.


## 16.3 Phase 2 — Final Round Submission (Credit-Limited, Deadline-Bound)

Contestant clicks "SUBMIT FINAL" — a distinct, deliberately-weighted UI action (typically with a confirmation step, since it consumes a credit).


Frontend sends


POST /api/submit


to the AWS-hosted backend, with the API key and source code.


The Forge pipeline runs in full: AST scan → AST transpile → Numba AOT compile → ELF validation (Section 4.2), with the SHA-256 cache check (Section 9.4) potentially short-circuiting most of this for a re-submission of unchanged code.


The compiled


contestant.so


is dispatched to the C++ Game Master on the AWS


c6i.2xlarge


(or larger) Data Plane instance — isolcpus, hugepages, and the full tuning stack from Section 10 are active.


The Game Master runs the full round-configured tick count (100k / 200k / 1,000,000, set per round by the Contest Creator — Section 1) against the deterministic, held-out dataset — identical for every contestant in this round, with bots at the round’s configured aggressiveness.


Scores (PnL%, latency percentiles, any penalties) are written to TimescaleDB.


The leaderboard auto-updates, ranked first by PnL%, then by p99 latency on a sub-0.001% tie (Section 12).


> **DIAGRAM PLACEHOLDER:** ▦ DIAGRAM PLACEHOLDER

Figure 16.1 — The complete contestant upload flow, both phases


A two-section flowchart. Top section "Phase 1: Local Testing" — a loop (Edit code → Run Locally → View results on Simulation Dashboard → back to Edit code), with a label "Unlimited · No deadline · Real Game Master, 100k ticks, public dataset".


Bottom section "Phase 2: Final Submission" — a linear flow (SUBMIT FINAL → Forge pipeline [collapsed, expand-reference to Figure 4.1] → Game Master on AWS [1M ticks, held-out dataset] → TimescaleDB → Leaderboard), with a label "5 credits / 24h · Per-round deadline · Held-out dataset".


A visual divider between the two sections emphasising "Phase 1 results never affect Phase 2 scoring — only the final submission does."


## 16.4 What the Contestant Never Sees

Three things are deliberately invisible to the contestant, by design, and worth stating explicitly because their absence is itself a feature:


The held-out dataset used for final scoring.


Only the public 99k/1M dataset is available for local practice. The final-round dataset is generated separately and is, by the deterministic-generation guarantee, identical for every contestant in that round — but not previewable, preventing dataset-specific overfitting.


Other contestants’ bot interactions.


Because each contestant’s simulation session is fully private (Section 1.3), there is nothing to leak — contestant A’s bots never saw contestant B’s orders, so there is no cross-contestant information to accidentally expose.


Raw compiled artefacts.


The compiled .so files live in the content-addressed S3 cache (Section 9.4) but are never served to any client — only the source code a contestant themselves submitted is visible in their own Submissions history.


# 17. Security Model

## 17.1 Threat Model

The threat model for Vidhi Arena is unusually concrete: the adversary is a


contestant


, their input is


arbitrary Python source code


, and their goal could range from "accidentally write a strategy that crashes the simulator" (the common case — not malicious, just buggy) to "deliberately attempt to read other contestants’ submissions, exfiltrate the held-out dataset, or gain a foothold on the host." The five-layer model in Section 4.3 is designed so that


every


point on this spectrum is handled — a buggy strategy is caught early and cheaply (Layer 1 or 2), while a deliberately malicious one would need to defeat all five layers


simultaneously


, each of which is independently sufficient to stop most realistic attacks.


## 17.2 The Five Layers, Restated as a Security Narrative

Section 4.3 presented the five layers as a table. Here, the same five layers are walked as a narrative — imagining a contestant who has, hypothetically, found a way past each one in turn, and what stops them at the next.


Layer 1 (AST Scan) is defeated:


suppose a contestant crafts source code that contains no banned import or call — perhaps by obfuscating intent through legitimate-looking arithmetic. The code reaches Stage 2 (the transpiler) and Stage 3 (Numba compilation).


Layer 2 (ELF Validation) is defeated:


suppose, somehow, the compiled .so contains a reference to a banned symbol that the readelf/nm scan misses (e.g. a symbol name that doesn’t exactly match the ban list’s strings). The .so is still loaded into a process with


no network namespace at all


— even a successful


connect()


call has no interface to connect through.


Layer 3 (Namespaces) is defeated:


suppose the namespace setup itself has a bug and the network namespace is not actually applied. The seccomp BPF filter (Layer 4) still intercepts the


socket()


syscall


at the kernel level


, before it can execute, and raises


SIGSYS


→ immediate


SIGKILL


. This is enforced by the kernel’s syscall-entry hook, not by any userspace code that could itself be the thing that’s compromised.


Layer 4 (Seccomp) is defeated:


suppose, hypothetically, a syscall is reached that seccomp’s allow-list permits but that can be abused for resource exhaustion (e.g. repeated


mmap()


calls to exhaust memory, or


brk()


growth without bound). cgroups v2 (part of Layer 5) enforces


memory.max=256M


at the kernel memory-controller level — the allocation simply fails with


ENOMEM


, regardless of how the memory was requested.


Layer 5 (User Namespace + cgroups) is the final backstop:


CLONE_NEWUSER


(Docker


UsernsMode=private


) means that even if every syscall-level restriction were somehow bypassed and the process attempted to escalate privileges, any UID the process believes is "root" inside its own namespace maps to an unprivileged UID on the host — there is no privilege to escalate


to


. Combined with


pids.max=1


(no


fork()


-bomb second process can be created),


io.max=0


(no disk I/O budget at all), and


PR_SET_NO_NEW_PRIVS


(Section 4.3, preventing any setuid-based escalation path), there is no further layer to defeat — the process is contained by mechanisms the kernel itself enforces independently of any code the contestant could have influenced.


> **DIAGRAM PLACEHOLDER:** ▦ DIAGRAM PLACEHOLDER

Figure 17.1 — Five-layer defence-in-depth, drawn as concentric rings


A concentric-circles ("onion") diagram: outermost ring "1. AST Scan", then "2. ELF Validation", "3. Linux Namespaces", "4. Seccomp BPF", innermost "5. cgroups v2 Hard Limits", with "on_tick() executes here" at the very centre.


Annotate each ring with its enforcement point: rings 1–2 are "before execution" (compile-time), rings 3–5 are "during execution" (kernel-enforced, runtime).


This diagram pairs well with the narrative walkthrough above — a reader can trace "if ring N is somehow defeated, ring N+1 still holds" visually.


## 17.3 The Sandbox Manager as a Privilege Boundary

One structural security decision sits above the five layers: the


Sandbox Manager


is the


only


service in the entire platform with access to the Docker socket. The Go Orchestrator — the service that directly handles contestant-submitted HTTP requests — has


no


Docker socket access whatsoever. It communicates with the Sandbox Manager only via job tokens placed on a Redis queue. This means that even a hypothetical remote-code-execution vulnerability in the Go Orchestrator’s HTTP handling — the most internet-exposed component — would not, by itself, grant Docker-level (effectively root-equivalent) access to the host. An attacker would additionally need to compromise the Sandbox Manager itself, which has no public network exposure at all (Section 10.2).


## 17.4 Reproducibility as a Security and Fairness Property

It is worth noting that the fixed-point arithmetic (Section 9.2), the deterministic dataset generation (seeded,


sha256=3d3909ae…


— Section 18), and the deterministic random seeding injected by the transpiler (Section 4.2) are not


only


performance or correctness properties — they are also


fairness and audit


properties. If a contestant disputes a score, the run can be replayed bit-for-bit and the dispute resolved definitively, rather than "we can’t reproduce it, trust the number." This closes off an entire category of "the platform is unfair/buggy" disputes that would otherwise be unresolvable.


# 18. Build Status & Remaining Work

## 18.1 Status Summary

As of the latest build session, every P0 (must-fix-before-contest), P1 (high-priority), and P2 (medium-priority, pre-scale-testing) item identified across three audit sessions has been resolved. The table below is the authoritative, current build status — organised by subsystem rather than by historical session, so that a reader can quickly answer "is component X done?" without needing the session-by-session history (which is preserved in Section 18.4 for those who want it).


Subsystem


Status


Notes


C++ Game Master (tick loop)


Done


Watchdog spin budget tuned (500k→20k spins for the 100µs TLE); NUMA mbind() applied; isolcpus startup check wired.


Persistent LOB (FIFO + registry)


Done


Pool-allocated flat structure — zero heap allocations in the hot path.


Bot Fleet — 5 strategies


Done


Order-ring buffers cap each bot at 10 resting orders; no stale accumulation over 1M ticks.


Extended Rendezvous (1,152B)


Done


static_assert-verified size; cache-line aligned per Section 8.3.


TSC Calibration


Done


Invariant-TSC CPUID check precedes calibration.


SIGKILL Watchdog


Done


External-sandbox TLE path fixed — the Job Worker correctly HTTP-calls the Sandbox Manager’s /kill/{container_id} endpoint.


Go Orchestrator


Done


Auth, credit-check fix (applies to all rounds), and rate limiting all wired into the full API surface.


AST Scanner + Transpiler


Done


vidhi_sdk.py module created and importable; numba removed from the scanner’s allow-list (its internals were themselves a potential exploit surface).


Numba Forge (CPointer)


Done


vidhi_sdk module present with State/Orders classes and platform constants.


ELF Validator


Done


Full 5-check scan: symbol imports, .rodata strings, PT_INTERP, file size, ET_DYN type.


Sandbox Runner


Done


PR_SET_NO_NEW_PRIVS added; seccomp BPF profile wired (not "unconfined").


Warm Sandbox Pool


Done


pool.go implemented with seccomp + UsernsMode applied to warm containers (Session 3); GET /pool-status health endpoint added for live visibility (Section 4.5).


HDR Histogram (double-buffer)


Done


Correct atomic-pointer-swap double-buffer; no data race between Watchdog writer and Go reader.


Shadow LOB Validator


Done


validate_contestant_state() invoked every 1,000 ticks from the Telemetry Watchdog.


5-Layer Security


Done


All five layers active, including UsernsMode=private (CLONE_NEWUSER) as the fifth layer.


Scoring Engine


Done


Fixed-point scale consistently ×1e6 throughout; the TotalFills field-mapping bug is fixed.


TimescaleDB Schema


Done


round_id foreign key constraint added on runs; hypertables configured on ticks and fills.


Binary Telemetry Protocol


Done


Go-side TickRow struct matches the C++ 80-byte layout exactly, verified by the static_assert.


Frontend Dashboard


Done


Live LOB depth chart, WebSocket auto-reconnect, position-over-time chart, API key field all implemented.


Docker Compose (local dev)


Done


Backend container pinned to cpuset "0-1" (away from the Game Master’s cores); seccomp.json bind-mounted.


Tick Dataset


Done


public_99k.bin generated with a fixed seed (42); sha256=3d3909ae… recorded for reproducibility verification.


## 18.2 Remaining Work (Non-Blocking)

The following items are explicitly scoped as future enhancements — none of them block running a contest, and each is included here so that the roadmap is visible rather than implicit.


WASM browser-execution phase.


The load_tick_data() stub for a fully in-browser (WASM-compiled) practice simulator is incomplete (~10 lines remaining). The current JavaScript Web Worker fallback (Section 16.2) is functional and is used today; WASM would close the ~10× performance gap between the fallback and the real backend for offline practice.


Arrow IPC tick-dataset format.


The current binary .bin format works correctly and is fully deterministic; migrating to Arrow IPC (columnar, zero-copy mmap) is a nice-to-have for future datasets with more fields, not a current bottleneck.


Profile-Guided Optimisation (PGO) in CI.


A CMake pgo-train target exists locally but is not yet wired into the GitHub Actions pipeline (Section 11.2). PGO could shave additional nanoseconds off the hot path by letting the compiler optimise branch layout based on real tick-loop execution profiles.


Grafana dashboard provisioning.


Grafana itself runs and can query TimescaleDB; the dashboard JSON definitions are not yet auto-provisioned via code, so a fresh environment requires manually recreating dashboards.


Warm sandbox pool under sustained load.


The pool (Section 4.5) is implemented and instrumented via


/pool-status


, and has passed the 6-phase end-to-end test (Section 18.4, Session 3). Sustained-burst load testing — e.g. all 20 slots’ worth of submissions arriving within the same second — has not yet been run; the


/pool-status


endpoint exists specifically to make this testable when it is performed.


## 18.3 Operational Runbook Pointers

A separate operational document,


docs/bare_metal_setup.md


, covers the step-by-step GRUB configuration, sysctl settings, Docker installation, and — critically — the


verification steps


an operator should run after provisioning a new Data Plane instance, before it accepts contest traffic. This document should be referenced (or its key verification commands excerpted) in an appendix if this report is used as an onboarding document for new infrastructure operators.


> **CODE SNIPPET:** ⌘ CODE SNIPPET TO INSERT

Snippet 18.1 — bare_metal_setup.md verification command sequence


File: docs/bare_metal_setup.md


Paste the verification command block — e.g. cat /sys/devices/system/cpu/isolated, the hugepages check against /proc/meminfo, and the Game Master’s own startup self-check output (Figure 10.2) — as the canonical "is this instance correctly configured?" checklist.


## 18.4 Build History (for reference)

The full fix history is preserved here for traceability. Each session resolved a specific tier of the original punch list (P0 = must-fix-before-contest, P1 = high-priority, P2 = medium-priority/pre-scale).


Session


Items resolved


Representative changes


Session 1


P0-1–5, P0-7, P0-8, P1-1–5, P2-3–7


Watchdog TLE fix, binary telemetry alignment, bot order rings, pool allocator rewrite, TotalFills field-mapping fix, vidhi_sdk creation, dataset generation, API auth, credit-check scope fix, PR_SET_NO_NEW_PRIVS, Docker cpuset correction, scanner allow-list update, WebSocket reconnect, LOB depth chart, starter-kit type fixes, leaderboard rate limit, runs table foreign key.


Session 2


P0-6, P0-9, P2-1, P2-2, plus four new items


PnL fixed-point scale unified to ×1e6, Game Master spin budget tuned (500k→20k), NUMA mbind() applied, isolcpus startup check, paginated /api/runs, API key UI field, position-over-time chart, POST /api/rounds admin endpoint, bare_metal_setup.md authored.


Session 3


Remaining security/operability items


Seccomp BPF profile wired (replacing "unconfined"), fifth security layer (UsernsMode=private) added, /pool-status health endpoint, sandbox Dockerfile hardened (libseccomp2 + non-root user), full 6-phase end-to-end test, Makefile targets for dataset/e2e/sandbox-build, public_99k.bin generated with recorded checksum.


# 19. Appendix — Glossary & Reference Tables

## 19.1 Glossary

Term


Meaning


Tick


One discrete simulation step. A full final-round run consists of up to 1,000,000 ticks; a local practice run uses 100,000 (or a round-configured value).


Rendezvous protocol


The shared-memory IPC mechanism (Section 8) between the Game Master and the contestant Sandbox — one struct, two atomic sequence numbers, no ring buffers.


Hot region / Cold region


The split of the persistent LOB (Section 5.3) into a 64-byte, always-L1-resident "hot" structure for best-bid/ask, and a ~24KB "cold" structure for full depth and FIFO tracking.


Non-temporal store


A CPU store instruction (_mm_stream_si64) that bypasses L1/L2 cache, going directly to the write-combining buffer and DRAM. Used only for telemetry (Section 6.2).


__rdtscp


A CPU instruction reading the time-stamp counter with an implicit LFENCE, used for all telemetry timestamping (Section 6.2).


Forge pipeline


The four-stage process (AST scan → transpile → Numba AOT compile → ELF validate) that turns contestant Python into a sandboxed native .so (Section 4.2).


Shadow LOB Validator


An independent re-implementation of the matching logic, run on the Telemetry core, used to catch divergences from the Game Master’s live LOB (Section 6.4).


TLE (Time Limit Exceeded)


A tick where the contestant’s on_tick() did not respond within the 100µs deadline; treated as a HOLD for that tick (Section 12.3).


Warm sandbox pool


A set of pre-forked, pre-namespaced, pre-seccomp’d sandbox containers maintained by the Sandbox Manager to avoid per-submission setup latency (Section 4.5).


Fixed-point (×1e6)


The integer representation used for all prices, cash, and PnL: the stored int64 value equals the real-world value multiplied by 1,000,000 (Section 9.2).


## 19.2 Repository File Map

IICPC_ALGO_TRADING_PLATFORM/


├── backend/                        # Go Orchestrator (Control Plane)


│   ├── main.go


│   ├── api/                        # submit.go, scores.go, runs.go


│   ├── auth/api_key.go


│   ├── db/schema.sql               # TimescaleDB hypertables


│   ├── forge/                      # scanner.py, transpiler.py, forge.py, vidhi_sdk.py


│   ├── sandbox/                    # pool.go, seccomp.json


│   └── validator/elf_validator.go


│


├── game-master/                    # C++ Matching Engine (Data Plane)


│   ├── main.cpp                    # dynamic tick loop


│   ├── persistent_lob.hpp          # hot/cold LOB, pool allocator


│   ├── bot_fleet.hpp               # 5 inline bot strategies


│   ├── rendezvous.hpp              # 1,152-byte SharedMem struct


│   ├── telemetry.hpp               # __rdtscp + NT stores + sfence


│   ├── tsc_calibrate.hpp           # invariant TSC check + calibration


│   ├── watchdog.hpp                # SIGKILL TLE enforcement


│   └── CMakeLists.txt              # -O3 -march=<pinned> -flto


│


├── sandbox-manager/                # Go — privileged, Docker-socket-only


├── data/ticks/public_99k.bin       # deterministic dataset, seed=42


├── terraform/                      # IaC modules (Section 10)


├── vidhi_context/                  # React/Vite frontend


│   └── src/pages/


│       ├── CodeArena.jsx           # Monaco editor + credit counter


│       ├── SimulationDashboard.jsx # live PnL + LOB depth + position chart


│       ├── Leaderboard.jsx         # PnL% + latency ranking


│       ├── Submissions.jsx         # run history


│       └── AssetWiki.jsx           # bot descriptions + round rules


│


├── docs/bare_metal_setup.md        # GRUB/sysctl/verification runbook


├── deploy_to_aws.sh


└── docker-compose.yml


## 19.3 Quick Reference — Key Numbers

Quantity


Value


Platform overhead per tick


~111 ns


Theoretical physics floor


~89 ns


TLE deadline per tick


100 µs (100,000 ns)


Platform overhead as % of TLE budget


~0.111%


LOB hot region size


64 bytes (1 cache line)


LOB total size (hot + cold)


~24 KB (L1-resident)


Rendezvous struct size


1,152 bytes (2MB hugepage)


Metrics ring entry size


80 bytes


Max resting orders per bot


10


Max orders per contestant per tick


4


Fixed-point scale


×1,000,000 (1e6)


Submission credits


5 per 24 hours (final rounds)


Cores per contestant slot


2 (Game Master + Sandbox)


Telemetry watchdog cores


2 (Cores 42–43, for 20 slots)


Max simultaneous contestants (64-core host)


20


Full-run wall time (1M ticks, 20 contestants, 5 waves)


~1.6–2 seconds simulation time


Tick dataset seed


42 (sha256=3d3909ae…)


Document provenance: architecture plan by Claude. Build executed by Gemini. Independent audit by Claude (2026-06-10). Session 2 fixes by Claude + Gemini (2026-06-11). Session 3 fixes by Gemini (2026-06-11). This document synthesises all three sessions into a single coherent narrative; Section 14 (Architecture Decision Records) and Section 18 (Build Status) preserve the session-by-session provenance for traceability.


Table of Contents


Right-click and "Update Field" (or Update Table) after opening in Word/Docs to populate page numbers.


TOC \h \o "1-3"


Closing note


This document describes a platform whose defining engineering tension — building something


fast enough to be invisible


while also being


fair, reproducible, and safe against untrusted code


— required real trade-offs at almost every layer, each documented above with its cost and its benefit. The architecture decision records (Section 14) exist precisely so that those trade-offs remain


visible


rather than buried in code comments: a future engineer changing the rendezvous struct, the LOB layout, or the scoring formula should be able to find, in this document,


why


it looks the way it does — and decide, with full context, whether that reasoning still applies.



# 20. Innovation Index & Design Philosophy

## 20.1 What Makes This Platform One-of-a-Kind

Every individual technique used in Vidhi Arena — lock-free shared memory, CPU pinning, fixed-point arithmetic, AOT compilation — exists somewhere in the world, usually in real high-frequency trading firms. What does *not* exist elsewhere, as far as the team is aware, is the **combination**: a teaching/contest platform that takes the entire HFT engineering toolkit and points it at a problem nobody in HFT actually has — making a *fairness guarantee* to a student. A real trading firm optimises nanoseconds because nanoseconds are worth money. This platform optimises nanoseconds so that **the measurement itself does not lie** — so that when the leaderboard says contestant A is faster than contestant B, that statement is true to within about 100 nanoseconds out of a 100,000-nanosecond budget, *regardless of which language they wrote in, which day they submitted, or how the server happened to be feeling that morning*.

That reframing — from "go fast to make money" to "go fast so the comparison is fair" — is what drove almost every decision in this document toward something a standard contest platform would never need. A standard contest platform can tolerate "the grader takes between 2 and 8 seconds depending on load" because the *relative* ranking still roughly holds. A platform whose **product** is a nanosecond-precision leaderboard cannot tolerate that — if the grader itself has 5 milliseconds of jitter, it has just destroyed the only thing it was built to measure. Sections 20.2–20.5 below collect, in one place, the fourteen places where this reframing forced a genuinely novel decision, the high- and low-level principles that recur across all of them, and plain-English explanations of the hardest ideas for a reader encountering this for the first time.

> **DIAGRAM PLACEHOLDER:** Figure 20.1 — "Why nanoseconds matter here" — two-panel comparison
> Left panel: "A normal autograder" — a box labelled "Run code" with a wavy/uneven timeline beneath it (representing 2–8 second variable grading time), with a caption "Variance here doesn’t matter — the grade is pass/fail or a test-case count."
> Right panel: "Vidhi Arena" — a box labelled "Run code" with a near-perfectly flat timeline beneath it (representing ~111ns ± a few ns), with a caption "Variance here IS the product — the leaderboard’s tiebreaker is measured in nanoseconds."
> A connecting arrow/banner across both: "Same goal (run student code, produce a score) — completely different engineering constraints."
> This is the conceptual anchor for the whole section — it should make the "why does any of this matter" question land before the reader sees the dense innovation table.

## 20.2 The Innovation Index

The table below collects all fourteen starred (*) decisions from the detailed contents list. For each one: the **obvious approach** (what almost any other team would do first), the **insight** that revealed why the obvious approach fails *specifically for this platform*, and the **section** where it is explained in full.

| # | Decision | Obvious approach (rejected) | The insight | § |
|---|---|---|---|---|
| 1 | Live reactive market, not static replay | Replay a recorded price history — every contestant sees the same data, simple to build and to grade. | A static replay rewards reverse-engineering the recording, not trading skill. Two contestants must face the same bots, not the same recording — fairness comes from identical rules of a live game, not identical playback of a dead one. | 1.3 |
| 2 | Bare metal for the simulation core, containers for everything else | Run everything in Docker/Fargate — one deployment model, simpler ops. | Fargate hides the CPU topology. You cannot pin a thread to a physical core or disable C-states inside a micro-VM — and the entire budget this platform is built around (~111ns) is smaller than the jitter a virtualised core alone would introduce. | 2.2 |
| 3 | The eleven-step tick loop with an explicit nanosecond ledger | Measure "average time per run" and call it done. | A single aggregate number hides where time goes and cannot tell you whether a regression is in the platform or in a contestant’s code. Itemising all eleven steps turns "it got slower" into "step 4 got slower", which is the difference between a debuggable system and a mysterious one. | 3.3 |
| 4 | Solve "fast + isolated + zero-copy" simultaneously, not as three separate problems | Pick two: e.g. use a fast IPC mechanism (zero-copy) but trust the contestant’s process (not isolated), or sandbox heavily (isolated) but pay serialisation cost (not zero-copy). | The five-layer security model and the rendezvous protocol were co-designed — the rendezvous struct’s memory permissions (mprotect-style read/write splits) are themselves part of the isolation boundary, so isolation is free, riding on a mechanism that exists anyway for speed. | 4.1 |
| 5 | AST-level transpiling, not source-text rewriting | Use find-and-replace or regex on the source code to rewrite state.bid_price into market_data[0]. | Source-text rewriting breaks the moment a contestant writes getattr(state, "bid_price"), or aliases s = state, or splits an expression across lines. Operating on the parsed AST with a NodeTransformer that tracks aliases handles every syntactic variant uniformly — the rewrite is correct by construction. | 4.2 |
| 6 | A process-boundary kill switch for compiled native code | Use Python’s signal.alarm() + PyErr_SetInterrupt() for the time limit. | Compiled code has no interpreter loop to interrupt — PyErr_SetInterrupt() is silently a no-op against a Numba cfunc stuck in a loop. The only thing that reliably stops arbitrary native machine code is a signal delivered to the process, routed through the Sandbox Manager’s /stop endpoint. | 4.4 |
| 7 | Bots as inline C++ structs on the same core, not a separate service | Run the bot fleet as its own process/service sending orders over a socket or message queue. | Once the bots need to react within the same tick to the contestant’s last move, any IPC between "bots" and "matching engine" reintroduces exactly the serialisation cost the whole platform exists to eliminate. Collapsing five "services" into five C++ structs called in sequence on one core takes ~10ns total instead of microseconds. | 5.1 |
| 8 | Hot/cold cache-aware data structure for the order book | Use std::map per price level (the textbook LOB implementation) — correct, well-understood, easy to reason about. | A std::map-based book heap-allocates on every add_limit(). Splitting the book into a 64-byte "hot" struct (touched 99% of the time) sized to stay in L1, plus a pool-allocated "cold" region for the rest, removes heap allocation from the hot path entirely. | 5.3 |
| 9 | Rendezvous protocol instead of ring buffers | Use SPSC lock-free ring buffers for Game-Master/Sandbox communication — the standard HFT pattern for producer/consumer IPC. | Ring buffers solve asynchronous producer/consumer relationships with bursty rates. This relationship is synchronous by construction — exactly one tick in flight, always. One shared struct plus two atomics is the ring, collapsed to its single-element limit. | 8.2 |
| 10 | Cache-line-isolated struct layout as a first-class design constraint | Lay out the shared struct fields in whatever order is logically convenient, then optimise later if profiling shows a problem. | "Optimise later" doesn’t work for false sharing. Treating "no two cross-core-written fields share a cache line" as an invariant enforced from the first draft (with static_assert) means the bug class cannot occur, rather than must be found. | 8.3 |
| 11 | __rdtscp + non-temporal stores + a single fence, used selectively | Use one consistent timing/IPC mechanism everywhere for simplicity. | The correct instruction depends on who reads the data and when. Telemetry wants non-temporal stores so it doesn’t evict the hot working set. Market data wants regular stores so it stays warm in cache. | 6.2 / 8.3 |
| 12 | Double-buffered histogram via atomic pointer swap, not a mutex | Protect the shared HDR histogram with a mutex — simple, obviously correct. | A mutex on a structure written every tick and read for the live leaderboard reintroduces lock contention on the hot path. Two histogram instances and one atomic pointer swap gives the same safety with zero locks. | 6.3 |
| 13 | "No query in the hot path" — shared-memory leaderboard percentiles | Query Postgres for live percentiles whenever the leaderboard needs to refresh. | A 5–50ms SQL round-trip is invisible for a single page load, but becomes visible jitter when 20 contestants' runs complete in the same second. Reading percentiles directly from shared-memory atomics means the leaderboard literally cannot be slower than the simulation. | 7.1 |
| 14 | Lexicographic scoring (PnL primary, latency tiebreaker) instead of a weighted blend | Combine PnL, Sharpe ratio, drawdown, and latency into one weighted composite score. | A weighted blend means the leaderboard ordering depends on coefficients that are invisible to contestants. A lexicographic rule can be stated and verified by a contestant in one sentence. | 12.1 |

## 20.3 High-Level Design Principles
These four principles are the "load-bearing walls" of the architecture — every one of the fourteen innovations above is an application of at least one of them. A future engineer extending this platform should check any new feature against these before writing code.

### Principle 1 — "The measurement must not be the thing it measures"
Every component that *observes* the simulation (Telemetry Watchdog, HDR histograms, the leaderboard) must be structurally incapable of *perturbing* the simulation. This is why telemetry uses non-temporal stores (Section 6.2) — a "fast" regular store would pollute the cache the simulation depends on, meaning the act of measuring speed would **change** the speed being measured. The principle generalises: any time a new feature needs to "watch" the hot path, the first question must be "can this watching change the answer?"

### Principle 2 — "Push correctness to compile time and kernel-enforced invariants, not runtime checks"
The `static_assert(sizeof(SharedMem) == ...)` (Section 8.3), the cache-line-padding-from-day-one rule (item 10), and the five-layer security model where each layer is *independently* kernel-enforced (Section 17.2) all share this shape: rather than "check at runtime and handle the error," the system is structured so the **bad state cannot be reached** — a struct-size mismatch fails the build, not a 3am production incident; a sandboxed process that somehow reaches `socket()` is killed by the kernel’s syscall table, not by application logic that the same exploit might have also compromised.

### Principle 3 — "Every shared resource has exactly one writer, known at design time"
The rendezvous struct (item 9), the double-buffered histogram (item 12), and the per-bot order-ring caps (Section 5.2) are all instances of the same rule: identify, for every piece of shared state, *which single core or thread is allowed to write it*, and make every other party a read-only observer of a value that, from their perspective, simply *appears* — updated via release/acquire atomics or an atomic pointer swap, never via a lock. Multi-writer shared state is the source of almost every concurrency bug class (races, false sharing, lock contention); single-writer-by-design eliminates the entire category rather than managing it.

### Principle 4 — "Make the fair thing and the fast thing the same thing"
It would have been *faster* to give every contestant the same static price recording (no live bots, Section 1.3) and *faster* to skip the held-out evaluation dataset (Section 16.4). Both of those "optimisations" would have undermined the contest’s core promise. Conversely, it would have been *fairer-feeling* but *slower* to run every contestant’s code through a full Python interpreter with rich introspection for debugging. The Forge pipeline (Section 4.2) resolves this by doing the **expensive, contestant-friendly work once** (AST scanning, AOT compilation, with a content-addressed cache for repeats) so that the *per-tick* cost — which happens a million times — is pure compiled-native speed. Whenever "fair" and "fast" appear to conflict, the resolution in this platform has consistently been to **move the cost to a place that happens once**, not to compromise on either.

> **DIAGRAM PLACEHOLDER:** Figure 20.2 — The four high-level principles as a "decision lens"
> A 2x2 grid or four-quadrant diagram, one quadrant per principle, each with its one-line name and a tiny icon/symbol representing it (e.g. Principle 1: an eye with a "no-entry" overlay on the data it’s watching; Principle 2: a padlock at compile-time; Principle 3: a single pen writing into a box that many eyes read from; Principle 4: a fork in a road where both paths rejoin).
> Caption beneath: "Before adding any new feature to Vidhi Arena, check it against all four quadrants."
> This is meant as a literal checklist poster for the engineering team — keep it visually simple and memorable rather than information-dense.

## 20.4 Low-Level Design Principles
Where Section 20.3 describes the "why" at the level of an architecture review, this section captures the recurring *implementation-level* patterns — the kind of detail that, individually, looks like "just good C++," but which collectively form a consistent house style. A reviewer who has internalised these five patterns can predict, with reasonable accuracy, how *any* new piece of hot-path code in this codebase ought to look before reading it.

| Pattern | What it looks like in code | What it prevents |
|---|---|---|
| Alignment-first struct design | Every hot-path struct begins with alignas(64), and every field written by a different core/thread than its neighbour is preceded by explicit padding bytes, sized so the next field starts on a new cache line. | False sharing (Section 8.3) — the most common reason "correct" lock-free code is mysteriously slow. |
| Fixed-point everywhere money is involved | int64_t scaled by ×1,000,000, with __int128 as the intermediate type for any multiplication that could overflow (e.g. fee or PnL calculations). | Non-reproducible results from floating-point rounding differences across compilers/CPUs (Section 9.2) — essential for the deterministic-replay guarantee that underlies dispute resolution (Section 17.4). |
| Single timestamp instruction, used consistently | __rdtscp (not __rdtsc, not clock_gettime) for every latency measurement, with one calibration routine (tsc_calibrate.hpp) as the single source of truth for converting ticks to nanoseconds. | Mixing timer sources, each with different overhead and ordering guarantees, which would make cross-component latency numbers incomparable (Section 6.2 / 15.3). |
| Pool allocation, never heap allocation, in any loop that runs per-tick | Resting orders, fill notifications, and bot order rings are all backed by pre-sized arrays with index-based "allocation" (bump a counter), never new/malloc or STL containers that allocate internally. | Heap allocator overhead and unpredictable latency spikes from allocator-internal locking or page faults (Section 5.3) — the #1 latency regression found in the build audit. |
| Branchless enforcement for anything checked every tick | Position-limit checks (Section 12.3) and the LOB’s best-pointer fast path (Section 3.3, step 8) are written so the cost of the check is identical whether or not the condition is true — no if that the CPU could mispredict on the hot path. | Branch misprediction penalties, which on modern CPUs (10–20 cycles) can exceed the entire cost budget for a tick-loop step (Section 3.3). |

> **The "house style" test:**
> A useful sanity check for any new hot-path code in this repository: read the function and ask "does this allocate, does this branch unpredictably, does this touch a cache line another core also writes, and does this use floating point for money?" If the answer to all four is *no*, the code is very likely consistent with the rest of the platform. If the answer to *any* is *yes*, it is either (a) not actually on the hot path — verify against the eleven-step loop in Section 3.3 — or (b) a candidate for the same kind of audit-and-fix cycle documented in Section 18.4.

## 20.5 Explaining the Hardest Ideas in Plain English
The rest of this document is necessarily technical — it is, after all, a specification. This final section steps back and explains the five hardest concepts in the document the way you might explain them to a smart friend who has never written C++, with no jargon left unexplained.

### "What is a cache line, and why do you keep padding things to 64 bytes?"
Imagine your CPU’s memory as a giant warehouse, and the CPU’s "desk" (its cache) can only hold a few small boxes at a time, each box holding exactly 64 bytes of data. When the CPU wants *one byte*, it doesn’t fetch one byte — it fetches the *whole 64-byte box* containing that byte, because fetching boxes from the warehouse is slow and it’s usually worth grabbing the neighbours too. Now imagine two CPUs sharing one warehouse, and — by bad luck — "Game Master’s notepad" and "Sandbox’s notepad" both happen to be written on the same box. Every time *either* CPU updates its notepad, the *other* CPU’s copy of that box becomes invalid and must be re-fetched — even though nothing it actually cares about changed. This is "false sharing." The fix (Section 8.3) is simply to make sure each CPU’s notepad gets its own box — by adding "padding" (unused filler bytes) so the next important thing always starts at the beginning of a fresh box. It feels wasteful (you’re "wasting" some bytes on padding) but it is enormously cheaper than the alternative.

### "Why can’t you just use a timeout like every other system?"
A normal timeout works like a teacher saying "put your pens down" — it relies on the student *noticing* the instruction and choosing to stop. Python’s normal timeout mechanism works exactly this way: it sets a flag, and Python’s "did anyone tell me to stop?" check runs between every line of code. But once a contestant’s strategy is compiled into raw machine instructions (Section 4.2, for speed), there *is no "between every line" moment* — it’s like the student has their head down, headphones on, and the teacher’s voice literally cannot reach them. The only thing that works at that point is **physically taking the pen away** — in computer terms, the operating system forcibly ending the program from the outside (Section 4.4). That’s why the watchdog has to be a separate, independent process that can reach in and stop things, rather than a polite request the running code might never check.

### "Why do the bots need to be 'inline' — isn’t that just a performance detail?"
Think of a card game where you play a card, and then four other players each react to *your specific card* before the next round starts. If those four players were in another room and you had to *mail* them your card, wait for them to mail back their reactions, and *then* continue — the game would still "work," but each round would take minutes instead of moments. "Inline bots" (Section 5.1) means all four players are sitting at *your table*, and they react *the instant* you play — not because being in the room is inherently "faster" in some abstract sense, but because the entire **point** of the contest is that the bots react to *this specific contestant’s* last move, every single move, a million times. Mailing letters a million times would make the contest take hours instead of seconds — and the "letters" (network messages) cost roughly a thousand times more than just calling a function in the same program.

### "What does 'deterministic replay' actually buy us?"
Imagine a contestant emails you: "I think your platform scored my strategy wrong — I should have made more money." Without determinism, your only answer is "we’ll re-run it and see" — and if the re-run gives a *slightly different* number (because, say, a floating-point rounding difference nudged one trade by a fraction of a cent, which cascaded into a different sequence of fills), you now have **two different answers** and no way to know which one is "right." Fixed-point arithmetic (Section 9.2) guarantees that the exact same code, run on the exact same input, produces the exact same output *to the last digit*, every time, on any machine. The re-run either matches *exactly* (and you can show the contestant precisely why their strategy made the PnL it made) or it doesn’t match — in which case *that itself* is a bug in the platform, not an ambiguity to argue about. Determinism turns "trust us" into "here, verify it yourself."

### "Why is the scoring rule so simple, when the system underneath is so complicated?"
This is, in a sense, the whole point. All of the engineering in Sections 2–11 — the cache-line padding, the AOT compilation, the lock-free histograms — exists **so that the scoring rule can afford to be simple**. If the platform’s measurements were noisy or untrustworthy, you’d need a *complicated* scoring formula to average away the noise — multiple runs, statistical confidence intervals, "best of five." Because the platform’s nanosecond-level measurements are **trustworthy by construction** (every section before this one is, in some sense, an argument for *why*), the scoring rule (Section 12) gets to be one sentence: *"highest PnL wins; if it’s a near-exact tie, the faster one wins."* A simple rule on top of a rigorous foundation is a *feature*, not a missed opportunity for sophistication — it is what all the underlying rigour was *for*.

> **DIAGRAM PLACEHOLDER:** Figure 20.3 — The "rigour enables simplicity" pyramid
> A pyramid/triangle diagram with five stacked layers from bottom to top, narrowing as it goes up:
> Bottom (widest) layer: "Hardware-level discipline" (cache lines, NUMA, hugepages, isolcpus).
> Next: "Process & memory discipline" (rendezvous protocol, fixed-point arithmetic, pool allocators).
> Next: "Measurement discipline" (rdtscp, non-temporal stores, double-buffered histograms).
> Next: "Trust discipline" (deterministic replay, 5-layer security, shadow validator).
> Top (narrowest, single line): "One-sentence scoring rule: PnL wins; near-tie -> latency wins."
> Caption: "Each layer exists to let the layer above it be simpler. The whole document, read bottom-to-top, is the argument for why the top layer is allowed to be this simple."
> This diagram works well as the closing visual of the entire document — consider placing it at the very end, after the Appendix.
