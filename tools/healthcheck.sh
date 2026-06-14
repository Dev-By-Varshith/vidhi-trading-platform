#!/bin/bash
# Vidhi Arena v5.0 — Backend Healthcheck
# Polls the API until it reports all subcomponents are online.
# Exits 0 if healthy, 1 if timeout.

TIMEOUT=60
INTERVAL=2
ELAPSED=0

echo "[HEALTHCHECK] Waiting for Vidhi backend to become healthy..."

while [ $ELAPSED -lt $TIMEOUT ]; do
    HTTP_CODE=$(curl -s -o /tmp/health.json -w "%{http_code}" http://localhost:8080/api/health)
    
    if [ "$HTTP_CODE" -eq 200 ]; then
        IS_ONLINE=$(grep -o '"online":true' /tmp/health.json)
        DB_ONLINE=$(grep -o '"db":true' /tmp/health.json)
        REDIS_ONLINE=$(grep -o '"redis":true' /tmp/health.json)
        
        if [ -n "$IS_ONLINE" ] && [ -n "$DB_ONLINE" ] && [ -n "$REDIS_ONLINE" ]; then
            echo "[HEALTHCHECK] OK! Backend, Postgres, and Redis are all online."
            exit 0
        fi
    fi
    
    printf "."
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
done

echo ""
echo "[HEALTHCHECK] ERROR: Timeout after ${TIMEOUT}s waiting for backend."
if [ -f /tmp/health.json ]; then
    cat /tmp/health.json
fi
exit 1
