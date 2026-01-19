chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-to-holy",
    title: chrome.i18n.getMessage("addToHoly"),
    contexts: ["page", "link", "frame"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "add-to-holy") {
    let url = info.linkUrl || info.frameUrl || tab?.url;
    let title = tab?.title || "No title";


    if (!url || !url.startsWith('http')) {
      return;
    }

    // Save data for adding
    await chrome.storage.session.set({
      pendingBookmarkAdd: {
        url: url,
        title: title.slice(0, 200)
      }
    });

    // Open popup
    if (chrome.action.openPopup) {
      chrome.action.openPopup();
    }
  }
});