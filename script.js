const BASE_URL = "https://basic-gmail-login.onrender.com";

async function login() {
  window.location.href = `${BASE_URL}/login`;
}

async function loadEmail() {
  try {
    const res = await fetch(`${BASE_URL}/latest_email`);
    const data = await res.json();
    document.getElementById("subject").innerText = data.subject;
    document.getElementById("body").innerText = data.body;
    document.getElementById("emailAudio").src = data.audio_url;
    document.getElementById("content").style.display = "block";
  } catch (err) {
    alert("Failed to fetch email. Are you logged in?");
    console.error(err);
  }
}

// Voice recognition
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
  alert("Your browser does not support voice input");
}

function startRecording() {
  if (recognition) recognition.start();
}

async function sendReply() {
  const reply = document.getElementById("transcript").dataset.reply;
  if (!reply) return alert("Please speak a reply first.");
  const res = await fetch(`${BASE_URL}/send_reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ reply })
  });
  const text = await res.text();
  alert("Reply sent!");
}
