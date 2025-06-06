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
    // if data.body_html is empty, this will simply inject an empty string

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
  // If the click was on the toggle header, swap classes and arrow
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
// Hands‐Free Workflow: one button orchestrates read-summary → record → AI‐reply → send/skip

function handsFreeFlow() {
  // Phase 1: Read the two‐line summary aloud, then ask “start recording?”
  const summaryText = document.getElementById("summary").innerText || "";
  if (!summaryText) {
    alert("No summary available.");
    return;
  }
  const utter = new SpeechSynthesisUtterance(summaryText);
  utter.lang = "en-US";
  speechSynthesis.speak(utter);

  utter.onend = () => {
    const confirmUtter = new SpeechSynthesisUtterance(
      "Do you want to start recording your reply? Say yes or no."
    );
    confirmUtter.lang = "en-US";
    speechSynthesis.speak(confirmUtter);
    confirmUtter.onend = () => {
      listenForStartConfirmation();
    };
  };
}

function listenForStartConfirmation() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Speech recognition not supported.");
    return;
  }
  const confirmRecog = new SpeechRecognition();
  confirmRecog.lang = "en-US";
  confirmRecog.continuous = false;

  confirmRecog.onresult = (event) => {
    const answer = event.results[0][0].transcript.toLowerCase();
    if (answer.includes("yes")) {
      startReplyRecording();
    } else if (answer.includes("no")) {
      // Do nothing, end flow
    } else {
      const retryUtter = new SpeechSynthesisUtterance(
        "Please say yes to start recording, or no to cancel."
      );
      retryUtter.lang = "en-US";
      speechSynthesis.speak(retryUtter);
      retryUtter.onend = () => {
        listenForStartConfirmation();
      };
    }
  };

  confirmRecog.onerror = (event) => {
    console.error("Start confirmation recognition error:", event.error);
    alert("Could not understand. Please click 'Hands Free' and try again.");
  };

  confirmRecog.start();
}

function startReplyRecording() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Speech recognition not supported.");
    return;
  }

  const replyRecog = new SpeechRecognition();
  replyRecog.lang = "en-US";
  replyRecog.continuous = true;

  let collectedReply = "";

  replyRecog.onresult = (event) => {
    // Grab the most recent transcript chunk
    const transcript = event.results[event.results.length - 1][0].transcript;
    if (transcript.toLowerCase().includes("stop recording")) {
      replyRecog.stop();
    } else {
      collectedReply += transcript + " ";
    }
  };

  replyRecog.onerror = (event) => {
    console.error("Reply recognition error:", event.error);
    alert("Error during reply recording.");
  };

  replyRecog.onend = () => {
    // Phase 3 done: send collectedReply to AI and read out response
    postToSendReply(collectedReply.trim());
  };

  // Prompt user that recording is starting
  const startUtter = new SpeechSynthesisUtterance(
    "Recording started. Say 'stop recording' when you are done."
  );
  startUtter.lang = "en-US";
  speechSynthesis.speak(startUtter);

  startUtter.onend = () => {
    replyRecog.start();
  };
}

async function postToSendReply(replyText) {
  if (!replyText) {
    alert("No reply detected.");
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
      return alert("Error generating AI reply: " + (err.error || JSON.stringify(err)));
    }
    const data = await res.json();
    document.getElementById("aiReplyEditable").value = data.formatted_reply;
    // Phase 4: read the AI’s reply and ask “yes to send or no to skip”
    readGeneratedReply();
  } catch (e) {
    console.error(e);
    alert("Failed to generate AI reply.");
  }
}

function readGeneratedReply() {
  const replyText = document.getElementById("aiReplyEditable").value || "";
  if (!replyText) {
    alert("No AI reply to read.");
    return;
  }
  const utter = new SpeechSynthesisUtterance(
    replyText + ". . . Say yes to send or no to skip."
  );
  utter.lang = "en-US";
  speechSynthesis.speak(utter);
  utter.onend = () => {
    listenForSendOrSkip();
  };
}

function listenForSendOrSkip() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Speech recognition not supported.");
    return;
  }
  const sendRecog = new SpeechRecognition();
  sendRecog.lang = "en-US";
  sendRecog.continuous = false;

  sendRecog.onresult = (event) => {
    const answer = event.results[0][0].transcript.toLowerCase();
    if (answer.includes("yes")) {
      actuallySendEmail();
    } else if (answer.includes("no")) {
      goToNextEmail(false);
    } else {
      const retryUtter = new SpeechSynthesisUtterance(
        "Please say yes to send or no to skip."
      );
      retryUtter.lang = "en-US";
      speechSynthesis.speak(retryUtter);
      retryUtter.onend = () => {
        listenForSendOrSkip();
      };
    }
  };

  sendRecog.onerror = (event) => {
    console.error("Send/skip recognition error:", event.error);
    alert("Could not understand. Please try again.");
  };

  sendRecog.start();
}
