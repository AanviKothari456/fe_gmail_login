// File: script.js

const BASE_URL = "https://basic-gmail-login.onrender.com";
const USE_ELEVEN = true;      // toggle ElevenLabs TTS
const USE_ASSEMBLY = true;    // toggle AssemblyAI STT in Hands-Free

// ── TTS Helpers ───────────────────────────────────────────────────────────────
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
      console.warn("ElevenLabs failed, falling back:", e);
    }
  }
  await nativeSpeak(text);
}

// ── AssemblyAI STT Helper (via backend) ────────────────────────────────────────
async function assemblyTranscribe(durationMs = 6000) {
  // 1) record from mic
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.start();
  await new Promise(r => setTimeout(r, durationMs));
  recorder.stop();
  await new Promise(r => (recorder.onstop = r));
  stream.getTracks().forEach(t => t.stop());
  const blob = new Blob(chunks, { type: "audio/webm" });

  // 2) send to backend /transcribe
  const form = new FormData();
  form.append("audio", blob, "reply.webm");
  const res = await fetch(`${BASE_URL}/transcribe`, {
    method: "POST",
    credentials: "include",
    body: form
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Transcription failed");
  }
  const { text } = await res.json();
  return text;
}

// ── App State ─────────────────────────────────────────────────────────────────
let unreadIds = [];
let currentIndex = 0;
let currentMsgId = "";
let lastGptDraft = "";

// ── 1) LOGIN & FETCH UNREAD IDS ────────────────────────────────────────────────
async function login() {
  window.location.href = `${BASE_URL}/login`;
}

async function loadInitial() {
  const res = await fetch(`${BASE_URL}/unread_ids`, { credentials: "include" });
  if (!res.ok) {
    document.getElementById("content").style.display = "none";
    return;
  }
  const data = await res.json();
  unreadIds = data.ids || [];
  if (!unreadIds.length) return showAllDoneMessage();
  currentIndex = 0;
  await loadEmailById(unreadIds[0]);
}

// ── 2) LOAD EMAIL BY ID ────────────────────────────────────────────────────────
async function loadEmailById(msgId) {
  currentMsgId = msgId;
  const res = await fetch(`${BASE_URL}/latest_email?msg_id=${msgId}`, { credentials: "include" });
  if (res.status === 401) {
    document.getElementById("content").style.display = "none";
    return;
  }
  const data = await res.json();
  document.getElementById("subject").innerText = data.subject || "";
  document.getElementById("body-toggle").className = "collapsed";
  document.getElementById("body-toggle").innerText = "▶ Body";
  document.getElementById("body-content").className = "collapsed-content";
  document.getElementById("body-content").innerHTML = data.body_html || "";
  document.getElementById("summary").innerText = data.summary || "";
  document.getElementById("aiReplyEditable").value = "";
  document.getElementById("transcript").innerText = "";
  document.getElementById("content").style.display = "block";
  document.getElementById("doneMessage").style.display = "none";
}

window.onload = () => {
  if (new URLSearchParams(window.location.search).get("logged_in") === "true") {
    document.getElementById("loginBtn").style.display = "none";
    loadInitial();
  }
};

// ── 3) TOGGLE BODY ─────────────────────────────────────────────────────────────
document.addEventListener("click", e => {
  if (e.target.id === "body-toggle") {
    const t = e.target, b = document.getElementById("body-content");
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

// ── 4) MANUAL SUMMARY READER ────────────────────────────────────────────────────
async function readSummary() {
  const text = document.getElementById("summary").innerText;
  if (text) await speak(text);
}

// ── 5) MANUAL VOICE-TO-TEXT (unchanged) ────────────────────────────────────────
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
function startRecording() { recognition && recognition.start(); }
function stopRecording() { recognition && recognition.stop(); }

// ── 6) MANUAL AI REPLY ─────────────────────────────────────────────────────────
async function sendReply() {
  const reply = document.getElementById("transcript").dataset.reply || "";
  if (!reply) return alert("No reply detected.");
  const res = await fetch(`${BASE_URL}/send_reply`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply, msg_id: currentMsgId })
  });
  if (!res.ok) return alert("Error generating reply.");
  const { formatted_reply } = await res.json();
  document.getElementById("aiReplyEditable").value = formatted_reply;
}

// ── 7) MANUAL READ & CONFIRM ───────────────────────────────────────────────────
async function readAndConfirmReply() {
  const txt = document.getElementById("aiReplyEditable").value;
  if (!txt) return;
  await speak(txt + ". Say yes to send or next to skip.");
  listenForConfirmation();
}

function listenForConfirmation() {
  if (!recognition) return alert("No speech support");
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = "en-US";
  rec.continuous = false;
  rec.onresult = async e => {
    const ans = e.results[0][0].transcript.toLowerCase();
    if (ans.includes("yes")) await actuallySendEmail();
    else if (ans.includes("next")) goToNextEmail();
    else await speak("Please say yes or next.").then(listenForConfirmation);
  };
  rec.start();
}

// ── 8) SEND OR SKIP ─────────────────────────────────────────────────────────────
async function actuallySendEmail() {
  const txt = document.getElementById("aiReplyEditable").value;
  const res = await fetch(`${BASE_URL}/send_email`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply_text: txt, msg_id: currentMsgId })
  });
  if (res.ok) {
    alert("Email sent!");
    goToNextEmail();
  } else {
    alert("Send failed.");
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

// ── HANDS-FREE FSM ────────────────────────────────────────────────────────────
// ── HANDS‐FREE FSM (replace your existing block) ───────────────────────────────
let fsmRecog = null;
let fsmPhase = "idle";

async function handsFreeFlow() {
  if (fsmPhase !== "idle") return;
  fsmPhase = "askReplaySummary";
  await speak(
    "Would you like to hear the summary? " +
    "Say yes to listen, or skip to move to the next email."
  );
  initFsmRecog();
  fsmRecog.start();
}

function initFsmRecog() {
  if (fsmRecog) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  fsmRecog = new SR();
  fsmRecog.lang = "en-US";
  fsmRecog.continuous = false;
  fsmRecog.interimResults = false;
  fsmRecog.onresult = async e => {
    const ans = e.results[0][0].transcript.trim().toLowerCase();
    if (fsmPhase === "askReplaySummary")   return handleAskReplaySummary(ans);
    if (fsmPhase === "askRecordReply")     return handleAskRecordReply(ans);
    if (fsmPhase === "askReadReply")       return handleAskReadReply(ans);
    if (fsmPhase === "askEditOrSend")      return handleAskEditOrSend(ans);
    if (fsmPhase === "askRecordEdit")      return handleAskRecordEdit(ans);
    if (fsmPhase === "confirmSendFinal")   return handleConfirmSendFinal(ans);
  };
  fsmRecog.onerror = err => { console.error(err.error); fsmPhase = "idle"; };
}

// 1) After summary prompt
async function handleAskReplaySummary(ans) {
  fsmRecog.stop();
  if (ans.includes("yes")) {
    await speak(document.getElementById("summary").innerText);
    await speak("Ready to record your reply? Say yes to start, or skip to move on.");
    fsmPhase = "askRecordReply";
    fsmRecog.start();

  } else if (ans.includes("skip")) {
    await speak("Skipping to the next email.");
    goToNextEmail();
    fsmPhase = "idle";

  } else {
    await speak("Please say yes or skip.");
    fsmRecog.start();
  }
}

// 2) Record the raw reply, send to GPT for a draft
async function handleAskRecordReply(ans) {
  fsmRecog.stop();
  if (!ans.includes("yes")) {
    // skip if not yes
    await speak("Okay, moving on.");
    goToNextEmail();
    return fsmPhase = "idle";
  }

  await speak("Recording now. Please speak your reply.");
  let transcript = "";
  if (USE_ASSEMBLY) {
    try {
      transcript = await assemblyTranscribe(6000);
    } catch {
      return speak("Transcription failed. Try again.");
    }
  } else {
    recognition.start();
    await new Promise(r => setTimeout(r, 6000));
    recognition.stop();
    transcript = document.getElementById("transcript").dataset.reply || "";
  }
  if (!transcript) return speak("No speech detected. Try again.");

  // send to GPT for draft
  const res = await fetch(`${BASE_URL}/send_reply`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply: transcript, msg_id: currentMsgId })
  });
  const { formatted_reply } = await res.json();
  lastGptDraft = formatted_reply;
  document.getElementById("aiReplyEditable").value = formatted_reply;

  // next: read / send / skip
  await speak(
    "Draft ready. " +
    "Say read to hear it, send to send it as-is, or skip to move on."
  );
  fsmPhase = "askReadReply";
  fsmRecog.start();
}

// 3) Read / send / skip the GPT draft
async function handleAskReadReply(ans) {
  fsmRecog.stop();
  if (ans.includes("read")) {
    await speak(lastGptDraft);
    // after reading, ask edit/send/skip
    await speak(
      "Would you like to edit this reply, send it, or skip to the next email?"
    );
    fsmPhase = "askEditOrSend";
    fsmRecog.start();

  } else if (ans.includes("send")) {
    await actuallySendEmail();
    fsmPhase = "idle";

  } else if (ans.includes("skip")) {
    goToNextEmail();
    fsmPhase = "idle";

  } else {
    await speak("Please say read, send, or skip.");
    fsmRecog.start();
  }
}

// 4) If user wants to edit or send (pre‐edit)
async function handleAskEditOrSend(ans) {
  fsmRecog.stop();
  if (ans.includes("send")) {
    await actuallySendEmail();
    fsmPhase = "idle";

  } else if (ans.includes("skip")) {
    goToNextEmail();
    fsmPhase = "idle";

  } else if (ans.includes("edit")) {
    // record edit instructions
    await speak("Alright, please speak your edit instructions now.");
    fsmPhase = "askRecordEdit";
    fsmRecog.start();

  } else {
    await speak("Say edit, send, or skip.");
    fsmRecog.start();
  }
}

// ── 5) Capture edit instructions and call backend to revise ────────────────
async function handleAskRecordEdit(ans) {
  fsmRecog.stop();
  const editInstructions = ans.trim();
  // call your edit endpoint
  const res = await fetch(`${BASE_URL}/edit_reply`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msg_id: currentMsgId,
      original_draft: lastGptDraft,
      edit_instructions: editInstructions
    })
  });
  const { revised_reply } = await res.json();
  lastGptDraft = revised_reply;
  document.getElementById("aiReplyEditable").value = revised_reply;

  // **NEW** prompt: read / send / skip
  await speak(
    "Revised draft ready. " +
    "Say read to hear it, send to send it, or skip to move to the next email."
  );
  fsmPhase = "confirmSendFinal";
  fsmRecog.start();
}

// ── 6) Final send / skip / read after edit ─────────────────────────────────
async function handleConfirmSendFinal(ans) {
  fsmRecog.stop();
  const normalized = ans.trim().toLowerCase();

  if (normalized.includes("read")) {
    // read it back
    await speak(lastGptDraft);
    await speak("Say send to send it, or skip to move on.");
    fsmPhase = "confirmSendFinal";
    fsmRecog.start();

  } else if (normalized.includes("send")) {
    // send email
    await actuallySendEmail();
    fsmPhase = "idle";

  } else if (normalized.includes("skip") || normalized.includes("next")) {
    // skip to next
    await speak("Moving to the next email.");
    goToNextEmail();
    fsmPhase = "idle";

  } else {
    // unrecognized → re-prompt
    await speak("Please say read, send, or skip.");
    fsmRecog.start();
  }
}

