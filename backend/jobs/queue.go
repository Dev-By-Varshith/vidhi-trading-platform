package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type Job struct {
	RunID    string `json:"run_id"`
	UserID   string `json:"user_id"`
	CodePath string `json:"code_path"`
}

type Queue struct {
	rdb        *redis.Client
	pendingKey string
	activeKey  string
}

func NewQueue(rdb *redis.Client) *Queue {
	return &Queue{
		rdb:        rdb,
		pendingKey: "vidhi:queue:pending",
		activeKey:  "vidhi:queue:active",
	}
}

// Enqueue adds a job to the pending queue.
func (q *Queue) Enqueue(ctx context.Context, job Job) error {
	data, err := json.Marshal(job)
	if err != nil {
		return err
	}
	return q.rdb.LPush(ctx, q.pendingKey, data).Err()
}

// Dequeue blocks until a job is available, atomically moving it to the active list.
func (q *Queue) Dequeue(ctx context.Context, timeout time.Duration) (*Job, error) {
	// BLMOVE source destination LEFT RIGHT timeout
	res, err := q.rdb.BLMove(ctx, q.pendingKey, q.activeKey, "LEFT", "RIGHT", timeout).Result()
	if err != nil {
		if err == redis.Nil {
			return nil, nil // timeout
		}
		return nil, fmt.Errorf("blmove error: %w", err)
	}

	var job Job
	if err := json.Unmarshal([]byte(res), &job); err != nil {
		return nil, fmt.Errorf("unmarshal job error: %w", err)
	}
	return &job, nil
}

// Ack removes a job from the active list (run complete).
func (q *Queue) Ack(ctx context.Context, job Job) error {
	data, _ := json.Marshal(job)
	return q.rdb.LRem(ctx, q.activeKey, 1, data).Err()
}

// Reclaim scans the active list for jobs that have timed out and moves them back to pending.
func (q *Queue) Reclaim(ctx context.Context) error {
	// Simple reaper: in production, use a sorted set with visibility timestamps.
	// For now, move the oldest active job back to pending if it's stuck.
	res, err := q.rdb.RPopLPush(ctx, q.activeKey, q.pendingKey).Result()
	if err != nil && err != redis.Nil {
		return fmt.Errorf("reclaim error: %w", err)
	}
	if err == nil {
		fmt.Printf("[REAPER] Reclaimed job from active to pending: %s\n", res)
	}
	return nil
}
