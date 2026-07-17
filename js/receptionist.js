const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const checkinForm = document.getElementById("checkinForm");
const ticketResult = document.getElementById("ticketResult");
const queueBody = document.getElementById("queueBody");
const signOutBtn = document.getElementById("signOutBtn");

let avgConsultMinutes = 15;
let realtimeChannel = null;

// ---------- Auth ----------

async function checkSession() {
  const { data } = await sb.auth.getSession();
  if (data.session) {
    showApp();
  } else {
    loginView.style.display = "block";
    appView.style.display = "none";
  }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.style.display = "none";
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    loginError.textContent = "Couldn't sign in — check the email and password.";
    loginError.style.display = "block";
    return;
  }
  showApp();
});

signOutBtn.addEventListener("click", async () => {
  await sb.auth.signOut();
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  loginView.style.display = "block";
  appView.style.display = "none";
});

function showApp() {
  loginView.style.display = "none";
  appView.style.display = "block";
  loadSettings();
  loadQueue();
  subscribeRealtime();
}

// ---------- Settings (rolling average consult time) ----------

async function loadSettings() {
  const { data, error } = await sb.from("clinic_settings").select("avg_consult_minutes").eq("id", 1).single();
  if (!error && data) avgConsultMinutes = data.avg_consult_minutes;
}

// ---------- Check-in ----------

checkinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("patientName");
  const label = nameInput.value.trim();
  if (!label) return;

  const submitBtn = checkinForm.querySelector("button");
  submitBtn.disabled = true;

  const { data, error } = await sb.rpc("create_ticket", { p_label: label, p_priority: 0 });
  submitBtn.disabled = false;

  if (error || !data) {
    ticketResult.innerHTML = `<p class="error-text">Couldn't create a ticket. Please try again.</p>`;
    return;
  }

  const ticket = Array.isArray(data) ? data[0] : data;
  const patientUrl = `${PATIENT_PAGE_URL}?code=${ticket.ticket_code}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(patientUrl)}`;

  ticketResult.innerHTML = `
    <div class="ticket-result">
      <img src="${qrUrl}" alt="QR code for ticket ${ticket.ticket_code}" width="140" height="140" />
      <div>
        <p class="muted" style="margin-bottom:4px;">Ticket for ${escapeHtml(label)}</p>
        <div class="code">${ticket.ticket_code}</div>
        <p class="muted" style="margin-top:6px;">Hand this to the patient, or have them scan the code.</p>
      </div>
    </div>
  `;

  nameInput.value = "";
  loadQueue();
});

// ---------- Queue ----------

async function loadQueue() {
  await loadSettings(); // always use the current average, never a stale one
  const { data, error } = await sb
    .from("tickets")
    .select("*")
    .in("status", ["waiting", "in_progress"])
    .order("priority", { ascending: false })
    .order("checked_in_at", { ascending: true });

  if (error) {
    queueBody.innerHTML = `<tr><td colspan="6" class="error-text">Couldn't load the queue.</td></tr>`;
    return;
  }

  renderQueue(data || []);
}

function renderQueue(tickets) {
  if (tickets.length === 0) {
    queueBody.innerHTML = `<tr><td colspan="6" style="color:var(--gray);">No patients waiting.</td></tr>`;
    return;
  }

  let waitingPosition = 0;
queueBody.innerHTML = tickets.map((t) => {
    let waitLabel = "—";
    if (t.status === "waiting") {
      const aheadCount = waitingPosition; // patients ahead of this one, not including them
      waitingPosition += 1;
      waitLabel = aheadCount === 0 ? "Next" : `${Math.round(aheadCount * avgConsultMinutes)} min`;
    } else if (t.status === "in_progress") {
      waitLabel = "Being seen";
    }

    const pillClass = t.status === "waiting" ? "status-waiting" : "status-in_progress";
    const pillLabel = t.status === "waiting" ? "Waiting" : "In progress";

    const actionBtn = t.status === "waiting"
      ? `<button class="btn-call" data-action="call" data-id="${t.id}">Call</button>`
      : `<button class="btn-done" data-action="complete" data-id="${t.id}">Complete</button>`;

    return `
      <tr>
        <td>${t.status === "waiting" ? waitingPosition : "—"}</td>
        <td>${t.ticket_code}</td>
        <td>${escapeHtml(t.patient_label)}</td>
        <td><span class="status-pill ${pillClass}">${pillLabel}</span></td>
        <td class="wait-min">${waitLabel}</td>
        <td class="actions">${actionBtn}</td>
      </tr>
    `;
  }).join("");
}

queueBody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  btn.disabled = true;

  if (btn.dataset.action === "call") {
    await sb.from("tickets").update({ status: "in_progress", called_at: new Date().toISOString() }).eq("id", id);
  } else if (btn.dataset.action === "complete") {
    await sb.rpc("complete_ticket", { p_id: id });
    await loadSettings(); // rolling average may have changed
  }

  loadQueue();
});

// ---------- Realtime ----------

function subscribeRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = sb
    .channel("tickets-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => {
      loadQueue();
    })
    .subscribe();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

checkSession();
