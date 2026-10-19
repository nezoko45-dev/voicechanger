(() => {
  const $ = (id) => document.getElementById(id);
  const start = $("echoStart");
  const stop = $("echoStop");
  const transcript = $("echoTranscript");
  const status = $("echoStatus");
  const profileSelect = $("echoProfile");
  const baseInput = $("voiceboxUrl");
  const refresh = $("echoRefresh");
  let recognition = null;
  let isListening = false;

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle("error", error);
  }

  function getRecognitionConstructor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition;
  }

  async function loadProfiles() {
    const base = baseInput.value.trim().replace(/\/$/, "");
    if (!base) return;
    refresh.disabled = true;
    try {
      const response = await fetch(base + "/profiles");
      if (!response.ok) throw new Error("Voicebox returned HTTP " + response.status);
      const profiles = await response.json();
      const previous = profileSelect.value;
      profileSelect.replaceChildren();
      for (const profile of profiles) {
        if (!profile || !profile.id || !profile.name) continue;
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = profile.name;
        profileSelect.append(option);
      }
      if (previous && [...profileSelect.options].some(option => option.value === previous)) {
        profileSelect.value = previous;
      }
      if (!profileSelect.options.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No profiles found";
        profileSelect.append(option);
      }
      setStatus("Loaded " + profiles.length + " Voicebox profile(s).");
    } catch (error) {
      setStatus("Could not load Voicebox profiles. Check that Voicebox is running and the URL is correct. " + error.message, true);
    } finally {
      refresh.disabled = false;
    }
  }

  async function speakWithVoicebox(text) {
    const base = baseInput.value.trim().replace(/\/$/, "");
    const profileId = profileSelect.value;
    if (!base || !profileId) throw new Error("Set a Voicebox URL and select a voice profile.");
    const response = await fetch(base + "/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: profileId, text, language: "en" })
    });
    if (!response.ok) {
      let detail = "Voicebox speech generation failed (HTTP " + response.status + ").";
      try {
        const body = await response.json();
        detail = body.detail || detail;
      } catch {}
      throw new Error(detail);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("audio/")) {
      const audioUrl = URL.createObjectURL(await response.blob());
      const audio = new Audio(audioUrl);
      audio.addEventListener("ended", () => URL.revokeObjectURL(audioUrl), { once: true });
      await audio.play();
      return;
    }

    const result = await response.json();
    const generationId = result.generation_id || result.id;
    const audioUrlFromResult = result.audio_url || result.url;
    if (audioUrlFromResult) {
      const resolvedUrl = new URL(audioUrlFromResult, base).href;
      const audio = new Audio(resolvedUrl);
      await audio.play();
      return;
    }
    if (!generationId) throw new Error("Voicebox responded, but no generation ID or audio URL was returned.");
    const audioResponse = await fetch(base + "/audio/" + encodeURIComponent(generationId));
    if (!audioResponse.ok) throw new Error("Voicebox generated speech, but audio retrieval failed (HTTP " + audioResponse.status + ").");
    const audioUrl = URL.createObjectURL(await audioResponse.blob());
    const audio = new Audio(audioUrl);
    audio.addEventListener("ended", () => URL.revokeObjectURL(audioUrl), { once: true });
    await audio.play();
  }

  function browserSpeak(text) {
    if (!("speechSynthesis" in window)) throw new Error("Speech playback is not supported by this browser.");
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
  }

  async function echoText(text) {
    transcript.textContent = text;
    setStatus("Recognized speech. Generating spoken echo…");
    try {
      await speakWithVoicebox(text);
      setStatus("Echo played using your selected Voicebox voice.");
    } catch (error) {
      try {
        browserSpeak(text);
        setStatus("Voicebox unavailable (" + error.message + "). Echoing with your browser voice instead.");
      } catch (fallbackError) {
        setStatus(error.message + " " + fallbackError.message, true);
      }
    }
  }

  start.addEventListener("click", () => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      setStatus("Speech recognition is not supported here. Open VoiceChanger in a recent version of Chrome.", true);
      return;
    }
    if (isListening) return;
    recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    isListening = true;
    start.disabled = true;
    stop.disabled = false;
    transcript.textContent = "Listening…";
    setStatus("Listening. Speak a short phrase, and VoiceChanger will echo it aloud.");
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const part = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += part;
        else interimText += part;
      }
      if (interimText) transcript.textContent = interimText;
      if (finalText.trim()) {
        transcript.textContent = finalText.trim();
        void echoText(finalText.trim());
      }
    };
    recognition.onerror = (event) => {
      setStatus("Speech recognition error: " + event.error + ".", true);
    };
    recognition.onend = () => {
      isListening = false;
      start.disabled = false;
      stop.disabled = true;
      recognition = null;
    };
    try {
      recognition.start();
    } catch (error) {
      isListening = false;
      start.disabled = false;
      stop.disabled = true;
      setStatus("Could not start speech recognition: " + error.message, true);
    }
  });

  stop.addEventListener("click", () => {
    if (recognition) recognition.stop();
    isListening = false;
    start.disabled = false;
    stop.disabled = true;
    setStatus("Listening stopped.");
  });
  refresh.addEventListener("click", () => void loadProfiles());
  baseInput.addEventListener("change", () => void loadProfiles());
  loadProfiles();
})();