// game-master/seccomp_filter.hpp
// BPF syscall filter to strictly isolate contestant code.
//
// Blocks networking, file access, and process creation.

#pragma once
#include <linux/seccomp.h>
#include <linux/filter.h>
#include <linux/audit.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <iostream>
#include <cstddef>

#if defined(__x86_64__)
#define SECCOMP_AUDIT_ARCH AUDIT_ARCH_X86_64
#else
#error "Seccomp filter requires x86_64"
#endif

namespace Seccomp {

inline void apply_strict_mode() {
    // Basic BPF program
    // 1. Load architecture
    // 2. Validate architecture
    // 3. Load syscall number
    // 4. Check against allowlist
    
    struct sock_filter filter[] = {
        // Load architecture from seccomp_data
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, (offsetof(struct seccomp_data, arch))),
        
        // Check if architecture is x86_64, if not kill process
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SECCOMP_AUDIT_ARCH, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),

        // Load syscall number
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, (offsetof(struct seccomp_data, nr))),

        // Allowlist
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_read, 6, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_write, 5, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_exit, 4, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_exit_group, 3, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_mprotect, 4, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_brk, 3, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_mmap, 2, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_munmap, 1, 0),

        // Default: Kill Process
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        // Match: Allow Syscall
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    };

    struct sock_fprog prog = {
        .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
        .filter = filter,
    };

    // PR_SET_NO_NEW_PRIVS is required before PR_SET_SECCOMP
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
        std::cerr << "[SECCOMP] Failed to set PR_SET_NO_NEW_PRIVS\n";
        exit(1);
    }

    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog) != 0) {
        std::cerr << "[SECCOMP] Failed to apply BPF filter\n";
        exit(1);
    }
    std::cerr << "[SECCOMP] Strict Sandbox Mode Activated.\n";
}

} // namespace Seccomp
