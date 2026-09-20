import sys
import unittest
import uuid
from pathlib import Path

import networkx as nx

sys.path.insert(0, str(Path(__file__).parents[1]))

from auth.context import AuthContext
from services.graph_cache import TenantGraphCache
from services.graph_service import GraphService, build_graph_from_network


class GraphServiceAndCacheTests(unittest.TestCase):
    def setUp(self):
        self.cache = TenantGraphCache()
        self.service = GraphService(self.cache)
        self.network_data_a = {
            "owner_id": "owner_a",
            "connections": [
                {
                    "name": "Direct A",
                    "profile_url": "https://example.test/in/direct-a",
                    "source": "test",
                }
            ],
            "relationship_evidence": [],
        }
        self.network_data_b = {
            "owner_id": "owner_b",
            "connections": [
                {
                    "name": "Direct B",
                    "profile_url": "https://example.test/in/direct-b",
                    "source": "test",
                }
            ],
            "relationship_evidence": [],
        }

    def test_graph_build_and_deterministic_reconstruction(self):
        graph1 = build_graph_from_network("owner_a", self.network_data_a)
        graph2 = build_graph_from_network("owner_a", self.network_data_a)

        self.assertEqual(graph1.number_of_nodes(), 2)
        self.assertEqual(graph1.number_of_edges(), 1)
        self.assertEqual(graph1.nodes(), graph2.nodes())
        self.assertEqual(
            list(graph1.edges(data=True)),
            list(graph2.edges(data=True)),
        )

    def test_tenant_cache_isolation(self):
        tenant_a = uuid.uuid4()
        tenant_b = uuid.uuid4()

        ctx_a = AuthContext(user_id=uuid.uuid4(), tenant_id=tenant_a, owner_id="owner_shared")
        ctx_b = AuthContext(user_id=uuid.uuid4(), tenant_id=tenant_b, owner_id="owner_shared")

        graph_a = build_graph_from_network("owner_shared", self.network_data_a)
        graph_b = build_graph_from_network("owner_shared", self.network_data_b)

        self.cache.set_graph(tenant_a, "owner_shared", graph_a)
        self.cache.set_graph(tenant_b, "owner_shared", graph_b)

        retrieved_a = self.cache.get_graph(tenant_a, "owner_shared")
        retrieved_b = self.cache.get_graph(tenant_b, "owner_shared")

        self.assertIsNotNone(retrieved_a)
        self.assertIsNotNone(retrieved_b)
        self.assertIn("https://example.test/in/direct-a", retrieved_a)
        self.assertNotIn("https://example.test/in/direct-a", retrieved_b)

    def test_cache_hit_miss_and_invalidation(self):
        tenant = uuid.uuid4()

        def loader(owner_id, auth_ctx):
            return self.network_data_a

        # Miss & Load
        graph1 = self.service.get_owner_graph("owner_a", AuthContext(user_id=uuid.uuid4(), tenant_id=tenant, owner_id="owner_a"), loader)
        self.assertIsNotNone(graph1)

        # Hit
        graph2 = self.service.get_owner_graph("owner_a", AuthContext(user_id=uuid.uuid4(), tenant_id=tenant, owner_id="owner_a"), None)
        self.assertIs(graph1, graph2)

        # Invalidate
        self.service.invalidate_owner_graph("owner_a", AuthContext(user_id=uuid.uuid4(), tenant_id=tenant, owner_id="owner_a"))
        self.assertIsNone(self.cache.get_graph(tenant, "owner_a"))

    def test_mutation_invalidates_stale_graph(self):
        tenant = uuid.uuid4()
        ctx = AuthContext(user_id=uuid.uuid4(), tenant_id=tenant, owner_id="owner_a")

        self.service.rebuild_owner_graph("owner_a", self.network_data_a, ctx)
        self.assertIsNotNone(self.cache.get_graph(tenant, "owner_a"))

        # Rebuilding with None invalidates
        self.service.rebuild_owner_graph("owner_a", None, ctx)
        self.assertIsNone(self.cache.get_graph(tenant, "owner_a"))


if __name__ == "__main__":
    unittest.main()
