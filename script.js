const BASE_URL = "https://basic-gmail-login.onrender.com";

async function login() {
  // Clicking “Login with Gmail” → backend /login
  window.location.href = `${BASE_URL}/login`;
}

async function loadEmail() {
  try {
    const res = await fetch(`${BASE_URL}/latest_email`, { credentials: "include" });

    if (res.status === 401) {
      // Not logged in → hide email UI, keep the login button visible
      document.getElementById("content").style.display = "none";
      return;
    }

    // We got a valid email back → hide the login button
    document.getElementById("loginBtn").style.display = "none";

    const data = await res.json();
    document.getElementById("subject").innerText = data.subject || "(No subject)";
    document.getElementById("body").innerText = data.body || "(No body)";
    document.getElementById("emailAudio").src = `data:audio/mpeg;base64,${data.audio_base64}`;
    document.getElementById("content").style.display = "block";
  } catch (err) {
    console.error("Error loading email:", err);
    alert("Something went wrong while fetching your email.");
  }
}

// Speech-to-text setup
let recognition;
if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = false;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    document.getElementById("transcript").innerText = "You said: " + transcript;
    document.getElementById("transcript").dataset.reply = transcript;
  };

  recognition.onerror = (event) => {
    alert("Mic error: " + event.error);
  };
} else {
  alert("Your browser does not support voice input (try Chrome).");
}

function startRecording() {
  if (!recognition) return;
  document.getElementById("transcript").innerText = "";      
  document.getElementById("transcript").dataset.reply = "";
  recognition.start();
}

function stopRecording() {
  if (recognition) recognition.stop();
}

async function sendReply() {
  const reply = document.getElementById("transcript").dataset.reply;
  if (!reply) return alert("Please speak a reply first.");
  const res = await fetch(`${BASE_URL}/send_reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ reply })
  });
  const json = await res.json();
  alert(json.status || "Reply sent!");
}

window.onload = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isLoggedIn = urlParams.get("logged_in") === "true";

  if (isLoggedIn) {
    // Hide login button and immediately fetch email
    document.getElementById("loginBtn").style.display = "none";
    loadEmail();
  }
};
