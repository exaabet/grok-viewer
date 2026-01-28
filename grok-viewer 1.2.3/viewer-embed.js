(() => {
  const STORAGE_KEY = "grokViewerVideos";
  const API_URL = "/rest/media/post/list";
  const DELETE_URL = "/rest/media/post/delete";
  const LIMIT = 40;
  const SOURCE = "MEDIA_POST_SOURCE_LIKED";
  const POLL_INTERVAL_MS = 5000;

  if (!location.pathname.startsWith("/imagine/favorites")) return;
  const params = new URLSearchParams(location.search);
  if (!params.has("grokViewer")) return;
  if (window.__grokViewerEmbedLoaded) return;
  window.__grokViewerEmbedLoaded = true;

  const state = {
    items: [],
    selectedIndex: 0,
    busy: false,
    logsOpen: false,
    lastUpdatedAt: 0,
    knownUrls: new Set(),
    autoAdvance: false
  };

  let lastUserKey = "";

  const getCookie = (name) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length < 2) return "";
    return parts.pop().split(";").shift() || "";
  };

  const getUserKey = () => {
    return getCookie("x-userid") || getCookie("x-anonuserid") || "";
  };

  const ensureUserScope = () =>
    new Promise((resolve) => {
      const currentKey = getUserKey();
      if (!currentKey || currentKey === lastUserKey) {
        resolve(false);
        return;
      }
      chrome.storage.local.get("grokViewerUserId", (data) => {
        const stored = data && data.grokViewerUserId ? data.grokViewerUserId : "";
        const changed = stored && stored !== currentKey;
        chrome.storage.local.set({ grokViewerUserId: currentKey }, () => {
          lastUserKey = currentKey;
          if (changed) {
            updateItems([]);
          }
          resolve(changed);
        });
      });
    });

  let logTimer = null;
  const logLines = [];
  const MAX_LOGS = 200;

  const formatTime = (date) =>
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(
      date.getSeconds()
    ).padStart(2, "0")}`;

  const addLog = (message) => {
    if (!logsBody) return;
    const line = `[${formatTime(new Date())}] ${message}`;
    logLines.push(line);
    if (logLines.length > MAX_LOGS) logLines.shift();
    logsBody.textContent = logLines.join("\n");
    logsBody.scrollTop = logsBody.scrollHeight;
  };

  const fetchPage = async (cursor) => {
    const body = {
      limit: LIMIT,
      filter: { source: SOURCE }
    };
    if (cursor) body.cursor = cursor;
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

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
    try {
      return new URL(url, window.location.href).toString();
    } catch (error) {
      return url;
    }
  };

  const isMp4 = (url, mimeType) => {
    if (mimeType === "video/mp4") return true;
    return (url || "").toLowerCase().includes(".mp4");
  };

  const buildItem = (post) => {
    if (!post) return null;
    const rawUrl = post.hdMediaUrl || post.mediaUrl || "";
    if (!isMp4(rawUrl, post.mimeType)) return null;
    const url = normalizeUrl(rawUrl);
    if (!isMp4(url, post.mimeType)) return null;
    const poster = normalizeUrl(post.thumbnailImageUrl || post.previewImageUrl || "");
    return {
      id: post.id || url,
      url,
      poster,
      postId: post.id || "",
      createdAt: post.createTime || post.createdAt || ""
    };
  };

  const extractItems = (posts) => {
    const items = [];
    (posts || []).forEach((post) => {
      const mainItem = buildItem(post);
      if (mainItem) items.push(mainItem);
      (post.childPosts || []).forEach((child) => {
        const childItem = buildItem(child);
        if (childItem) items.push(childItem);
      });
    });
    return items;
  };

  const fetchAll = async () => {
    let cursor = undefined;
    let allItems = [];
    while (true) {
      const data = await fetchPage(cursor);
      const posts = data && data.posts ? data.posts : [];
      const items = extractItems(posts);
      allItems = allItems.concat(items);
      cursor = data && data.nextCursor ? data.nextCursor : undefined;
      if (!cursor || posts.length === 0) break;
    }
    return allItems;
  };

  const updateItems = (items) => {
    state.items = items || [];
    state.lastUpdatedAt = Date.now();
    const nextUrls = new Set(state.items.map((item) => item.url));
    nextUrls.forEach((url) => {
      if (!state.knownUrls.has(url)) addLog(`New video: ${url}`);
    });
    state.knownUrls.forEach((url) => {
      if (!nextUrls.has(url)) addLog(`Removed video: ${url}`);
    });
    state.knownUrls = nextUrls;
    renderGrid();
    updateCount();
  };

  const refresh = async () => {
    if (state.busy) return;
    state.busy = true;
    setStatus("Refreshing favorites...");
    addLog("Refresh requested");
    try {
      await ensureUserScope();
      const items = await fetchAll();
      updateItems(items);
      chrome.storage.local.set({ [STORAGE_KEY]: { items, updatedAt: Date.now() } }, () => {});
      addLog("Refresh completed");
      setStatus(`Loaded ${items.length} MP4 video${items.length === 1 ? "" : "s"}.`);
    } catch (error) {
      addLog(`Refresh failed: ${error.message}`);
      setStatus("Refresh failed.");
    } finally {
      state.busy = false;
      updateActionButtons();
    }
  };

  const sendToFavorites = (payload) =>
    new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "grokViewerProxyToTab", payload }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false });
      });
    });

  const deletePost = async (postId) => {
    if (!postId) return { ok: false };
    const result = await sendToFavorites({ action: "grokViewerDeleteOne", postId });
    if (!result || !result.ok || !result.response) {
      return { ok: false };
    }
    return { ok: Boolean(result.response.ok), status: result.response.status };
  };

  const deleteOne = async () => {
    const item = state.items[state.selectedIndex];
    if (!item || !item.postId || state.busy) return;
    state.busy = true;
    setStatus("Deleting video...");
    const result = await deletePost(item.postId);
    state.busy = false;
    if (!result.ok) {
      setStatus("Delete failed.");
      updateActionButtons();
      return;
    }
    updateItems(state.items.filter((entry) => entry.postId !== item.postId));
    setStatus("Video deleted.");
    updateActionButtons();
  };

  const deleteAll = async () => {
    if (state.busy) return;
    if (!window.confirm("Delete all videos from favorites?")) return;
    state.busy = true;
    updateActionButtons();
    setStatus("Deleting all videos...");
    const toDelete = state.items.map((item) => item.postId).filter(Boolean);
    const result = await sendToFavorites({ action: "grokViewerDeleteAll", postIds: toDelete });
    const response = result && result.ok ? result.response : null;
    const failed = (response && response.failed) || [];
    const deleted = (response && response.deleted) || [];
    if (deleted.length || failed.length) {
      const remaining = state.items.filter((item) => failed.includes(item.postId));
      updateItems(remaining);
    }
    state.busy = false;
    setStatus(failed.length ? `Failed ${failed.length} deletions.` : "All deletions requested.");
    updateActionButtons();
  };

  const pickDownloadUrl = (item) => {
    if (!item) return "";
    if (item.hdMediaUrl) return item.hdMediaUrl;
    return item.url || "";
  };

  const fetchWithBestCreds = async (url) => {
    if (!url) return null;
    const isPublic = url.includes("imagine-public.x.ai");
    const response = await fetch(url, {
      credentials: isPublic ? "omit" : "include"
    });
    return response;
  };

  const downloadViaExtension = (url) =>
    new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "grokViewerDownloadUrl", url }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false });
      });
    });

  const downloadFile = async (item) => {
    if (!item) return;
    const targetUrl = pickDownloadUrl(item);
    try {
      const response = await fetchWithBestCreds(targetUrl);
      if (!response || !response.ok) throw new Error("fetch-failed");
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${item.postId || item.id || "grok-video"}.mp4`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (error) {
      const fallback = await downloadViaExtension(targetUrl);
      if (!fallback || !fallback.ok) {
        setStatus("Download failed.");
      }
    }
  };

  const downloadOne = () => {
    const item = state.items[state.selectedIndex];
    if (!item) return;
    downloadFile(item);
  };

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  const crc32 = (data) => {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i += 1) {
      const byte = data[i];
      crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  const toDosTimeDate = (date) => {
    const year = Math.max(1980, date.getFullYear());
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = Math.floor(date.getSeconds() / 2);
    const dosTime = (hours << 11) | (minutes << 5) | seconds;
    const dosDate = ((year - 1980) << 9) | (month << 5) | day;
    return { dosTime, dosDate };
  };

  const buildZipBlob = (files) => {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach((file) => {
      const nameBytes = encoder.encode(file.name);
      const header = new Uint8Array(30 + nameBytes.length);
      const headerView = new DataView(header.buffer);
      headerView.setUint32(0, 0x04034b50, true);
      headerView.setUint16(4, 20, true);
      headerView.setUint16(6, 0, true);
      headerView.setUint16(8, 0, true);
      headerView.setUint16(10, file.dosTime, true);
      headerView.setUint16(12, file.dosDate, true);
      headerView.setUint32(14, file.crc, true);
      headerView.setUint32(18, file.size, true);
      headerView.setUint32(22, file.size, true);
      headerView.setUint16(26, nameBytes.length, true);
      headerView.setUint16(28, 0, true);
      header.set(nameBytes, 30);
      localParts.push(header, file.data);

      const central = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, file.dosTime, true);
      centralView.setUint16(14, file.dosDate, true);
      centralView.setUint32(16, file.crc, true);
      centralView.setUint32(20, file.size, true);
      centralView.setUint32(24, file.size, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centralParts.push(central);

      offset += header.length + file.size;
    });

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    endView.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  };

  const downloadAll = () => {
    if (state.busy || !state.items.length) return;
    state.busy = true;
    updateActionButtons();
    setStatus("Preparing archive...");
    const run = async () => {
      try {
        const files = [];
        const queue = state.items.slice();
        const concurrency = Math.min(4, Math.max(1, navigator.hardwareConcurrency ? Math.floor(navigator.hardwareConcurrency / 2) : 3));
        let completed = 0;

        const fetchOne = async () => {
          while (queue.length) {
            const item = queue.shift();
            if (!item) continue;
            const response = await fetchWithBestCreds(item.hdMediaUrl || item.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer = new Uint8Array(await response.arrayBuffer());
            const { dosTime, dosDate } = toDosTimeDate(new Date());
            const name = `${item.postId || item.id}.mp4`;
            files.push({
              name,
              data: buffer,
              size: buffer.length,
              crc: crc32(buffer),
              dosTime,
              dosDate
            });
            completed += 1;
            setStatus(`Preparing archive... ${completed}/${state.items.length}`);
          }
        };

        const workers = [];
        for (let i = 0; i < concurrency; i += 1) {
          workers.push(fetchOne());
        }
        await Promise.all(workers);

        if (!files.length) {
          setStatus("No videos available to download.");
          return;
        }
        setStatus("Building archive...");
        const blob = buildZipBlob(files);
        const archiveName = `grok-videos-${Date.now()}.zip`;
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = archiveName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        setStatus("Archive download started.");
      } catch (error) {
        setStatus("Download all failed.");
      } finally {
        state.busy = false;
        updateActionButtons();
      }
    };
    run();
  };

  let root;
  let statusEl;
  let gridEl;
  let emptyEl;
  let countEl;
  let refreshBtn;
  let downloadAllBtn;
  let deleteAllBtn;
  let logsBtn;
  let logsPanel;
  let logsBody;
  let clearLogsBtn;
  let purgeBtn;
  let logsCloseBtn;
  let lightboxEl;
  let lightboxCountEl;
  let closeBtn;
  let fullscreenBtn;
  let downloadBtn;
  let deleteBtn;
  let autoNextBtn;
  let prevBtn;
  let nextBtn;
  let playerEl;

  const updateCount = () => {
    const total = state.items.length;
    if (countEl) {
      countEl.textContent = `${total} video${total === 1 ? "" : "s"}`;
    }
    if (lightboxCountEl) {
      const current = total ? state.selectedIndex + 1 : 0;
      lightboxCountEl.textContent = `${current} / ${total}`;
    }
  };

  const setStatus = (text) => {
    if (statusEl) statusEl.textContent = text;
  };

  const updateActionButtons = () => {
    const selected = state.items[state.selectedIndex];
    const canDelete = Boolean(selected && selected.postId);
    if (downloadBtn) downloadBtn.disabled = !selected || state.busy;
    if (deleteBtn) deleteBtn.disabled = !canDelete || state.busy;
    if (downloadAllBtn) downloadAllBtn.disabled = !state.items.length || state.busy;
    if (deleteAllBtn) deleteAllBtn.disabled = !state.items.length || state.busy;
    if (autoNextBtn) autoNextBtn.classList.toggle("active", state.autoAdvance);
  };

  const renderGrid = () => {
    if (!gridEl) return;
    gridEl.innerHTML = "";
    if (!state.items.length) {
      if (emptyEl) emptyEl.classList.add("show");
      updateCount();
      updateActionButtons();
      return;
    }
    if (emptyEl) emptyEl.classList.remove("show");
    const fragment = document.createDocumentFragment();
    state.items.forEach((item, index) => {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "thumb";
      thumb.dataset.index = String(index);
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.loop = true;
      video.autoplay = true;
      video.tabIndex = -1;
      if (item.poster) video.poster = item.poster;
      video.src = item.url;
      video.addEventListener("error", () => addLog(`Thumb error: ${item.url}`));
      const overlay = document.createElement("div");
      overlay.className = "thumb-overlay";
      const actions = document.createElement("div");
      actions.className = "thumb-actions";
      const downloadAction = document.createElement("button");
      downloadAction.type = "button";
      downloadAction.className = "icon-btn";
      downloadAction.title = "Download";
      downloadAction.textContent = "↓";
      downloadAction.onclick = (event) => {
        event.stopPropagation();
        downloadFile(item);
      };
      const deleteAction = document.createElement("button");
      deleteAction.type = "button";
      deleteAction.className = "icon-btn danger";
      deleteAction.title = item.postId ? "Delete" : "Delete unavailable";
      deleteAction.textContent = "✕";
      deleteAction.disabled = !item.postId || state.busy;
      deleteAction.onclick = (event) => {
        event.stopPropagation();
        state.selectedIndex = index;
        deleteOne();
      };
      actions.appendChild(downloadAction);
      actions.appendChild(deleteAction);
      overlay.appendChild(actions);
      thumb.appendChild(video);
      thumb.appendChild(overlay);
      thumb.onclick = () => openLightbox(index);
      fragment.appendChild(thumb);
    });
    gridEl.appendChild(fragment);
    updateCount();
    updateActionButtons();
  };

  const loadPlayer = () => {
    const item = state.items[state.selectedIndex];
    if (!item || !playerEl) return;
    playerEl.pause();
    playerEl.src = item.url;
    playerEl.loop = !state.autoAdvance;
    playerEl.load();
    const playPromise = playerEl.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
    updateCount();
    updateActionButtons();
  };

  const toggleAutoAdvance = () => {
    state.autoAdvance = !state.autoAdvance;
    if (playerEl) {
      playerEl.loop = !state.autoAdvance;
    }
    updateActionButtons();
  };

  const openLightbox = (index) => {
    if (!lightboxEl) return;
    state.selectedIndex = (index + state.items.length) % state.items.length;
    lightboxEl.classList.add("open");
    lightboxEl.setAttribute("aria-hidden", "false");
    loadPlayer();
  };

  const closeLightbox = () => {
    if (!lightboxEl) return;
    lightboxEl.classList.remove("open");
    lightboxEl.setAttribute("aria-hidden", "true");
    if (playerEl) playerEl.pause();
  };

  const step = (delta) => {
    if (!state.items.length) return;
    state.selectedIndex = (state.selectedIndex + delta + state.items.length) % state.items.length;
    loadPlayer();
  };

  const startLogTimer = () => {
    if (logTimer) return;
    logTimer = setInterval(() => {
      if (!state.logsOpen) return;
      const last = state.lastUpdatedAt
        ? new Date(state.lastUpdatedAt).toLocaleTimeString()
        : "never";
      addLog(`Tick • videos=${state.items.length} • updated=${last}`);
    }, 1000);
  };

  const stopLogTimer = () => {
    if (!logTimer) return;
    clearInterval(logTimer);
    logTimer = null;
  };

  const toggleLogs = () => {
    state.logsOpen = !state.logsOpen;
    if (logsPanel) logsPanel.classList.toggle("show", state.logsOpen);
    if (state.logsOpen) {
      startLogTimer();
      addLog("Logs opened");
    } else {
      stopLogTimer();
    }
  };

  const initUI = async () => {
    const response = await fetch(chrome.runtime.getURL("embed.html"));
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script").forEach((script) => script.remove());
    const style = doc.querySelector("style");
    const body = doc.body;

    const overlay = document.createElement("div");
    overlay.id = "gv-overlay";
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: rgba(8, 10, 14, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex;
      justify-content: center;
      align-items: stretch;
      overflow: auto;
    `;

    const host = document.createElement("div");
    host.id = "gv-root";
    host.style.cssText = "width: 100%; max-width: 1200px;";
    overlay.appendChild(host);
    document.body.appendChild(overlay);

    const shadow = host.attachShadow({ mode: "open" });
    if (style) {
      const styleEl = document.createElement("style");
      const rawCss = style.textContent || "";
      const cssWithHost = rawCss.replace(/\bbody\b/g, ":host");
      styleEl.textContent = cssWithHost.replace(/url\((['"]?)(images\/[^'")]+)\1\)/g, (match, quote, path) => {
        const resolved = chrome.runtime.getURL(path);
        const q = quote || "";
        return `url(${q}${resolved}${q})`;
      });
      shadow.appendChild(styleEl);
    }
    const container = document.createElement("div");
    container.innerHTML = body.innerHTML;
    container.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (!src) return;
      if (src.startsWith("chrome-extension://") || src.startsWith("http") || src.startsWith("data:")) return;
      const cleaned = src.startsWith("/") ? src.slice(1) : src;
      img.src = chrome.runtime.getURL(cleaned);
    });
    shadow.appendChild(container);

    root = shadow;
    statusEl = shadow.querySelector("#status");
    gridEl = shadow.querySelector("#grid");
    emptyEl = shadow.querySelector("#empty");
    countEl = shadow.querySelector("#count");
    refreshBtn = shadow.querySelector("#refreshBtn");
    downloadAllBtn = shadow.querySelector("#downloadAllBtn");
    deleteAllBtn = shadow.querySelector("#deleteAllBtn");
    logsBtn = shadow.querySelector("#logsBtn");
    logsPanel = shadow.querySelector("#logsPanel");
    logsBody = shadow.querySelector("#logsBody");
    clearLogsBtn = shadow.querySelector("#clearLogsBtn");
    purgeBtn = shadow.querySelector("#purgeBtn");
    logsCloseBtn = shadow.querySelector("#logsCloseBtn");
    lightboxEl = shadow.querySelector("#lightbox");
    lightboxCountEl = shadow.querySelector("#lightboxCount");
    closeBtn = shadow.querySelector("#closeBtn");
    fullscreenBtn = shadow.querySelector("#fullscreenBtn");
    downloadBtn = shadow.querySelector("#downloadBtn");
    deleteBtn = shadow.querySelector("#deleteBtn");
    autoNextBtn = shadow.querySelector("#autoNextBtn");
    prevBtn = shadow.querySelector("#prevBtn");
    nextBtn = shadow.querySelector("#nextBtn");
    playerEl = shadow.querySelector("#player");
    const githubBtn = shadow.querySelector("#githubBtn");

    if (refreshBtn) refreshBtn.onclick = refresh;
    if (downloadAllBtn) downloadAllBtn.onclick = downloadAll;
    if (deleteAllBtn) deleteAllBtn.onclick = deleteAll;
    if (logsBtn) logsBtn.onclick = toggleLogs;
    if (logsCloseBtn) logsCloseBtn.onclick = () => {
      if (!state.logsOpen) return;
      state.logsOpen = false;
      if (logsPanel) logsPanel.classList.remove("show");
      stopLogTimer();
    };
    if (clearLogsBtn) clearLogsBtn.onclick = () => {
      logLines.length = 0;
      if (logsBody) logsBody.textContent = "";
      addLog("Logs cleared");
    };
    if (purgeBtn) {
      purgeBtn.onclick = () => {
        if (!window.confirm("Purge cached list? This won't delete downloaded files.")) return;
        chrome.storage.local.remove(STORAGE_KEY, () => {
          updateItems([]);
          addLog("Cache purged");
          refresh();
        });
      };
    }
    if (downloadBtn) downloadBtn.onclick = downloadOne;
    if (deleteBtn) deleteBtn.onclick = deleteOne;
    if (autoNextBtn) autoNextBtn.onclick = toggleAutoAdvance;
    if (githubBtn) {
      githubBtn.onclick = () => {
        window.open("https://github.com/exaabet/grok-viewer", "_blank", "noopener");
      };
    }
    if (closeBtn) closeBtn.onclick = closeLightbox;
    if (fullscreenBtn) {
      fullscreenBtn.onclick = () => {
        if (!playerEl) return;
        const isFullscreen = document.fullscreenElement;
        if (isFullscreen) {
          document.exitFullscreen().catch(() => {});
          return;
        }
        if (playerEl.requestFullscreen) {
          playerEl.requestFullscreen().catch(() => {});
        }
      };
    }
    if (prevBtn) prevBtn.onclick = () => step(-1);
    if (nextBtn) nextBtn.onclick = () => step(1);
    if (playerEl) {
      playerEl.addEventListener("ended", () => {
        if (state.autoAdvance) step(1);
      });
    }
    if (lightboxEl) {
      lightboxEl.onclick = (event) => {
        if (event.target === lightboxEl) closeLightbox();
      };
    }

    document.addEventListener("keydown", (event) => {
      if (!lightboxEl || !lightboxEl.classList.contains("open")) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
      if (event.key === "Escape") closeLightbox();
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        if (!playerEl) return;
        if (playerEl.paused) {
          const playPromise = playerEl.play();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(() => {});
          }
        } else {
          playerEl.pause();
        }
      }
    });

    setStatus("Loading favorites...");
    refresh();
    setInterval(refresh, POLL_INTERVAL_MS);
  };

  initUI();
})();
