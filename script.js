// File: script.js

const BASE_URL = "https://basic-gmail-login.onrender.com";

// 1) LOGIN / LOAD EMAIL
async function login() {
  window.location.href = `${BASE_URL}/login`;
}

async function loadEmail() {
  try {
    const res = await fetch(`${BASE_URL}/latest_email`, { credentials: "include" });
    if (res.status === 401) {
      document.getElementById("content").style.display = "none";
      return;
    }
    document.getElementById("loginBtn").style.display = "none";

    const data = await res.json();
    document.getElementById("subject").innerText = data.subject || "(No subject)";
    document.getElementById("body").innerText = data.body || "(No body)";

    // Populate the two‐line summary field
    document.getElementById("summary").innerText = data.summary || "(No summary)";

    document.getElementById("content").style.display = "block";

    // Automatically read the summary aloud
    readSummary(data.summary || "");
  } catch (err) {
    console.error("Error loading email:", err);
    alert("Something went wrong while fetching your email.");
  }
}

window.onload = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isLoggedIn = urlParams.get("logged_in") === "true";
  if (isLoggedIn) {
    document.getElementById("loginBtn").style.display = "none";
    loadEmail();
  }
};

// 2) SPEECH SYNTHESIS FOR SUMMARY
function readSummary(text) {
  const content = text || document.getElementById("summary").innerText;
  if (!content) return;
  const utter = new SpeechSynthesisUtterance(content);
  utter.lang = "en-US";
  speechSynthesis.speak(utter);
}

// 3) VOICE‐TO‐TEXT for USER INSTRUCTION
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
  document.getElementById("transcript").innerText = "";
  document.getElementById("transcript").dataset.reply = "";
  if (recognition) recognition.start();
}

function stopRecording() {
  if (recognition) recognition.stop();
}

// 4) GENERATE AI REPLY (populates the textarea)
async function sendReply() {
  const userInstruction = document.getElementById("transcript").dataset.reply;
  if (!userInstruction) {
    return alert("Please speak a reply instruction first.");
  }

  // Call /send_reply to get back AI-formatted text
  const res = await fetch(`${BASE_URL}/send_reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ reply: userInstruction })
  });

  if (!res.ok) {
    const err = await res.json();
    return alert("Error: " + (err.error || JSON.stringify(err)));
  }

  const json = await res.json();
  // Put the AI reply inside the editable textarea
  document.getElementById("aiReplyEditable").value = json.formatted_reply;
}

// 5) READ OUT-and-ASK “SEND?” then listen for yes/no
function readAndConfirmReply() {
  const textToRead = document.getElementById("aiReplyEditable").value.trim();
  if (!textToRead) {
    return alert("No reply text to read.");
  }

  // Read the text, then prompt for confirmation
  const utterance = new SpeechSynthesisUtterance(
    textToRead + ". . . Do you want to send this email? Say yes or no."
  );
  utterance.lang = "en-US";
  speechSynthesis.speak(utterance);

  utterance.onend = () => {
    listenForConfirmation();
  };
}

function listenForConfirmation() {
  if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
    return alert("Your browser does not support speech recognition.");
  }

  const ConfirmRecog = window.SpeechRecognition
    ? new SpeechRecognition()
    : new webkitSpeechRecognition();
  ConfirmRecog.lang = "en-US";
  ConfirmRecog.continuous = false;

  ConfirmRecog.onresult = (event) => {
    const answer = event.results[0][0].transcript.toLowerCase().trim();
    if (answer.includes("yes")) {
      actuallySendEmail();
    } else {
      console.log("User said no, not sending.");
      alert("Email not sent.");
    }
  };

  ConfirmRecog.onerror = (event) => {
    console.error("Confirmation recognition error:", event.error);
    alert("Could not understand confirmation. Please click 'Read Reply Aloud & Ask to Send' and say yes or no.");
  };

  ConfirmRecog.start();
}

// 6) CALL BACKEND TO ACTUALLY SEND VIA GMAIL
async function actuallySendEmail() {
  const finalText = document.getElementById("aiReplyEditable").value.trim();
  if (!finalText) {
    return alert("Reply text is empty—nothing to send.");
  }

  const res = await fetch(`${BASE_URL}/send_email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ reply_text: finalText })
  });

  if (!res.ok) {
    const err = await res.json();
    return alert("Failed to send email: " + (err.error || JSON.stringify(err)));
  }

  const json = await res.json();
  if (json.status === "sent") {
    alert("Email sent successfully!");
  } else {
    alert("Unexpected response: " + JSON.stringify(json));
  }
}
