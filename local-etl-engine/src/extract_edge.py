import requests

EDGE_API_BASE_URL = "https://preschool-edge-api.diemdanh-tds.workers.dev/api/sync" 
SECRET_KEY = "SECRET_INTERNAL_KEY_2026";

def fetch_pending_from_edge():
    """Calls Edge API and returns a list of records with edge_sync_status = 0."""
    try:
        response = requests.get(
            f"{EDGE_API_BASE_URL}/pending",
            headers={"x-api-key": SECRET_KEY}
        )
        response.raise_for_status()
        return response.json().get('results', [])
    except Exception as e:
        print(f"Error fetching from Edge: {e}")
        return []

def acknowledge_sync_to_edge(log_ids):
    """Sends a list of log_ids to Edge API to mark as synced (edge_sync_status = 1)."""
    if not log_ids:
        return
    
    try:
        response = requests.post(
            f"{EDGE_API_BASE_URL}/ack",
            json={"log_ids": log_ids},
            headers={"x-api-key": SECRET_KEY}
        )
        response.raise_for_status()
        print(f"Successfully acknowledged {len(log_ids)} records to Edge.")
    except Exception as e:
        print(f"Error acknowledging to Edge: {e}")
