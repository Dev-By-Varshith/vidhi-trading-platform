const {
  C, sp, H1, H2, H3, H4, run, bold, italic, mono, body, bullet, numbered,
  codeBlock, spacer, pageBreak, callout, placeholder, makeTable,
} = require('./helpers');
const { Paragraph, TextRun, AlignmentType, BorderStyle, ShadingType, Table, TableRow, TableCell, WidthType } = require('docx');

// Star-marked innovation badge for the detailed TOC
function star() {
  return new TextRun({ text: '  \u2605 INNOVATION', font: 'Arial', size: 17, bold: true, color: C.amber });
}

// Detailed TOC entry: number, title, optional subtopics list, optional star
function tocEntry(num, title, subtopics = [], starred = false) {
  const out = [];
  const titleRuns = [new TextRun({ text: `${num}  ${title}`, font: 'Arial', size: 21, bold: true, color: C.navy })];
  if (starred) titleRuns.push(star());
  out.push(new Paragraph({ children: titleRuns, ...sp(140, 30) }));
  subtopics.forEach(st => {
    const isStarred = typeof st === 'object';
    const text = isStarred ? st.text : st;
    const subRuns = [new TextRun({ text, font: 'Arial', size: 19, color: C.slate })];
    if (isStarred && st.star) subRuns.push(star());
    out.push(new Paragraph({
      children: subRuns,
      indent: { left: 480 },
      ...sp(0, 30),
    }));
  });
  return out;
}

function buildFrontMatter() {
  const c = [];

  // ══════════════════════════════════════════════════════════════════════
  // DETAILED TABLE OF CONTENTS
  // ══════════════════════════════════════════════════════════════════════
  c.push(new Paragraph({
    children: [new TextRun({ text: 'Detailed Table of Contents', font: 'Arial', size: 34, bold: true, color: C.navy })],
    ...sp(0, 100),
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: C.navy, space: 4 } },
  }));
  c.push(new Paragraph({
    children: [
      new TextRun({ text: 'Sections and sub-topics, with ', font: 'Arial', size: 19, italics: true, color: C.lightgrey }),
      star(),
      new TextRun({ text: ' marking the engineering decisions in this platform that are genuinely novel \u2014 not standard practice copied from elsewhere, but solved here through first-principles reasoning. These are also indexed together in the Innovation Index immediately following this contents list.', font: 'Arial', size: 19, italics: true, color: C.lightgrey }),
    ],
    ...sp(80, 200),
  }));

  c.push(...tocEntry('0', 'How to Use This Document', [
    'Conventions: diagram placeholders, code snippet placeholders, engineering rationale boxes',
  ]));

  c.push(...tocEntry('1', 'System Overview', [
    '1.1 What Vidhi Arena Is',
    '1.2 The Two Roles \u2014 Contest Creator vs Contestant',
    { text: '1.3 Why Bots, and Why Private \u2014 the live reactive market design', star: true },
    '1.4 Document Roadmap',
  ], false));

  c.push(...tocEntry('2', 'High-Level Architecture', [
    '2.1 The Two Planes \u2014 Control Plane vs Data Plane',
    { text: '2.2 Component Inventory \u2014 why bare metal for the simulation core', star: true },
    '2.3 Per-Contestant Resource Allocation \u2014 the 64-core map',
  ]));

  c.push(...tocEntry('3', 'End-to-End Data Flow', [
    '3.1 The Two Journeys \u2014 Submission (seconds) vs Tick (nanoseconds)',
    '3.2 The Submission Journey, step by step',
    { text: '3.3 The Tick Journey \u2014 the eleven-step loop and the 89ns / 111ns budget', star: true },
  ]));

  c.push(...tocEntry('4', 'Sandbox Engine', [
    { text: '4.1 The Core Problem \u2014 fast, isolated, and zero-copy, simultaneously', star: true },
    { text: '4.2 The Forge Pipeline \u2014 AST scan, AST-based transpiler, Numba AOT, ELF validator', star: true },
    '4.3 The Five-Layer Defence-in-Depth Security Model',
    { text: '4.4 The Watchdog \u2014 why SIGKILL must cross a process boundary, and the /stop fix', star: true },
    '4.5 Warm Sandbox Pool',
  ]));

  c.push(...tocEntry('5', 'Bot Fleet & The Persistent Live Limit Order Book', [
    { text: '5.1 Why "Inline" Bots, Not a Separate Service', star: true },
    '5.2 The Five Bot Strategies and what each one prevents',
    { text: '5.3 The Persistent Limit Order Book \u2014 hot/cold cache split', star: true },
    '5.4 Order Processing Order \u2014 why bots go first',
  ]));

  c.push(...tocEntry('6', 'Telemetry & Validation', [
    '6.1 The Telemetry Watchdog\u2019s Three Jobs',
    { text: '6.2 Why __rdtscp, Non-Temporal Stores, and a Fence', star: true },
    { text: '6.3 HDR Histogram Double-Buffering \u2014 lock-free percentile reporting', star: true },
    '6.4 The Shadow LOB Validator',
  ]));

  c.push(...tocEntry('7', 'Real-Time Leaderboard', [
    { text: '7.1 The "No Query in the Hot Path" Principle', star: true },
    '7.2 Update Flow and the 1,000-tick refresh cadence',
    '7.3 WebSocket Resilience',
  ]));

  c.push(...tocEntry('8', 'Inter-Service Communication', [
    '8.1 Two Very Different Kinds of "Communication"',
    { text: '8.2 From SPSC Rings to a Rendezvous Protocol', star: true },
    { text: '8.3 The Shared Rendezvous Struct \u2014 cache-line layout discipline', star: true },
    '8.4 Control-Plane Communication Summary',
  ]));

  c.push(...tocEntry('9', 'Data Stores', [
    '9.1 Three Stores, Three Jobs',
    { text: '9.2 TimescaleDB Schema \u2014 fixed-point arithmetic for deterministic replay', star: true },
    '9.3 Redis Usage \u2014 credits, queue, leaderboard, rate limiting',
    '9.4 S3 Layout and the content-addressed compile cache',
  ]));

  c.push(...tocEntry('10', 'Infrastructure as Code', [
    '10.1 Terraform Module Map',
    '10.2 Security Group Design',
    { text: '10.3 The Bare-Metal Bootstrap Script \u2014 isolcpus, nohz_full, skew_tick', star: true },
    { text: '10.4 Startup Self-Checks \u2014 catching silent misconfiguration', star: true },
    '10.5 Cost Profile and Operational Posture',
  ]));

  c.push(...tocEntry('11', 'CI/CD Pipeline', [
    { text: '11.1 Why the C++ Core Needs a Different Build Path', star: true },
    '11.2 Pipeline Stages',
    '11.3 Manual vs Automated Deployment \u2014 a deliberate asymmetry',
  ]));

  c.push(...tocEntry('12', 'Composite Scoring Algorithm', [
    { text: '12.1 Design Goal \u2014 lexicographic, not weighted', star: true },
    '12.2 The Formula',
    '12.3 Walking Through Each Rule',
    '12.4 Where Correctness Penalties Fit In',
  ]));

  c.push(...tocEntry('13', 'Technology Decisions', [
    'Every "why X and not Y" decision in one quick-reference table',
  ]));

  c.push(...tocEntry('14', 'Architecture Decision Records', [
    { text: 'ADR-001 \u2014 REST/WebSocket bots \u2192 Inline bots', star: true },
    { text: 'ADR-002 \u2014 Splitting Control Plane (Fargate) from Data Plane (bare metal)', star: true },
    { text: 'ADR-003 \u2014 SPSC Rings \u2192 Rendezvous Protocol', star: true },
    'ADR-004 \u2014 Weighted composite score \u2192 lexicographic PnL/latency',
    { text: 'ADR-005 \u2014 Static tick replay \u2192 persistent reactive live LOB', star: true },
  ]));

  c.push(...tocEntry('15', 'Performance Characteristics', [
    '15.1 The Full Per-Tick Budget, Restated',
    '15.2 Multi-Contestant Throughput',
    '15.3 How These Numbers Were Measured',
  ]));

  c.push(...tocEntry('16', 'Contestant Upload Flow', [
    '16.1 Two-Phase Flow Overview',
    { text: '16.2 Phase 1 \u2014 Local Testing, identical engine, unlimited runs', star: true },
    '16.3 Phase 2 \u2014 Final Round Submission',
    '16.4 What the Contestant Never Sees',
  ]));

  c.push(...tocEntry('17', 'Security Model', [
    '17.1 Threat Model',
    { text: '17.2 The Five Layers as a Security Narrative \u2014 "what if layer N is defeated?"', star: true },
    '17.3 The Sandbox Manager as a Privilege Boundary',
    { text: '17.4 Reproducibility as a Security and Fairness Property', star: true },
  ]));

  c.push(...tocEntry('18', 'Build Status & Remaining Work', [
    '18.1 Status Summary',
    '18.2 Remaining Work (Non-Blocking)',
    '18.3 Operational Runbook Pointers',
    '18.4 Build History',
  ]));

  c.push(...tocEntry('19', 'Appendix \u2014 Glossary & Reference Tables', [
    '19.1 Glossary',
    '19.2 Repository File Map',
    '19.3 Quick Reference \u2014 Key Numbers',
  ]));

  c.push(...tocEntry('20', 'Innovation Index & Design Philosophy', [
    '20.1 What Makes This Platform One-of-a-Kind',
    '20.2 The Innovation Index \u2014 all 14 starred decisions in one table',
    '20.3 High-Level Design Principles',
    '20.4 Low-Level Design Principles',
    '20.5 Explaining the Hardest Ideas in Plain English',
  ], true));

  c.push(pageBreak());

  return c;
}

module.exports = { buildFrontMatter, tocEntry, star };
