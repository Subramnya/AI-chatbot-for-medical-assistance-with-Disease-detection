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

  let desiredListening = false;
  let recognition = null;
  let finalBuffer = "";
  let sendTimer = null;
  let recognizing = false;
  let assistantSpeaking = false;
  let currentAssistantText = "";
  let mediaRecorder = null;
  let mediaChunks = [];
  let mediaStream = null;

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

  function restartListeningSoon() {
    if (!desiredListening || !recognition || recognizing) return;
    window.setTimeout(() => {
      if (!desiredListening || recognizing) return;
      try {
        recognition.start();
      } catch {
        recognizing = false;
      }
    }, 260);
  }

  async function speakReply(text) {
    assistantSpeaking = true;
    currentAssistantText = String(text || "");
    setStage("speaking");
    await DOC.speak(text, {
      onstart: () => {
        assistantSpeaking = true;
        currentAssistantText = String(text || "");
        setStage("speaking");
      },
      onend: () => {
        assistantSpeaking = false;
        currentAssistantText = "";
        setStage(desiredListening ? "listening" : "");
      }
    });
    assistantSpeaking = false;
    currentAssistantText = "";
    setStage(desiredListening ? "listening" : "");
    restartListeningSoon();
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
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    }, 950);
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

      if (assistantSpeaking && isProbablyAssistantEcho(heard, currentAssistantText)) {
        finalBuffer = "";
        liveTranscript.textContent = "DOC is speaking. Start talking to interrupt.";
        return;
      }

      if (assistantSpeaking && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        assistantSpeaking = false;
        currentAssistantText = "";
      }

      liveTranscript.textContent = interim || finalBuffer || "Listening. Speak naturally.";
      if (finalBuffer) scheduleFinalSend();
    };

    recognition.onerror = () => {
      recognizing = false;
      restartListeningSoon();
    };

    recognition.onend = () => {
      recognizing = false;
      voiceButton.textContent = desiredListening ? "Listening continuously" : "Start continuous voice";
      setStage(desiredListening ? "listening" : "");
      restartListeningSoon();
    };
  }

  voiceButton.addEventListener("click", () => {
    if (!recognition) return;
    desiredListening = true;
    restartListeningSoon();
  });

  stopVoiceButton.addEventListener("click", () => {
    desiredListening = false;
    finalBuffer = "";
    if (sendTimer) window.clearTimeout(sendTimer);
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    try {
      recognition?.stop();
    } catch {
      recognizing = false;
    }
    setStage("");
    liveTranscript.textContent = "Paused. Press start when you want to talk again.";
    voiceButton.textContent = "Start continuous voice";
  });

  uploadNowButton.addEventListener("click", () => sendMessage(""));

  setupSpeech();
  append("assistant", "Hi, DOC here. Press start and tell me your name, age, what happened, what you can see, and any allergies. You can interrupt me while I am speaking.");

  function isProbablyAssistantEcho(heard, spoken) {
    const heardWords = String(heard || "").toLowerCase().match(/[a-z]{3,}/g) || [];
    const spokenText = String(spoken || "").toLowerCase();
    if (heardWords.length < 3 || !spokenText) return false;
    const matches = heardWords.filter((word) => spokenText.includes(word)).length;
    return matches / heardWords.length > 0.7;
  }
});
