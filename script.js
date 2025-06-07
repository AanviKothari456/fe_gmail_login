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
    if (!res.ok) return document.getElementById("content").style.display = "none";
    const data = await res.json();
    unreadIds = data.ids || [];
    if (!unreadIds.length) return showAllDoneMessage();
    currentIndex = 0;
    loadEmailById(unreadIds[currentIndex]);
  } catch (e) {
    console.error(e);
    alert("Could not fetch unread emails.");
  }
}

async function loadEmailById(msgId) {
  try {
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
    lastOriginalBody = data.body_text || stripHtml(data.body_html || "");
    document.getElementById("transcript").innerText = "";
    document.getElementById("transcript").dataset.reply = "";
    document.getElementById("aiReplyEditable").value = "";
    document.getElementById("content").style.display = "block";
  } catch (e) {
    console.error(e);
    alert("Error loading email.");
  }
}

function stripHtml(html) {
  const tmp = document.createElement("DIV");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

window.onload = () => {
  if (new URLSearchParams(window.location.search).get("logged_in") === "true") {
    document.getElementById("loginBtn").style.display = "none";
    loadInitial();
  }
};

document.addEventListener("click", e => {
  if (e.target.id === "body-toggle") {
    const t = e.target, b = document.getElementById("body-content");
    if (t.classList.contains("collapsed")) {
      t.classList.replace("collapsed","expanded"); t.innerText = "▼ Body"; b.classList.replace("collapsed-content","expanded-content");
    } else {
      t.classList.replace("expanded","collapsed"); t.innerText = "▶ Body"; b.classList.replace("expanded-content","collapsed-content");
    }
  }
});

// -- Summary Reader ---------------------------------------------------------
async function readSummary() {
  const text = document.getElementById("summary").innerText;
  if (text) await speak(text);
}

// -- Voice-to-Text ----------------------------------------------------------
let recognition;
if ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) {
  const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.onresult = e => {
    const t = e.results[0][0].transcript;
    document.getElementById("transcript").innerText = "You said: " + t;
    document.getElementById("transcript").dataset.reply = t;
  };
  recognition.onerror = e => console.error("Mic error",e.error);
}
function startRecording() { document.getElementById("transcript").innerText=""; document.getElementById("transcript").dataset.reply=""; recognition&&recognition.start(); }
function stopRecording()  { recognition&&recognition.stop(); }

// -- Manual Reply Generation ------------------------------------------------
async function sendReply() {
  const reply = document.getElementById("transcript").dataset.reply;
  if (!reply) return alert("No reply detected.");
  try {
    const res = await fetch(`${BASE_URL}/send_reply`,{
      method:"POST",credentials:"include",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({reply,msg_id:currentMsgId})
    });
    if(!res.ok) throw await res.json();
    const {formatted_reply} = await res.json();
    document.getElementById("aiReplyEditable").value=formatted_reply;
  } catch(e) { console.error(e); alert("Reply error"); }
}

// -- Manual Read & Confirm --------------------------------------------------
async function readAndConfirmReply() {
  const txt = document.getElementById("aiReplyEditable").value;
  if (!txt) return;
  await speak(txt+". Say 'yes' to send or 'next' to skip.");
  listenForConfirmation();
}
function listenForConfirmation() {
  if(!recognition) return alert("No speech support");
  const SR=SpeechRecognition||webkitSpeechRecognition;
  const rec=new SR(); rec.lang="en-US"; rec.continuous=false;
  rec.onresult=async e=>{
    const ans=e.results[0][0].transcript.toLowerCase();
    if(ans.includes("yes")) await actuallySendEmail();
    else if(ans.includes("next")) goToNextEmail();
    else await speak("Please say yes or next.").then(listenForConfirmation);
  };
  rec.onerror=e=>console.error(e.error);
  rec.start();
}

// -- Send Email & Advance ---------------------------------------------------
async function actuallySendEmail() {
  const txt=document.getElementById("aiReplyEditable").value;
  try {
    const res=await fetch(`${BASE_URL}/send_email`,{
      method:"POST",credentials:"include",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({reply_text:txt,msg_id:currentMsgId})
    }); if(!res.ok) throw await res.json();
    const json=await res.json(); if(json.status==="sent") alert("Sent!")&&goToNextEmail();
  } catch(e) { console.error(e); alert("Send failed"); }
}
function goToNextEmail() {
  currentIndex++; if(currentIndex<unreadIds.length) loadEmailById(unreadIds[currentIndex]); else showAllDoneMessage();
}
function showAllDoneMessage(){document.getElementById("content").style.display="none";document.getElementById("doneMessage").innerText="All done!";document.getElementById("doneMessage").style.display="block";}

// -- FSM Hands-Free ---------------------------------------------------------
let fsmRecog=null, fsmPhase="idle", fsmReplyBuffer="", lastGptDraft="";

function handsFreeFlow(){
  if(fsmPhase!="idle")return;
  fsmPhase="askReplaySummary";
  ensureFsmRecog();
  speak("Would you like to hear the summary? Say yes or no.")
    .then(()=>fsmRecog.start());
}

function ensureFsmRecog(){
  if(fsmRecog)return;
  if(!recognition){console.warn("No speech support");return;}
  const SR=SpeechRecognition||webkitSpeechRecognition;
  fsmRecog=new SR(); fsmRecog.lang="en-US"; fsmRecog.continuous=false; fsmRecog.interimResults=false;
  fsmRecog.onresult=e=>{
    const t=e.results[0][0].transcript.trim().toLowerCase();
    switch(fsmPhase){
      case"askReplaySummary":handleAskReplaySummary(t);break;
      case"askRecordReply":handleAskRecordReply(t);break;
      case"confirmReadReply":handleConfirmReadReply(t);break;
      case"confirmSendFinal":handleConfirmSendFinal(t);break;
    }
  };
  fsmRecog.onerror=e=>{console.error(e.error);fsmPhase="idle";};
}

function handleAskReplaySummary(ans){
  fsmRecog.stop();
  if(ans.includes("yes")){
    const s=document.getElementById("summary").innerText; speak(s)
    .then(()=>speak("Ready to record your reply? Say yes or no. You have six seconds."))
    .then(()=>{fsmPhase="askRecordReply";fsmRecog.start();});
  } else fsmPhase="idle";
}

function handleAskRecordReply(ans){
  fsmRecog.stop();
  if(ans.includes("yes")){
    speak("Recording now. You have six seconds.").then(()=>{
      fsmPhase="recordReplyFixed";fsmReplyBuffer="";recognition.start();
      setTimeout(()=>{ recognition.stop(); speak("Done recording.")
      .then(()=>{
        const t=fsmReplyBuffer.trim();
        if(!t){speak("No speech detected. Try again?").then(()=>{fsmPhase="askRecordReply";fsmRecog.start();});}
        else postToSendReplyFixed(t);
      });},6000);
    });
  } else fsmPhase="idle";
}

async function postToSendReplyFixed(txt){
  try{
    const res=await fetch(`${BASE_URL}/send_reply`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({reply:txt,msg_id:currentMsgId})});
    if(!res.ok) throw await res.json();
    const {formatted_reply}=await res.json(); document.getElementById("aiReplyEditable").value=formatted_reply; lastGptDraft=formatted_reply;
    speak("Read reply? Say yes or no.").then(()=>{fsmPhase="confirmReadReply";fsmRecog.start();});
  }catch(e){console.error(e);fsmPhase="idle";}
}

function handleConfirmReadReply(ans){
  fsmRecog.stop();
  if(ans.includes("yes")) speak(document.getElementById("aiReplyEditable").value || "");
  speak("Say yes to send, next to skip, or edit to revise.").then(()=>{fsmPhase="confirmSendFinal";fsmRecog.start();});
}

function handleConfirmSendFinal(ans){
  fsmRecog.stop();
  if(ans.includes("yes")) actuallySendEmail();
  else if(ans.includes("next")) goToNextEmail();
  else if(ans.includes("edit")){
    speak("Record edits now. You have six seconds.").then(()=>{fsmPhase="collectEditInstructions";fsmReplyBuffer="";recognition.start();setTimeout(()=>{recognition.stop();speak("Done edits.").then(()=>{postToSendReplyFixed(`This email:\n${lastOriginalBody}\nYour draft:\n${lastGptDraft}\nEdits:\n${fsmReplyBuffer.trim()}`);});},6000);});
  } else speak("Please say yes, next, or edit.").then(()=>fsmRecog.start());
  fsmPhase="idle";
}
