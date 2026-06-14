package validator

import (
	"bytes"
	"debug/elf"
	"fmt"
	"os"
	"strings"
)

// ValidateContestantBinary performs a full security audit of a compiled contestant .so.
//
// Checks performed:
//  1. Valid ELF shared library (ET_DYN) — not an executable
//  2. Required export: on_tick__cfunc must be present
//  3. Banned dynamic symbol imports: dangerous libc/syscall wrappers
//  4. Banned string literals in .rodata: shell paths, exec strings
//  5. No PT_INTERP segment (interpreters allow execve bypasses)
//  6. File size sanity: < 50MB (prevents DoS via huge binaries)
func ValidateContestantBinary(soPath string) error {

	// ── Sanity: file size ────────────────────────────────────────────────────
	fi, err := os.Stat(soPath)
	if err != nil {
		return fmt.Errorf("stat: %w", err)
	}
	if fi.Size() > 50*1024*1024 {
		return fmt.Errorf("binary too large (%d bytes > 50MB limit)", fi.Size())
	}

	// ── Open ELF ────────────────────────────────────────────────────────────
	f, err := elf.Open(soPath)
	if err != nil {
		return fmt.Errorf("not a valid ELF binary: %w", err)
	}
	defer f.Close()

	// ── Check 1: Must be a shared library, not an executable ─────────────────
	if f.Type != elf.ET_DYN {
		return fmt.Errorf("binary type %v is not ET_DYN (shared library)", f.Type)
	}

	// ── Check 2 & 3: Dynamic symbol scan ──────────────────────────────────────
	// Banned libc wrappers that enable syscall bypasses.
	// These are the dynamic-linker-visible names (the __libc_ prefixed versions
	// can also be used; we ban both forms).
	bannedImports := map[string]string{
		"system":          "arbitrary command execution",
		"execve":          "process replacement",
		"execvp":          "process replacement",
		"execvpe":         "process replacement",
		"execl":           "process replacement",
		"execle":          "process replacement",
		"execlp":          "process replacement",
		"fork":            "process forking",
		"vfork":           "process forking",
		"clone":           "thread/process cloning",
		"unshare":         "namespace manipulation",
		"socket":          "network access",
		"connect":         "network access",
		"bind":            "network binding",
		"listen":          "network binding",
		"accept":          "network access",
		"sendmsg":         "network access",
		"recvmsg":         "network access",
		"ptrace":          "process tracing (debugger bypass)",
		"process_vm_readv":  "cross-process memory read",
		"process_vm_writev": "cross-process memory write",
		"mprotect":        "memory permission change (RWX mapping)",
		"dlopen":          "dynamic library loading",
		"dlmopen":         "dynamic library loading",
		"popen":           "shell pipe execution",
		"__libc_system":   "arbitrary command execution",
		"__execve":        "process replacement",
	}

	syms, err := f.DynamicSymbols()
	if err != nil {
		// Some minimal .so files have no dynamic symbols — that's fine
		// as long as they still export on_tick__cfunc via static symbols
		syms = nil
	}

	foundOnTick := false
	for _, sym := range syms {
		name := sym.Name
		if sym.Section == elf.SHN_UNDEF {
			// Undefined = imported from external library
			if reason, banned := bannedImports[name]; banned {
				return fmt.Errorf("security violation: banned import '%s' (%s)", name, reason)
			}
			// Also catch __libc_ prefixed variants dynamically
			if strings.HasPrefix(name, "__libc_") && name != "__libc_start_main" {
				return fmt.Errorf("security violation: suspicious libc internal import '%s'", name)
			}
		} else {
			// Defined = exported from this .so
			if name == "on_tick__cfunc" {
				foundOnTick = true
			}
		}
	}

	// Also scan all symbols (static + dynamic) for on_tick export
	if !foundOnTick {
		allSyms, _ := f.Symbols()
		for _, sym := range allSyms {
			if sym.Name == "on_tick__cfunc" {
				foundOnTick = true
				break
			}
		}
	}

	if !foundOnTick {
		return fmt.Errorf("missing required export: 'on_tick__cfunc' not found in symbol table")
	}

	// ── Check 4: Banned string literals in .rodata ────────────────────────────
	// Attacker could encode a shell path as a string and pass it to a syscall
	// that slipped through symbol filtering.
	bannedStrings := []string{
		"/bin/sh", "/bin/bash", "/bin/dash", "/bin/zsh",
		"cmd.exe", "powershell",
		"/proc/self/mem",        // direct memory write bypass
		"/proc/self/fd",         // fd hijacking
		"LD_PRELOAD",            // library injection
		"LD_LIBRARY_PATH",       // library injection
		"/dev/tcp",              // bash TCP redirection
	}

	rodataSection := f.Section(".rodata")
	if rodataSection != nil {
		rodataBytes, err := rodataSection.Data()
		if err == nil {
			for _, banned := range bannedStrings {
				if bytes.Contains(rodataBytes, []byte(banned)) {
					return fmt.Errorf("security violation: banned string literal '%s' found in .rodata", banned)
				}
			}
		}
	}

	// ── Check 5: No PT_INTERP (dynamic interpreter) segment ──────────────────
	// A genuine .so has no interpreter. Presence of PT_INTERP means the binary
	// was compiled as a PIE executable that can be run directly — unusual and suspicious.
	for _, prog := range f.Progs {
		if prog.Type == elf.PT_INTERP {
			return fmt.Errorf("security violation: PT_INTERP segment found — binary appears to be an executable, not a shared library")
		}
	}

	// ── All checks passed ─────────────────────────────────────────────────────
	return nil
}
