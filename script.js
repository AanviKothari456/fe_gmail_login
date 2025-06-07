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
    document.getElementById("transcript").dataset.reply = t;
  };
  recognition.onerror = e => alert("Mic error: " + e.error);
} else {
  alert("Your browser does not support voice input (try Chrome).");
}
function startRecording() {
  document.getElementById("transcript").innerText = "";
  document.getElementById("transcript").dataset.reply = "";
  recognition && recognition.start();
}
function stopRecording() {
  recognition && recognition.stop();
}

// -- FSM & AI Interactions --------------------------------------------------
let fsmRecog = null;
let fsmPhase = "idle";
let fsmReplyBuffer = "";
let lastGptDraft = "";

async function postToSendReplyFixed(replyText) {
  if (!replyText) {
    alert("No reply detected.");
    fsmPhase = "idle";
    return;
  }
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

    // Ask user if they want to hear it
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

// Generate AI reply manually
async function sendReply() {
  const userInstruction = document.getElementById("transcript").dataset.reply || "";
  const res = await fetch(`${BASE_URL}/send_reply`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply: userInstruction, msg_id: currentMsgId })
  });
  if (!res.ok) {
    const err = await res.json();
    return alert("Error: " + (err.error || JSON.stringify(err)));
  }
  const { formatted_reply } = await res.json();
  document.getElementById("aiReplyEditable").value = formatted_reply;
}

async function readAndConfirmReply() {
  const toRead = document.getElementById("aiReplyEditable").value || "";
  if (!toRead) return;
  await speak(toRead + ". . . Say 'yes' to send, or 'next' to skip.");
  listenForConfirmation();
}

function listenForConfirmation() {
  if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
    return alert("Your browser does not support speech recognition.");
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const confirmRecog = new SR();
  confirmRecog.lang = "en-US";
  confirmRecog.continuous = false;
  confirmRecog.onresult = async e => {
    const ans = e.results[0][0].transcript.toLowerCase().trim();
    if (ans.includes("yes")) await actuallySendEmail();
    else if (ans.includes("next")) goToNextEmail(false);
    else await speak("Please say 'yes' to send or 'next' to skip.").then(listenForConfirmation);
  };
  confirmRecog.onerror = e => {
    console.error("Confirmation error", e.error);
    alert("Could not understand. Please try again.");
  };
  confirmRecog.start();
}

async function actuallySendEmail() {
  const finalText = document.getElementById("aiReplyEditable").value || "";
  const res = await fetch(`${BASE_URL}/send_email`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply_text: finalText, msg_id: currentMsgId })
  });
  if (!res.ok) {
    const err = await res.json();
    return alert("Failed to send email: " + (err.error || JSON.stringify(err)));
  }
  const json = await res.json();
  if (json.status === "sent") {
    alert("Email sent successfully!");
    goToNextEmail(true);
  } else {
    alert("Unexpected response: " + JSON.stringify(json));
  }
}

function goToNextEmail() {
  currentIndex++;
  if (currentIndex < unreadIds.length) loadEmailById(unreadIds[currentIndex]);
  else showAllDoneMessage();
}

function showAllDoneMessage() {
  document.getElementById("content").style.display = "none";
  document.getElementById("doneMessage").innerText = "All emails read!";
  document.getElementById("doneMessage").style.display = "block";
}

// -- Hands-Free FSM Entry and Helpers ---------------------------------------
function handsFreeFlow() {
  if (fsmPhase !== "idle") return;
  fsmPhase = "askReplaySummary";
  ensureFsmRecog();
  speak("Would you like to listen to the summary? Say yes or no.")
    .then(() => fsmRecog.start());
}

function ensureFsmRecog() {
  if (fsmRecog) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert("Speech recognition not supported.");
    fsmPhase = "idle";
    return;
  }
  fsmRecog = new SR();
  fsmRecog.lang = "en-US";
  fsmRecog.interimResults = false;
  fsmRecog.continuous = false;
  fsmRecog.onresult = event => {
    const t = event.results[0][0].transcript.trim().toLowerCase();
    switch (fsmPhase) {
      case "askReplaySummary": handleAskReplaySummary(t); break;
      case "askRecordReply": handleAskRecordReply(t); break;
      case "recordReplyFixed": handleRecordReplyFixed(event); break;
      case "confirmReadReply": handleConfirmReadReply(t); break;
      case "confirmSendFinal": handleConfirmSendFinal(t); break;
      case "collectEditInstructions": /* handled in timeout callback */ break;
    }
  };
  fsmRecog.onerror = e => {
    if (e.error !== "aborted") {
      console.error("FSM error", e.error);
      fsmPhase = "idle";
    }
  };
}

function handleAskReplaySummary(ans) {
  fsmRecog.stop();
  if (ans.includes("yes")) {
    const txt = document.getElementById("summary").innerText || "";
    if (!txt) return fsmPhase = "idle";
    speak(txt)
      .then(() => speak("Would you like to record an informal reply? Say yes or no. I will timeout after six seconds."))
      .then(() => { fsmPhase = "askRecordReply"; fsmRecog.start(); });
  } else if (ans.includes("no")) {
    fsmPhase = "idle";
  } else {
    speak("Please say yes to hear the summary, or no to cancel.")
      .then(() => fsmRecog.start());
  }
}

function handleAskRecordReply(ans) {
  fsmRecog.stop();
  if (ans.includes("yes")) {
    speak("Recording started. You have six seconds.")
      .then(() => {
        fsmPhase = "recordReplyFixed";
        fsmReplyBuffer = "";
        fsmRecog.continuous = true;
        fsmRecog.start();
        setTimeout(() => {
          fsmRecog.stop();
          speak("Ending recording.")
            .then(() => postToSendReplyFixed(fsmReplyBuffer.trim()));
        }, 6000);
      });
  } else if (ans.includes("no")) {
    fsmPhase = "idle";
  } else {
    speak("Please say yes to record your reply, or no to skip.")
      .then(() => fsmRecog.start());
  }
}

function handleConfirmReadReply(ans) {
  fsmRecog.stop();
  const toRead = document.getElementById("aiReplyEditable").value || "";
  let prompt = "Say yes to send, next to skip, or edit to revise.";
  if (ans.includes("yes") && toRead) {
    speak(toRead)
      .then(() => speak(prompt))
      .then(() => { fsmPhase = "confirmSendFinal"; fsmRecog.start(); });
  } else {
    speak(prompt)
      .then(() => { fsmPhase = "confirmSendFinal"; fsmRecog.start(); });
  }
}

function handleConfirmSendFinal(ans) {
  fsmRecog.stop();
  if (ans.includes("yes")) actuallySendEmail();
  else if (ans.includes("next")) goToNextEmail(false);
  else if (ans.includes("edit")) {
    fsmPhase = "collectEditInstructions";
    speak("Beginning recording for six seconds to collect your edits.")
      .then(() => {
        fsmReplyBuffer = "";
        fsmRecog.continuous = true;
        fsmRecog.start();
        setTimeout(() => {
          fsmRecog.stop();
          speak("Ending edit recording.")
            .then(() => postToSendReplyFixed(
              `This was the email:\n${lastOriginalBody}\n\n` +
              `This is what you just generated as a reply:\n${lastGptDraft}\n\n` +
              `I want this edit to your last draft follow CAREFULLY:\n${fsmReplyBuffer.trim()}`
            ));
        }, 6000);
      });
  } else {
    speak("Please say yes to send, next to skip, or edit to revise.")
      .then(() => fsmRecog.start());
  }
  fsmPhase = "idle";
}
