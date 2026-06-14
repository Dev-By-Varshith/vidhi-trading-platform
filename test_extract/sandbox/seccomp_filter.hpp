// sandbox/seccomp_filter.hpp
// Basic Seccomp BPF filter to ensure the contestant .so cannot perform malicious syscalls
// (e.g. execve, connect, open) after initialization.

#pragma once

#include <linux/seccomp.h>
#include <linux/filter.h>
#include <linux/audit.h>
#include <sys/prctl.h>
#include <unistd.h>
#include <cstddef>

inline bool apply_seccomp_filter() {
    // Only allow safe math/memory operations used by Numba compiled code
    // and basic return/yield ops.
    struct sock_filter filter[] = {
        // Load syscall number
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, (offsetof(struct seccomp_data, nr))),
        
        // Allow exit_group
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 231, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
        
        // Allow exit
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 60, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),

        // Default: Kill Process
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL)
    };

    struct sock_fprog prog = {
        .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
        .filter = filter,
    };

    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) {
        return false;
    }

    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog)) {
        return false;
    }

    return true;
}
