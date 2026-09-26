# WarmGraph — Relationship Intelligence Platform

> AI-powered Chrome extension that transforms LinkedIn connections into an interactive warm introduction graph.

## Overview

WarmGraph extracts a user's LinkedIn network, builds a relationship graph, and discovers the strongest warm introduction paths between people.

### Core capabilities

* Chrome Extension for LinkedIn network extraction
* Incremental Sync with pause/resume
* Interactive Graph Visualization (Cytoscape)
* Target Person Search
* Warm Path Generation
* Explain Path with Relationship Evidence
* Research & Knowledge Hub
* Developer Dashboard

---

# Project Structure

```text
warm_graph_extension_poc/
│
├── backend/                # FastAPI graph engine
│   ├── services/
│   ├── tests/
│   └── main.py
│
├── extension/              # Chrome Extension (Manifest V3)
│   ├── popup.html
│   ├── popup.js
│   ├── overlay.js
│   ├── content.js
│   └── developer_dashboard.html
│
├── website/                # SaaS website
│   ├── index.html
│   ├── network.html
│   ├── graph.html
│   ├── research.html
│   └── person.html
│
└── scratch/                # Development tests
```

---

# Tech Stack

| Layer         | Technology                     |
| ------------- | ------------------------------ |
| Extension     | JavaScript, Manifest V3        |
| Backend       | FastAPI                        |
| Graph Engine  | Python                         |
| Visualization | Cytoscape.js                   |
| Website       | HTML, CSS, JavaScript          |
| Storage       | Chrome Storage + Local Storage |

---

# Getting Started

## 1. Backend

```bash
cd backend

python -m venv .venv

# Windows
.venv\Scripts\activate

pip install -r requirements.txt

uvicorn main:app --reload --port 8000
```

Backend runs at:

```text
http://127.0.0.1:8000
```

Swagger Docs:

```text
http://127.0.0.1:8000/docs
```

---

## 2. Load Extension

1. Open Chrome
2. Visit `chrome://extensions`
3. Enable **Developer Mode**
4. Click **Load Unpacked**
5. Select the `extension/` folder

The WarmGraph icon should now appear.

---

## 3. Run Website

```bash
cd website
python -m http.server 5500
```

Open:

```text
http://localhost:5500
```

---

# How to Use WarmGraph

## Step 1 — Import LinkedIn Network

Open:

```text
https://www.linkedin.com/mynetwork/invite-connect/connections/
```

Click **Sync Network**.

WarmGraph automatically:

* Scrolls the page
* Extracts connections
* Removes duplicates
* Builds the graph
* Syncs to backend

When complete you'll see:

> You're all caught up ✨

---

## Step 2 — Search a Target

Open the popup.

Enter:

* Company
* Deal Side
* Optional Role

Example:

```text
Company: HPE
Role: AI Engineer
```

Click **Find Target Person**.

---

## Step 3 — Generate Warm Path

Select a returned person.

Click **Find Warm Path**.

Example output:

```text
You
↓
Bipin Raj
↓
Reshma Hegde
```

---

## Step 4 — Explain the Relationship

Click **Explain Path**.

WarmGraph displays structured relationship evidence such as:

* Same College
* Student ↔ Faculty
* Same Department
* Same Company
* Same City
* LinkedIn 1st Degree

Each evidence includes a confidence score.

---

## Interactive Graph

Open:

```text
website/graph.html
```

Features:

* Zoom
* Pan
* Drag nodes
* Search people
* Highlight warm paths
* Click node → profile drawer

---

## Research Hub

Open:

```text
website/research.html
```

Supports:

* Company research
* Person notes
* Markdown editor
* Saved notes
* Warm path references

Notes are currently stored locally.

---

## Developer Dashboard

Accessible from the extension popup.

Displays:

* Extraction health
* Sync status
* Connection count
* Graph nodes
* Relationship evidence
* Diagnostics

This dashboard is **local to the current user**.

---

# Current MVP Status

| Feature             | Status |
| ------------------- | ------ |
| LinkedIn Extraction | ✅      |
| Incremental Sync    | ✅      |
| Warm Path           | ✅      |
| Explain Path        | ✅      |
| Interactive Graph   | ✅      |
| Research Hub        | ✅      |
| Developer Dashboard | ✅      |

---

# Roadmap

## v1.1 (Current)

* Production MVP
* Interactive Graph
* Research Hub
* Relationship Evidence

## v2.0

* Multi-user Cloud Database
* Authentication
* Admin Dashboard
* Network Analytics
* CRM Integration

---

# Important Note

WarmGraph currently operates in **local-first mode**.

Each user's graph is stored in Chrome Storage and synchronized with the local FastAPI backend. Multi-user cloud synchronization will be introduced in the next release (v2.0).
