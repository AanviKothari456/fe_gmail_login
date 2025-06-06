// File: script.js

const BASE_URL = "https://basic-gmail-login.onrender.com";

let unreadIds = [];     // will hold all unread message IDs
let currentIndex = 0;   // pointer to the “current” email in unreadIds

// 1) LOGIN and INITIAL FETCH OF ALL UNREAD IDS
async function login() {
  window.location.href = `${BASE_URL}/login`;
}

// After login, fetch unread IDs and then load the first email
async function loadInitial() {
  try {
    // Fetch array of unread message IDs
    const res = await fetch(`${BASE_URL}/unread_ids`, { credentials: "include" });
    if (!res.ok) {
      // Not logged in or error
      document.getElementById("content").style.display = "none";
      return;
    }
    const data = await res.json();
    unreadIds = data.ids || [];

    if (unreadIds.length === 0) {
      // Nothing to process
      showAllDoneMessage();
      return;
    }

    // Otherwise load the first email in the list
    currentIndex = 0;
    await loadEmailById(unreadIds[currentIndex]);
  } catch (err) {
    console.error("Error fetching unread IDs:", err);
    alert("Could not fetch unread emails.");
  }
}

// 2) LOAD A SINGLE EMAIL BY ID (replaces old loadEmail)
async function loadEmailById(msgId) {
  try {
    // Fetch that one message’s subject/body/summary
    const res = await fetch(`${BASE_URL}/latest_email?msg_id=${msgId}`, {
      credentials: "include"
    });
    if (res.status === 401) {
      document.getElementById("content").style.display = "none";
      return;
    }
    const data = await res.json();

    // Populate the UI
    document.getElementById("subject").innerText = data.subject || "(No subject)";
    document.getElementById("body").innerText = data.body || "(No body)";
    document.getElementById("summary").innerText = data.summary || "(No summary)";

    document.getElementById("content").style.display = "block";
    document.getElementById("doneMessage").style.display = "none";
  } catch (err) {
    console.error("Error loading email by ID:", err);
    alert("Something went wrong while fetching the email.");
  }
}

// 3) ON PAGE LOAD: decide if we should start multi‐email flow
window.onload = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isLoggedIn = urlParams.get("logged_in") === "true";
  if (isLoggedIn) {
    document.getElementById("loginBtn").style.display = "none";
    loadInitial();
  }
};

// 4) SPEECH SYNTHESIS FOR SUMMARY
function readSummary() {
  const text = document.getElementById("summary").innerText;
  if (!text || text === "(No summary)") return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  speechSynthesis.speak(utter);
}

// 5) VOICE‐TO‐TEXT FOR USER INSTRUCTION (unchanged from before)
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

// 6) GENERATE AI REPLY (populates the textarea exactly as before)
async function sendReply() {
  const userInstruction = document.getElementById("transcript").dataset.reply;
  if (!userInstruction) {
    return alert("Please speak a reply instruction first.");
  }

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
  document.getElementById("aiReplyEditable").value = json.formatted_reply;
}

// 7) READ OUT and ASK FOR “YES” vs “NEXT”
function readAndConfirmReply() {
  const textToRead = document.getElementById("aiReplyEditable").value.trim();
  if (!textToRead) {
    return alert("No reply text to read.");
  }

  // Speak the AI reply + prompt for “yes” or “next”
  const utterance = new SpeechSynthesisUtterance(
    textToRead + ". . . Say 'yes' to send, or 'next' to skip."
  );
  utterance.lang = "en-US";
  speechSynthesis.speak(utterance);

  // When done speaking, listen for one keyword
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
      // Send this email, then move on
      actuallySendEmail();
    } else if (answer.includes("next")) {
      // Skip sending and go to the next email
      goToNextEmail(false);
    } else {
      // If neither “yes” nor “next,” ask again
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
    goToNextEmail(true);
  } else {
    alert("Unexpected response: " + JSON.stringify(json));
  }
}

function goToNextEmail(justSent) {
  // Optionally mark the current ID as “done” in Gmail by removing UNREAD – but
  // if your /send_email already replies on that thread, it typically gets
  // marked read automatically. For a “skip” (justSent=false), you might call:
  //    service.users().messages().modify(userId="me", id=currentId, body={"removeLabelIds":["UNREAD"]}).execute();
  // But skipping that here for brevity.

  currentIndex += 1;
  if (currentIndex < unreadIds.length) {
    // Load the next message ID
    loadEmailById(unreadIds[currentIndex]);
    // Clear the transcript and AI‐textarea
    document.getElementById("transcript").innerText = "";
    document.getElementById("transcript").dataset.reply = "";
    document.getElementById("aiReplyEditable").value = "";
  } else {
    // No more unread IDs → show “All done”
    showAllDoneMessage();
  }
}

// 9) SHOW “ALL DONE” and HIDE EVERYTHING ELSE
function showAllDoneMessage() {
  document.getElementById("content").style.display = "none";
  document.getElementById("doneMessage").style.display = "block";
}
