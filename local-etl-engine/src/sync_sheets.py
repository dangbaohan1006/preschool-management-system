import gspread
from google.oauth2.service_account import Credentials
import os

# --- Configurations ---
# Put your Google Cloud Service Account JSON file in credentials/gcp_service_account.json
CREDENTIALS_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'credentials', 'gcp_service_account.json')
# Provide the name of your target Google Sheet
SHEET_NAME = "Preschool_Attendance_Analytics"

def sync_rows_to_sheets(rows):
    """Appends rows of attendance data to a Google Sheet."""
    if not rows:
        return False
        
    if not os.path.exists(CREDENTIALS_PATH):
        print(f"Skipping Sheets sync: Credentials file not found at {CREDENTIALS_PATH}")
        return False

    try:
        # 1. Authenticate with Google
        scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        creds = Credentials.from_service_account_file(CREDENTIALS_PATH, scopes=scopes)
        client = gspread.authorize(creds)

        # 2. Open the Sheet
        spreadsheet = client.open(SHEET_NAME)
        worksheet = spreadsheet.worksheet("Raw_Data") # Assuming the sheet has a tab named "Raw_Data"

        # 3. Append rows (rows is a list of lists)
        worksheet.append_rows(rows)
        print(f"Successfully synced {len(rows)} records to Google Sheets.")
        return True

    except Exception as e:
        print(f"Error syncing to Google Sheets: {e}")
        return False
