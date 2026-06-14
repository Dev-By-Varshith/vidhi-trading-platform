package sandbox

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
	dockerClient "github.com/docker/docker/client"
)

const PoolSize = 20

// WarmContainer holds the ID and the designated host directory for its bind mount
type WarmContainer struct {
	ID      string
	HostDir string
}

var (
	warmPool chan WarmContainer
	poolOnce sync.Once
)

// InitPool starts the background goroutine to maintain the warm container pool.
func InitPool() {
	poolOnce.Do(func() {
		warmPool = make(chan WarmContainer, PoolSize)
		go replenishLoop()
	})
}

// ClaimSandbox pops a pre-created container from the pool.
// If the pool is empty, it returns an error to fallback to manual creation.
func ClaimSandbox() (WarmContainer, error) {
	select {
	case c := <-warmPool:
		return c, nil
	default:
		return WarmContainer{}, fmt.Errorf("warm pool is empty")
	}
}

func replenishLoop() {
	cli, err := dockerClient.NewClientWithOpts(dockerClient.FromEnv, dockerClient.WithAPIVersionNegotiation())
	if err != nil {
		log.Fatalf("[POOL] Failed to connect to docker: %v", err)
	}

	// Create base directory for pool mounts
	baseDir := "/tmp/vidhi_pool"
	os.MkdirAll(baseDir, 0777)

	counter := 0

	for {
		// Fill the channel up to PoolSize
		for len(warmPool) < PoolSize {
			counter++
			hostDir := filepath.Join(baseDir, fmt.Sprintf("sb_%d_%d", time.Now().UnixNano(), counter))
			if err := os.MkdirAll(hostDir, 0777); err != nil {
				log.Printf("[POOL] Failed to create host dir: %v", err)
				time.Sleep(1 * time.Second)
				break
			}

			id, err := createWarmContainer(cli, hostDir)
			if err != nil {
				log.Printf("[POOL] Failed to create warm container: %v", err)
				time.Sleep(1 * time.Second)
				break
			}
			warmPool <- WarmContainer{ID: id, HostDir: hostDir}
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func createWarmContainer(cli *dockerClient.Client, hostDir string) (string, error) {
	ctx := context.Background()

	containerCfg := &container.Config{
		Image: SandboxImage,
		Cmd:   []string{"/bin/vidhi-loader"},
		Env:   []string{"VIDHI_SO_PATH=/sandbox/trader.so"},
	}

	hostCfg := &container.HostConfig{
		IpcMode: "host",
		Resources: container.Resources{
			Memory:            int64(SandboxMemoryMB) * 1024 * 1024,
			MemorySwap:        int64(SandboxMemoryMB) * 1024 * 1024,
			CPUSetCPUs:        SandboxCore,
			CPUQuota:          100_000,
			CPUPeriod:         100_000,
			PidsLimit:         pointerInt64(64),
		},
		ReadonlyRootfs: true,
		Mounts: []mount.Mount{
			{
				Type:     mount.TypeBind,
				Source:   hostDir,
				Target:   "/sandbox",
				ReadOnly: true, // Container can't write, but host can modify hostDir before starting
			},
			{
				Type:   mount.TypeTmpfs,
				Target: "/tmp",
				TmpfsOptions: &mount.TmpfsOptions{
					SizeBytes: 64 * 1024 * 1024,
					Mode:      0755,
				},
			},
		},
		NetworkMode: "none",
		CapDrop:     []string{"ALL"},
		SecurityOpt: []string{
			"no-new-privileges:true",
			"seccomp=" + seccompProfile,
		},
		AutoRemove: false,
	}

	resp, err := cli.ContainerCreate(ctx, containerCfg, hostCfg, nil, nil, "")
	if err != nil {
		return "", err
	}

	return resp.ID, nil
}
