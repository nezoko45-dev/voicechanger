// Force every Web Audio context used by VoiceChanger onto the selected output device.
// Chrome/Edge support AudioContext sinkId from Chromium 110+.
const NativeAudioContext = window.AudioContext;
const contexts = new Set();

function selectedSinkId() {
  const select = document.getElementById("outputDevice");
  const selected = select?.value || localStorage.getItem("voicechanger.outputDevice") || "default";
  return selected === "default" ? "" : selected;
}

async function routeContext(ctx, quiet = false) {
  if (!ctx || typeof ctx.setSinkId !== "function") return false;
  const sink = selectedSinkId();
  try {
    if (ctx.sinkId === sink) return true;
    await ctx.setSinkId(sink);
    if (!quiet) {
      const select = document.getElementById("outputDevice");
      const label = select?.selectedOptions?.[0]?.text || (sink || "Windows default output");
      console.log(`[VoiceChanger] Live audio output: ${label}`);
    }
    return true;
  } catch (error) {
    console.warn("[VoiceChanger] Could not route Web Audio output:", error);
    return false;
  }
}

if (NativeAudioContext) {
  window.AudioContext = new Proxy(NativeAudioContext, {
    construct(Target, args, NewTarget) {
      const sink = selectedSinkId();
      let ctx;
      try {
        // Pass the selected sink at construction time so live audio never starts
        // on the Windows default device first.
        if (sink && (!args || args.length === 0)) {
          ctx = Reflect.construct(Target, [{ sinkId: sink }], NewTarget);
        } else {
          ctx = Reflect.construct(Target, args, NewTarget);
        }
      } catch (error) {
        // Older browsers may not understand the sinkId constructor option.
        ctx = Reflect.construct(Target, args, NewTarget);
      }

      contexts.add(ctx);
      void routeContext(ctx, true);
      ctx.addEventListener?.("statechange", () => {
        if (ctx.state === "closed") contexts.delete(ctx);
      });
      return ctx;
    }
  });
}

window.__voiceChangerRouteOutputs = async function () {
  const results = [];
  for (const ctx of contexts) results.push(await routeContext(ctx));
  return results;
};

function bindOutputSelector() {
  const select = document.getElementById("outputDevice");
  if (!select || select.dataset.outputSinkFixBound) return;
  select.dataset.outputSinkFixBound = "1";
  select.addEventListener("change", () => {
    localStorage.setItem("voicechanger.outputDevice", select.value || "default");
    void window.__voiceChangerRouteOutputs();
  });
}

bindOutputSelector();
new MutationObserver(bindOutputSelector).observe(document.documentElement, { childList: true, subtree: true });
