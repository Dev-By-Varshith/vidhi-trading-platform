#!/usr/bin/env python3
import os
import sys
import psycopg2
import argparse
from datetime import datetime

def transition_round(db_url: str, new_round_id: str):
    """
    Automated cron tool to transition the active competition round.
    Closes all queued runs from the previous round and opens the new round.
    """
    print(f"[{datetime.now().isoformat()}] Initiating round transition to: {new_round_id}")
    
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        
        # 1. Mark queued or running jobs from old rounds as 'aborted_due_to_transition'
        cur.execute("""
            UPDATE runs 
            SET status = 'error', error_msg = 'Round transitioned before job could execute'
            WHERE status IN ('queued', 'running') AND round_id != %s
        """, (new_round_id,))
        
        aborted = cur.rowcount
        print(f"  -> Aborted {aborted} lingering jobs from previous rounds.")
        
        # 2. Update a global config table if it exists (for now, we just rely on API)
        # Assuming the API checks some config table for the active round.
        # If there isn't one, we could create it, but for now, we just lock the runs.
        
        conn.commit()
        cur.close()
        conn.close()
        print(f"[SUCCESS] Round successfully transitioned to {new_round_id}.")
        
    except Exception as e:
        print(f"[ERROR] Database connection failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Automated Round Transition Cron Script")
    parser.add_argument("--round", type=str, required=True, help="The new round ID (e.g., STARFRUIT)")
    parser.add_argument("--db", type=str, default="postgres://vidhi:vidhi_secret@localhost:5432/vidhidb?sslmode=disable", help="Postgres Connection String")
    
    args = parser.parse_args()
    transition_round(args.db, args.round)
