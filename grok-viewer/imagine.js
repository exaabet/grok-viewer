(() => {
  const STORAGE_KEY = "grokViewerVideos";
  const SOURCE = "live";

  const normalizeUrl = (url) => {
    if (!url || typeof url !== "string") return "";
    if (url.startsWith("http")) return url;
    if (url.startsWith("users/") || url.startsWith("/users/")) {
      const trimmed = url.replace(/^\//, "");
      return `https://assets.grok.com/${trimmed}`;
    }
    if (url.startsWith("/imagine-public/")) {
      return `https://imagine-public.x.ai${url}`;
    }
    if (url.startsWith("imagine-public/")) {
      return `https://imagine-public.x.ai/${url}`;
    }
    return url;
  };

  const isMp4 = (url) => {
    if (!url) return false;
    const base = url.split(/[?#]/)[0].toLowerCase();
    return base.endsWith(".mp4");
  };

  const addLiveVideo = (url) => {
    const full = normalizeUrl(url);
    if (!isMp4(full)) return;
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      const existing = (data && data[STORAGE_KEY] && data[STORAGE_KEY].items) || [];
      const map = new Map();
      existing.forEach((item) => {
        if (item && item.url) {
          map.set(item.id || item.url, item);
        }
      });
      const id = full;
      map.set(id, {
        id,
        url: full,
        poster: "",
        createdAt: new Date().toISOString(),
        source: SOURCE
      });
      const merged = Array.from(map.values());
      chrome.storage.local.set(
        {
          [STORAGE_KEY]: {
            items: merged,
            updatedAt: Date.now()
          }
        },
        () => {
          chrome.runtime.sendMessage({
            action: "grokViewerVideosUpdated",
            count: merged.length
          });
        }
      );
    });
  };

  const onMessage = (event) => {
    if (!event || !event.data || event.data.source !== "grok-viewer") return;
    if (event.data.type === "videoUrl") {
      addLiveVideo(event.data.url);
    }
  };

  window.addEventListener("message", onMessage);

  const injectScript = () => {
    if (document.getElementById("grok-viewer-hook")) return;
    const script = document.createElement("script");
    script.id = "grok-viewer-hook";
    script.src = chrome.runtime.getURL("page-hook.js");
    script.onload = () => {
      script.remove();
    };
    document.documentElement.appendChild(script);
  };

  injectScript();
})();
