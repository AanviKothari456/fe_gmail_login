// File: script.js

const BASE_URL = "https://basic-gmail-login.onrender.com";
const USE_ELEVEN = true;
const USE_ASSEMBLY = true; // toggle AssemblyAI for Hands-Free STT

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

// -- AssemblyAI STT Helper ---------------------------------------------------
async function assemblyTranscribe(durationMs = 6000) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.start();
  await new Promise(r => setTimeout(r, durationMs));
  recorder.stop();
  await new Promise(r => recorder.onstop = r);
  stream.getTracks().forEach(t => t.stop());
  const blob = new Blob(chunks, { type: 'audio/webm' });

  // proxy to backend for secure key handling
  const form = new FormData();
  form.append('audio', blob, 'reply.webm');
  const res = await fetch(`${BASE_URL}/transcribe`, {
    method: 'POST',
    credentials: 'include',
    body: form
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Transcription failed');
  }
  const { text } = await res.json();
  return text;
}

// -- Application State -------------------------------------------------------
let unreadIds = [];
let currentIndex = 0;
let currentMsgId = "";

// 1) LOGIN and INITIAL FETCH OF ALL UNREAD IDS
async function login() {
  window.location.href = `${BASE_URL}/login`;
}

async function loadInitial() {
  try {
    const res = await fetch(`${BASE_URL}/unread_ids`, { credentials: "include" });
    if (!res.ok) return document.getElementById("content").style.display = "none";
    const data = await res.json();
    unreadIds = data.ids || [];
    if (!unreadIds.length) return showAllDoneMessage();
    currentIndex = 0;
    await loadEmailById(unreadIds[currentIndex]);
  } catch (e) {
    console.error(e);
    alert("Could not fetch unread emails.");
  }
}

// 2) LOAD A SINGLE EMAIL BY ID (now uses body_html)
async function loadEmailById(msgId) {
  currentMsgId = msgId;
  const res = await fetch(`${BASE_URL}/latest_email?msg_id=${msgId}`, { credentials: "include" });
  if (res.status === 401) return document.getElementById("content").style.display = "none";
  const data = await res.json();
  document.getElementById("subject").innerText = data.subject || "";
  const toggleEl = document.getElementById("body-toggle");
  const bodyEl = document.getElementById("body-content");
  toggleEl.className = "collapsed";
  toggleEl.innerText = "▶ Body";
  bodyEl.className = "collapsed-content";
  bodyEl.innerHTML = data.body_html || "";
  document.getElementById("summary").innerText = data.summary || "";
  document.getElementById("transcript").innerText = "";
  document.getElementById("transcript").dataset.reply = "";
  document.getElementById("aiReplyEditable").value = "";
  document.getElementById("content").style.display = "block";
  document.getElementById("doneMessage").style.display = "none";
}

window.onload = () => {
  if (new URLSearchParams(window.location.search).get("logged_in") === "true") {
    document.getElementById("loginBtn").style.display = "none";
    loadInitial();
  }
};

// 3) TOGGLE BODY EXPANSION/COLLAPSE
document.addEventListener("click", e => {
  if (e.target.id === "body-toggle") {
    const t = e.target;
    const b = document.getElementById("body-content");
    if (t.classList.contains("collapsed")) {
      t.classList.replace("collapsed", "expanded");
      t.innerText = "▼ Body";
      b.classList.replace("collapsed-content", "expanded-content");
    } else {
      t.classList.replace("expanded", "collapsed");
      t.innerText = "▶ Body";
      b.classList.replace("expanded-content", "collapsed-content");
    }
  }
});

// 4) SPEECH SYNTHESIS FOR SUMMARY
function readSummary() {
  const text = document.getElementById("summary").innerText;
  if (text) speak(text);
}

// 5) VOICE‐TO‐TEXT FOR USER INSTRUCTION (unchanged)
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
  recognition.onerror = err => console.error("Mic error", err.error);
} else {
  console.warn("Voice input unsupported");
}
function startRecording() { document.getElementById("transcript").innerText = ""; recognition && recognition.start(); }
function stopRecording() { recognition && recognition.stop(); }

// 6) GENERATE AI REPLY (manual)
async function sendReply() {
  const userInstruction = document.getElementById("transcript").dataset.reply || "";
  if (!userInstruction) return alert("No reply detected.");
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
  const json = await res.json();
  document.getElementById("aiReplyEditable").value = json.formatted_reply;
}

// 7) READ & CONFIRM
function readAndConfirmReply() {
  const txt = document.getElementById("aiReplyEditable").value;
  if (!txt) return;
  speak(txt + ". Say yes to send or next to skip.")
    .then(listenForConfirmation);
}
function listenForConfirmation() {
  if (!recognition) return alert("No speech support");
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR(); rec.lang = "en-US"; rec.continuous = false;
  rec.onresult = async e => {
    const ans = e.results[0][0].transcript.toLowerCase();
    if (ans.includes("yes")) actuallySendEmail();
    else if (ans.includes("next")) goToNextEmail(false);
    else speak("Please say yes or next.").then(listenForConfirmation);
  };
  rec.start();
}

// 8) SEND OR SKIP
async function actuallySendEmail() {
  const txt = document.getElementById("aiReplyEditable").value;
  const res = await fetch(`${BASE_URL}/send_email`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply_text: txt, msg_id: currentMsgId })
  });
  if (res.ok) {
    alert("Email sent!");
    goToNextEmail(true);
  } else {
    const err = await res.json().catch(() => ({}));
    alert("Send failed: " + (err.error || JSON.stringify(err)));
  }
}
function goToNextEmail() {
  currentIndex++;
  if (currentIndex < unreadIds.length) loadEmailById(unreadIds[currentIndex]);
  else showAllDoneMessage();
}
function showAllDoneMessage() {
  document.getElementById("content").style.display = "none";
  document.getElementById("doneMessage").style.display = "block";
}

// -- HANDS-FREE FSM ---------------------------------------------------------
let fsmRecog = null;
let fsmPhase = "idle";
let lastGptDraft = "";

function handsFreeFlow() {
  if (fsmPhase !== "idle") return;
  fsmPhase = "askReplaySummary";
  speak("Would you like to hear the summary? Say yes or no.")
    .then(() => { fsmRecog = null; ensureFsmRecog(); fsmRecog.start(); });
}

function ensureFsmRecog() {
  if (fsmRecog) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  fsmRecog = new SR();
  fsmRecog.lang = "en-US";
  fsmRecog.continuous = false;
  fsmRecog.interimResults = false;
  fsmRecog.onresult = async e => {
    const ans = e.results[0][0].transcript.trim().toLowerCase();
    switch (fsmPhase) {
      case "askReplaySummary": handleAskReplaySummary(ans); break;
      case "askRecordReply": handleAskRecordReply(ans); break;
      case "confirmReadReply": handleConfirmReadReply(ans); break;
      case "confirmSendFinal": handleConfirmSendFinal(ans); break;
    }
  };
  fsmRecog.onerror = err => { console.error(err.error); fsmPhase = "idle"; };
}

function handleAskReplaySummary(ans) {
  fsmRecog.stop();
  if (ans.includes("yes")) {
    const s = document.getElementById("summary").innerText;
    speak(s)
      .then(() => speak("Ready to record your reply? Say yes or no."))
      .then(() => { fsmPhase = "askRecordReply"; fsmRecog.start(); });
  } else {
    fsmPhase = "idle";
  }
}

async function handleAskRecordReply(ans) {
  fsmRecog.stop();
  if (ans.includes("yes")) {
    speak("Recording now. Please speak your reply.");
    let transcript = "";
    if (USE_ASSEMBLY) {
      try {
        transcript = await assemblyTranscribe(6000);
      } catch (e) {
        console.error(e);
        return speak("Transcription failed, please try again.");
      }
    } else {
      recognition.start();
      await new Promise(r => setTimeout(r, 6000));
      recognition.stop();
      transcript = document.getElementById("transcript").dataset.reply || "";
    }
    if (!transcript) {
      return speak("No speech detected. Try again.").then(() => { fsmPhase = "askRecordReply"; fsmRecog.start(); });
    }
    fsmPhase = "idle";
    // send to AI
    const res = await fetch(`${BASE_URL}/send_reply`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: transcript, msg_id: currentMsgId })
    });
    const data = await res.json();
    document.getElementById("aiReplyEditable").value = data.formatted_reply;
    lastGptDraft = data.formatted_reply;
    speak("Would you like me to read your reply? Say yes or no.")
      .then(() => { fsmPhase = "confirmReadReply"; fsmRecog.start(); });
  } else {
    fsmPhase = "idle";
  }
}

function handleConfirmReadReply(ans) {
  fsmRecog.stop();
  if (ans.includes("yes")) speak(lastGptDraft);
  speak("Say yes to send or next to skip.")
    .then(() => { fsmPhase = "confirmSendFinal"; fsmRecog.start(); });
}

async function handleConfirmSendFinal(ans) {
  fsmRecog.stop();
  if (ans.includes("yes")) await actuallySendEmail();
  else if (ans.includes("next")) goToNextEmail();
  else return speak("Please say yes or next.").then(() => fsmRecog.start());
  fsmPhase = "idle";
}

// End of script.js code
