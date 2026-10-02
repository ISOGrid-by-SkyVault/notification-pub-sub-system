/**
 * Notification inbox.
 *
 * Loads the seeded users from GET /api/users, lets the viewer switch between
 * them, and listens to the selected user's Server-Sent Events stream at
 * GET /users/:userId/notifications.
 *
 * Only the selected user has an open stream. Notifications dispatched to a
 * user nobody is listening to stay "pending" on the server and are replayed
 * as soon as that user's stream opens, so switching users loses nothing.
 */
document.addEventListener("DOMContentLoaded", () => {
  const userTabs = document.getElementById("user-tabs");
  const statusBadge = document.getElementById("stream-status");
  const staleBanner = document.getElementById("stale-banner");
  const reconnectBtn = document.getElementById("reconnect-btn");
  const clearBtn = document.getElementById("clear-btn");
  const feed = document.getElementById("feed");
  const feedTitle = document.getElementById("feed-title");
  const feedSubtitle = document.getElementById("feed-subtitle");
  const emptyState = document.getElementById("empty-state");
  const emptyText = document.getElementById("empty-text");

  // Same origin by default (nginx proxies to the API). `?api=https://host`
  // points the page at another API origin, and opening the file straight
  // from disk falls back to a local API.
  const BASE_URL = (
    new URLSearchParams(window.location.search).get("api") ||
    (window.location.protocol === "file:" ? "http://localhost:3000" : "")
  ).replace(/\/$/, "");

  const STORAGE_KEY = "inbox:lastUserId";
  const PAGE_TITLE = document.title;

  let users = [];
  let activeUser = null;
  let eventSource = null;
  let unseen = 0; // notifications received while the page was hidden

  // userId -> Map(notificationId -> event), kept for the page's lifetime so
  // switching back to a user shows what they already received.
  const inboxes = new Map();
  // batchId -> Promise<courseName | null>, for events that carry no course name
  const batchNames = new Map();

  function remember(userId) {
    try {
      localStorage.setItem(STORAGE_KEY, userId);
    } catch (err) {
      // storage unavailable (private window): the choice just isn't remembered
    }
  }

  function recall() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  function initials(name) {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
  }

  function inboxOf(userId) {
    if (!inboxes.has(userId)) inboxes.set(userId, new Map());
    return inboxes.get(userId);
  }

  function setStatus(status) {
    const labels = { offline: "Disconnected", connecting: "Connecting", online: "Live" };
    statusBadge.className = `status-badge status-${status}`;
    statusBadge.querySelector(".status-text").textContent = labels[status];
  }

  async function loadUsers() {
    try {
      const response = await fetch(`${BASE_URL}/api/users`);
      if (!response.ok) throw new Error(`API answered ${response.status}`);
      users = await response.json();
    } catch (err) {
      console.error("Could not load users:", err);
      userTabs.replaceChildren(hint(`Could not load users (${err.message}). Is the API running?`));
      return;
    }

    if (users.length === 0) {
      userTabs.replaceChildren(hint("No users found."));
      return;
    }

    renderTabs();

    // Preselect: ?user=<id>, then the last user viewed, then the first one
    const wanted = new URLSearchParams(window.location.search).get("user") || recall();
    selectUser(users.find((u) => u.userId === wanted) || users[0]);
  }

  function hint(text) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = text;
    return p;
  }

  function renderTabs() {
    userTabs.replaceChildren(
      ...users.map((user) => {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "user-tab";
        tab.setAttribute("role", "tab");
        tab.dataset.userId = user.userId;

        const avatar = document.createElement("span");
        avatar.className = "avatar";
        avatar.textContent = initials(user.name);

        const label = document.createElement("span");
        const name = document.createElement("span");
        name.className = "user-name";
        name.textContent = user.name;
        const email = document.createElement("span");
        email.className = "user-email";
        email.textContent = user.email;
        label.append(name, email);

        const count = document.createElement("span");
        count.className = "unread";
        count.hidden = true;

        tab.append(avatar, label, count);
        tab.addEventListener("click", () => selectUser(user));
        return tab;
      })
    );
  }

  function updateTabs() {
    userTabs.querySelectorAll(".user-tab").forEach((tab) => {
      const isActive = activeUser !== null && tab.dataset.userId === activeUser.userId;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));

      const received = inboxOf(tab.dataset.userId).size;
      const count = tab.querySelector(".unread");
      count.hidden = received === 0;
      count.textContent = String(received);
    });
  }

  function selectUser(user) {
    if (activeUser && activeUser.userId === user.userId) return;

    activeUser = user;
    remember(user.userId);
    feedTitle.textContent = `${user.name}'s notifications`;
    renderFeed();
    openStream();
  }

  function closeStream() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    setStatus("offline");
  }

  function openStream() {
    closeStream();
    staleBanner.hidden = true;
    setStatus("connecting");
    feedSubtitle.textContent = `Connecting to ${activeUser.email}…`;

    const user = activeUser;
    const source = new EventSource(`${BASE_URL}/users/${encodeURIComponent(user.userId)}/notifications`);
    eventSource = source;

    source.onmessage = (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch (err) {
        console.error("Unreadable event:", message.data);
        return;
      }

      if (event.type === "connected") {
        setStatus("online");
        feedSubtitle.textContent = `Listening for notifications sent to ${user.email}.`;
      } else if (event.type === "notification") {
        receive(user, event);
      } else if (event.type === "stale") {
        // The server keeps one stream per user and just handed it to another
        // page. Stop here: letting EventSource reconnect would steal the
        // stream back and the two pages would disconnect each other forever.
        closeStream();
        staleBanner.hidden = false;
        feedSubtitle.textContent = "Not listening.";
      }
    };

    // EventSource retries on its own; just reflect the state meanwhile
    source.onerror = () => {
      if (eventSource !== source) return;
      setStatus("connecting");
      feedSubtitle.textContent = "Connection lost, retrying…";
    };
  }

  function receive(user, event) {
    // Keyed by notificationId: a replayed event updates the entry in place
    const entry = { ...event, receivedAt: Date.now() };
    inboxOf(user.userId).set(event.notificationId, entry);

    if (!entry.courseName && entry.batchId) {
      courseNameOf(entry.batchId).then((courseName) => {
        if (!courseName) return;
        entry.courseName = courseName;
        if (activeUser && activeUser.userId === user.userId) renderFeed();
      });
    }

    if (document.hidden) {
      unseen += 1;
      document.title = `(${unseen}) ${PAGE_TITLE}`;
    }

    renderFeed();
  }

  // Events replayed from the backlog carry no course name: ask the API once
  // per batch.
  function courseNameOf(batchId) {
    if (!batchNames.has(batchId)) {
      batchNames.set(
        batchId,
        fetch(`${BASE_URL}/api/batches/${encodeURIComponent(batchId)}`)
          .then((response) => (response.ok ? response.json() : null))
          .then((batch) => (batch ? batch.courseName : null))
          .catch(() => null)
      );
    }
    return batchNames.get(batchId);
  }

  function renderFeed() {
    const entries = activeUser ? [...inboxOf(activeUser.userId).values()] : [];
    entries.sort((a, b) => b.receivedAt - a.receivedAt);

    feed.replaceChildren(...entries.map(renderNotification));
    emptyState.hidden = entries.length > 0;
    emptyText.textContent = activeUser
      ? `Nothing for ${activeUser.name} yet. Send a batch from the dashboard and it will show up here.`
      : "Nothing here yet.";
    clearBtn.hidden = entries.length === 0;
    updateTabs();
  }

  function renderNotification(entry) {
    const delivered = entry.status === "delivered";

    const item = document.createElement("li");
    item.className = `notification ${delivered ? "delivered" : "dead"}`;

    const top = document.createElement("div");
    top.className = "notification-top";
    const title = document.createElement("span");
    title.className = "notification-title";
    title.textContent = entry.courseName || "Course enrollment";
    const badge = document.createElement("span");
    badge.className = "notification-badge";
    badge.textContent = delivered ? "Delivered" : "Failed";
    top.append(title, badge);
    item.append(top);

    const message = document.createElement("p");
    message.className = "notification-message";
    message.textContent = entry.message || (delivered ? "You have a new enrollment notification." : "A notification could not be delivered.");
    item.append(message);

    if (entry.error) {
      const error = document.createElement("p");
      error.className = "notification-error";
      error.textContent = entry.error;
      item.append(error);
    }

    const meta = document.createElement("div");
    meta.className = "notification-meta";
    const time = new Date(entry.dispatchedAt || entry.receivedAt).toLocaleTimeString();
    const attempts = `${entry.attempts} ${entry.attempts === 1 ? "attempt" : "attempts"}`;
    const batch = entry.batchId ? `Batch ${entry.batchId.substring(0, 8)}` : null;
    [time, attempts, batch].filter(Boolean).forEach((text) => {
      const span = document.createElement("span");
      span.textContent = text;
      meta.append(span);
    });
    item.append(meta);

    return item;
  }

  reconnectBtn.addEventListener("click", () => {
    if (activeUser) openStream();
  });

  clearBtn.addEventListener("click", () => {
    if (!activeUser) return;
    inboxOf(activeUser.userId).clear();
    renderFeed();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      unseen = 0;
      document.title = PAGE_TITLE;
    }
  });

  loadUsers();
});
