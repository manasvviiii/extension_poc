# Warm Introduction Methodology

**Category:** Warm Introduction  
**Last Updated:** Sep 24, 2026  
**Reading Time:** 9 min read  

Cold outreach yields sub-3% response rates in high-stakes professional transactions. WarmGraph identifies trusted paths to target decision-makers through mutual connections.

> [!NOTE]
> A **Warm Path** is a multi-hop path through an owner's verified professional network connecting them to a target person or company.

---

## The 3-Step Warm Path Discovery Process

1. **Target Identification**:
   User specifies a target company or individual (e.g. CFO at Target Corp).
2. **Graph Traversal (Dijkstra / Shortest Path)**:
   WarmGraph executes weighted pathfinding over the owner's relationship graph:
   $$\text{Path Score} = \prod_{e \in \text{Path}} \text{Weight}(e)$$
3. **Warm Path Ranking**:
   Paths are ranked by aggregate path score, recency, and mutual connection count.

---

## Warm Path Ranking Hierarchy

1. **Direct 1st-Degree Path** (Owner ──► Target)
   - Highest confidence; direct contact established.
2. **2-Hop Mutual Path** (Owner ──► Connector ──► Target)
   - Ideal intro path; single intermediary connector needed.
3. **3-Hop Extended Path** (Owner ──► Node A ──► Node B ──► Target)
   - Extended warm introduction path.

```json
// Example Ranked Warm Path Output
{
  "target": "Jane Doe (CFO, Target Corp)",
  "path_score": 0.885,
  "hops": 2,
  "connector": {
    "name": "Alex Smith",
    "headline": "Partner at Alpha Ventures",
    "relationship_degree": "1st"
  }
}
```
