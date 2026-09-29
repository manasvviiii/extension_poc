/**
 * WarmGraph Invisible Local Workspace Identity Service
 * TASK 13.5.3 — Invisible Local Workspace (Zero-Click UX)
 *
 * Automatically provisions a persistent local workspace using a UUID stored in
 * chrome.storage.local key 'warmgraph_user'. Zero authentication UI or credentials required.
 */

const LOCAL_STORAGE_SESSION_KEY = "warmgraph_user";
const LOCAL_STORAGE_TOKEN_KEY = "warmgraph_access_token";

const _memoryStore = new Map();

function generateUUID() {
  let hex = "";
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    hex = crypto.randomUUID().replace(/-/g, "").substring(0, 15);
  } else {
    hex = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 9);
  }
  return `wg_${hex}`;
}

class AuthService {
  /**
   * Get or automatically provision the persistent local workspace identity.
   */
  static async getCurrentUser() {
    return new Promise((resolve) => {
      const handleUser = (user) => {
        if (user && user.id) {
          resolve(user);
        } else {
          // Provision workspace automatically on first launch
          AuthService.ensureLocalWorkspace().then(resolve);
        }
      };

      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([LOCAL_STORAGE_SESSION_KEY], (res) => {
          handleUser(res ? res[LOCAL_STORAGE_SESSION_KEY] : null);
        });
      } else if (typeof localStorage !== "undefined") {
        try {
          const raw = localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
          handleUser(raw ? JSON.parse(raw) : _memoryStore.get(LOCAL_STORAGE_SESSION_KEY));
        } catch (_) {
          handleUser(_memoryStore.get(LOCAL_STORAGE_SESSION_KEY));
        }
      } else {
        handleUser(_memoryStore.get(LOCAL_STORAGE_SESSION_KEY));
      }
    });
  }

  /**
   * Automatically ensure local workspace exists. Generates UUID if missing.
   */
  static async ensureLocalWorkspace() {
    const existing = await new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([LOCAL_STORAGE_SESSION_KEY], (res) => {
          resolve(res ? res[LOCAL_STORAGE_SESSION_KEY] : null);
        });
      } else if (typeof localStorage !== "undefined") {
        try {
          const raw = localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
          resolve(raw ? JSON.parse(raw) : _memoryStore.get(LOCAL_STORAGE_SESSION_KEY));
        } catch (_) {
          resolve(_memoryStore.get(LOCAL_STORAGE_SESSION_KEY));
        }
      } else {
        resolve(_memoryStore.get(LOCAL_STORAGE_SESSION_KEY));
      }
    });

    const now = new Date().toISOString();
    let user;

    if (existing && existing.id) {
      user = {
        ...existing,
        name: "WarmGraph User",
        provider: "local",
        last_active: now
      };
    } else {
      const newId = generateUUID();
      user = {
        id: newId,
        name: "WarmGraph User",
        provider: "local",
        created_at: now,
        last_active: now
      };
    }

    const rawUuid = user.id.startsWith("wg_") ? user.id.substring(3) : user.id;
    const token = `wg_local_${rawUuid}`;

    return new Promise((resolve) => {
      const data = {
        [LOCAL_STORAGE_SESSION_KEY]: user,
        [LOCAL_STORAGE_TOKEN_KEY]: token
      };

      _memoryStore.set(LOCAL_STORAGE_SESSION_KEY, user);
      _memoryStore.set(LOCAL_STORAGE_TOKEN_KEY, token);

      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(data, () => resolve(user));
      } else if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(user));
          localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, token);
        } catch (_) {}
        resolve(user);
      } else {
        resolve(user);
      }
    });
  }

  static async loginLocal() {
    return AuthService.ensureLocalWorkspace();
  }

  /**
   * Log out and clear local session keys (for test suite resets).
   */
  static async logout() {
    _memoryStore.delete(LOCAL_STORAGE_SESSION_KEY);
    _memoryStore.delete(LOCAL_STORAGE_TOKEN_KEY);

    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove([LOCAL_STORAGE_SESSION_KEY, LOCAL_STORAGE_TOKEN_KEY], () => {
          resolve();
        });
      } else if (typeof localStorage !== "undefined") {
        try {
          localStorage.removeItem(LOCAL_STORAGE_SESSION_KEY);
          localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
        } catch (_) {}
        resolve();
      } else {
        resolve();
      }
    });
  }

  static async isAuthenticated() {
    return true; // Always true for invisible local workspace
  }

  static async getAccessToken() {
    const user = await AuthService.getCurrentUser();
    const rawUuid = user.id.startsWith("wg_") ? user.id.substring(3) : user.id;
    return `wg_local_${rawUuid}`;
  }
}

if (typeof window !== "undefined") {
  window.AuthService = AuthService;
  // Automatically provision local workspace on script load
  AuthService.ensureLocalWorkspace().catch(() => {});
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { AuthService };
}
