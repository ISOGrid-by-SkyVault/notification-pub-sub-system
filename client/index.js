/**
 * Sender dashboard, served by the API at /.
 *
 * Publishes enrollment batches (POST /api/batches) and can listen to one
 * seeded user's SSE stream to watch the dispatch results arrive.
 * The standalone inbox in frontend/ is the receive-only counterpart.
 */
document.addEventListener("DOMContentLoaded", () => {
  const usersListContainer = document.getElementById("users-list");
  const recipientsCheckboxes = document.getElementById("recipients-checkboxes");
  const batchForm = document.getElementById("batch-form");
  const streamStatusBadge = document.getElementById("stream-status");
  const notificationsFeed = document.getElementById("notifications-feed");
  const streamTargetText = document.getElementById("stream-target-text");

  const BASE_URL = window.location.protocol === "file:" ? "http://localhost:3000" : "";

  let activeUser = null;
  let eventSource = null;
  let allUsers = [];

  // Fetch seeded users on load
  async function fetchUsers() {
    try {
      const response = await fetch(`${BASE_URL}/api/users`);
      if (!response.ok) throw new Error("Failed to retrieve users list");
      allUsers = await response.json();
      renderUsers(allUsers);
      renderRecipientsCheckboxes(allUsers);
    } catch (error) {
      console.error("Error loading users:", error);
      usersListContainer.innerHTML = `<div class="loading-spinner" style="color:#ef4444;">Failed to load users: ${error.message}</div>`;
    }
  }

  // Render users in sidebar
  function renderUsers(users) {
    if (users.length === 0) {
      usersListContainer.innerHTML = '<div class="loading-spinner">No users found.</div>';
      return;
    }

    usersListContainer.innerHTML = "";
    users.forEach((user) => {
      const userItem = document.createElement("div");
      userItem.className = "user-item";
      userItem.dataset.userId = user.userId;
      userItem.innerHTML = `
        <div class="user-info">
          <h3>${user.name}</h3>
          <p>${user.email}</p>
        </div>
        <span class="user-badge">Listen</span>
      `;
      userItem.addEventListener("click", () => selectUser(user));
      usersListContainer.appendChild(userItem);
    });
  }

  // Render recipient checkboxes in the batch form
  function renderRecipientsCheckboxes(users) {
    recipientsCheckboxes.innerHTML = "";
    users.forEach((user) => {
      const label = document.createElement("label");
      label.className = "recipient-checkbox-label";
      label.innerHTML = `
        <input type="checkbox" name="recipients" value="${user.email}" checked>
        <span>${user.name} (${user.email})</span>
      `;
      recipientsCheckboxes.appendChild(label);
    });
  }

  // Handle active user selection
  function selectUser(user) {
    if (activeUser && activeUser.userId === user.userId) return;

    activeUser = user;
    
    // Highlight selected item in sidebar
    document.querySelectorAll(".user-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.userId === user.userId);
    });

    // Close previous stream
    closeSSEStream();

    // Start new stream
    openSSEStream(user);
  }

  // Close EventSource stream
  function closeSSEStream() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    updateStatusBadge("offline");
  }

  // Open EventSource SSE stream for selected user
  function openSSEStream(user) {
    updateStatusBadge("connecting");
    streamTargetText.textContent = `Streaming notifications for ${user.name} (${user.email})...`;
    notificationsFeed.innerHTML = ""; // Clear existing stream cards

    // Initialize EventSource
    eventSource = new EventSource(`${BASE_URL}/users/${user.userId}/notifications`);

    eventSource.onopen = () => {
      updateStatusBadge("online");
    };

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "connected") {
          console.log("SSE established on channel:", payload.channel);
          // Initial established state
          const startCard = document.createElement("div");
          startCard.className = "loading-spinner";
          startCard.style.padding = "0.5rem";
          startCard.textContent = "Real-time connection established. Waiting for dispatches...";
          notificationsFeed.appendChild(startCard);
          return;
        }

        if (payload.type === "notification") {
          removeLoadingSpinner();
          addNotificationCard(payload);
          return;
        }

        // The server keeps one stream per user and handed this one to another
        // page (e.g. the inbox frontend). Stop instead of letting EventSource
        // reconnect, or both pages would keep disconnecting each other.
        if (payload.type === "stale") {
          closeSSEStream();
          activeUser = null;
          document.querySelectorAll(".user-item").forEach((el) => el.classList.remove("active"));
          streamTargetText.textContent = `${user.name}'s stream was opened somewhere else. Select the user again to listen here.`;
        }
      } catch (err) {
        console.error("Error parsing message payload:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE connection error:", err);
      updateStatusBadge("connecting");
    };
  }

  // Remove loading spinners in feed
  function removeLoadingSpinner() {
    const spinner = notificationsFeed.querySelector(".loading-spinner");
    if (spinner) spinner.remove();
  }

  // Add notification item in DOM
  function addNotificationCard(data) {
    const card = document.createElement("div");
    card.className = `notification-card ${data.status}`;
    
    const formattedDate = data.dispatchedAt ? new Date(data.dispatchedAt).toLocaleTimeString() : new Date().toLocaleTimeString();

    card.innerHTML = `
      <div class="notification-top">
        <span class="notif-title">Recipients: ${data.recipient}</span>
        <span class="notif-badge ${data.status}">${data.status.toUpperCase()}</span>
      </div>
      <p class="notif-message">Notification successfully queued and dispatched under batch.</p>
      ${data.error ? `<div class="notif-error"><strong>Error:</strong> ${data.error}</div>` : ""}
      <div class="notif-meta">
        <span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          ${formattedDate}
        </span>
        <span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M23 4v6h-6M1 20v-6h6"/></svg>
          Attempts: ${data.attempts}
        </span>
        <span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          Batch ID: ${data.batchId.substring(0, 8)}...
        </span>
      </div>
    `;

    // Prepend to show newest on top
    notificationsFeed.prepend(card);
  }

  // Update connection status badge
  function updateStatusBadge(status) {
    streamStatusBadge.className = `status-badge status-${status}`;
    
    const dot = streamStatusBadge.querySelector(".status-dot");
    const text = streamStatusBadge.querySelector(".status-text");

    if (status === "offline") {
      text.textContent = "Disconnected";
    } else if (status === "connecting") {
      text.textContent = "Connecting";
    } else if (status === "online") {
      text.textContent = "Connected";
    }
  }

  // Intercept Form Submission & post batch
  batchForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const courseName = document.getElementById("courseName").value;
    const priority = document.getElementById("priority").value;
    const message = document.getElementById("message").value;

    const checkedCheckboxes = Array.from(recipientsCheckboxes.querySelectorAll("input[name='recipients']:checked"));
    const recipients = checkedCheckboxes.map(cb => cb.value);

    if (recipients.length === 0) {
      alert("Please check at least one recipient user for enrollment.");
      return;
    }

    const payload = { courseName, priority, message, recipients };

    try {
      const response = await fetch(`${BASE_URL}/api/batches`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to trigger batch");
      }

      const batch = await response.json();
      console.log("Batch successfully created:", batch);
      
      // Flash the submit button to green
      const btn = batchForm.querySelector("button[type='submit']");
      const origText = btn.innerHTML;
      btn.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
      btn.innerHTML = `<span>Batch Published! (ID: ${batch.batchId.substring(0, 8)}...)</span>`;
      
      setTimeout(() => {
        btn.style.background = "";
        btn.innerHTML = origText;
      }, 3000);

    } catch (error) {
      console.error("Error posting batch:", error);
      alert(`Error triggering enrollment batch: ${error.message}`);
    }
  });

  // Load active state
  fetchUsers();
});
