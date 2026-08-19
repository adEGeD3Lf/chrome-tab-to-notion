const fields = {
  notionToken: document.getElementById("notionToken"),
  notionPageUrl: document.getElementById("notionPageUrl"),
  textChannelNames: document.getElementById("textChannelNames"),
  closeTabsAfterText: document.getElementById("closeTabsAfterText"),
  pasteUnmatchedAsBookmark: document.getElementById("pasteUnmatchedAsBookmark"),
  includeNonYoutubeTabs: document.getElementById("includeNonYoutubeTabs"),
  closeTabsAfterBookmark: document.getElementById("closeTabsAfterBookmark"),
};
const statusEl = document.getElementById("status");

async function load() {
  const settings = await chrome.storage.local.get([
    "notionToken",
    "notionPageUrl",
    "textChannelNames",
    "closeTabsAfterText",
    "pasteUnmatchedAsBookmark",
    "includeNonYoutubeTabs",
    "closeTabsAfterBookmark",
  ]);
  fields.notionToken.value = settings.notionToken || "";
  fields.notionPageUrl.value = settings.notionPageUrl || "";
  fields.textChannelNames.value = settings.textChannelNames || "";
  fields.closeTabsAfterText.checked = settings.closeTabsAfterText !== false;
  fields.pasteUnmatchedAsBookmark.checked = settings.pasteUnmatchedAsBookmark !== false;
  fields.includeNonYoutubeTabs.checked = settings.includeNonYoutubeTabs !== false;
  fields.closeTabsAfterBookmark.checked = settings.closeTabsAfterBookmark !== false;
}

async function save() {
  await chrome.storage.local.set({
    notionToken: fields.notionToken.value.trim(),
    notionPageUrl: fields.notionPageUrl.value.trim(),
    textChannelNames: fields.textChannelNames.value,
    closeTabsAfterText: fields.closeTabsAfterText.checked,
    pasteUnmatchedAsBookmark: fields.pasteUnmatchedAsBookmark.checked,
    includeNonYoutubeTabs: fields.includeNonYoutubeTabs.checked,
    closeTabsAfterBookmark: fields.closeTabsAfterBookmark.checked,
  });
  statusEl.textContent = "保存しました";
  setTimeout(() => (statusEl.textContent = ""), 2000);
}

document.getElementById("save").addEventListener("click", save);
load();
