// File: script.js

const BASE_URL = "https://basic-gmail-login.onrender.com";

let unreadIds = [];       // will hold all unread message IDs
let currentIndex = 0;     // pointer to the “current” email in unreadIds
let currentMsgId = "";    // track which msg_id is currently shown

// 1) LOGIN and INITIAL FETCH OF ALL UNREAD IDS
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

    if (unreadIds.length === 0) {
      showAllDoneMessage();
      return;
    }

    currentIndex = 0;
    await loadEmailById(unreadIds[currentIndex]);
  } catch (err) {
    console.error("Error fetching unread IDs:", err);
    alert("Could not fetch unread emails.");
  }
}

// 2) LOAD A SINGLE EMAIL BY ID (now uses body_html)
let lastOriginalBody = ""; // store actual plain-text body for editing prompts

async function loadEmailById(msgId) {
  try {
    currentMsgId = msgId;

    const res = await fetch(`${BASE_URL}/latest_email?msg_id=${msgId}`, {
      credentials: "include"
    });
    if (res.status === 401) {
      document.getElementById("content").style.display = "none";
      return;
    }
    const data = await res.json();

    document.getElementById("subject").innerText = data.subject || "";

    // Toggling: reset to “collapsed” on each new email
    const toggleEl = document.getElementById("body-toggle");
    const bodyEl = document.getElementById("body-content");
    toggleEl.className = "collapsed";
    toggleEl.innerText = "▶ Body";
    bodyEl.className = "collapsed-content";
    bodyEl.innerHTML = data.body_html || "";
    document.getElementById("summary").innerText = data.summary || "";
    document.getElementById("content").style.display = "block";
    document.getElementById("doneMessage").style.display = "none";

    // Also store the plain-text portion for editing prompts
    lastOriginalBody = data.body_text || stripHtml(data.body_html || "");

    document.getElementById("transcript").innerText = "";
    document.getElementById("transcript").dataset.reply = "";
    document.getElementById("aiReplyEditable").value = "";
  } catch (err) {
    console.error("Error loading email by ID:", err);
    alert("Something went wrong while fetching the email.");
  }
}

// Utility to strip HTML tags if needed
function stripHtml(html) {
  const tmp = document.createElement("DIV");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

window.onload = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isLoggedIn = urlParams.get("logged_in") === "true";
  if (isLoggedIn) {
    document.getElementById("loginBtn").style.display = "none";
    loadInitial();
  }
};

// 3) TOGGLE BODY EXPANSION/COLLAPSE
document.addEventListener("click", (e) => {
  if (e.target.id === "body-toggle") {
    const toggleEl = e.target;
    const bodyEl = document.getElementById("body-content");

    if (toggleEl.classList.contains("collapsed")) {
      toggleEl.classList.remove("collapsed");
      toggleEl.classList.add("expanded");
      toggleEl.innerText = "▼ Body";
      bodyEl.classList.remove("collapsed-content");
      bodyEl.classList.add("expanded-content");
    } else {
      toggleEl.classList.remove("expanded");
      toggleEl.classList.add("collapsed");
      toggleEl.innerText = "▶ Body";
      bodyEl.classList.remove("expanded-content");
      bodyEl.classList.add("collapsed-content");
    }
  }
});

// 4) SPEECH SYNTHESIS FOR SUMMARY
function readSummary() {
  const text = document.getElementById("summary").innerText || "";
  if (!text) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  speechSynthesis.speak(utter);
}

// 5) VOICE‐TO‐TEXT FOR USER INSTRUCTION (unchanged)
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

// 6) Accumulate final transcripts during fixed recording
function handleRecordReplyFixed(event) {
  const transcript = event.results[event.resultIndex][0].transcript.trim();
  if (transcript) {
    fsmReplyBuffer += transcript + " ";
  }
}

// 7) Send user’s spoken reply (or instructions) to AI, then ask to read
async function postToSendReplyFixed(replyText) {
  if (!replyText) {
    alert("No reply detected.");
    fsmPhase = "idle";
    return;
  }
  try {
    const res = await fetch(`${BASE_URL}/send_reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        // For edits, replyText can be a composite instruction string
        reply: replyText,
        msg_id: currentMsgId
      })
    });
    if (!res.ok) {
      const err = await res.json();
      alert("Error generating AI reply: " + (err.error || JSON.stringify(err)));
      fsmPhase = "idle";
      return;
    }
    const data = await res.json();
    const newDraft = data.formatted_reply;
    document.getElementById("aiReplyEditable").value = newDraft;

    // Ask if user wants to hear the AI-generated reply
    const askReadUtter = new SpeechSynthesisUtterance(
      "Would you like me to read your reply? Say yes or no."
    );
    askReadUtter.lang = "en-US";
    speechSynthesis.speak(askReadUtter);
    askReadUtter.onend = () => {
      fsmPhase = "confirmReadReply";
      fsmRecog.interimResults = false;
      fsmRecog.continuous = false;
      fsmRecog.start();
    };
  } catch (e) {
    console.error(e);
    alert("Failed to generate AI reply.");
    fsmPhase = "idle";
  }
}

// 8) GENERATE AI REPLY (include currentMsgId) – for manual reply button
async function sendReply() {
  const userInstruction = document.getElementById("transcript").dataset.reply || "";
  const res = await fetch(`${BASE_URL}/send_reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      reply: userInstruction,
      msg_id: currentMsgId
    })
  });

  if (!res.ok) {
    const err = await res.json();
    return alert("Error: " + (err.error || JSON.stringify(err)));
  }

  const json = await res.json();
  document.getElementById("aiReplyEditable").value = json.formatted_reply;
}

// 9) READ OUT and ASK FOR “YES” vs “NEXT” – for manual read/send
function readAndConfirmReply() {
  const textToRead = document.getElementById("aiReplyEditable").value || "";
  const utterance = new SpeechSynthesisUtterance(
    textToRead + ". . . Say 'yes' to send, or 'next' to skip."
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
    } else if (answer.includes("next")) {
      goToNextEmail(false);
    } else {
      const retryUtter = new SpeechSynthesisUtterance(
        "Please say 'yes' to send or 'next' to skip."
      );
      retryUtter.lang = "en-US";
      speechSynthesis.speak(retryUtter);
      retryUtter.onend = () => {
        listenForConfirmation();
      };
    }
  };

  ConfirmRecog.onerror = (event) => {
    console.error("Confirmation recognition error:", event.error);
    alert("Could not understand. Please click the button and say 'yes' or 'next'.");
  };

  ConfirmRecog.start();
}

// 10) SEND VIA GMAIL or SKIP, THEN ADVANCE INDEX
async function actuallySendEmail() {
  const finalText = document.getElementById("aiReplyEditable").value || "";
  const res = await fetch(`${BASE_URL}/send_email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      reply_text: finalText,
      msg_id: currentMsgId
    })
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

function goToNextEmail(justSent) {
  currentIndex += 1;
  if (currentIndex < unreadIds.length) {
    loadEmailById(unreadIds[currentIndex]);
  } else {
    showAllDoneMessage();
  }
}

// 11) SHOW “ALL DONE” and HIDE EVERYTHING ELSE
function showAllDoneMessage() {
  document.getElementById("content").style.display = "none";
  document.getElementById("doneMessage").innerText = "All emails read!";
  document.getElementById("doneMessage").style.display = "block";
}


// ────────────────────────────────────────────────────────────────────────────
// HANDS-FREE: Extended FSM with “edit” loop

let fsmRecog = null;
let fsmPhase = "idle";          
// "idle" | "askReplaySummary" | "askRecordReply" | "recordReplyFixed" 
// | "confirmReadReply" | "confirmSendFinal" | "collectEditInstructions"
let fsmReplyBuffer = "";         // holds user’s spoken reply or edit instructions
let lastGptDraft = "";           // holds the most recent AI-generated reply

// 1) HANDS-FREE ENTRY
function handsFreeFlow() {
  if (fsmPhase !== "idle") return;

  fsmPhase = "askReplaySummary";
  ensureFsmRecog();

  fsmRecog.interimResults = false;
  fsmRecog.continuous = false;

  const utter = new SpeechSynthesisUtterance(
    "Would you like to listen to the summary? Say yes or no."
  );
  utter.lang = "en-US";
  speechSynthesis.speak(utter);
  utter.onend = () => {
    fsmRecog.start();
  };
}

// 2) ENSURE FSM RECOGNIZER SETUP
function ensureFsmRecog() {
  if (fsmRecog) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Speech recognition not supported in this browser.");
    fsmPhase = "idle";
    return;
  }

  fsmRecog = new SpeechRecognition();
  fsmRecog.lang = "en-US";

  fsmRecog.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim().toLowerCase();
    switch (fsmPhase) {
      case "askReplaySummary":
        handleAskReplaySummary(transcript);
        break;
      case "askRecordReply":
        handleAskRecordReply(transcript);
        break;
      case "recordReplyFixed":
        handleRecordReplyFixed(event);
        break;
      case "confirmReadReply":
        handleConfirmReadReply(transcript);
        break;
      case "confirmSendFinal":
        handleConfirmSendFinal(transcript);
        break;
      case "collectEditInstructions":
        handleCollectEditInstructions(transcript);
        break;
      default:
        break;
    }
  };

  fsmRecog.onerror = (event) => {
    if (event.error !== "aborted") {
      console.error("FSM recognition error:", event.error);
      fsmPhase = "idle";
    }
  };

  fsmRecog.onend = () => {
    if (fsmPhase === "recordReplyFixed") {
      // Turn to confirmReadReply phase
      fsmPhase = "confirmReadReply";
      // Store last GPT draft from textarea
      lastGptDraft = document.getElementById("aiReplyEditable").value.trim();
      postToSendReplyFixed(fsmReplyBuffer.trim());
    } else if (fsmPhase === "collectEditInstructions") {
      // After collecting instructions, combine and re-prompt GPT
      fsmPhase = "confirmReadReply"; 
      const editInstructions = fsmReplyBuffer.trim();
      const combinedPrompt = 
        `Original email:\n${lastOriginalBody}\n\n` +
        `Previous draft:\n${lastGptDraft}\n\n` +
        `Edit instructions:\n${editInstructions}`;
      fsmReplyBuffer = ""; // Clear buffer
      postToSendReplyFixed(combinedPrompt);
    }
    // Other phases explicitly restart fsmRecog.start() as needed
  };
}

// 3) HANDLE “askReplaySummary”
function handleAskReplaySummary(answer) {
  fsmRecog.stop();
  if (answer.includes("yes")) {
    const summaryText = document.getElementById("summary").innerText || "";
    if (!summaryText) {
      alert("No summary available.");
      fsmPhase = "idle";
      return;
    }
    const replayUtter = new SpeechSynthesisUtterance(summaryText);
    replayUtter.lang = "en-US";
    speechSynthesis.speak(replayUtter);
    replayUtter.onend = () => {
      fsmPhase = "askRecordReply";
      const askUtter = new SpeechSynthesisUtterance(
        "Would you like to record an informal reply? Say yes or no. I will timeout after six seconds."
      );
      askUtter.lang = "en-US";
      speechSynthesis.speak(askUtter);
      askUtter.onend = () => {
        fsmRecog.start();
      };
    };
  } else if (answer.includes("no")) {
    fsmPhase = "idle";
  } else {
    const retryUtter = new SpeechSynthesisUtterance(
      "Please say yes to hear the summary, or no to cancel."
    );
    retryUtter.lang = "en-US";
    speechSynthesis.speak(retryUtter);
    retryUtter.onend = () => {
      fsmRecog.start();
    };
  }
}

// 4) HANDLE “askRecordReply”
function handleAskRecordReply(answer) {
  fsmRecog.stop();
  if (answer.includes("yes")) {
    const startUtter = new SpeechSynthesisUtterance(
      "Recording started. You have six seconds."
    );
    startUtter.lang = "en-US";
    speechSynthesis.speak(startUtter);
    startUtter.onend = () => {
      fsmPhase = "recordReplyFixed";
      startFixedLengthRecordingFSM();
    };
  } else if (answer.includes("no")) {
    fsmPhase = "idle";
  } else {
    const retryUtter = new SpeechSynthesisUtterance(
      "Please say yes to record your reply, or no to skip."
    );
    retryUtter.lang = "en-US";
    speechSynthesis.speak(retryUtter);
    retryUtter.onend = () => {
      fsmRecog.start();
    };
  }
}

// 5) BEGIN fixed-length (6s) recording
function startFixedLengthRecordingFSM() {
  fsmReplyBuffer = "";
  fsmRecog.interimResults = false;
  fsmRecog.continuous = true;

  // After TTS, start the six-second listen
  fsmRecog.start();
  setTimeout(() => {
    fsmRecog.stop();
    const endUtter = new SpeechSynthesisUtterance("Ending recording.");
    endUtter.lang = "en-US";
    speechSynthesis.speak(endUtter);
    // onend triggers postToSendReplyFixed
  }, 6000);
}

// 6) HANDLE “confirmReadReply”
function handleConfirmReadReply(answer) {
  fsmRecog.stop();
  if (answer.includes("yes")) {
    const toRead = document.getElementById("aiReplyEditable").value || "";
    if (toRead) {
      const readUtter = new SpeechSynthesisUtterance(toRead);
      readUtter.lang = "en-US";
      speechSynthesis.speak(readUtter);
      readUtter.onend = () => {
        const askSendUtter = new SpeechSynthesisUtterance(
          "Say yes to send, next to skip, or edit to revise."
        );
        askSendUtter.lang = "en-US";
        speechSynthesis.speak(askSendUtter);
        askSendUtter.onend = () => {
          fsmPhase = "confirmSendFinal";
          fsmRecog.interimResults = false;
          fsmRecog.continuous = false;
          fsmRecog.start();
        };
      };
    } else {
      const askSendUtter = new SpeechSynthesisUtterance(
        "Say yes to send, next to skip, or edit to revise."
      );
      askSendUtter.lang = "en-US";
      speechSynthesis.speak(askSendUtter);
      askSendUtter.onend = () => {
        fsmPhase = "confirmSendFinal";
        fsmRecog.interimResults = false;
        fsmRecog.continuous = false;
        fsmRecog.start();
      };
    }
  } else if (answer.includes("no")) {
    const askSendUtter = new SpeechSynthesisUtterance(
      "Say yes to send, next to skip, or edit to revise."
    );
    askSendUtter.lang = "en-US";
    speechSynthesis.speak(askSendUtter);
    askSendUtter.onend = () => {
      fsmPhase = "confirmSendFinal";
      fsmRecog.interimResults = false;
      fsmRecog.continuous = false;
      fsmRecog.start();
    };
  } else {
    const retry = new SpeechSynthesisUtterance(
      "Please say yes to hear the reply, or no to skip."
    );
    retry.lang = "en-US";
    speechSynthesis.speak(retry);
    retry.onend = () => {
      fsmRecog.start();
    };
  }
}

// 7) HANDLE “confirmSendFinal”
function handleConfirmSendFinal(answer) {
  fsmRecog.stop();
  if (answer.includes("yes")) {
    actuallySendEmail();
  } else if (answer.includes("next")) {
    goToNextEmail(false);
  } else if (answer.includes("edit")) {
    // Collect edit instructions
    fsmPhase = "collectEditInstructions";
    const askEditUtter = new SpeechSynthesisUtterance(
      "Beginning recording for six seconds to collect your edits."
    );
    askEditUtter.lang = "en-US";
    speechSynthesis.speak(askEditUtter);
    askEditUtter.onend = () => {
      fsmRecog.interimResults = false;
      fsmRecog.continuous = true;
      fsmReplyBuffer = "";
      fsmRecog.start();
      setTimeout(() => {
        fsmRecog.stop();
        const endEditUtter = new SpeechSynthesisUtterance("Ending edit recording.");
        endEditUtter.lang = "en-US";
        speechSynthesis.speak(endEditUtter);
        // onend will trigger combine in onend handler
      }, 6000);
    };
  } else {
    const retry = new SpeechSynthesisUtterance(
      "Please say yes to send, next to skip, or edit to revise."
    );
    retry.lang = "en-US";
    speechSynthesis.speak(retry);
    retry.onend = () => {
      fsmRecog.start();
    };
    return;
  }
  fsmPhase = "idle";
}
