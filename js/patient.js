const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STORAGE_KEY = "clinic_ticket_code";
const POLL_MS = 15000;

const entryCard = document.getElementById("entryCard");
const waitCard = document.getElementById("waitCard");
const codeForm = document.getElementById("codeForm");
const codeInput = document.getElementById("codeInput");
const entryError = document.getElementById("entryError");
const notMineBtn = document.getElementById("notMineBtn");

const ticketLabel = document.getElementById("ticketLabel");
const waitNumber = document.getElementById("waitNumber");
const waitUnit = document.getElementById("waitUnit");
const statusMsg = document.getElementById("statusMsg");
const subMsg = document.getElementById("subMsg");

let pollTimer = null;

function getCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  return code ? code.trim().toUpperCase() : null;
}

function init() {
  const urlCode = getCodeFromUrl();
  if (urlCode) {
    localStorage.setItem(STORAGE_KEY, urlCode);
    showWaitScreen(urlCode);
    return;
  }

  const savedCode = localStorage.getItem(STORAGE_KEY);
  if (savedCode) {
    showWaitScreen(savedCode);
    return;
  }

  showEntryScreen();
}

function showEntryScreen() {
  stopPolling();
  entryCard.style.display = "block";
  waitCard.style.display = "none";
}

function showWaitScreen(code) {
  entryCard.style.display = "none";
  waitCard.style.display = "block";
  fetchStatus(code);
  startPolling(code);
}

codeForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const code = codeInput.value.trim().toUpperCase();
  if (!code) return;
  entryError.style.display = "none";
  localStorage.setItem(STORAGE_KEY, code);
  showWaitScreen(code);
});

notMineBtn.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  // Clear the code from the URL too, so a refresh doesn't re-load it.
  window.history.replaceState({}, "", "patient.html");
  showEntryScreen();
});

function startPolling(code) {
  stopPolling();
  pollTimer = setInterval(() => fetchStatus(code), POLL_MS);
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") {
    const code = localStorage.getItem(STORAGE_KEY);
    if (code) fetchStatus(code);
  }
}

async function fetchStatus(code) {
  const { data, error } = await sb.rpc("get_ticket_status", { p_code: code });

  if (error || !data || data.length === 0) {
    ticketLabel.textContent = "Ticket not found";
    waitNumber.textContent = "—";
    waitUnit.textContent = "";
    statusMsg.textContent = "We couldn't find that ticket.";
    subMsg.textContent = "Please check with the front desk.";
    return;
  }

  const t = data[0];
  ticketLabel.textContent = `Ticket ${t.ticket_code}`;

  if (t.status === "waiting") {
    waitNumber.classList.remove("pulse");
    if (t.position_in_queue === 0) {
      waitNumber.textContent = "Next";
      waitUnit.textContent = "";
      statusMsg.textContent = "You'll be called any moment";
    } else {
      waitNumber.textContent = t.estimated_wait_minutes;
      waitUnit.textContent = "minutes";
      statusMsg.textContent = `${t.position_in_queue} patient${t.position_in_queue === 1 ? "" : "s"} ahead of you`;
    }
    subMsg.textContent = "This screen updates on its own — no need to refresh.";
  } else if (t.status === "in_progress") {
    waitNumber.textContent = "Now";
    waitUnit.textContent = "";
    waitNumber.classList.add("pulse");
    statusMsg.textContent = "You're being seen";
    subMsg.textContent = "";
  } else if (t.status === "done") {
    waitNumber.textContent = "✓";
    waitUnit.textContent = "";
    waitNumber.classList.remove("pulse");
    statusMsg.textContent = "Visit complete";
    subMsg.textContent = "Thank you for visiting us.";
    stopPolling();
  } else {
    waitNumber.textContent = "—";
    waitUnit.textContent = "";
    statusMsg.textContent = "This ticket is no longer active.";
    subMsg.textContent = "Please check with the front desk.";
    stopPolling();
  }
}

init();
