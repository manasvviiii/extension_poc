# Engineering Principles

**Category:** Engineering Decisions  
**Last Updated:** Sep 24, 2026  
**Reading Time:** 5 min read  

Engineering standards guiding the design, execution, and boundary enforcement of WarmGraph components.

---

## Core Engineering Directives

### 1. Zero Stealth Automation
WarmGraph strictly avoids bot-evasion tactics, fingerprint manipulation, automated crawling, or hidden network requests. Data acquisition is purely passive DOM extraction while the user browses.

### 2. Strict Tenant Isolation
All stored network snapshots, graph nodes, and audit logs are scoped to the authenticated `owner_id`. Cross-tenant data leaks are guarded at API endpoints and repository bounds.

### 3. Read-Only Developer Workspaces
Internal developer tools (such as the Developer Extraction Dashboard and Knowledge Hub) execute read-only queries and must never alter network data, trigger sync operations, or mutate database states.

### 4. Empirical Verification
No feature or bugfix is declared complete without executing test verification commands demonstrating 100% clean test execution.
