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

    document.getElementById("transcript").innerText = "";
    document.getElementById("transcript").dataset.reply = "";
    document.getElementById("aiReplyEditable").value = "";
  } catch (err) {
    console.error("Error loading email by ID:", err);
    alert("Something went wrong while fetching the email.");
  }
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

// 7) Send user’s spoken reply to AI, then ask to read it back
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
    document.getElementById("aiReplyEditable").value = data.formatted_reply;

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

// 6) GENERATE AI REPLY (include currentMsgId) – for manual reply button
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

// 7) READ OUT and ASK FOR “YES” vs “NEXT” – for manual read/send
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

// 8) SEND VIA GMAIL or SKIP, THEN ADVANCE INDEX
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

// 9) SHOW “ALL DONE” and HIDE EVERYTHING ELSE
function showAllDoneMessage() {
  document.getElementById("content").style.display = "none";
  document.getElementById("doneMessage").style.display = "block";
}


// ────────────────────────────────────────────────────────────────────────────
// HANDS-FREE: Fixed-Length (6s) FSM Implementation, with correct phase transitions

let fsmRecog = null;
let fsmPhase = "idle";          // "idle" | "askReplaySummary" | "askRecordReply" | "recordReplyFixed" | "confirmReadReply" | "confirmSendFinal"
let fsmReplyBuffer = "";

// 1) Called by the new "Hands Free" button
function handsFreeFlow() {
  if (fsmPhase !== "idle") return;

  fsmPhase = "askReplaySummary";
  ensureFsmRecog();

  // In askReplaySummary, we want only one-shot listen
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

// 2) Ensure single FSM recognizer exists
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
    // If we were recording, now move to sending phase
    if (fsmPhase === "recordReplyFixed") {
      fsmPhase = "confirmReadReply";
      postToSendReplyFixed(fsmReplyBuffer.trim());
    }
    // Otherwise, do nothing; each phase calls start() explicitly
  };
}

// 3) Handle “askReplaySummary” answers
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

// 4) Handle “askRecordReply” answers
function handleAskRecordReply(answer) {
  fsmRecog.stop();

  if (answer.includes("yes")) {
    // Speak the “starting recording” prompt, then begin six-second recording
    const startUtter = new SpeechSynthesisUtterance(
      "Starting recording. You have six seconds."
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

// 5) Begin fixed-length (6s) recording
function startFixedLengthRecordingFSM() {
  fsmReplyBuffer = "";
  fsmRecog.interimResults = false;
  fsmRecog.continuous = true;

  const startUtter = new SpeechSynthesisUtterance(
    "Recording started. You have six seconds."
  );
  startUtter.lang = "en-US";
  speechSynthesis.speak(startUtter);

  startUtter.onend = () => {
    fsmRecog.start();
    // Stop after exactly six seconds
    setTimeout(() => {
      fsmRecog.stop();
      const endUtter = new SpeechSynthesisUtterance("Ending recording.");
      endUtter.lang = "en-US";
      speechSynthesis.speak(endUtter);
      // After this TTS ends, fsmRecog.onend will fire and call postToSendReplyFixed
    }, 6000);
  };
}

// 6) Accumulate final transcripts during fixed recording (already defined above)

// 7) postToSendReplyFixed sends to AI then asks to read
// (already defined above)

// 8) Handle “confirmReadReply” answers (reads then asks send/next)
function handleConfirmReadReply(answer) {
  fsmRecog.stop();

  if (answer.includes("yes")) {
    const toRead = document.getElementById("aiReplyEditable").value || "";
    if (toRead) {
      const readUtter = new SpeechSynthesisUtterance(toRead);
      readUtter.lang = "en-US";
      speechSynthesis.speak(readUtter);
      readUtter.onend = () => {
        // After reading, ask send or skip
        const askSendUtter = new SpeechSynthesisUtterance(
          "Say yes to send or next to skip."
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
      // If somehow empty, skip directly to send prompt
      const askSendUtter = new SpeechSynthesisUtterance(
        "Say yes to send or next to skip."
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
    // Skip directly to send prompt
    const askSendUtter = new SpeechSynthesisUtterance(
      "Say yes to send or next to skip."
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
    // Invalid response: ask again
    const retry = new SpeechSynthesisUtterance(
      "Please say yes to hear the reply, or no to skip."
    );
    retry.lang = "en-US";
    speechSynthesis.speak(retry);
    retry.onend = () => {
      fsmRecog.start();
    };
    return;
  }
}

// 9) Handle “confirmSendFinal” answers (yes → send, next → skip)
function handleConfirmSendFinal(answer) {
  fsmRecog.stop();

  if (answer.includes("yes")) {
    actuallySendEmail();
  } else if (answer.includes("next")) {
    goToNextEmail(false);
  } else {
    const retry = new SpeechSynthesisUtterance(
      "Please say yes to send or next to skip."
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
