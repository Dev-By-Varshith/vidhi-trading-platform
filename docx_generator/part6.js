const {
  C, sp, H1, H2, H3, H4, run, bold, italic, mono, body, bullet, numbered,
  codeBlock, spacer, pageBreak, callout, placeholder, makeTable,
} = require('./helpers');
const { Paragraph, TextRun, AlignmentType, ShadingType, BorderStyle } = require('docx');
const { star } = require('./front_matter');

function buildPart6() {
  const c = [];

  c.push(H1('Innovation Index & Design Philosophy', 20));

  c.push(H2('20.1 What Makes This Platform One-of-a-Kind'));
  c.push(body([
    run('Every individual technique used in Vidhi Arena \u2014 lock-free shared memory, CPU pinning, fixed-point arithmetic, AOT compilation \u2014 exists somewhere in the world, usually in real high-frequency trading firms. What does '),
    italic('not'), run(' exist elsewhere, as far as the team is aware, is the '), bold('combination'), run(': a teaching/contest platform that takes the entire HFT engineering toolkit and points it at a problem nobody in HFT actually has \u2014 making a '),
    italic('fairness guarantee'), run(' to a student. A real trading firm optimises nanoseconds because nanoseconds are worth money. This platform optimises nanoseconds so that '),
    bold('the measurement itself does not lie'), run(' \u2014 so that when the leaderboard says contestant A is faster than contestant B, that statement is true to within about 100 nanoseconds out of a 100,000-nanosecond budget, '), italic('regardless of which language they wrote in, which day they submitted, or how the server happened to be feeling that morning'), run('.'),
  ]));

  c.push(body([
    run('That reframing \u2014 from "go fast to make money" to "go fast so the comparison is fair" \u2014 is what drove almost every decision in this document toward something a standard contest platform would never need. A standard contest platform can tolerate "the grader takes between 2 and 8 seconds depending on load" because the '),
    italic('relative'), run(' ranking still roughly holds. A platform whose '), bold('product'), run(' is a nanosecond-precision leaderboard cannot tolerate that \u2014 if the grader itself has 5 milliseconds of jitter, it has just destroyed the only thing it was built to measure. Sections 20.2\u201320.5 below collect, in one place, the fourteen places where this reframing forced a genuinely novel decision, the high- and low-level principles that recur across all of them, and plain-English explanations of the hardest ideas for a reader encountering this for the first time.'),
  ]));

  c.push(...spacer(1));
  c.push(placeholder('diagram', 'Figure 20.1 \u2014 "Why nanoseconds matter here" \u2014 two-panel comparison', [
    'Left panel: "A normal autograder" \u2014 a box labelled "Run code" with a wavy/uneven timeline beneath it (representing 2\u20138 second variable grading time), with a caption "Variance here doesn\u2019t matter \u2014 the grade is pass/fail or a test-case count."',
    'Right panel: "Vidhi Arena" \u2014 a box labelled "Run code" with a near-perfectly flat timeline beneath it (representing ~111ns \u00b1 a few ns), with a caption "Variance here IS the product \u2014 the leaderboard\u2019s tiebreaker is measured in nanoseconds."',
    'A connecting arrow/banner across both: "Same goal (run student code, produce a score) \u2014 completely different engineering constraints."',
    'This is the conceptual anchor for the whole section \u2014 it should make the "why does any of this matter" question land before the reader sees the dense innovation table.',
  ]));

  c.push(pageBreak());

  c.push(H2('20.2 The Innovation Index'));
  c.push(body([
    run('The table below collects all fourteen starred ('), star(), run([' ']),
    run([') decisions from the detailed contents list. For each one: the ']), bold('obvious approach'), run(' (what almost any other team would do first), the '), bold('insight'), run(' that revealed why the obvious approach fails '),
    italic('specifically for this platform'), run(', and the '), bold('section'), run(' where it is explained in full.'),
  ]));

  c.push(makeTable(
    [{label:'#', w:380}, {label:'Decision', w:2000}, {label:'Obvious approach (rejected)', w:2400}, {label:'The insight', w:3580}, {label:'\u00a7', w:600}],
    [
      ['1','Live reactive market, not static replay','Replay a recorded price history \u2014 every contestant sees the same data, simple to build and to grade.','A static replay rewards reverse-engineering the recording, not trading skill. Two contestants must face the same bots, not the same recording \u2014 fairness comes from identical rules of a live game, not identical playback of a dead one.','1.3'],
      ['2','Bare metal for the simulation core, containers for everything else','Run everything in Docker/Fargate \u2014 one deployment model, simpler ops.','Fargate hides the CPU topology. You cannot pin a thread to a physical core or disable C-states inside a micro-VM \u2014 and the entire budget this platform is built around (~111ns) is smaller than the jitter a virtualised core alone would introduce.','2.2'],
      ['3','The eleven-step tick loop with an explicit nanosecond ledger','Measure "average time per run" and call it done.','A single aggregate number hides where time goes and cannot tell you whether a regression is in the platform or in a contestant\u2019s code. Itemising all eleven steps turns "it got slower" into "step 4 got slower", which is the difference between a debuggable system and a mysterious one.','3.3'],
      ['4','Solve "fast + isolated + zero-copy" simultaneously, not as three separate problems','Pick two: e.g. use a fast IPC mechanism (zero-copy) but trust the contestant\u2019s process (not isolated), or sandbox heavily (isolated) but pay serialisation cost (not zero-copy).','The five-layer security model (item 6) and the rendezvous protocol (item 9) were co-designed \u2014 the rendezvous struct\u2019s memory permissions (mprotect-style read/write splits) are themselves part of the isolation boundary, so isolation is free, riding on a mechanism that exists anyway for speed.','4.1'],
      ['5','AST-level transpiling, not source-text rewriting','Use find-and-replace or regex on the source code to rewrite state.bid_price into market_data[0].','Source-text rewriting breaks the moment a contestant writes getattr(state, "bid_price"), or aliases s = state, or splits an expression across lines. Operating on the parsed AST with a NodeTransformer that tracks aliases (including chained assignment a = b = state) handles every syntactic variant uniformly \u2014 the rewrite is correct by construction, not by enumeration of cases.','4.2'],
      ['6','A process-boundary kill switch for compiled native code','Use Python\u2019s signal.alarm() + PyErr_SetInterrupt() for the time limit.','Compiled code has no interpreter loop to interrupt \u2014 PyErr_SetInterrupt() is silently a no-op against a Numba cfunc stuck in a loop. The only thing that reliably stops arbitrary native machine code is a signal delivered to the process, and in the external-sandbox topology that means routing the kill through the one service that actually holds the container handle (the Sandbox Manager\u2019s /stop endpoint), not the Game Master.','4.4'],
      ['7','Bots as inline C++ structs on the same core, not a separate service','Run the bot fleet as its own process/service sending orders over a socket or message queue, like a normal microservice load generator.','Once the bots need to react within the same tick to the contestant\u2019s last move (item 1), any IPC between "bots" and "matching engine" reintroduces exactly the serialisation cost the whole platform exists to eliminate. Collapsing five "services" into five C++ structs called in sequence on one core turns a microservices problem into a function-call problem \u2014 ~10ns total instead of microseconds.','5.1'],
      ['8','Hot/cold cache-aware data structure for the order book','Use std::map per price level (the textbook LOB implementation) \u2014 correct, well-understood, easy to reason about.','A std::map-based book heap-allocates on every add_limit(). Over 1,000,000 ticks this is not "a bit slower" \u2014 it was measured as the single largest latency regression in the entire system. Splitting the book into a 64-byte "hot" struct (the only part touched on 99% of ticks) sized to stay in L1, plus a pool-allocated "cold" region for the rest, removes heap allocation from the hot path entirely, by construction.','5.3'],
      ['9','Rendezvous protocol instead of ring buffers','Use SPSC lock-free ring buffers for Game-Master/Sandbox communication \u2014 the standard HFT pattern for producer/consumer IPC.','Ring buffers solve asynchronous producer/consumer relationships with bursty rates. This relationship is synchronous by construction \u2014 exactly one tick in flight, always. A ring buffer\u2019s head/tail pointers and wrap-around logic are pure overhead for a problem that, here, does not exist. One shared struct plus two atomics is the ring, collapsed to its single-element limit.','8.2'],
      ['10','Cache-line-isolated struct layout as a first-class design constraint','Lay out the shared struct fields in whatever order is logically convenient, then optimise later if profiling shows a problem.','"Optimise later" doesn\u2019t work for false sharing \u2014 by the time a profiler shows the symptom (one core\u2019s writes mysteriously stalling another core), the fix requires re-deriving the entire layout anyway. Treating "no two cross-core-written fields share a cache line" as an invariant enforced from the first draft (with static_assert on total size) means the bug class cannot occur, rather than must be found.','8.3'],
      ['11','__rdtscp + non-temporal stores + a single fence, used selectively','Use one consistent timing/IPC mechanism everywhere for simplicity \u2014 e.g. all non-temporal, or all regular stores.','The correct instruction depends on who reads the data and when. Telemetry (written once, read once, asynchronously, by a different core) wants non-temporal stores so it doesn\u2019t evict the hot working set. Market data (written this tick, read this same tick by the cooperating core) wants regular stores so it stays warm in cache. Using non-temporal stores for market data \u2014 a mistake actually made and caught during the build \u2014 would have cost more than the entire optimisation it was copying.','6.2 / 8.3'],
      ['12','Double-buffered histogram via atomic pointer swap, not a mutex','Protect the shared HDR histogram with a mutex \u2014 simple, obviously correct.','A mutex on a structure written every tick and read for the live leaderboard (item 13) reintroduces lock contention on the hot path \u2014 exactly the thing the whole rendezvous redesign (item 9) was designed to eliminate elsewhere. Two histogram instances and one atomic pointer swap every 1,000 ticks gives the same safety with zero locks and zero hot-path branching.','6.3'],
      ['13','"No query in the hot path" \u2014 shared-memory leaderboard percentiles','Query Postgres for live percentiles whenever the leaderboard needs to refresh.','A 5\u201350ms SQL round-trip is invisible for a single page load, but becomes visible jitter the moment 20 contestants\u2019 runs complete in the same second \u2014 the exact scenario a contest\u2019s final minutes guarantee will happen. Reading percentiles directly from the same shared-memory atomics the Telemetry Watchdog already maintains (item 12) means the leaderboard\u2019s "hot path" literally cannot be slower than the simulation\u2019s own internal bookkeeping.','7.1'],
      ['14','Lexicographic scoring (PnL primary, latency tiebreaker) instead of a weighted blend','Combine PnL, Sharpe ratio, drawdown, and latency into one weighted composite score \u2014 rewards "good" trading more holistically.','A weighted blend means the leaderboard ordering depends on coefficients that are invisible to contestants and can silently reorder everyone if tuned between rounds \u2014 turning "why did I lose?" into an unanswerable question. A lexicographic rule ("maximise PnL; if tied to within 0.001%, lower latency wins") can be stated, understood, and verified by a contestant in one sentence, and a 0.001% tie is rare enough that the latency tiebreaker \u2014 the platform\u2019s namesake feature \u2014 gets to matter when it activates, without ever overriding a real PnL difference.','12.1'],
    ]
  ));

  c.push(pageBreak());

  c.push(H2('20.3 High-Level Design Principles'));
  c.push(body('These four principles are the "load-bearing walls" of the architecture \u2014 every one of the fourteen innovations above is an application of at least one of them. A future engineer extending this platform should check any new feature against these before writing code.'));

  c.push(H3('Principle 1 \u2014 "The measurement must not be the thing it measures"'));
  c.push(body([
    run('Every component that '), italic('observes'), run(' the simulation (Telemetry Watchdog, HDR histograms, the leaderboard) must be structurally incapable of '), italic('perturbing'), run(' the simulation. This is why telemetry uses non-temporal stores (Section 6.2) \u2014 a "fast" regular store would pollute the cache the simulation depends on, meaning the act of measuring speed would '), bold('change'), run(' the speed being measured. The principle generalises: any time a new feature needs to "watch" the hot path, the first question must be "can this watching change the answer?"'),
  ]));

  c.push(H3('Principle 2 \u2014 "Push correctness to compile time and kernel-enforced invariants, not runtime checks"'));
  c.push(body([
    run('The '), mono('static_assert(sizeof(SharedMem) == ...)'), run(' (Section 8.3), the cache-line-padding-from-day-one rule (item 10), and the five-layer security model where each layer is '), italic('independently'), run(' kernel-enforced (Section 17.2) all share this shape: rather than "check at runtime and handle the error," the system is structured so the '), bold('bad state cannot be reached'), run(' \u2014 a struct-size mismatch fails the build, not a 3am production incident; a sandboxed process that somehow reaches '), mono('socket()'), run(' is killed by the kernel\u2019s syscall table, not by application logic that the same exploit might have also compromised.'),
  ]));

  c.push(H3('Principle 3 \u2014 "Every shared resource has exactly one writer, known at design time"'));
  c.push(body([
    run('The rendezvous struct (item 9), the double-buffered histogram (item 12), and the per-bot order-ring caps (Section 5.2) are all instances of the same rule: identify, for every piece of shared state, '), italic('which single core or thread is allowed to write it'), run(', and make every other party a read-only observer of a value that, from their perspective, simply '), italic('appears'), run(' \u2014 updated via release/acquire atomics or an atomic pointer swap, never via a lock. Multi-writer shared state is the source of almost every concurrency bug class (races, false sharing, lock contention); single-writer-by-design eliminates the entire category rather than managing it.'),
  ]));

  c.push(H3('Principle 4 \u2014 "Make the fair thing and the fast thing the same thing"'));
  c.push(body([
    run('It would have been '), italic('faster'), run(' to give every contestant the same static price recording (no live bots, Section 1.3) and '), italic('faster'), run(' to skip the held-out evaluation dataset (Section 16.4). Both of those "optimisations" would have undermined the contest\u2019s core promise. Conversely, it would have been '), italic('fairer-feeling'), run(' but '), italic('slower'), run(' to run every contestant\u2019s code through a full Python interpreter with rich introspection for debugging. The Forge pipeline (Section 4.2) resolves this by doing the '), bold('expensive, contestant-friendly work once'), run(' (AST scanning, AOT compilation, with a content-addressed cache for repeats) so that the '), italic('per-tick'), run(' cost \u2014 which happens a million times \u2014 is pure compiled-native speed. Whenever "fair" and "fast" appear to conflict, the resolution in this platform has consistently been to '), bold('move the cost to a place that happens once'), run(', not to compromise on either.'),
  ]));

  c.push(...spacer(1));
  c.push(placeholder('diagram', 'Figure 20.2 \u2014 The four high-level principles as a "decision lens"', [
    'A 2x2 grid or four-quadrant diagram, one quadrant per principle, each with its one-line name and a tiny icon/symbol representing it (e.g. Principle 1: an eye with a "no-entry" overlay on the data it\u2019s watching; Principle 2: a padlock at compile-time; Principle 3: a single pen writing into a box that many eyes read from; Principle 4: a fork in a road where both paths rejoin).',
    'Caption beneath: "Before adding any new feature to Vidhi Arena, check it against all four quadrants."',
    'This is meant as a literal checklist poster for the engineering team \u2014 keep it visually simple and memorable rather than information-dense.',
  ]));

  c.push(pageBreak());

  c.push(H2('20.4 Low-Level Design Principles'));
  c.push(body([
    run('Where Section 20.3 describes the "why" at the level of an architecture review, this section captures the recurring '),
    italic('implementation-level'), run(' patterns \u2014 the kind of detail that, individually, looks like "just good C++," but which collectively form a consistent house style. A reviewer who has internalised these five patterns can predict, with reasonable accuracy, how '),
    italic('any'), run(' new piece of hot-path code in this codebase ought to look before reading it.'),
  ]));

  c.push(makeTable(
    [{label:'Pattern', w:2400}, {label:'What it looks like in code', w:3160}, {label:'What it prevents', w:2800}],
    [
      ['Alignment-first struct design','Every hot-path struct begins with alignas(64), and every field written by a different core/thread than its neighbour is preceded by explicit padding bytes, sized so the next field starts on a new cache line.','False sharing (Section 8.3) \u2014 the most common reason "correct" lock-free code is mysteriously slow.'],
      ['Fixed-point everywhere money is involved','int64_t scaled by \u00d71,000,000, with __int128 as the intermediate type for any multiplication that could overflow (e.g. fee or PnL calculations).','Non-reproducible results from floating-point rounding differences across compilers/CPUs (Section 9.2) \u2014 essential for the deterministic-replay guarantee that underlies dispute resolution (Section 17.4).'],
      ['Single timestamp instruction, used consistently','__rdtscp (not __rdtsc, not clock_gettime) for every latency measurement, with one calibration routine (tsc_calibrate.hpp) as the single source of truth for converting ticks to nanoseconds.','Mixing timer sources, each with different overhead and ordering guarantees, which would make cross-component latency numbers incomparable (Section 6.2 / 15.3).'],
      ['Pool allocation, never heap allocation, in any loop that runs per-tick','Resting orders, fill notifications, and bot order rings are all backed by pre-sized arrays with index-based "allocation" (bump a counter), never new/malloc or STL containers that allocate internally.','Heap allocator overhead and unpredictable latency spikes from allocator-internal locking or page faults (Section 5.3) \u2014 the #1 latency regression found in the build audit.'],
      ['Branchless enforcement for anything checked every tick','Position-limit checks (Section 12.3) and the LOB\u2019s best-pointer fast path (Section 3.3, step 8) are written so the cost of the check is identical whether or not the condition is true \u2014 no if that the CPU could mispredict on the hot path.','Branch misprediction penalties, which on modern CPUs (10\u201320 cycles) can exceed the entire cost budget for a tick-loop step (Section 3.3).'],
    ]
  ));

  c.push(...spacer(1));
  c.push(callout('The "house style" test', [
    new Paragraph({ children: [run('A useful sanity check for any new hot-path code in this repository: read the function and ask "does this allocate, does this branch unpredictably, does this touch a cache line another core also writes, and does this use floating point for money?" If the answer to all four is '), italic('no'), run(', the code is very likely consistent with the rest of the platform. If the answer to '), italic('any'), run(' is '), italic('yes'), run(', it is either (a) not actually on the hot path \u2014 verify against the eleven-step loop in Section 3.3 \u2014 or (b) a candidate for the same kind of audit-and-fix cycle documented in Section 18.4.')], ...sp(0,0) }),
  ]));

  c.push(pageBreak());

  c.push(H2('20.5 Explaining the Hardest Ideas in Plain English'));
  c.push(body('The rest of this document is necessarily technical \u2014 it is, after all, a specification. This final section steps back and explains the five hardest concepts in the document the way you might explain them to a smart friend who has never written C++, with no jargon left unexplained.'));

  c.push(H3('"What is a cache line, and why do you keep padding things to 64 bytes?"'));
  c.push(body([
    run('Imagine your CPU\u2019s memory as a giant warehouse, and the CPU\u2019s "desk" (its cache) can only hold a few small boxes at a time, each box holding exactly 64 bytes of data. When the CPU wants '),
    italic('one byte'), run(', it doesn\u2019t fetch one byte \u2014 it fetches the '), italic('whole 64-byte box'), run(' containing that byte, because fetching boxes from the warehouse is slow and it\u2019s usually worth grabbing the neighbours too. Now imagine two CPUs sharing one warehouse, and \u2014 by bad luck \u2014 "Game Master\u2019s notepad" and "Sandbox\u2019s notepad" both happen to be written on the same box. Every time '),
    italic('either'), run(' CPU updates its notepad, the '), italic('other'), run(' CPU\u2019s copy of that box becomes invalid and must be re-fetched \u2014 even though nothing it actually cares about changed. This is "false sharing." The fix (Section 8.3) is simply to make sure each CPU\u2019s notepad gets its own box \u2014 by adding "padding" (unused filler bytes) so the next important thing always starts at the beginning of a fresh box. It feels wasteful (you\u2019re "wasting" some bytes on padding) but it is enormously cheaper than the alternative.'),
  ]));

  c.push(H3('"Why can\u2019t you just use a timeout like every other system?"'));
  c.push(body([
    run('A normal timeout works like a teacher saying "put your pens down" \u2014 it relies on the student '), italic('noticing'), run(' the instruction and choosing to stop. Python\u2019s normal timeout mechanism works exactly this way: it sets a flag, and Python\u2019s "did anyone tell me to stop?" check runs between every line of code. But once a contestant\u2019s strategy is compiled into raw machine instructions (Section 4.2, for speed), there '),
    italic('is no "between every line" moment'), run(' \u2014 it\u2019s like the student has their head down, headphones on, and the teacher\u2019s voice literally cannot reach them. The only thing that works at that point is '), bold('physically taking the pen away'), run(' \u2014 in computer terms, the operating system forcibly ending the program from the outside (Section 4.4). That\u2019s why the watchdog has to be a separate, independent process that can reach in and stop things, rather than a polite request the running code might never check.'),
  ]));

  c.push(H3('"Why do the bots need to be \u2018inline\u2019 \u2014 isn\u2019t that just a performance detail?"'));
  c.push(body([
    run('Think of a card game where you play a card, and then four other players each react to '), italic('your specific card'), run(' before the next round starts. If those four players were in another room and you had to '), italic('mail'), run(' them your card, wait for them to mail back their reactions, and '), italic('then'), run(' continue \u2014 the game would still "work," but each round would take minutes instead of moments. "Inline bots" (Section 5.1) means all four players are sitting at '),
    italic('your table'), run(', and they react '), italic('the instant'), run(' you play \u2014 not because being in the room is inherently "faster" in some abstract sense, but because the entire '), bold('point'), run(' of the contest is that the bots react to '), italic('this specific contestant\u2019s'), run(' last move, every single move, a million times. Mailing letters a million times would make the contest take hours instead of seconds \u2014 and the "letters" (network messages) cost roughly a thousand times more than just calling a function in the same program.'),
  ]));

  c.push(H3('"What does \u2018deterministic replay\u2019 actually buy us?"'));
  c.push(body([
    run('Imagine a contestant emails you: "I think your platform scored my strategy wrong \u2014 I should have made more money." Without determinism, your only answer is "we\u2019ll re-run it and see" \u2014 and if the re-run gives a '), italic('slightly different'), run(' number (because, say, a floating-point rounding difference nudged one trade by a fraction of a cent, which cascaded into a different sequence of fills), you now have '),
    bold('two different answers'), run(' and no way to know which one is "right." Fixed-point arithmetic (Section 9.2) guarantees that the exact same code, run on the exact same input, produces the exact same output '), italic('to the last digit'), run(', every time, on any machine. The re-run either matches '), italic('exactly'), run(' (and you can show the contestant precisely why their strategy made the PnL it made) or it doesn\u2019t match \u2014 in which case '),
    italic('that itself'), run(' is a bug in the platform, not an ambiguity to argue about. Determinism turns "trust us" into "here, verify it yourself."'),
  ]));

  c.push(H3('"Why is the scoring rule so simple, when the system underneath is so complicated?"'));
  c.push(body([
    run('This is, in a sense, the whole point. All of the engineering in Sections 2\u201311 \u2014 the cache-line padding, the AOT compilation, the lock-free histograms \u2014 exists '), bold('so that the scoring rule can afford to be simple'), run('. If the platform\u2019s measurements were noisy or untrustworthy, you\u2019d need a '), italic('complicated'), run(' scoring formula to average away the noise \u2014 multiple runs, statistical confidence intervals, "best of five." Because the platform\u2019s nanosecond-level measurements are '), bold('trustworthy by construction'), run(' (every section before this one is, in some sense, an argument for '), italic('why'), run('), the scoring rule (Section 12) gets to be one sentence: '), italic('"highest PnL wins; if it\u2019s a near-exact tie, the faster one wins."'), run(' A simple rule on top of a rigorous foundation is a '),
    italic('feature'), run(', not a missed opportunity for sophistication \u2014 it is what all the underlying rigour was '), italic('for'), run('.'),
  ]));

  c.push(...spacer(1));
  c.push(placeholder('diagram', 'Figure 20.3 \u2014 The "rigour enables simplicity" pyramid', [
    'A pyramid/triangle diagram with five stacked layers from bottom to top, narrowing as it goes up:',
    'Bottom (widest) layer: "Hardware-level discipline" (cache lines, NUMA, hugepages, isolcpus).',
    'Next: "Process & memory discipline" (rendezvous protocol, fixed-point arithmetic, pool allocators).',
    'Next: "Measurement discipline" (rdtscp, non-temporal stores, double-buffered histograms).',
    'Next: "Trust discipline" (deterministic replay, 5-layer security, shadow validator).',
    'Top (narrowest, single line): "One-sentence scoring rule: PnL wins; near-tie \u2192 latency wins."',
    'Caption: "Each layer exists to let the layer above it be simpler. The whole document, read bottom-to-top, is the argument for why the top layer is allowed to be this simple."',
    'This diagram works well as the closing visual of the entire document \u2014 consider placing it at the very end, after the Appendix.',
  ]));

  return c;
}

module.exports = { buildPart6 };
