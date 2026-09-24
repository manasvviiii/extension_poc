# Relationship Evidence Model

**Category:** Relationship Evidence  
**Last Updated:** Sep 24, 2026  
**Reading Time:** 7 min read  

WarmGraph models professional relationship strength using multi-layer evidence rather than binary connection flags.

> [!TIP]
> Relationship evidence combines direct 1st-degree connection records with observed 2nd-degree mutual connection text extracted from profile cards.

---

## Evidence Types & Schema

| Evidence Type | Degree | Description | Weight Contribution |
| :--- | :--- | :--- | :--- |
| `connection_card` | 1st | Confirmed 1st-degree connection | Base Score: `1.0` |
| `relationship_card` | 2nd | Mutual connection card observed on LinkedIn | Base Score: `0.7` |
| `mutual_connection_text` | 2nd | Extracted mutual text snippet ("Person A is a mutual connection") | Bonus: `+0.15` per mutual |

---

## Edge Scoring Algorithm

Each relationship edge between the owner and a contact is assigned a calculated weight:

$$\text{Weight} = S_{\text{base}} \times S_{\text{recency}} + S_{\text{mutual\_bonus}}$$

### Scoring Parameters:
- **Base Score ($S_{\text{base}}$)**: `1.0` for 1st-degree, `0.7` for 2nd-degree evidence.
- **Recency Decay ($S_{\text{recency}}$)**: Exponential decay based on connection date or observation timestamp:
  - $< 30$ days: $1.0$
  - $30–180$ days: $0.85$
  - $> 180$ days: $0.70$
- **Mutual Bonus ($S_{\text{mutual\_bonus}}$)**: $+0.15$ per verified mutual connection, capped at $+0.45$.

```python
# Example Edge Weight Calculation
def calculate_edge_weight(degree: str, connection_date: str, mutual_count: int) -> float:
    base = 1.0 if degree == "1st" else 0.7
    recency = get_recency_multiplier(connection_date)
    bonus = min(0.45, mutual_count * 0.15)
    return round(base * recency + bonus, 3)
```
