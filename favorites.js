(() => {
  const STORAGE_KEY = "grokViewerVideos";
  const POLL_INTERVAL_MS = 5000;
  const LIMIT = 40;
  const SOURCE = "MEDIA_POST_SOURCE_LIKED";
  const BUTTON_ID = "grok-viewer-open";
  const VIDEO_EXTENSIONS = [".mp4"];
  const DELETE_ENDPOINT = "/rest/media/post/delete";

  let pollTimer = null;
  let fetchInFlight = false;
  let deleteInFlight = false;
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
        if (stored && stored !== currentKey) {
          chrome.storage.local.set(
            {
              grokViewerUserId: currentKey,
              [STORAGE_KEY]: { items: [], updatedAt: Date.now() }
            },
            () => {
              lastUserKey = currentKey;
              resolve(true);
            }
          );
          return;
        }
        chrome.storage.local.set({ grokViewerUserId: currentKey }, () => {
          lastUserKey = currentKey;
          resolve(false);
        });
      });
    });

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
      return "";
    }
  };

  const isMp4 = (url, mimeType) => {
    if (mimeType === "video/mp4") return true;
    const base = (url || "").split(/[?#]/)[0].toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => base.endsWith(ext));
  };

  const getPostId = (post) => {
    return (
      post.originalPostId ||
      post.id ||
      post.postId ||
      post.videoPostId ||
      post.mediaPostId ||
      ""
    );
  };

  const getVideoId = (post) => {
    return (
      post.videoId ||
      post.mediaId ||
      (post.media && (post.media.id || post.media.videoId)) ||
      ""
    );
  };

  const buildItem = (post) => {
    if (!post) return null;
    const rawUrl = post.hdMediaUrl || post.mediaUrl || "";
    const url = normalizeUrl(rawUrl);
    const poster = normalizeUrl(post.thumbnailImageUrl || post.previewImageUrl || "");
    const postId = getPostId(post);
    const videoId = getVideoId(post);
    const hdMediaUrl = normalizeUrl(post.hdMediaUrl || "");
    if (!url || !isMp4(url, post.mimeType)) return null;
    const id = post.id || post.videoPostId || url;
    return {
      id,
      url,
      hdMediaUrl,
      poster,
      postId,
      videoId,
      createdAt: post.createTime || post.createdAt || "",
      source: "favorites"
    };
  };

  const extractFromPosts = (posts) => {
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

  const mergeVideos = (existing, incoming) => {
    const map = new Map();
    (existing || []).forEach((item) => {
      if (!item || !item.url) return;
      if (item.source === "favorites") return;
      map.set(item.id || item.url, item);
    });
    (incoming || []).forEach((item) => {
      if (!item || !item.url) return;
      map.set(item.id || item.url, item);
    });
    return Array.from(map.values());
  };

  const sortVideos = (items) => {
    return (items || []).slice().sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return tb - ta;
    });
  };

  const persistVideos = (incoming) => {
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      const existing = (data && data[STORAGE_KEY] && data[STORAGE_KEY].items) || [];
      const merged = mergeVideos(existing, incoming);
      const sorted = sortVideos(merged);
      chrome.storage.local.set(
        {
          [STORAGE_KEY]: {
            items: sorted,
            updatedAt: Date.now()
          }
        },
        () => {
          chrome.runtime.sendMessage({
            action: "grokViewerVideosUpdated",
            count: sorted.length
          });
        }
      );
    });
  };

  const fetchPage = async (cursor) => {
    const body = {
      limit: LIMIT,
      filter: {
        source: SOURCE
      }
    };
    if (cursor) body.cursor = cursor;

    const response = await fetch("/rest/media/post/list", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  };

  const fetchAllFavorites = async () => {
    if (fetchInFlight) return;
    fetchInFlight = true;
    try {
      await ensureUserScope();
      let succeeded = false;
      let cursor = undefined;
      let allItems = [];
      while (true) {
        const data = await fetchPage(cursor);
        succeeded = true;
        const posts = data && data.posts ? data.posts : [];
        const items = extractFromPosts(posts);
        allItems = allItems.concat(items);
        cursor = data && data.nextCursor ? data.nextCursor : undefined;
        if (!cursor || posts.length === 0) break;
      }
      if (succeeded) {
        persistVideos(allItems);
      }
    } catch (error) {
      // ignore fetch errors
    } finally {
      fetchInFlight = false;
    }
  };

  const startPolling = () => {
    if (pollTimer) return;
    fetchAllFavorites();
    pollTimer = setInterval(fetchAllFavorites, POLL_INTERVAL_MS);
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const deletePost = async (postId) => {
    if (!postId) return { ok: false, status: 0 };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await fetch(DELETE_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          credentials: "include",
          body: JSON.stringify({ id: postId })
        });
        if (response.status === 429) {
          await sleep(600 * (attempt + 1));
          continue;
        }
        return { ok: response.ok, status: response.status };
      } catch (error) {
        await sleep(400);
      }
    }
    return { ok: false, status: 429 };
  };

  const deletePostsSequential = async (postIds) => {
    const unique = Array.from(new Set((postIds || []).filter(Boolean)));
    const deleted = [];
    const failed = [];
    for (let i = 0; i < unique.length; i += 1) {
      const postId = unique[i];
      const result = await deletePost(postId);
      if (result && result.ok) {
        deleted.push(postId);
      } else {
        failed.push(postId);
      }
      await sleep(180);
    }
    return { deleted, failed };
  };

  const createFloatingButton = () => {
    if (document.getElementById(BUTTON_ID)) return;
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.title = "Open grok-viewer";
    button.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      z-index: 99999;
      padding: 0;
    `;

    const img = document.createElement("img");
    img.src = chrome.runtime.getURL("images/logo.svg");
    img.alt = "grok-viewer";
    img.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: scale-down;
      padding: 6px;
    `;

    button.appendChild(img);

    button.addEventListener("mouseenter", () => {
      button.style.transform = "scale(1.08)";
      button.style.borderColor = "rgba(255, 255, 255, 0.4)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.transform = "scale(1)";
      button.style.borderColor = "rgba(255, 255, 255, 0.2)";
    });

    button.addEventListener("click", () => {
      try {
        if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: "openViewerWindow" }, () => {});
        }
      } catch (error) {
        // ignore messaging failures
      }
      fetchAllFavorites();
    });

    document.body.appendChild(button);
  };

  const ensureFloatingButton = () => {
    if (!document.body) return;
    if (!document.getElementById(BUTTON_ID)) {
      createFloatingButton();
    }
  };

  const observeButton = () => {
    const observer = new MutationObserver(() => {
      ensureFloatingButton();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === "grokViewerRefresh") {
      fetchAllFavorites().finally(() => {
        sendResponse({ ok: true });
      });
      return true;
    }
    if (message && message.action === "grokViewerDeleteOne") {
      if (deleteInFlight) {
        sendResponse({ ok: false, reason: "busy" });
        return true;
      }
      deleteInFlight = true;
      deletePost(message.postId)
        .then((result) => {
          if (result && result.ok) {
            return fetchAllFavorites().then(() => result);
          }
          return result;
        })
        .then((result) => {
          sendResponse({
            ok: Boolean(result && result.ok),
            status: result && result.status
          });
        })
        .finally(() => {
          deleteInFlight = false;
        });
      return true;
    }
    if (message && message.action === "grokViewerDeleteAll") {
      if (deleteInFlight) {
        sendResponse({ ok: false, reason: "busy" });
        return true;
      }
      deleteInFlight = true;
      const postIds = Array.isArray(message.postIds) ? message.postIds : [];
      deletePostsSequential(postIds)
        .then((result) => fetchAllFavorites().then(() => result))
        .then((result) => {
          sendResponse({
            ok: true,
            deleted: result.deleted,
            failed: result.failed
          });
        })
        .finally(() => {
          deleteInFlight = false;
        });
      return true;
    }
    return false;
  });

  const init = () => {
    createFloatingButton();
    observeButton();
    startPolling();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
