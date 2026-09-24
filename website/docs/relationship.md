# Relationship Evidence Model

> [!NOTE] 
> **Status:** Implemented (Evidence Multi-Factor Engine)

WarmGraph does not rely on static binary connections. Instead, it evaluates **Relationship Evidence** to establish true connection strength between counterparties.

---

## 🔬 Relationship Evidence Signals

WarmGraph synthesizes three distinct signal categories into a unified relationship score:

### 1. Structural Network Overlap
- Shared mutual connection density within specific executive clusters.
- Higher weighting for mutual connections who are senior decision-makers.

### 2. Temporal & Interaction Evidence
- Frequency and recency of joint co-locations or shared firm tenures.
- Co-authorship of industry publications, public commentary, and panel appearances.

### 3. Corporate & Transactional Evidence
- Joint involvement in past M&A transactions, syndicated debt facilities, or venture co-investments.
- Alumni network overlap across major investment banks and consulting firms.

---

## 📋 Schema Definition

```json
{
  "edge_id": "edge_alex_mercer_sarah_jenkins",
  "source_id": "usr_alex_mercer",
  "target_id": "usr_sarah_jenkins",
  "evidence_score": 0.92,
  "confidence_rating": "HIGH",
  "evidence_factors": {
    "mutual_connections_count": 48,
    "firm_tenure_overlap_years": 3.5,
    "shared_deal_involvement": ["Project Falcon M&A", "Series B Co-investment"],
    "last_interaction_timestamp": "2026-08-14T10:30:00Z"
  }
}
```

> [!WARNING]
> Unverified connections without evidence factors receive a baseline default weight of 0.10 to prevent false-positive path recommendations.
