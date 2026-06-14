// backend/auth/api_key.go
// API Key authentication middleware for Vidhi Arena.
//
// Every protected API endpoint requires a valid API key in the X-API-Key header.
// Keys are stored in the api_keys table as SHA-256 hashes — never stored in plain text.
// Key format: "vidhi_<user_id>_<random32hex>"  (prefix helps with accidental exposure detection)
//
// Provisioning (Contest Creator):
//   POST /api/apikey  body: {"user_id": "alice"}  → returns plain-text key (shown once)
//   The key_hash is stored in DB. The plain-text key is shown once to the contestant.

package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ─── Context key (unexported — prevents collision with other packages) ─────────
type contextKey string

const userIDCtxKey contextKey = "vidhi_user_id"

// ─── In-memory key cache (TTL-based, avoids a DB hit on every request) ────────
type cachedKey struct {
	userID    string
	expiresAt time.Time
}

var (
	keyCache   = make(map[string]*cachedKey)
	keyCacheMu sync.RWMutex
	cacheTTL   = 5 * time.Minute
)

// Middleware validates the X-API-Key header.
// If db is nil (dev/test mode), auth is skipped — user_id comes from the form value.
func Middleware(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Dev mode — no DB means no auth enforcement
			if db == nil {
				next.ServeHTTP(w, r)
				return
			}

			apiKey := r.Header.Get("X-API-Key")
			if apiKey == "" {
				// Also accept ?api_key=... query param for browser/curl testing
				apiKey = r.URL.Query().Get("api_key")
			}
			if apiKey == "" {
				w.Header().Set("Content-Type", "application/json")
				http.Error(w, `{"error":"missing X-API-Key header or ?api_key= param"}`, http.StatusUnauthorized)
				return
			}

			userID, err := LookupKey(db, apiKey)
			if err != nil || userID == "" {
				w.Header().Set("Content-Type", "application/json")
				http.Error(w, `{"error":"invalid or expired API key"}`, http.StatusUnauthorized)
				return
			}

			// Inject validated user_id into context so handlers can trust it
			ctx := context.WithValue(r.Context(), userIDCtxKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// LookupKey checks the in-memory cache first, then falls back to the DB.
// Returns the user_id associated with the key, or ("", nil) if the key is invalid.
func LookupKey(db *sql.DB, rawKey string) (string, error) {
	hash := HashKey(rawKey)

	// Cache read
	keyCacheMu.RLock()
	if entry, ok := keyCache[hash]; ok && time.Now().Before(entry.expiresAt) {
		keyCacheMu.RUnlock()
		return entry.userID, nil
	}
	keyCacheMu.RUnlock()

	// DB lookup
	var userID string
	err := db.QueryRow(
		`SELECT user_id FROM api_keys
		 WHERE key_hash = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
		hash,
	).Scan(&userID)
	if err == sql.ErrNoRows {
		return "", nil // key not found → invalid
	}
	if err != nil {
		return "", fmt.Errorf("api_key db lookup: %w", err)
	}

	// Cache write
	keyCacheMu.Lock()
	keyCache[hash] = &cachedKey{userID: userID, expiresAt: time.Now().Add(cacheTTL)}
	keyCacheMu.Unlock()

	return userID, nil
}

// GenerateKey creates a new random API key for a user.
// Returns: plaintext (shown once to contestant), hash (stored in DB).
func GenerateKey(userID string) (plaintext, hash string) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic("rand.Read failed: " + err.Error())
	}
	plaintext = fmt.Sprintf("vidhi_%s_%s", userID, hex.EncodeToString(buf))
	hash = HashKey(plaintext)
	return plaintext, hash
}

// HashKey SHA-256 hashes a raw API key for storage (constant-time).
func HashKey(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// InvalidateCache removes a key hash from the cache (e.g., after revocation).
func InvalidateCache(hash string) {
	keyCacheMu.Lock()
	delete(keyCache, hash)
	keyCacheMu.Unlock()
}

// ─── Context helpers ──────────────────────────────────────────────────────────

// GetUserID extracts the authenticated user_id from the request context.
// Falls back to the form/query "user_id" value when auth is disabled (dev mode).
func GetUserID(r *http.Request) string {
	if uid, ok := r.Context().Value(userIDCtxKey).(string); ok && uid != "" {
		return uid
	}
	// Dev mode fallback — read from form or query param
	uid := strings.TrimSpace(r.FormValue("user_id"))
	if uid == "" {
		uid = strings.TrimSpace(r.URL.Query().Get("user_id"))
	}
	if uid == "" {
		return "anonymous"
	}
	return uid
}
