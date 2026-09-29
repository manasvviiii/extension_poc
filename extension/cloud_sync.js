/**
 * WarmGraph Cloud Sync Adapter — Task 13.5
 * Offline SaaS synchronization layer with local pending queue & retry logic.
 */

const CloudSyncAdapter = {
  baseUrl: "http://127.0.0.1:8000",
  pendingQueueKey: "warmgraph_pending_sync",

  /**
   * Start a cloud sync session.
   * Flushes any pending offline items if backend is available.
   */
  async startSync(userId = "local_user") {
    await this.flushPendingQueue();
    return {
      sessionId: `sync_${Date.now()}`,
      userId,
      startedAt: new Date().toISOString(),
      status: "running"
    };
  },

  /**
   * Upload connections to backend /sync/network endpoint.
   * If offline, saves to pending queue.
   */
  async uploadConnections(userId = "local_user", connections = []) {
    const payload = {
      user_id: userId,
      owner_id: userId,
      connections: connections,
      source: "linkedin_dom",
      confirmed: true,
      completion_status: "complete"
    };

    try {
      const response = await fetch(`${this.baseUrl}/sync/network`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = await response.json();
        return { success: true, queued: false, data };
      }
    } catch (err) {
      console.warn("[CloudSyncAdapter] Backend unreachable. Queueing connections locally.", err);
    }

    // Offline failure recovery: Queue locally in warmgraph_pending_sync
    await this.enqueuePendingSync(userId, "network", payload);
    return {
      success: false,
      queued: true,
      message: "Backend offline. Connection payload saved to warmgraph_pending_sync queue."
    };
  },

  /**
   * Upload relationship evidence to backend /sync/relationships endpoint.
   * If offline, saves to pending queue.
   */
  async uploadEvidence(userId = "local_user", evidence = []) {
    const payload = {
      user_id: userId,
      owner_id: userId,
      evidence: evidence
    };

    try {
      const response = await fetch(`${this.baseUrl}/sync/relationships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = await response.json();
        return { success: true, queued: false, data };
      }
    } catch (err) {
      console.warn("[CloudSyncAdapter] Backend unreachable. Queueing evidence locally.", err);
    }

    // Offline failure recovery: Queue locally in warmgraph_pending_sync
    await this.enqueuePendingSync(userId, "relationships", payload);
    return {
      success: false,
      queued: true,
      message: "Backend offline. Evidence payload saved to warmgraph_pending_sync queue."
    };
  },

  /**
   * Finish sync session and report summary.
   */
  async finishSync(userId = "local_user", summary = {}) {
    const status = await this.getLastSync(userId);
    return {
      success: true,
      userId,
      completedAt: new Date().toISOString(),
      summary,
      status
    };
  },

  /**
   * Fetch current sync status from backend /sync/status endpoint.
   */
  async getLastSync(userId = "local_user") {
    try {
      const response = await fetch(`${this.baseUrl}/sync/status?user_id=${encodeURIComponent(userId)}`);
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      // Backend unreachable
    }

    // Return offline status fallback
    const queue = await this.getPendingQueue();
    return {
      user_id: userId,
      status: queue.length > 0 ? "pending_offline_queue" : "completed",
      progress: 100,
      pending_queued_items: queue.length,
      last_sync: new Date().toISOString()
    };
  },

  /**
   * Add a payload to local pending queue (warmgraph_pending_sync).
   */
  async enqueuePendingSync(userId, type, payload) {
    const queue = await this.getPendingQueue();
    queue.push({
      id: `pending_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      userId,
      type,
      payload,
      queuedAt: new Date().toISOString()
    });
    await this.savePendingQueue(queue);
  },

  /**
   * Flush and retry all items in warmgraph_pending_sync queue.
   */
  async flushPendingQueue() {
    const queue = await this.getPendingQueue();
    if (queue.length === 0) return { flushed: 0, remaining: 0 };

    const remaining = [];
    let flushedCount = 0;

    for (const item of queue) {
      try {
        const endpoint = item.type === "relationships" ? "/sync/relationships" : "/sync/network";
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.payload)
        });

        if (response.ok) {
          flushedCount++;
        } else {
          remaining.push(item);
        }
      } catch (err) {
        remaining.push(item);
      }
    }

    await this.savePendingQueue(remaining);
    return { flushed: flushedCount, remaining: remaining.length };
  },

  /**
   * Helper: Get pending queue from chrome.storage.local or localStorage.
   */
  getPendingQueue() {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([this.pendingQueueKey], (result) => {
          resolve(result[this.pendingQueueKey] || []);
        });
      } else if (typeof localStorage !== "undefined") {
        try {
          const raw = localStorage.getItem(this.pendingQueueKey);
          resolve(raw ? JSON.parse(raw) : []);
        } catch (e) {
          resolve([]);
        }
      } else {
        resolve([]);
      }
    });
  },

  /**
   * Helper: Save pending queue to chrome.storage.local or localStorage.
   */
  savePendingQueue(queue) {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [this.pendingQueueKey]: queue }, () => resolve());
      } else if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(this.pendingQueueKey, JSON.stringify(queue));
        } catch (e) {}
        resolve();
      } else {
        resolve();
      }
    });
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = CloudSyncAdapter;
}
