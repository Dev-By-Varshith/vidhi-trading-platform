import re

def process_file():
    with open('docx_text.txt', 'r', encoding='utf-8') as f:
        lines = f.readlines()

    out_lines = []
    toc_lines = []
    
    # 1. Title section
    out_lines.append("# PROJECT VIDHI: Arena v5.0\n")
    out_lines.append("## Architecture & Engineering Design Document\n")
    out_lines.append("> An Industry-Grade, Ultra-Low-Latency Algorithmic Trading Contest Platform\n\n")

    in_body = False
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        # Detect headings like "1. System Overview"
        m1 = re.match(r'^(\d+)\.\s+(.*)$', line)
        m2 = re.match(r'^(\d+)\.(\d+)\s+(.*)$', line)
        m3 = re.match(r'^(\d+)\.(\d+)\.(\d+)\s+(.*)$', line)
        
        if m1 and line != "1. System Overview" and not in_body:
            pass # Wait until we see "1. System Overview" to start body?
        
        if line == "1. System Overview":
            in_body = True
            
        if not in_body:
            continue
            
        if m3:
            toc_lines.append(f"    - [{line}](#{line.lower().replace(' ', '-').replace('.', '')})")
            out_lines.append(f"### {line}\n")
        elif m2:
            toc_lines.append(f"  - [{line}](#{line.lower().replace(' ', '-').replace('.', '')})")
            out_lines.append(f"## {line}\n")
        elif m1:
            toc_lines.append(f"- [{line}](#{line.lower().replace(' ', '-').replace('.', '')})")
            out_lines.append(f"# {line}\n")
        elif line.startswith("▦"):
            out_lines.append(f"> **DIAGRAM PLACEHOLDER:** {line}\n")
        elif line.startswith("⌘"):
            out_lines.append(f"> **CODE SNIPPET:** {line}\n")
        else:
            out_lines.append(f"{line}\n\n")

    # Now add Section 20 from part6.js
    section_20 = """
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
"""

    toc_lines.extend([
        "- [20. Innovation Index & Design Philosophy](#20-innovation-index--design-philosophy)",
        "  - [20.1 What Makes This Platform One-of-a-Kind](#201-what-makes-this-platform-one-of-a-kind)",
        "  - [20.2 The Innovation Index](#202-the-innovation-index)",
        "  - [20.3 High-Level Design Principles](#203-high-level-design-principles)",
        "    - [Principle 1 — The measurement must not be the thing it measures](#principle-1--the-measurement-must-not-be-the-thing-it-measures)",
        "    - [Principle 2 — Push correctness to compile time](#principle-2--push-correctness-to-compile-time)",
        "    - [Principle 3 — Every shared resource has exactly one writer](#principle-3--every-shared-resource-has-exactly-one-writer)",
        "    - [Principle 4 — Make the fair thing and the fast thing the same thing](#principle-4--make-the-fair-thing-and-the-fast-thing-the-same-thing)",
        "  - [20.4 Low-Level Design Principles](#204-low-level-design-principles)",
        "  - [20.5 Explaining the Hardest Ideas in Plain English](#205-explaining-the-hardest-ideas-in-plain-english)",
        "    - [What is a cache line?](#what-is-a-cache-line)",
        "    - [Why can't you just use a timeout?](#why-cant-you-just-use-a-timeout)",
        "    - [Why do bots need to be inline?](#why-do-bots-need-to-be-inline)",
        "    - [What does deterministic replay buy us?](#what-does-deterministic-replay-buy-us)",
        "    - [Why is the scoring rule so simple?](#why-is-the-scoring-rule-so-simple)"
    ])

    final_content = []
    
    # Title
    final_content.append("# PROJECT VIDHI: Arena v5.0")
    final_content.append("## Architecture & Engineering Design Document")
    final_content.append("> An Industry-Grade, Ultra-Low-Latency Algorithmic Trading Contest Platform\n")
    final_content.append("## Table of Contents")
    final_content.extend(toc_lines)
    final_content.append("\n---\n")
    final_content.extend(out_lines)
    final_content.append(section_20)

    # Note: Using standard python open since this is not meant as an artifact file directly but a local file
    # Then I can convert it. Let's just create an Artifact using Antigravity Artifact syntax.
    # We will just write it to C:\Users\varsh\IICPC_ALGO_TRADING_PLATFORM\Project_Vidhi_Architecture_Complete.md
    
    with open('Project_Vidhi_Architecture_Complete.md', 'w', encoding='utf-8') as fout:
        fout.write('\n'.join(final_content))

if __name__ == '__main__':
    process_file()
