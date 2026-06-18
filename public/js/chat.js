document.addEventListener("DOMContentLoaded", () => {
  const chatWindow = document.querySelector("#chatWindow");
  const fileInput = document.querySelector("#chatFiles");
  const status = document.querySelector("#chatStatus");
  const voiceButton = document.querySelector("#voiceButton");
  const stopVoiceButton = document.querySelector("#stopVoiceButton");
  const uploadNowButton = document.querySelector("#uploadNowButton");
  const reportLink = document.querySelector("#latestReport");
  const voiceStage = document.querySelector("#voiceStage");
  const liveTranscript = document.querySelector("#liveTranscript");

  const FLOW_VERSION = "short-turns-6";
  if (localStorage.getItem("doc_voice_flow_version") !== FLOW_VERSION) {
    localStorage.removeItem(DOC.sessionKey);
    localStorage.setItem("doc_voice_flow_version", FLOW_VERSION);
  }

  let desiredListening = false;
  let recognition = null;
  let finalBuffer = "";
  let sendTimer = null;
  let restartTimer = null;
  let recognizing = false;
  let assistantSpeaking = false;
  let currentAssistantText = "";
  let lastAssistantText = "";
  let ignoreRecognitionUntil = 0;
  let echoFilterUntil = 0;
  let mediaRecorder = null;
  let mediaChunks = [];
  let mediaStream = null;
  const POST_SPEECH_IGNORE_MS = 450;

  function setStage(state) {
    voiceStage.classList.remove("listening", "speaking", "thinking");
    if (state) voiceStage.classList.add(state);
  }

  function append(role, text, reportUrl = "") {
    const bubble = document.createElement("div");
    bubble.className = `message ${role}`;
    bubble.textContent = text;
    chatWindow.appendChild(bubble);
    if (reportUrl) {
      const link = document.createElement("a");
      link.className = "button button-pill secondary";
      link.href = reportUrl;
      link.textContent = "Open report";
      chatWindow.appendChild(link);
      reportLink.href = reportUrl;
      reportLink.hidden = false;
    }
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function scheduleListeningRestart(delay = 260) {
    if (restartTimer) window.clearTimeout(restartTimer);
    if (!desiredListening || !recognition) return;
    const waitForCooldown = Math.max(0, ignoreRecognitionUntil - Date.now()) + 80;
    restartTimer = window.setTimeout(() => {
      restartTimer = null;
      if (!desiredListening || !recognition || recognizing) return;
      if (assistantSpeaking || Date.now() < ignoreRecognitionUntil) {
        scheduleListeningRestart(160);
        return;
      }
      try {
        recognition.start();
      } catch {
        recognizing = false;
        scheduleListeningRestart(450);
      }
    }, Math.max(delay, waitForCooldown));
  }

  function restartListeningSoon() {
    scheduleListeningRestart(260);
  }

  function stopRecognitionForSpeech() {
    if (!recognition || !recognizing) return;
    try {
      recognition.stop();
    } catch {
      recognizing = false;
    }
  }

  function pauseListening(message = "Paused. Press start when you want to talk again.") {
    desiredListening = false;
    finalBuffer = "";
    if (sendTimer) window.clearTimeout(sendTimer);
    if (restartTimer) window.clearTimeout(restartTimer);
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    try {
      recognition?.stop();
    } catch {
      recognizing = false;
    }
    setStage("");
    liveTranscript.textContent = message;
    voiceButton.textContent = "Start continuous voice";
  }

  async function speakReply(text) {
    assistantSpeaking = true;
    currentAssistantText = String(text || "");
    lastAssistantText = currentAssistantText;
    ignoreRecognitionUntil = Date.now() + POST_SPEECH_IGNORE_MS;
    if (sendTimer) window.clearTimeout(sendTimer);
    finalBuffer = "";
    stopRecognitionForSpeech();
    setStage("speaking");
    const maxSpeechMs = Math.min(45000, Math.max(5000, currentAssistantText.length * 85));
    const speechPromise = DOC.speak(text, {
      onstart: () => {
        assistantSpeaking = true;
        currentAssistantText = String(text || "");
        lastAssistantText = currentAssistantText;
        ignoreRecognitionUntil = Date.now() + POST_SPEECH_IGNORE_MS;
        stopRecognitionForSpeech();
        setStage("speaking");
      },
      onend: () => {
        assistantSpeaking = false;
        currentAssistantText = "";
        ignoreRecognitionUntil = Date.now() + POST_SPEECH_IGNORE_MS;
        echoFilterUntil = Date.now() + 350;
        setStage(desiredListening ? "listening" : "");
      }
    });
    await Promise.race([speechPromise, new Promise((resolve) => window.setTimeout(resolve, maxSpeechMs))]);
    assistantSpeaking = false;
    currentAssistantText = "";
    ignoreRecognitionUntil = Date.now() + POST_SPEECH_IGNORE_MS;
    echoFilterUntil = Date.now() + 350;
    setStage(desiredListening ? "listening" : "");
    scheduleListeningRestart(POST_SPEECH_IGNORE_MS);
  }

  async function sendMessage(message) {
    const clean = String(message || "").trim();
    if (!clean && !fileInput.files.length) return;
    if (sendTimer) window.clearTimeout(sendTimer);
    finalBuffer = "";
    append("user", clean || "Uploaded supporting files.");
    liveTranscript.textContent = "DOC is preparing an answer...";
    status.textContent = "DOC is thinking...";
    setStage("thinking");
    const files = await DOC.filesToPayload(fileInput.files, "chat-upload");
    fileInput.value = "";

    try {
      const response = await DOC.api("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: localStorage.getItem(DOC.sessionKey),
          message: clean || "I uploaded supporting files. Please include them in my medical report.",
          files
        })
      });
      localStorage.setItem(DOC.sessionKey, response.sessionId);
      append("assistant", response.reply, response.reportUrl);
      status.textContent = "";
      liveTranscript.textContent = desiredListening ? "Listening. Speak when ready." : "Paused.";
      await speakReply(response.reply);
      if (response.endConversation) {
        localStorage.removeItem(DOC.sessionKey);
        pauseListening("Session finished. Press start for a new conversation.");
      }
    } catch (error) {
      append("assistant", error.message);
      status.textContent = "";
      liveTranscript.textContent = desiredListening ? "Listening. Speak when ready." : "Paused.";
      setStage(desiredListening ? "listening" : "");
    }
  }

  function stopMediaTracks() {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  async function sendRecordedAudio(blob) {
    status.textContent = "Transcribing with local Whisper...";
    liveTranscript.textContent = "DOC is transcribing your voice...";
    setStage("thinking");
    try {
      const file = new File([blob], "doc-voice.webm", { type: blob.type || "audio/webm" });
      const payload = await DOC.fileToPayload(file, "voice-audio");
      const transcript = await DOC.api("/api/voice/transcribe", {
        method: "POST",
        body: JSON.stringify({ file: payload })
      });
      if (!transcript.text) throw new Error("No speech was detected in the recording.");
      liveTranscript.textContent = transcript.text;
      await sendMessage(transcript.text);
    } catch (error) {
      append("assistant", error.installHint ? `${error.message} ${error.installHint}` : error.message);
      status.textContent = "";
      liveTranscript.textContent = "Whisper transcription is unavailable. You can still type or use a browser with speech recognition.";
      setStage("");
    }
  }

  async function startWhisperRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      liveTranscript.textContent = "Audio recording is not available in this browser.";
      return;
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    mediaChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data?.size) mediaChunks.push(event.data);
    };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(mediaChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      stopMediaTracks();
      voiceButton.textContent = "Record with local Whisper";
      await sendRecordedAudio(blob);
    };
    mediaRecorder.start();
    setStage("listening");
    status.textContent = "Recording. Press again to send.";
    liveTranscript.textContent = "Recording for faster-whisper...";
    voiceButton.textContent = "Stop and transcribe";
  }

  function stopWhisperRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  }

  function scheduleFinalSend() {
    if (sendTimer) window.clearTimeout(sendTimer);
    sendTimer = window.setTimeout(() => {
      const message = finalBuffer.trim();
      finalBuffer = "";
      if (message) sendMessage(message);
    }, 650);
  }

  function setupSpeech() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      stopVoiceButton.disabled = true;
      voiceButton.textContent = "Record with local Whisper";
      voiceButton.title = "Uses the local /api/voice/transcribe endpoint when faster-whisper is installed.";
      liveTranscript.textContent = "Browser speech recognition is unavailable. You can record audio for local Whisper transcription.";
      voiceButton.addEventListener("click", async () => {
        if (mediaRecorder && mediaRecorder.state === "recording") {
          stopWhisperRecording();
          return;
        }
        try {
          await startWhisperRecording();
        } catch (error) {
          append("assistant", error.message);
          stopMediaTracks();
          setStage("");
        }
      });
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      recognizing = true;
      if (assistantSpeaking || Date.now() < ignoreRecognitionUntil) {
        try {
          recognition.stop();
        } catch {
          recognizing = false;
        }
        scheduleListeningRestart(180);
        return;
      }
      setStage("listening");
      voiceButton.textContent = "Listening continuously";
      liveTranscript.textContent = "Listening. Speak naturally.";
    };

    recognition.onresult = (event) => {
      let interim = "";
      let heard = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0].transcript.trim();
        heard = `${heard} ${transcript}`.trim();
        if (event.results[i].isFinal) finalBuffer = `${finalBuffer} ${transcript}`.trim();
        else interim = `${interim} ${transcript}`.trim();
      }

      if (assistantSpeaking || Date.now() < ignoreRecognitionUntil) {
        finalBuffer = "";
        liveTranscript.textContent = "DOC is speaking. Listening will resume after the reply.";
        scheduleListeningRestart(180);
        return;
      }

      if (Date.now() < echoFilterUntil && isProbablyAssistantEcho(heard, currentAssistantText || lastAssistantText) && !isUserCommand(heard)) {
        finalBuffer = "";
        liveTranscript.textContent = "Ignored DOC's speaker audio.";
        return;
      }

      liveTranscript.textContent = interim || finalBuffer || "Listening. Speak naturally.";
      if (finalBuffer) scheduleFinalSend();
    };

    recognition.onerror = () => {
      recognizing = false;
      scheduleListeningRestart(350);
    };

    recognition.onend = () => {
      recognizing = false;
      voiceButton.textContent = desiredListening ? "Listening continuously" : "Start continuous voice";
      setStage(assistantSpeaking ? "speaking" : desiredListening ? "listening" : "");
      scheduleListeningRestart(260);
    };
  }

  voiceButton.addEventListener("click", () => {
    if (!recognition) return;
    desiredListening = true;
    restartListeningSoon();
  });

  stopVoiceButton.addEventListener("click", () => {
    pauseListening();
  });

  uploadNowButton.addEventListener("click", () => sendMessage(""));

  setupSpeech();
  append("assistant", "Hi, DOC here. Press start and say hello.");

  function isProbablyAssistantEcho(heard, spoken) {
    const heardWords = String(heard || "").toLowerCase().match(/[a-z]{2,}/g) || [];
    const spokenWords = String(spoken || "").toLowerCase().match(/[a-z]{2,}/g) || [];
    if (!heardWords.length || !spokenWords.length) return false;
    const spokenSet = new Set(spokenWords);
    const meaningfulHeardWords = heardWords.filter((word) => word.length > 2 || ["i", "am"].includes(word));
    if (!meaningfulHeardWords.length) return false;
    const matches = meaningfulHeardWords.filter((word) => spokenSet.has(word) || String(spoken || "").toLowerCase().includes(word)).length;
    return matches / meaningfulHeardWords.length >= 0.6;
  }

  function isUserCommand(text) {
    return /^(yes|yeah|yep|ok|okay|correct|right|no|nope|none|no thanks|thank you|thanks|generate report|report|reset|start over|uploaded|done)$/i.test(String(text || "").trim());
  }
});
