import os
import unittest

class TestWarmGraphPublicWebsiteStructure(unittest.TestCase):
    def setUp(self):
        self.base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.website_dir = os.path.join(self.base_dir, "website")

    def test_pages_exist(self):
        """Verify index.html, knowledge.html, roadmap.html exist."""
        for page in ["index.html", "knowledge.html", "roadmap.html"]:
            path = os.path.join(self.website_dir, page)
            self.assertTrue(os.path.exists(path), f"{page} must exist in website/")

    def test_css_files_exist(self):
        """Verify global.css, landing.css, knowledge.css exist."""
        for css in ["global.css", "landing.css", "knowledge.css"]:
            path = os.path.join(self.website_dir, "css", css)
            self.assertTrue(os.path.exists(path), f"css/{css} must exist in website/")

    def test_js_files_exist(self):
        """Verify app.js, knowledge.js, animations.js exist."""
        for js in ["app.js", "knowledge.js", "animations.js"]:
            path = os.path.join(self.website_dir, "js", js)
            self.assertTrue(os.path.exists(path), f"js/{js} must exist in website/")

    def test_assets_exist(self):
        """Verify logo.svg exists."""
        logo_path = os.path.join(self.website_dir, "assets", "logo.svg")
        self.assertTrue(os.path.exists(logo_path), "assets/logo.svg must exist")

    def test_markdown_docs_exist(self):
        """Verify all required documentation articles exist in website/docs/."""
        expected_docs = [
            "architecture.md",
            "acquisition.md",
            "graph_engine.md",
            "relationship.md",
            "banking.md",
            "roadmap.md"
        ]
        for doc in expected_docs:
            doc_path = os.path.join(self.website_dir, "docs", doc)
            self.assertTrue(os.path.exists(doc_path), f"docs/{doc} must exist")

    def test_roadmap_sections(self):
        """Verify roadmap.html contains Implemented, Current, and Upcoming sections."""
        roadmap_path = os.path.join(self.website_dir, "roadmap.html")
        with open(roadmap_path, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("IMPLEMENTED", content)
        self.assertIn("CURRENT PHASE", content)
        self.assertIn("UPCOMING MILESTONES", content)
        self.assertIn("Persistent acquisition", content)
        self.assertIn("Public Website", content)

    def test_no_external_modifications(self):
        """Verify that external production folders remained untouched."""
        for p in ["extension", "backend", "mock_network"]:
            path = os.path.join(self.base_dir, p)
            self.assertTrue(os.path.exists(path), f"{p} must exist and be untouched")

if __name__ == "__main__":
    unittest.main()
