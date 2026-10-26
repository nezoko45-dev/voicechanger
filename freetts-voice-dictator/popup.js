document.getElementById("open").addEventListener("click", () => {
  chrome.tabs.create({url:"https://freetts.com/text-to-speech"});
});