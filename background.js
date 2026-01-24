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


    await chrome.storage.session.set({
      pendingBookmarkAdd: {
        url: url,
        title: title.slice(0, 200)
      }
    });


    if (chrome.action.openPopup) {
      chrome.action.openPopup();
    }
  }
});


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'reloadmanager') {

    chrome.tabs.query({ url: chrome.runtime.getURL('manager.html') }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.reload(tab.id);
      });
    });
  }
});


chrome.runtime.onInstalled.addListener((details) => {

  const uninstallURL = 'https://docs.google.com/forms/d/e/1FAIpQLSeC7QN0uyKRdEw5MXko2_RLE1y8oQxgkZShqNQOjnVr3FKpnA/viewform?usp=publish-editor';
  chrome.runtime.setUninstallURL(uninstallURL);
});