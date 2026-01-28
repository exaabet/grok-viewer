(() => {
  const openViewerWindow = () => {
    chrome.windows.create({
      url: chrome.runtime.getURL("popup.html?mode=window"),
      type: "popup",
      width: 1200,
      height: 820
    });
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === "openViewerWindow") {
      openViewerWindow();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
})();
