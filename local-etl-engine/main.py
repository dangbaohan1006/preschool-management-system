import time
import os
from src.extract_edge import fetch_pending_from_edge, acknowledge_sync_to_edge
from src.load_local import init_db, save_records, get_unsynced_for_sheets, mark_sheets_synced
from src.sync_sheets import sync_rows_to_sheets

# --- Settings ---
POLL_INTERVAL = 60 # Sync every 60 seconds

def run_orchestrator():
    print("🚀 Attendance Data ETL Engine Started...")
    
    # 0. Initialize Database
    init_db()
    print("✅ Local SQLite database initialized.")

    while True:
        try:
            print("\n--- NEW SYNC CYCLE ---")
            
            # 1. Fetch data from Cloudflare Edge Buffer
            print("🔍 Checking Edge for pending records...")
            records = fetch_pending_from_edge()
            
            if records:
                print(f"📦 Found {len(records)} pending records.")
                
                # 2. Save records locally
                print("💾 Saving to local database...")
                saved_log_ids = save_records(records)
                
                # 3. Acknowledge sync back to Edge
                if saved_log_ids:
                    print("ACKing Edge...")
                    acknowledge_sync_to_edge(saved_log_ids)
            else:
                print("😴 No new records from Edge.")

            # 4. Check for local records to push to Google Sheets
            print("🚀 Checking local-to-sheets pending...")
            unsynced_data = get_unsynced_for_sheets()
            
            if unsynced_data:
                print(f"📊 Found {len(unsynced_data)} unsynced records for Google Sheets.")
                
                # 5. Push to Google Sheets
                success = sync_rows_to_sheets(unsynced_data)
                
                if success:
                    # 6. Mark as synced in local database
                    print("✅ Marking as synced locally...")
                    mark_sheets_synced()
                else:
                    print("⚠️ Failed or skipped Sheets sync.")
            else:
                print("😴 No pending records for Google Sheets.")

        except Exception as e:
            print(f"❌ Orchestrator encountered error: {e}")

        # Sleep for the next poll interval
        print(f"⏳ Waiting {POLL_INTERVAL}s for next cycle...")
        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    run_orchestrator()
