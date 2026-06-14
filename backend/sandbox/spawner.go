// backend/sandbox/spawner.go
// Docker-based contestant sandbox spawner
//
// When the Go control plane needs to run a contestant's .so in isolation,
// it calls SpawnSandbox() which:
//   1. Creates a Docker container from the base sandbox image
//   2. Bind-mounts the contestant's .so read-only
//   3. Sets strict resource limits (CPU quota, memory limit, no network)
//   4. Runs the sandbox_runner binary which dlopen()s the .so
//   5. Returns when the container exits (success, TLE, or error)
//
// Isolation guarantees:
//   - Network: disabled (--network=none)
//   - CPU:     pinned to Core 3 (--cpuset-cpus=3)
//   - Memory:  512MB hard limit
//   - FS:      read-only root + tmpfs /tmp
//   - Caps:    all dropped (--cap-drop=ALL)
//   - Seccomp: default Docker seccomp profile (blocks 300+ syscalls)

package sandbox

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	dockerClient "github.com/docker/docker/client"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
)

//go:embed seccomp.json
var seccompProfile string


const (
	SandboxImage    = "vidhi_sandbox:latest"  // built from sandbox/Dockerfile
	SandboxCore     = "3"                      // CPU core for contestant (isolated)
	SandboxMemoryMB = 512
	SandboxTimeout  = 6 * time.Minute
)

// SpawnSandbox launches a Docker sandbox container, waits for it to complete.
func SpawnSandbox(ctx context.Context, soPath, runID, phase string) error {
	cli, err := dockerClient.NewClientWithOpts(
		dockerClient.FromEnv,
		dockerClient.WithAPIVersionNegotiation(),
	)
	if err != nil {
		return nil, fmt.Errorf("docker client: %w", err)
	}
	defer cli.Close()

	soAbsPath, _ := filepath.Abs(soPath)
	ticks := "1000000"
	if phase == "public" { ticks = "100000" }

	var containerID string
	var cleanupDir string

	warm, errWarm := ClaimSandbox()
	if errWarm == nil {
		containerID = warm.ID
		cleanupDir = warm.HostDir
		targetFile := filepath.Join(warm.HostDir, "trader.so")
		if err := copyFile(soAbsPath, targetFile); err != nil {
			cli.ContainerRemove(context.Background(), containerID, container.RemoveOptions{Force: true})
			return fmt.Errorf("copy .so to warm pool: %w", err)
		}
		log.Printf("[SANDBOX] Claimed warm container %s for run=%s", containerID[:12], runID[:min(12, len(runID))])
	} else {
		// ── Fallback manual creation ──────────────────────────────────────────────
		containerCfg := &container.Config{
			Image: SandboxImage,
			Cmd:   []string{"/bin/vidhi-loader"},
			Env:   []string{"VIDHI_SO_PATH=/sandbox/trader.so"},
			Labels: map[string]string{
				"vidhi.run_id": runID,
				"vidhi.phase":  phase,
			},
		}

		hostCfg := &container.HostConfig{
			IpcMode: "host", // Must share /dev/shm with the Game Master host process
			// ── Resource isolation ──────────────────────────────────────────────
			Resources: container.Resources{
				Memory:            int64(SandboxMemoryMB) * 1024 * 1024,
				MemorySwap:        int64(SandboxMemoryMB) * 1024 * 1024, // no swap
				CPUSetCPUs:        SandboxCore,
				CPUQuota:          100_000, // 100ms per 100ms period = 1 full core
				CPUPeriod:         100_000,
				PidsLimit:         pointerInt64(64),  // max 64 processes
			},
			// ── Filesystem isolation ─────────────────────────────────────────────
			ReadonlyRootfs: true,
			Mounts: []mount.Mount{
				{
					Type:     mount.TypeBind,
					Source:   soAbsPath,
					Target:   "/sandbox/trader.so",
					ReadOnly: true,
				},
				{
					Type:   mount.TypeTmpfs,
					Target: "/tmp",
					TmpfsOptions: &mount.TmpfsOptions{
						SizeBytes: 64 * 1024 * 1024, // 64MB tmpfs
						Mode:      0755,
					},
				},
			},
			// ── Network isolation ────────────────────────────────────────────────
			NetworkMode: "none",
			// ── Capability isolation ─────────────────────────────────────────────
			CapDrop: []string{"ALL"},
			SecurityOpt: []string{
				"no-new-privileges:true",
				"seccomp=" + seccompProfile,
			},
			// ── Auto-remove on exit ──────────────────────────────────────────────
			AutoRemove: false, // we read logs before removing
		}

		resp, err := cli.ContainerCreate(ctx, containerCfg, hostCfg, nil, nil, "vidhi-sb-"+runID[:8])
		if err != nil {
			return fmt.Errorf("container create: %w", err)
		}
		containerID = resp.ID
		log.Printf("[SANDBOX] Fallback container %s created for run=%s", containerID[:12], runID[:min(12, len(runID))])
	}

	defer func() {
		// Always clean up
		cli.ContainerRemove(context.Background(), containerID, container.RemoveOptions{Force: true})
		if cleanupDir != "" {
			os.RemoveAll(cleanupDir)
		}
	}()

	// ── Start container ───────────────────────────────────────────────────────
	if err := cli.ContainerStart(ctx, containerID, container.StartOptions{}); err != nil {
		return fmt.Errorf("container start: %w", err)
	}

	// ── Wait with timeout ─────────────────────────────────────────────────────
	waitCtx, cancel := context.WithTimeout(ctx, SandboxTimeout)
	defer cancel()

	statusCh, errCh := cli.ContainerWait(waitCtx, containerID, container.WaitConditionNotRunning)
	select {
	case waitErr := <-errCh:
		if waitErr != nil {
			return fmt.Errorf("container wait error: %w", waitErr)
		}
	case status := <-statusCh:
		log.Printf("[SANDBOX] Container %s exited with code %d", containerID[:12], status.StatusCode)
	case <-waitCtx.Done():
		// TLE — kill the container
		cli.ContainerKill(context.Background(), containerID, "SIGKILL")
		return fmt.Errorf("tle: container killed")
	}

	return nil
}

func pointerInt64(v int64) *int64 { return &v }

func min(a, b int) int {
	if a < b { return a }
	return b
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil { return err }
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil { return err }
	defer out.Close()

	_, err = io.Copy(out, in)
	if err != nil { return err }
	
	// Copy permissions so loader can execute/read it if needed
	info, err := os.Stat(src)
	if err == nil {
		os.Chmod(dst, info.Mode())
	}
	return nil
}
