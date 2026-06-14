# Vidhi Arena — Bare Metal Production Setup Guide

> **Target machine:** AMD EPYC 64-core (dual-socket NUMA), Ubuntu 22.04 LTS.
> These instructions bring latency from ~500ns/tick down to ~89ns/tick.
> Steps are **additive** — each one is independently valuable.

---

## 1. GRUB Kernel Parameters

Edit `/etc/default/grub`:

```
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash \
  isolcpus=managed_irq,domain,2-4 \
  nohz_full=2-4 \
  rcu_nocbs=2-4 \
  processor.max_cstate=0 \
  intel_idle.max_cstate=0 \
  amd_iommu=off \
  transparent_hugepage=always \
  skew_tick=1 \
  rcupdate.rcu_normal=1 \
  nosoftlockup \
  tsc=reliable \
  clocksource=tsc"
```

Apply:
```bash
sudo update-grub
sudo reboot
```

**Verify isolation after reboot:**
```bash
cat /sys/devices/system/cpu/isolated
# Expected: 2-4
```

### What each parameter does

| Parameter | Effect |
|-----------|--------|
| `isolcpus=managed_irq,domain,2-4` | Removes cores 2/3/4 from the scheduler. No OS tasks run there. `managed_irq` prevents IRQs from landing on these cores. |
| `nohz_full=2-4` | Disables the periodic timer tick (1kHz) on isolated cores. Eliminates ~1µs interrupt per ms. |
| `rcu_nocbs=2-4` | Offloads RCU (Read-Copy-Update) callbacks away from isolated cores. |
| `processor.max_cstate=0` / `intel_idle.max_cstate=0` | Disables deep C-states. CPU stays in C0 (active). Eliminates wake-up latency (50–300µs on deep sleep). |
| `transparent_hugepage=always` | Enables 2MB hugepages for `madvise(MADV_HUGEPAGE)`. Reduces TLB misses on the 1GB price signal dataset. |
| `skew_tick=1` | Staggers timer ticks across cores to reduce lock contention on the tick lock. |
| `tsc=reliable` / `clocksource=tsc` | Uses the CPU's TSC as the clock source (lower overhead than HPET). Critical for accurate `__rdtscp` latency measurement. |

---

## 2. sysctl Tuning

Create `/etc/sysctl.d/99-vidhi.conf`:

```
# Disable transparent huge page defragmentation stall (let kernel handle it lazily)
kernel.numa_balancing = 0

# Increase shared memory limits for the rendezvous page
kernel.shmmax = 68719476736
kernel.shmall = 4294967296

# Disable swap to prevent memory page-out during simulation
vm.swappiness = 0

# Minimize memory compaction latency
vm.compaction_proactiveness = 0

# Pin all mlock'd pages immediately (for mlockall in vidhi-gm)
vm.mmap_min_addr = 65536
```

Apply:
```bash
sudo sysctl -p /etc/sysctl.d/99-vidhi.conf
```

---

## 3. Hugepage Pre-allocation

The Game Master uses `madvise(MADV_HUGEPAGE)` on the rendezvous page and
optionally `mmap(MAP_HUGETLB)` for the 1GB price signal dataset.

Pre-allocate 512 × 2MB hugepages at boot:

```bash
# /etc/rc.local or systemd service
echo 512 > /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages
```

Verify:
```bash
grep HugePages /proc/meminfo
# HugePages_Total: 512
# HugePages_Free:  510  (2 used by vidhi-gm)
```

For 1GB hugepages (optional, for price dataset):
```bash
echo 2 > /sys/kernel/mm/hugepages/hugepages-1048576kB/nr_hugepages
```

---

## 4. CPU Frequency Scaling

Disable frequency scaling on HFT cores:

```bash
# Set performance governor on all cores
for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
  echo performance > $cpu
done

# Disable turbo boost (removes frequency jitter — controversial, benchmark both)
echo 1 > /sys/devices/system/cpu/intel_pstate/no_turbo
# or for AMD:
echo 0 > /sys/devices/system/cpu/cpufreq/boost
```

---

## 5. IRQ Affinity

Move all IRQs away from cores 2-4:

```bash
# Install irqbalance and configure it to exclude HFT cores
apt install irqbalance
cat > /etc/default/irqbalance << 'EOF'
IRQBALANCE_BANNED_CPUS=0x0000001c  # hex bitmask: cores 2,3,4
EOF
systemctl restart irqbalance
```

Verify:
```bash
cat /proc/irq/*/smp_affinity | head -20
# No 0x1c patterns should appear
```

---

## 6. Docker Compose Resource Config

The `docker-compose.yml` must not place any container on cores 2-4.
These are exclusively for the Game Master, sandbox, and telemetry.

```yaml
# docker-compose.yml (excerpt)
services:
  backend:
    cpuset: "0-1"          # OS cores only
    mem_limit: 4g

  timescaledb:
    cpuset: "44-47"        # Control plane cores
    mem_limit: 16g

  redis:
    cpuset: "48-49"
    mem_limit: 2g

  # NOTE: Game Master runs as a bare binary, NOT a Docker container.
  # It is launched by the backend worker pool via exec().
  # Cores 2-4 must be reserved exclusively in the host OS.
```

---

## 7. Verify the Full Setup

Run the Game Master with the built-in startup checks:

```bash
./vidhi-gm --run-id verify_001 --ticks 1000
```

Expected startup output:
```
[GM] isolcpus check: 2-4 ✓
[GM] NUMA mbind: rendezvous pinned to node 0 ✓
[GM] TSC calibrated: 0.333 ns/tick
[GM] mlockall: all pages pinned ✓
```

Run the latency benchmark:
```bash
./vidhi-gm --run-id bench_001 --ticks 100000 2>/dev/null | python3 -c "
import json, sys
r = json.load(sys.stdin)
print(f'p50={r[\"p50_ns\"]:.0f}ns  p99={r[\"p99_ns\"]:.0f}ns  tle={r[\"tle_count\"]}')
"
```

**Expected results on properly configured bare metal:**

| Metric | Target | Untuned (VM) |
|--------|--------|---------------|
| p50 | ≤ 89 ns | ~500 ns |
| p99 | ≤ 200 ns | ~5,000 ns |
| TLE count | 0 | 5–20 per 100k |

---

## 8. NUMA Topology Check

Verify that cores 2/3/4 are on NUMA node 0 (same node as shared memory):

```bash
numactl --hardware
# Should show cores 2,3,4 under node 0

# Confirm shm placement after a run:
numastat -m | grep AnonHugePages
```

---

## 9. Systemd Service (Production)

Create `/etc/systemd/system/vidhi-backend.service`:

```ini
[Unit]
Description=Vidhi Arena Control Plane
After=docker.service postgresql.service redis.service

[Service]
Type=simple
User=vidhi
WorkingDirectory=/opt/vidhi
ExecStart=/opt/vidhi/backend/vidhi-backend
Restart=always
RestartSec=5
Environment=PORT=8080
Environment=DATABASE_URL=postgres://vidhi:secret@localhost:5432/vidhidb
Environment=REDIS_URL=localhost:6379
LimitNOFILE=65536
LimitMEMLOCK=infinity    # allow mlockall in game master

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable vidhi-backend
sudo systemctl start vidhi-backend
```

---

## Quick Reference

```
Core topology (64-core EPYC):
  Cores 0-1:    OS + system services
  Cores 2-3:    GM1 + Sandbox1  (slot 1)   ← isolated
  Cores 4-5:    GM2 + Sandbox2  (slot 2)   ← isolated
  ...
  Cores 40-41:  GM20 + Sandbox20 (slot 20) ← isolated
  Core 42-43:   Telemetry Watchdog A/B     ← isolated
  Cores 44+:    Control plane (Docker: backend, redis, tsdb)

GRUB one-liner:
  isolcpus=managed_irq,domain,2-4 nohz_full=2-4 rcu_nocbs=2-4 \
  processor.max_cstate=0 transparent_hugepage=always tsc=reliable \
  clocksource=tsc skew_tick=1 rcupdate.rcu_normal=1
```

---

*Architecture: Claude. Build: Gemini. Bare metal guide: Claude + Gemini (2026-06-11).*
