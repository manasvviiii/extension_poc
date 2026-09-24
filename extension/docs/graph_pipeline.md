# Graph Generation Pipeline

**Category:** Graph Engine  
**Last Updated:** Sep 24, 2026  
**Reading Time:** 8 min read  

The graph engine transforms raw connection records and relationship evidence snapshots into a NetworkX graph structure.

---

## Pipeline Execution Steps

1. **Snapshot Import**:
   Backend receives `/network/import` payload containing `connections` and `relationship_evidence`.
2. **Entity Resolution & Node Creation**:
   - Owner Node: Primary node created with `owner_id`.
   - Contact Nodes: Profile nodes created using `profile_node_id()` derived from normalized profile URL or name key.
3. **Edge Insertion & Weight Assignment**:
   - 1st-degree connection edges: `(owner_node, contact_node)` with weight $1.0$.
   - 2nd-degree mutual evidence edges: `(contact_node_A, contact_node_B)` with evidence weight $0.7$.
4. **Tenant Isolation Check**:
   Graphs are isolated per owner in `GRAPHS[owner_id]` dictionary or PostgreSQL repository.

```python
# Graph Generation Sample Implementation
import networkx as nx

def build_graph_from_network(owner_id: str, data: dict) -> nx.Graph:
    G = nx.Graph()
    G.add_node(f"owner:{owner_id}", type="owner", name=owner_id)
    
    for conn in data.get("connections", []):
        node_id = conn.get("profile_url") or conn.get("name")
        G.add_node(node_id, name=conn.get("name"), headline=conn.get("headline"))
        G.add_edge(f"owner:{owner_id}", node_id, weight=1.0)
        
    return G
```
