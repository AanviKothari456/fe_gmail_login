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

// 6) GENERATE AI REPLY (include currentMsgId)
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

// 7) READ OUT and ASK FOR “YES” vs “NEXT”
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
// HANDS-FREE: Single-Recognizer FSM, 5 s Idle-Timeout Version

let fsmRecog = null;
let fsmPhase = "idle";          // "idle" | "askReplaySummary" | "askRecordReply" | "recordReply" | "confirmSend"
let fsmReplyBuffer = "";
let fsmPauseTimer = null;

// 1) Called by the new "Hands Free" button
function handsFreeFlow() {
  // If we're already in the middle of an FSM run, do nothing
  if (fsmPhase !== "idle") return;

  // Move into phase “askReplaySummary”
  fsmPhase = "askReplaySummary";

  ensureFsmRecog();
  fsmRecog.interimResults = false;
  fsmRecog.continuous = false;

  // Prompt: ask if the user wants to hear the summary again
  const utter = new SpeechSynthesisUtterance(
    "Would you like to listen to the summary again? Say yes or no."
  );
  utter.lang = "en-US";
  speechSynthesis.speak(utter);

  utter.onend = () => {
    fsmRecog.start();
  };
}

// 2) Ensure our single FSM recognizer exists and configure handlers
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
    // Combine all transcript chunks (interim + final) into one string
    const transcript = Array.from(event.results)
      .map(r => r[0].transcript)
      .join(" ")
      .trim()
      .toLowerCase();

    switch (fsmPhase) {
      case "askReplaySummary":
        handleAskReplaySummary(transcript);
        break;

      case "askRecordReply":
        handleAskRecordReply(transcript);
        break;

      case "recordReply":
        handleRecordReply(event);
        break;

      case "confirmSend":
        handleConfirmSend(transcript);
        break;

      default:
        break;
    }
  };

  fsmRecog.onerror = (event) => {
    console.error("FSM recognition error:", event.error);
    // Reset FSM if something goes wrong
    fsmPhase = "idle";
    clearTimeout(fsmPauseTimer);
  };

  fsmRecog.onend = () => {
    // If we just finished “recordReply,” that means the 5 s timer fired
    if (fsmPhase === "recordReply") {
      fsmPhase = "confirmSend";
      postToSendReply(fsmReplyBuffer.trim());
    }
    // Otherwise, do nothing; other phases explicitly call .start() again
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
    // Read summary again
    const replayUtter = new SpeechSynthesisUtterance(summaryText);
    replayUtter.lang = "en-US";
    speechSynthesis.speak(replayUtter);

    replayUtter.onend = () => {
      fsmPhase = "askRecordReply";
      const askUtter = new SpeechSynthesisUtterance(
        "Would you like to record a reply? Say yes or no."
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
    // Didn’t catch yes/no
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
    fsmPhase = "recordReply";
    startRecordingReplyFSM();
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

// 5) Begin recording the user’s reply (FSM style) using idle timeout
function startRecordingReplyFSM() {
  fsmReplyBuffer = "";
  clearTimeout(fsmPauseTimer);

  fsmRecog.interimResults = true;  // capture partial transcripts too
  fsmRecog.continuous = true;

  const startUtter = new SpeechSynthesisUtterance(
    "Recording started. Please speak your reply. I will stop when you pause for five seconds."
  );
  startUtter.lang = "en-US";
  speechSynthesis.speak(startUtter);

  startUtter.onend = () => {
    // As soon as TTS finishes, start listening
    fsmRecog.start();
    // Kick off an initial 5 s timer in case user stays silent
    fsmPauseTimer = setTimeout(() => {
      fsmRecog.stop();
    }, 5000);
  };
}

// 6) On every result (interim or final), append finals and reset idle timer
function handleRecordReply(event) {
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i];
    // Only append if it's final
    if (result.isFinal) {
      const finalText = result[0].transcript.trim();
      if (finalText) {
        fsmReplyBuffer += finalText + " ";
      }
    }
  }
  // Reset our 5 s idle timer whenever ANY result arrives
  clearTimeout(fsmPauseTimer);
  fsmPauseTimer = setTimeout(() => {
    fsmRecog.stop();  // no speech for 5 s → end recording
  }, 5000);
}

// 7) Send user’s spoken reply to AI, then read AI response
async function postToSendReply(replyText) {
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

    // Now read AI’s reply and ask send/skip
    const aiText = data.formatted_reply;
    const sendPrompt = new SpeechSynthesisUtterance(
      aiText + ". . . Say yes to send or next to skip."
    );
    sendPrompt.lang = "en-US";
    speechSynthesis.speak(sendPrompt);
    sendPrompt.onend = () => {
      fsmPhase = "confirmSend";
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

// 8) Handle “confirmSend” response
function handleConfirmSend(answer) {
  fsmRecog.stop();

  if (answer.includes("yes")) {
    actuallySendEmail();
  } else if (answer.includes("next") || answer.includes("no")) {
    goToNextEmail(false);
  } else {
    const retryUtter = new SpeechSynthesisUtterance(
      "Please say yes to send or next to skip."
    );
    retryUtter.lang = "en-US";
    speechSynthesis.speak(retryUtter);
    retryUtter.onend = () => {
      fsmRecog.start();
    };
    return;
  }
  fsmPhase = "idle";
}
