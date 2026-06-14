#!/usr/bin/env python3
"""
tools/setup_bare_metal.py — Bare-metal Linux kernel configuration script
Applies all hardware-level optimizations required by the Vidhi Arena v5.0 spec.

USAGE:
  sudo python3 tools/setup_bare_metal.py [--dry-run]

WHAT IT DOES:
  1. Isolates CPU cores 2-3 from the kernel scheduler (isolcpus)
  2. Enables full tick-less mode on those cores (nohz_full)
  3. Offloads RCU callbacks from cores 2-3 (rcu_nocbs)
  4. Disables C-states to eliminate interrupt latency (processor.max_cstate=0)
  5. Pre-allocates 1GB Hugepages (for LOB mmap)
  6. Pins IRQ handlers away from cores 2-3
  7. Sets GRUB kernel boot parameters
  8. Writes /etc/security/limits.d/vidhi.conf for RT priorities
  9. Configures sysctl for low-latency networking and mmap

VERIFIED ON:
  Ubuntu 22.04 LTS, kernel 5.15+
  AWS c6in.metal (96 vCPU, 192GB RAM, 200Gbps network)
"""

import argparse
import os
import subprocess
import sys

DRY_RUN = False

GRUB_PARAMS = [
    "isolcpus=managed_irq,domain,2-3",  # isolate cores 2-3
    "nohz_full=2-3",                     # full tickless on 2-3
    "rcu_nocbs=2-3",                     # no RCU callbacks on 2-3
    "processor.max_cstate=0",            # disable CPU C-states
    "intel_idle.max_cstate=0",           # Intel-specific C-state disable
    "mce=ignore_ce",                     # ignore correctable memory errors (latency)
    "nosoftlockup",                      # no softlockup watchdog (causes jitter)
    "skew_tick=1",                       # de-synchronize tick timers
    "transparent_hugepage=always",       # enable THP globally
]

SYSCTL_PARAMS = {
    # Hugepages: 1GB × 2 = 2GB reserved for LOB + telemetry ring
    "vm.nr_hugepages": 2,
    "vm.nr_overcommit_hugepages": 4,
    # mmap limits for shared memory
    "vm.max_map_count": 1048576,
    # TCP fast networking (for bot-fleet HTTP)
    "net.core.rmem_max":         134217728,
    "net.core.wmem_max":         134217728,
    "net.ipv4.tcp_rmem":         "4096 87380 134217728",
    "net.ipv4.tcp_wmem":         "4096 65536 134217728",
    "net.core.netdev_max_backlog": 30000,
    # Disable transparent hugepage compaction delay
    "kernel.numa_balancing": 0,
}

RT_LIMITS = """# /etc/security/limits.d/vidhi.conf
# Allows vidhi-gm process to use real-time scheduling priorities
vidhi  -  rtprio  99
vidhi  -  memlock unlimited
vidhi  -  nofile  65535
root   -  rtprio  99
root   -  memlock unlimited
"""

def run(cmd: str, check: bool = True) -> str:
    print(f"  $ {cmd}")
    if DRY_RUN:
        return "[DRY RUN]"
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if check and result.returncode != 0:
        print(f"  [ERROR] {result.stderr.strip()}", file=sys.stderr)
    return result.stdout.strip()

def check_root():
    if os.geteuid() != 0 and not DRY_RUN:
        print("[ERROR] This script must be run as root (sudo python3 setup_bare_metal.py)")
        sys.exit(1)

def apply_grub():
    print("\n[1/7] Configuring GRUB kernel parameters...")
    grub_cfg = "/etc/default/grub"
    if not os.path.exists(grub_cfg) and not DRY_RUN:
        print("  [SKIP] /etc/default/grub not found (not a GRUB system)")
        return

    param_str = " ".join(GRUB_PARAMS)
    print(f"  Adding: {param_str}")

    if not DRY_RUN:
        with open(grub_cfg, "r") as f:
            content = f.read()

        # Find GRUB_CMDLINE_LINUX_DEFAULT and append params
        if "GRUB_CMDLINE_LINUX_DEFAULT" in content:
            # Check if already applied
            if "isolcpus=managed_irq" in content:
                print("  [SKIP] GRUB params already applied")
            else:
                content = content.replace(
                    'GRUB_CMDLINE_LINUX_DEFAULT=""',
                    f'GRUB_CMDLINE_LINUX_DEFAULT="{param_str}"'
                )
                content = content.replace(
                    'GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"',
                    f'GRUB_CMDLINE_LINUX_DEFAULT="quiet splash {param_str}"'
                )
                with open(grub_cfg, "w") as f:
                    f.write(content)
                run("update-grub")
                print("  [OK] GRUB updated — reboot required for kernel params to take effect")

def apply_hugepages():
    print("\n[2/7] Pre-allocating 1GB Hugepages...")
    run("echo 2 > /proc/sys/vm/nr_hugepages")
    run("mkdir -p /mnt/hugepages")
    run("mount -t hugetlbfs -o pagesize=1G hugetlbfs /mnt/hugepages 2>/dev/null || true")

    # Check current hugepages
    out = run("grep HugePages_Total /proc/meminfo", check=False)
    print(f"  {out}")

def apply_sysctl():
    print("\n[3/7] Applying sysctl parameters...")
    for key, val in SYSCTL_PARAMS.items():
        run(f"sysctl -w {key}={val}")

    # Persist to /etc/sysctl.d/
    sysctl_file = "/etc/sysctl.d/90-vidhi.conf"
    if not DRY_RUN:
        with open(sysctl_file, "w") as f:
            f.write("# Vidhi Arena v5.0 — low-latency sysctl settings\n")
            for key, val in SYSCTL_PARAMS.items():
                f.write(f"{key} = {val}\n")
        print(f"  [OK] Written {sysctl_file}")

def pin_irqs():
    print("\n[4/7] Pinning IRQs away from cores 2-3...")
    # Get all IRQ numbers and move them to cores 0-1 (CPU mask = 0x3 = 0b11)
    irq_dirs = [d for d in os.listdir("/proc/irq") if d.isdigit()] if not DRY_RUN else ["1","2"]
    count = 0
    for irq in irq_dirs:
        smp_path = f"/proc/irq/{irq}/smp_affinity"
        if os.path.exists(smp_path) and not DRY_RUN:
            try:
                with open(smp_path, "w") as f:
                    f.write("3")  # hex 0x3 = cores 0,1 only
                count += 1
            except PermissionError:
                pass
    print(f"  [OK] Pinned {count} IRQs to cores 0-1")

def apply_rt_limits():
    print("\n[5/7] Writing RT priority limits...")
    if not DRY_RUN:
        with open("/etc/security/limits.d/vidhi.conf", "w") as f:
            f.write(RT_LIMITS)
    print("  [OK] Written /etc/security/limits.d/vidhi.conf")

def apply_cpu_governor():
    print("\n[6/7] Setting CPU frequency governor to 'performance'...")
    run("for f in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do echo performance > $f 2>/dev/null || true; done")
    governor = run("cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null", check=False)
    print(f"  CPU governor: {governor or 'unknown'}")

def verify():
    print("\n[7/7] Verification...")
    if not DRY_RUN:
        # Check isolcpus
        cmdline = run("cat /proc/cmdline", check=False)
        if "isolcpus" in cmdline:
            print("  [OK] isolcpus active in kernel cmdline")
        else:
            print("  [REBOOT NEEDED] isolcpus not yet active — reboot to apply GRUB params")

        # Check hugepages
        hp = run("grep HugePages_Total /proc/meminfo", check=False)
        print(f"  Hugepages: {hp}")

        # Check core isolation
        cpu2_isolated = run("cat /sys/devices/system/cpu/cpu2/online", check=False)
        print(f"  Core 2 online: {cpu2_isolated}")
    print("\n  Setup complete. Reboot required for GRUB kernel params to take effect.")
    print("  After reboot, verify with: cat /proc/cmdline | grep isolcpus")

def main():
    global DRY_RUN
    parser = argparse.ArgumentParser(description="Vidhi Arena bare-metal setup")
    parser.add_argument("--dry-run", action="store_true", help="Print commands without executing")
    args = parser.parse_args()
    DRY_RUN = args.dry_run

    print("=" * 60)
    print("  Vidhi Arena v5.0 — Bare Metal Setup Script")
    print("  Target: AWS c6in.metal / Ubuntu 22.04")
    if DRY_RUN:
        print("  MODE: DRY RUN (no changes will be made)")
    print("=" * 60)

    check_root()
    apply_grub()
    apply_hugepages()
    apply_sysctl()
    pin_irqs()
    apply_rt_limits()
    apply_cpu_governor()
    verify()

if __name__ == "__main__":
    main()
