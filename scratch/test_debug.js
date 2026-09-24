const fs = require("fs");
const path = require("path");

const contentJsPath = path.join(__dirname, "../extension/content.js");
const contentJsSource = fs.readFileSync(contentJsPath, "utf8");

function createMockEnvironment() {
  const elements = new Set();
  const listeners = {};

  const documentMock = {
    location: {
      href: "https://www.linkedin.com/mynetwork/invite-connect/connections/",
      origin: "https://www.linkedin.com"
    },
    documentElement: { innerText: "", textContent: "" },
    body: { innerText: "", textContent: "" },
    querySelectorAll: (selector) => {
      const results = [];
      for (const el of elements) {
        if (selector.includes('a[href*="/in/"]')) {
          if (el.tagName === "A" && el.href && el.href.includes("/in/")) {
            results.push(el);
          }
        }
      }
      return results;
    }
  };

  const windowMock = {
    location: documentMock.location,
    addEventListener: (type, fn) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    dispatchEvent: (type) => {
      if (listeners[type]) {
        listeners[type].forEach(fn => fn());
      }
    }
  };

  class MockMutationObserver {
    constructor(callback) { this.callback = callback; this.active = false; }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
    trigger(addedCount = 1) {
      if (this.active) this.callback([{ addedNodes: new Array(addedCount) }]);
    }
  }

  let messageListener = null;
  const storageMap = {};

  const chromeMock = {
    storage: {
      local: {
        get: (keys, cb) => {
          const res = {};
          keys.forEach(k => { res[k] = storageMap[k]; });
          cb(res);
        },
        set: (obj, cb) => {
          Object.assign(storageMap, obj);
          if (cb) cb();
        }
      }
    },
    runtime: {
      onMessage: {
        addListener: (fn) => { messageListener = fn; }
      },
      sendMessage: (msg, cb) => {
        if (cb) cb({ success: true });
      }
    }
  };

  function addConnectionCard({ name, profileUrl, degree = "1st", connectedDate = "September 10, 2026", headline = "Software Engineer" }) {
    const cardEl = {
      tagName: "DIV",
      innerText: `${name}\n${headline}\n${degree}\nConnected on ${connectedDate}\nMessage`,
      textContent: `${name}\n${headline}\n${degree}\nConnected on ${connectedDate}\nMessage`,
      querySelector: () => null,
      querySelectorAll: (sel) => {
        if (sel.includes('a[href*="/in/"]')) {
          return [anchorEl];
        }
        return [];
      }
    };

    const anchorEl = {
      tagName: "A",
      href: profileUrl,
      innerText: name,
      textContent: name,
      parentElement: cardEl,
      querySelector: (sel) => {
        if (sel.includes("span")) return { innerText: name, textContent: name };
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel.includes('a[href*="/in/"]')) {
          return [anchorEl];
        }
        return [];
      }
    };

    cardEl.parentElement = {
      parentElement: null,
      innerText: cardEl.innerText,
      textContent: cardEl.textContent,
      querySelectorAll: () => [anchorEl]
    };

    elements.add(anchorEl);
    elements.add(cardEl);
    return { anchorEl, cardEl };
  }

  const vm = require("node:vm");
  const sandbox = {
    window: windowMock,
    document: documentMock,
    location: documentMock.location,
    MutationObserver: MockMutationObserver,
    chrome: chromeMock,
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: (id) => clearTimeout(id),
    console: console,
    Date: Date,
    URL: URL,
    Map: Map,
    Set: Set,
    JSON: JSON,
    parseInt: parseInt,
    isNaN: isNaN,
    RegExp: RegExp
  };

  vm.createContext(sandbox);
  vm.runInContext(contentJsSource, sandbox);

  return {
    sandbox,
    sendMessage: (msg) => {
      let response = null;
      messageListener(msg, {}, (res) => { response = res; });
      return response;
    },
    addConnectionCard
  };
}

const env = createMockEnvironment();
let r1 = env.sendMessage({ action: "startCollection" });
console.log("startCollection res:", r1);

env.addConnectionCard({ name: "Alice Smith", profileUrl: "https://www.linkedin.com/in/alice-smith" });
let r2 = env.sendMessage({ action: "getCollectionStatus" });
console.log("getCollectionStatus res:", r2);

let r3 = env.sendMessage({ action: "resumeCollection" });
console.log("resumeCollection res:", r3);
