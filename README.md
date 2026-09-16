# Warm Graph Extension POC

Validates: network data -> extension -> FastAPI -> stored network.

The demo intentionally uses a LOCAL mock connections page and fixed test data.
It does not scrape LinkedIn or bypass LinkedIn controls.

## Backend
```powershell
cd backend
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Extension
1. Open chrome://extensions
2. Enable Developer mode
3. Load unpacked -> select `extension`
4. Open the extension
5. Click Check backend
6. Click Import demo network

Expected: Imported 3 connections. Owner: banker_A

## Next
Once an approved LinkedIn data-access mechanism is available, replace only the demo ingestion source. Keep the backend/graph architecture.
