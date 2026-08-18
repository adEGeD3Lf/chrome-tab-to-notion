const fields = {
  notionToken: document.getElementById("notionToken"),
  notionPageUrl: document.getElementById("notionPageUrl"),
  textChannelNames: document.getElementById("textChannelNames"),
  closeTabsAfter: document.getElementById("closeTabsAfter"),
  includeNonYoutubeTabs: document.getElementById("includeNonYoutubeTabs"),
};
const statusEl = document.getElementById("status");

async function load() {
  const settings = await chrome.storage.local.get([
    "notionToken",
    "notionPageUrl",
    "textChannelNames",
    "closeTabsAfter",
    "includeNonYoutubeTabs",
  ]);
  fields.notionToken.value = settings.notionToken || "";
  fields.notionPageUrl.value = settings.notionPageUrl || "";
  fields.textChannelNames.value = settings.textChannelNames || "";
  fields.closeTabsAfter.checked = settings.closeTabsAfter !== false;
  fields.includeNonYoutubeTabs.checked = settings.includeNonYoutubeTabs !== false;
}

async function save() {
  await chrome.storage.local.set({
    notionToken: fields.notionToken.value.trim(),
    notionPageUrl: fields.notionPageUrl.value.trim(),
    textChannelNames: fields.textChannelNames.value,
    closeTabsAfter: fields.closeTabsAfter.checked,
    includeNonYoutubeTabs: fields.includeNonYoutubeTabs.checked,
  });
  statusEl.textContent = "保存しました";
  setTimeout(() => (statusEl.textContent = ""), 2000);
}

document.getElementById("save").addEventListener("click", save);
load();
