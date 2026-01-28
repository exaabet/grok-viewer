(() => {
  const openViewerWindow = () => {
    chrome.windows.create({
      url: "https://grok.com/imagine/favorites?grokViewer=1",
      type: "popup",
      width: 1200,
      height: 820
    });
  };

  chrome.action.onClicked.addListener(() => {
    openViewerWindow();
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === "openViewerWindow") {
      openViewerWindow();
      sendResponse({ ok: true });
      return true;
    }
    if (message && message.action === "grokViewerProxyToTab") {
      const tabId = sender && sender.tab ? sender.tab.id : null;
      if (!tabId) {
        sendResponse({ ok: false, error: "no-tab" });
        return true;
      }
      chrome.tabs.sendMessage(tabId, message.payload || {}, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ ok: true, response });
      });
      return true;
    }
    return false;
  });
})();
