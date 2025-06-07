// File: script.js

const BASE_URL = "https://basic-gmail-login.onrender.com";
const USE_ELEVEN = true;

// -- TTS Helpers --------------------------------------------------------------
async function elevenSpeak(text) {
  const res = await fetch(`${BASE_URL}/tts`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!res.ok) throw new Error("ElevenLabs TTS error");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.onended = resolve;
    audio.onerror = reject;
    audio.play();
  });
}

function nativeSpeak(text) {
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.onend = resolve;
    speechSynthesis.speak(u);
  });
}

async function speak(text) {
  if (USE_ELEVEN) {
    try {
      await elevenSpeak(text);
      return;
    } catch (e) {
      console.warn("ElevenLabs TTS failed, falling back to native TTS", e);
    }
  }
  await nativeSpeak(text);
}

// -- Application State -------------------------------------------------------
let unreadIds = [];
let currentIndex = 0;
let currentMsgId = "";
let lastOriginalBody = "";

// -- Login & Initial Fetch --------------------------------------------------
async function login() {
  window.location.href = `${BASE_URL}/login`;
}

async function loadInitial() {
  try {
    const res = await fetch(`${BASE_URL}/unread_ids`, { credentials: "include" });
    if (!res.ok) {
      document.getElementById("content").style.display = "none";
      return;
    }
    const data = await res.json();
    unreadIds = data.ids || [];
    if (!unreadIds.length) return showAllDoneMessage();
    currentIndex = 0;
    await loadEmailById(unreadIds[currentIndex]);
  } catch (err) {
    console.error("Error fetching unread IDs:", err);
    alert("Could not fetch unread emails.");
  }
}

async function loadEmailById(msgId) {
  try {
    currentMsgId = msgId;
    const res = await fetch(`${BASE_URL}/latest_email?msg_id=${msgId}`, { credentials: "include" });
    if (res.status === 401) {
      document.getElementById("content").style.display = "none";
      return;
    }
    const data = await res.json();
    document.getElementById("subject").innerText = data.subject || "";
    const toggleEl = document.getElementById("body-toggle");
    const bodyEl = document.getElementById("body-content");
    toggleEl.className = "collapsed";
    toggleEl.innerText = "▶ Body";
    bodyEl.className = "collapsed-content";
    bodyEl.innerHTML = data.body_html || "";
    document.getElementById("summary").innerText = data.summary || "";
    document.getElementById("content").style.display = "block";
    document.getElementById("doneMessage").style.display = "none";
    lastOriginalBody = data.body_text || stripHtml(data.body_html || "");
    document.getElementById("transcript").innerText = "";
    document.getElementById("transcript").dataset.reply = "";
    document.getElementById("aiReplyEditable").value = "";
  } catch (err) {
    console.error("Error loading email by ID:", err);
    alert("Something went wrong while fetching the email.");
  }
}

function stripHtml(html) {
  const tmp = document.createElement("DIV");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

window.onload = () => {
  const isLoggedIn = new URLSearchParams(window.location.search).get("logged_in") === "true";
  if (isLoggedIn) {
    document.getElementById("loginBtn").style.display = "none";
    loadInitial();
  }
};

document.addEventListener("click", e => {
  if (e.target.id === "body-toggle") {
    const toggleEl = e.target;
    const bodyEl = document.getElementById("body-content");
    if (toggleEl.classList.contains("collapsed")) {
      toggleEl.classList.replace("collapsed", "expanded");
      toggleEl.innerText = "▼ Body";
      bodyEl.classList.replace("collapsed-content", "expanded-content");
    } else {
      toggleEl.classList.replace("expanded", "collapsed");
      toggleEl.innerText = "▶ Body";
      bodyEl.classList.replace("expanded-content", "collapsed-content");
    }
  }
});

// -- Read Summary ------------------------------------------------------------
async function readSummary() {
  const text = document.getElementById("summary").innerText || "";
  if (!text) return;
  await speak(text);
}

// -- Voice-to-Text Setup -----------------------------------------------------
let recognition;
if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.onresult = e => {
    const t = e.results[0][0].transcript;
    document.getElementById("transcript").innerText = "You said: " + t;
    fsmReplyBuffer += t + " ";
  };
  recognition.onerror = e => console.error("Mic error: " + e.error);
} else {
  console.warn("SpeechRecognition not supported");
}
function startRecording() {
  document.getElementById("transcript").innerText = "";
  fsmReplyBuffer = "";
  recognition && recognition.start();
}
function stopRecording() {
  recognition && recognition.stop();
}

// -- FSM & AI Interactions --------------------------------------------------
let fsmRecog = null;
let fsmPhase = "idle";
let lastGptDraft = "";

async function postToSendReplyFixed(replyText) {
  // proceed directly to sending
  try {
    const res = await fetch(`${BASE_URL}/send_reply`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: replyText, msg_id: currentMsgId })
    });
    if (!res.ok) {
      const err = await res.json();
      alert("Error generating AI reply: " + (err.error || JSON.stringify(err)));
      fsmPhase = "idle";
      return;
    }
    const { formatted_reply } = await res.json();
    document.getElementById("aiReplyEditable").value = formatted_reply;
    lastGptDraft = formatted_reply;

    await speak("Would you like me to read your reply? Say yes or no.");
    fsmPhase = "confirmReadReply";
    ensureFsmRecog();
    fsmRecog.start();
  } catch (e) {
    console.error(e);
    alert("Failed to generate AI reply.");
    fsmPhase = "idle";
  }
}

// -- Handle AskRecordReply --------------------------------------------------
function handleAskRecordReply(answer) {
  fsmRecog.stop();
  if (answer.includes("yes")) {
    speak("Recording started. You have six seconds.")
      .then(() => {
        fsmPhase = "recordReplyFixed";
        fsmReplyBuffer = "";
        recognition.continuous = true;
        recognition.start();
        setTimeout(() => {
          recognition.stop();
          speak("Ending recording.")
            .then(async () => {
              const trimmed = fsmReplyBuffer.trim();
              if (!trimmed) {
                await speak("I didn't catch that. Would you like to try recording again? Say yes or no.");
                fsmPhase = "askRecordReply";
                ensureFsmRecog();
                fsmRecog.start();
              } else {
                postToSendReplyFixed(trimmed);
              }
            });
        }, 6000);
      });
  } else if (answer.includes("no")) {
    fsmPhase = "idle";
  } else {
    speak("Please say yes to record your reply, or no to skip.")
      .then(() => fsmRecog.start());
  }
}

// The rest of FSM handlers (confirmReadReply, confirmSendFinal, etc.) unchanged...

// -- Hands-Free Entry --------------------------------------------------------
function handsFreeFlow() {
  if (fsmPhase !== "idle") return;
  fsmPhase = "askReplaySummary";
  ensureFsmRecog();
  speak("Would you like to listen to the summary? Say yes or no.")
    .then(() => fsmRecog.start());
}

// -- FSM Recognizer Setup ----------------------------------------------------
function ensureFsmRecog() {
  if (fsmRecog) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    console.warn("SpeechRecognition not supported");
    fsmPhase = "idle";
    return;
  }
  fsmRecog = new SR();
  fsmRecog.lang = "en-US";
  fsmRecog.continuous = false;
  fsmRecog.interimResults = false;
  fsmRecog.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim().toLowerCase();
    switch (fsmPhase) {
      case "askRecordReply":
        handleAskRecordReply(transcript);
        break;
      // add other cases if needed
      default:
        break;
    }
  };
  fsmRecog.onerror = (e) => {
    console.error("FSM error", e);
    fsmPhase = "idle";
  };
}
