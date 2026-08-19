const SUBSCRIPTIONS_URL_PREFIX = "https://www.youtube.com/feed/subscriptions";
const NOTION_VERSION = "2022-06-28";
const NOTION_API_BASE = "https://api.notion.com/v1";

chrome.action.onClicked.addListener(() => {
  run().catch((err) => {
    console.error(err);
    chrome.action.setBadgeText({ text: "" });
    notify("エラーが発生しました", String((err && err.message) || err));
  });
});

async function run() {
  const settings = await chrome.storage.local.get([
    "notionToken",
    "notionPageUrl",
    "textChannelNames",
    "closeTabsAfter",
    "includeNonYoutubeTabs",
    "pasteUnmatchedAsBookmark",
  ]);

  if (!settings.notionToken || !settings.notionPageUrl) {
    notify("設定が未完了です", "オプション画面でNotionトークンとページURLを設定してください。");
    chrome.runtime.openOptionsPage();
    return;
  }

  const pageId = extractPageId(settings.notionPageUrl);
  if (!pageId) {
    notify("ページURLが不正です", "NotionページのURLを確認してください。");
    return;
  }

  const channelNames = (settings.textChannelNames || "")
    .split("\n")
    .map((s) => s.normalize("NFKC").trim())
    .filter(Boolean)
    .map((s) => s.toLowerCase());

  const closeTabsAfter = settings.closeTabsAfter !== false;
  const includeNonYoutubeTabs = settings.includeNonYoutubeTabs !== false;
  const pasteUnmatchedAsBookmark = settings.pasteUnmatchedAsBookmark !== false;

  chrome.action.setBadgeText({ text: "..." });
  chrome.action.setBadgeBackgroundColor({ color: "#2e7dff" });

  const tabs = await chrome.tabs.query({ currentWindow: true });
  tabs.sort((a, b) => a.index - b.index);

  const originIndex = tabs.findIndex((t) => (t.url || "").startsWith(SUBSCRIPTIONS_URL_PREFIX));
  if (originIndex === -1) {
    chrome.action.setBadgeText({ text: "" });
    notify("起点タブが見つかりません", "YouTubeの登録チャンネル一覧タブを開いてから実行してください。");
    return;
  }

  const candidateTabs = tabs
    .slice(originIndex + 1)
    .filter((t) => t.url && /^https?:\/\//.test(t.url));

  const targetTabs = includeNonYoutubeTabs
    ? candidateTabs
    : candidateTabs.filter((t) => isYoutubeUrl(t.url));

  if (targetTabs.length === 0) {
    chrome.action.setBadgeText({ text: "" });
    notify("対象タブがありません", "起点タブより右に処理対象のタブがありませんでした。");
    return;
  }

  const classifications = await Promise.all(
    targetTabs.map(async (tab) => {
      let channelName = "";
      if (isYoutubeUrl(tab.url)) {
        const info = await getYoutubeOEmbed(tab.url);
        channelName = (info.author_name || "").normalize("NFKC").trim().toLowerCase();
      }
      const isTextMatch = Boolean(
        channelName && channelNames.some((name) => channelName.includes(name))
      );
      return { tab, isTextMatch };
    })
  );

  const textUrls = [];
  const bookmarkUrls = [];
  const handledTabIds = [];
  let unmatchedSkippedCount = 0;
  for (const { tab, isTextMatch } of classifications) {
    if (isTextMatch) {
      textUrls.push(tab.url);
      handledTabIds.push(tab.id);
    } else if (pasteUnmatchedAsBookmark) {
      bookmarkUrls.push(tab.url);
      handledTabIds.push(tab.id);
    } else {
      unmatchedSkippedCount++;
    }
  }

  await appendToNotion({
    token: settings.notionToken,
    pageId,
    textUrls,
    bookmarkUrls,
  });

  if (closeTabsAfter && handledTabIds.length > 0) {
    await chrome.tabs.remove(handledTabIds);
  }

  chrome.action.setBadgeText({ text: "OK" });
  chrome.action.setBadgeBackgroundColor({ color: "#22a55e" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);

  const skippedCount = candidateTabs.length - targetTabs.length;
  const notes = [];
  if (skippedCount > 0) notes.push(`対象外(非YouTube)で無視: ${skippedCount}件`);
  if (unmatchedSkippedCount > 0) notes.push(`未指定チャンネルで無視: ${unmatchedSkippedCount}件`);
  const skippedNote = notes.length > 0 ? ` / ${notes.join(" / ")}` : "";
  notify(
    "Notionに貼り付けました",
    `テキスト: ${textUrls.length}件 / ブックマーク: ${bookmarkUrls.length}件${skippedNote}`
  );
}

function isYoutubeUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "youtube.com" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

// YouTubeのタブタイトルには通常チャンネル名が含まれない（「動画タイトル - YouTube」形式）ため、
// タイトル解析ではなくYouTubeのoEmbed公開APIからチャンネル名（author_name）と動画タイトル（title）を取得する。
async function getYoutubeOEmbed(url) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

function extractPageId(urlOrId) {
  const match = urlOrId.replace(/-/g, "").match(/[0-9a-fA-F]{32}/);
  if (!match) return null;
  const hex = match[0];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function notionRequest(token, path, options = {}) {
  const res = await fetch(`${NOTION_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Notion API エラー (${res.status}): ${body}`);
  }
  return res.json();
}

async function getAllChildren(token, blockId) {
  const results = [];
  let cursor = undefined;
  do {
    const qs = cursor ? `?start_cursor=${encodeURIComponent(cursor)}&page_size=100` : "?page_size=100";
    const data = await notionRequest(token, `/blocks/${blockId}/children${qs}`);
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

function toRichText(text) {
  const max = 1900;
  const chunks = [];
  for (let i = 0; i < text.length; i += max) {
    chunks.push({ type: "text", text: { content: text.slice(i, i + max) } });
  }
  if (chunks.length === 0) chunks.push({ type: "text", text: { content: "" } });
  return chunks;
}

const MIN_BLANK_LINES = 3;

function buildUpdatedCodeContent(originalText, newUrls) {
  if (newUrls.length === 0) return originalText;
  const lines = originalText.split("\n");
  let lastUrlLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^https?:\/\//.test(lines[i].trim())) {
      lastUrlLineIndex = i;
    }
  }
  let insertAt;
  if (lastUrlLineIndex === -1) {
    let sepIndex = lines.findIndex((l) => /^ー{5,}$/.test(l.trim()));
    insertAt = sepIndex === -1 ? lines.length : sepIndex;
  } else {
    insertAt = lastUrlLineIndex + 1;
  }
  lines.splice(insertAt, 0, ...newUrls);

  // 新しく一番下になったURLの下に、最低でも3行の空行を確保する
  const newLastUrlIndex = insertAt + newUrls.length - 1;
  let blankCount = 0;
  for (let i = newLastUrlIndex + 1; i < lines.length && lines[i].trim() === ""; i++) {
    blankCount++;
  }
  if (blankCount < MIN_BLANK_LINES) {
    const padding = new Array(MIN_BLANK_LINES - blankCount).fill("");
    lines.splice(newLastUrlIndex + 1, 0, ...padding);
  }

  return lines.join("\n");
}

// afterId未指定なら常にページ末尾に追記（既存ブックマークが無い場合）。
// afterId指定時は、そのブロックの直後に挿入し、複数バッチに分かれる場合は
// 直前バッチの最後に挿入されたブロックを次のanchorとして使う（順序維持のため）。
async function chunkedInsertChildren(token, pageId, children, afterId) {
  const max = 100;
  let anchor = afterId;
  for (let i = 0; i < children.length; i += max) {
    const batch = children.slice(i, i + max);
    const body = { children: batch };
    if (anchor) body.after = anchor;
    const data = await notionRequest(token, `/blocks/${pageId}/children`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (afterId) {
      anchor = data.results[data.results.length - 1].id;
    }
  }
}

async function appendToNotion({ token, pageId, textUrls, bookmarkUrls }) {
  let children = null;
  if (textUrls.length > 0 || bookmarkUrls.length > 0) {
    children = await getAllChildren(token, pageId);
  }

  if (textUrls.length > 0) {
    const codeBlock = children.find((b) => b.type === "code");
    if (!codeBlock) {
      throw new Error("Notionページ内にテキスト貼り付け用のコードブロックが見つかりませんでした。");
    }
    const originalText = codeBlock.code.rich_text.map((rt) => rt.plain_text).join("");
    const updatedText = buildUpdatedCodeContent(originalText, textUrls);
    await notionRequest(token, `/blocks/${codeBlock.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        code: {
          rich_text: toRichText(updatedText),
          language: codeBlock.code.language || "plain text",
        },
      }),
    });
  }

  if (bookmarkUrls.length > 0) {
    // 既存の一番上のブックマークの直前に挿入。既存ブックマークが無ければページ末尾に追加。
    const firstBookmarkIndex = children.findIndex((b) => b.type === "bookmark");
    let anchorId;
    if (firstBookmarkIndex > 0) {
      anchorId = children[firstBookmarkIndex - 1].id;
    } else if (firstBookmarkIndex === 0) {
      throw new Error(
        "一番上のブックマークの直前に挿入するための基準ブロックが見つかりませんでした（ページ構成を確認してください）。"
      );
    }
    // 右のタブが上、左のタブが下になるよう順序を反転する
    const orderedUrls = [...bookmarkUrls].reverse();
    const bookmarkChildren = orderedUrls.map((url) => ({
      type: "bookmark",
      bookmark: { url },
    }));
    await chunkedInsertChildren(token, pageId, bookmarkChildren, anchorId);
  }
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
  });
}
