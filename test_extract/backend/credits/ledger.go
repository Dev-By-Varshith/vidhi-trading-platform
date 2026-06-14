package credits

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// IncrementAndCheckScript atomically checks if the user has hit the daily limit, and if not, increments their usage.
// KEYS[1] = daily_usage_key, ARGV[1] = limit
const IncrementAndCheckScript = `
local used = tonumber(redis.call("GET", KEYS[1]) or "0")
local limit = tonumber(ARGV[1])
if used < limit then
    redis.call("INCR", KEYS[1])
    -- ensure key expires in 25 hours just in case
    if used == 0 then
        redis.call("EXPIRE", KEYS[1], 90000) 
    end
    return used + 1
else
    return -1
end
`

var ErrDailyLimitReached = errors.New("daily simulation limit reached")

type Ledger struct {
	rdb *redis.Client
}

func NewLedger(rdb *redis.Client) *Ledger {
	return &Ledger{rdb: rdb}
}

// DeductCredit atomically attempts to consume 1 credit. Returns error if limit reached.
func (l *Ledger) DeductCredit(ctx context.Context, userID string, dailyLimit int) error {
	if l.rdb == nil {
		return nil // skip if redis is unavailable
	}
	key := fmt.Sprintf("vidhi:credits:used:%s:%s", userID, time.Now().UTC().Format("2006-01-02"))
	res, err := l.rdb.Eval(ctx, IncrementAndCheckScript, []string{key}, dailyLimit).Result()
	if err != nil {
		return fmt.Errorf("redis eval error: %w", err)
	}

	newUsed := res.(int64)
	if newUsed < 0 {
		return ErrDailyLimitReached
	}

	return nil
}

