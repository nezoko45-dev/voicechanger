const defaults = { enabled: true, stallSeconds: 20, cooldownSeconds: 20 };
const $ = id => document.getElementById(id);
function save() {
  const settings = {
    enabled: $("enabled").checked,
    stallSeconds: Math.max(4, Math.min(60, Number($("stallSeconds").value) || 20)),
    cooldownSeconds: Math.max(5, Math.min(120, Number($("cooldownSeconds").value) || 20))
  };
  chrome.storage.local.set(settings, () => {
    $("status").textContent = chrome.runtime.lastError ? "Could not save settings." : "Settings saved.";
  });
}
chrome.storage.local.get(defaults, settings => {
  $("enabled").checked = settings.enabled;
  $("stallSeconds").value = settings.stallSeconds;
  $("cooldownSeconds").value = settings.cooldownSeconds;
});
$("enabled").addEventListener("change", save);
$("stallSeconds").addEventListener("change", save);
$("cooldownSeconds").addEventListener("change", save);

