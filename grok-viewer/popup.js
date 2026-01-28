(() => {
  const STORAGE_KEY = "grokViewerVideos";
  const FAVORITES_URL = "https://grok.com/imagine/favorites";

  const statusEl = document.getElementById("status");
  const gridEl = document.getElementById("grid");
  const emptyEl = document.getElementById("empty");
  const countEl = document.getElementById("count");
  const refreshBtn = document.getElementById("refreshBtn");
  const downloadAllBtn = document.getElementById("downloadAllBtn");
  const deleteAllBtn = document.getElementById("deleteAllBtn");

  const lightboxEl = document.getElementById("lightbox");
  const lightboxCountEl = document.getElementById("lightboxCount");
  const closeBtn = document.getElementById("closeBtn");
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const deleteBtn = document.getElementById("deleteBtn");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const playerEl = document.getElementById("player");

  const state = {
    videos: [],
    selectedIndex: 0,
    favoritesTabId: null,
    busy: false
  };

  const isMp4 = (url) => {
    if (!url || typeof url !== "string") return false;
    const base = url.split(/[?#]/)[0].toLowerCase();
    return base.endsWith(".mp4");
  };

  const setMode = () => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") === "window" ? "window" : "popup";
    document.body.dataset.mode = mode;
  };

  const setStatus = (text) => {
    if (!statusEl) return;
    statusEl.textContent = text;
  };

  const updateCount = () => {
    const total = state.videos.length;
    if (countEl) {
      countEl.textContent = `${total} video${total === 1 ? "" : "s"}`;
    }
    if (lightboxCountEl) {
      const current = total ? state.selectedIndex + 1 : 0;
      lightboxCountEl.textContent = `${current} / ${total}`;
    }
  };

  const normalizeItems = (items) => {
    return (items || [])
      .filter((item) => item && item.url && isMp4(item.url))
      .map((item) => ({
        id: item.id || item.url,
        url: item.url,
        hdMediaUrl: item.hdMediaUrl || "",
        poster: item.poster || "",
        postId: item.postId || "",
        videoId: item.videoId || "",
        createdAt: item.createdAt || ""
      }));
  };

  const getSelected = () => state.videos[state.selectedIndex] || null;

  const getDownloadUrl = (item) => {
    if (!item) return "";
    return item.hdMediaUrl || item.url || "";
  };

  const buildFilename = (item, url) => {
    const fallback = `grok/video-${Date.now()}.mp4`;
    if (!url) return fallback;
    try {
      const parsed = new URL(url);
      const name = parsed.pathname.split("/").pop() || "video.mp4";
      const prefix = item && item.postId ? `grok/${item.postId}-` : "grok/";
      return `${prefix}${name}`;
    } catch (error) {
      return fallback;
    }
  };

  const downloadItem = (item) => {
    const url = getDownloadUrl(item);
    if (!url) return;
    const filename = buildFilename(item, url);
    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({ url, filename, saveAs: false }, () => {
        if (chrome.runtime.lastError) {
          const fallback = document.createElement("a");
          fallback.href = url;
          fallback.download = filename;
          fallback.target = "_blank";
          fallback.rel = "noreferrer";
          fallback.click();
        }
      });
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.click();
    }
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

  const downloadAll = async () => {
    if (state.busy || !state.videos.length) return;
    state.busy = true;
    updateActionButtons();
    setStatus("Preparing archive...");
    try {
      const files = [];
      const queue = state.videos.slice();
      const concurrency = Math.min(4, Math.max(1, navigator.hardwareConcurrency ? Math.floor(navigator.hardwareConcurrency / 2) : 3));
      let completed = 0;

      const fetchOne = async () => {
        while (queue.length) {
          const item = queue.shift();
          if (!item) continue;
          const url = getDownloadUrl(item);
          if (!url) {
            completed += 1;
            continue;
          }
          const response = await fetch(url, { credentials: "include" });
          if (!response.ok) {
            throw new Error(`Fetch failed: ${response.status}`);
          }
          const buffer = new Uint8Array(await response.arrayBuffer());
          const { dosTime, dosDate } = toDosTimeDate(new Date());
          const filename = buildFilename(item, url).replace(/^grok\//, "");
          files.push({
            name: filename,
            data: buffer,
            size: buffer.length,
            crc: crc32(buffer),
            dosTime,
            dosDate
          });
          completed += 1;
          setStatus(`Preparing archive... ${completed}/${state.videos.length}`);
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
      if (chrome.downloads && chrome.downloads.download) {
        chrome.downloads.download({ url: blobUrl, filename: archiveName, saveAs: false }, () => {
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        });
      } else {
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = archiveName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      }
      setStatus("Archive download started.");
    } catch (error) {
      setStatus("Download all failed. Try again.");
    } finally {
      state.busy = false;
      updateActionButtons();
    }
  };

  const applyDeletion = (postIds) => {
    const ids = new Set((postIds || []).filter(Boolean));
    if (!ids.size) return;
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      const items = (data && data[STORAGE_KEY] && data[STORAGE_KEY].items) || [];
      const filtered = items.filter((item) => !ids.has(item.postId));
      chrome.storage.local.set(
        {
          [STORAGE_KEY]: {
            items: filtered,
            updatedAt: Date.now()
          }
        },
        () => updateVideos(filtered)
      );
    });
  };

  const sendToFavorites = (message, callback) => {
    chrome.tabs.query({ url: `${FAVORITES_URL}*` }, (tabs) => {
      const tab = tabs && tabs.length ? tabs[0] : null;
      state.favoritesTabId = tab ? tab.id : null;
      if (!state.favoritesTabId) {
        callback({ ok: false, error: "no-tab" });
        return;
      }
      chrome.tabs.sendMessage(state.favoritesTabId, message, (response) => {
        if (chrome.runtime.lastError) {
          callback({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        callback({ ok: true, response });
      });
    });
  };

  const deleteItem = (item) => {
    if (!item || !item.postId || state.busy) return;
    state.busy = true;
    updateActionButtons();
    setStatus("Deleting video...");
    sendToFavorites({ action: "grokViewerDeleteOne", postId: item.postId }, (result) => {
      state.busy = false;
      updateActionButtons();
      if (!result.ok || !result.response || !result.response.ok) {
        setStatus("Delete failed. Keep favorites open.");
        return;
      }
      applyDeletion([item.postId]);
      setStatus("Video deleted.");
    });
  };

  const deleteAll = () => {
    if (state.busy) return;
    const postIds = state.videos.map((item) => item.postId).filter(Boolean);
    if (!postIds.length) return;
    if (!window.confirm("Delete all videos from Grok favorites?")) return;
    state.busy = true;
    updateActionButtons();
    setStatus("Deleting all videos...");
    sendToFavorites({ action: "grokViewerDeleteAll", postIds }, (result) => {
      state.busy = false;
      updateActionButtons();
      if (!result.ok || !result.response || !result.response.ok) {
        setStatus("Delete all failed. Keep favorites open.");
        return;
      }
      const deleted = result.response.deleted || postIds;
      applyDeletion(deleted);
      const failed = result.response.failed || [];
      if (failed.length) {
        setStatus(`Deleted ${postIds.length - failed.length}. Failed ${failed.length}.`);
      } else {
        setStatus("All deletions requested.");
      }
    });
  };

  const updateActionButtons = () => {
    const selected = getSelected();
    const canDelete = Boolean(selected && selected.postId);
    if (downloadBtn) downloadBtn.disabled = !selected || state.busy;
    if (deleteBtn) deleteBtn.disabled = !canDelete || state.busy;
    if (downloadAllBtn) downloadAllBtn.disabled = !state.videos.length || state.busy;
    if (deleteAllBtn) deleteAllBtn.disabled = !state.videos.some((item) => item.postId) || state.busy;
  };

  const renderGrid = () => {
    if (!gridEl) return;
    gridEl.innerHTML = "";

    if (!state.videos.length) {
      if (emptyEl) emptyEl.classList.add("show");
      updateCount();
      updateActionButtons();
      return;
    }

    if (emptyEl) emptyEl.classList.remove("show");

    const fragment = document.createDocumentFragment();
    state.videos.forEach((item, index) => {
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
      if (item.poster) {
        video.poster = item.poster;
      }
      video.src = item.url;

      const overlay = document.createElement("div");
      overlay.className = "thumb-overlay";

      const actions = document.createElement("div");
      actions.className = "thumb-actions";

      const downloadAction = document.createElement("button");
      downloadAction.type = "button";
      downloadAction.className = "icon-btn";
      downloadAction.title = "Download";
      downloadAction.textContent = "↓";
      downloadAction.addEventListener("click", (event) => {
        event.stopPropagation();
        downloadItem(item);
      });

      const deleteAction = document.createElement("button");
      deleteAction.type = "button";
      deleteAction.className = "icon-btn danger";
      deleteAction.title = item.postId ? "Delete" : "Delete unavailable";
      deleteAction.textContent = "✕";
      deleteAction.disabled = !item.postId || state.busy;
      deleteAction.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteItem(item);
      });

      actions.appendChild(downloadAction);
      actions.appendChild(deleteAction);
      overlay.appendChild(actions);

      thumb.appendChild(video);
      thumb.appendChild(overlay);
      thumb.addEventListener("click", () => openLightbox(index));
      fragment.appendChild(thumb);
    });

    gridEl.appendChild(fragment);
    updateCount();
    updateActionButtons();
  };

  const loadPlayer = () => {
    if (!playerEl) return;
    const item = getSelected();
    if (!item) return;

    playerEl.pause();
    playerEl.src = item.url;
    playerEl.loop = true;
    playerEl.load();
    const playPromise = playerEl.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
    updateCount();
    updateActionButtons();
  };

  const openLightbox = (index) => {
    if (!lightboxEl || !state.videos.length) return;
    state.selectedIndex = (index + state.videos.length) % state.videos.length;
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
    if (!state.videos.length) return;
    state.selectedIndex = (state.selectedIndex + delta + state.videos.length) % state.videos.length;
    loadPlayer();
  };

  const updateVideos = (items) => {
    state.videos = normalizeItems(items);
    if (!state.videos.length) {
      setStatus("No videos yet. Keep favorites open.");
    } else {
      setStatus(`Loaded ${state.videos.length} MP4 video${state.videos.length === 1 ? "" : "s"}.`);
    }
    if (state.selectedIndex >= state.videos.length) {
      state.selectedIndex = 0;
    }
    renderGrid();
    if (lightboxEl && lightboxEl.classList.contains("open")) {
      loadPlayer();
    }
  };

  const loadFromStorage = () => {
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      const items = data && data[STORAGE_KEY] ? data[STORAGE_KEY].items : [];
      updateVideos(items || []);
    });
  };

  const detectFavoritesTab = () => {
    chrome.tabs.query({ url: `${FAVORITES_URL}*` }, (tabs) => {
      const tab = tabs && tabs.length ? tabs[0] : null;
      state.favoritesTabId = tab ? tab.id : null;
      if (state.favoritesTabId) {
        setStatus("Favorites open. Live syncing...");
      } else if (!state.videos.length) {
        setStatus("Open Grok favorites to sync videos.");
      }
      updateActionButtons();
    });
  };

  const refreshFromFavorites = () => {
    chrome.tabs.query({ url: `${FAVORITES_URL}*` }, (tabs) => {
      const tab = tabs && tabs.length ? tabs[0] : null;
      state.favoritesTabId = tab ? tab.id : null;
      if (!state.favoritesTabId) {
        setStatus("Open Grok favorites to refresh.");
        return;
      }
      setStatus("Refreshing favorites...");
      chrome.tabs.sendMessage(state.favoritesTabId, { action: "grokViewerRefresh" }, () => {
        if (chrome.runtime.lastError) {
          setStatus("Refresh failed. Keep favorites open.");
          return;
        }
        loadFromStorage();
      });
    });
  };

  const bindEvents = () => {
    if (refreshBtn) {
      refreshBtn.addEventListener("click", refreshFromFavorites);
    }

    if (downloadAllBtn) {
      downloadAllBtn.addEventListener("click", downloadAll);
    }

    if (deleteAllBtn) {
      deleteAllBtn.addEventListener("click", deleteAll);
    }

    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => downloadItem(getSelected()));
    }

    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => deleteItem(getSelected()));
    }

    if (closeBtn) {
      closeBtn.addEventListener("click", closeLightbox);
    }

    if (fullscreenBtn) {
      fullscreenBtn.addEventListener("click", () => {
        if (!playerEl) return;
        const isFullscreen = document.fullscreenElement;
        if (isFullscreen) {
          document.exitFullscreen().catch(() => {});
          return;
        }
        if (playerEl.requestFullscreen) {
          playerEl.requestFullscreen().catch(() => {});
        }
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", () => step(-1));
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", () => step(1));
    }

    if (lightboxEl) {
      lightboxEl.addEventListener("click", (event) => {
        if (event.target === lightboxEl) closeLightbox();
      });
    }

    document.addEventListener("fullscreenchange", () => {
      if (!fullscreenBtn) return;
      fullscreenBtn.textContent = document.fullscreenElement ? "Exit Fullscreen" : "Fullscreen";
    });

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

    chrome.storage.onChanged.addListener((changes) => {
      if (changes[STORAGE_KEY] && changes[STORAGE_KEY].newValue) {
        updateVideos(changes[STORAGE_KEY].newValue.items || []);
      }
    });
  };

  setMode();
  bindEvents();
  loadFromStorage();
  detectFavoritesTab();

  setInterval(detectFavoritesTab, 10000);
})();
