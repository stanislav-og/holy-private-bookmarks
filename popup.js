const STORAGE_KEY = 'holyPrivateData';
let masterKey = null;
let currentPassword = null;
let data = { folders: [] };
let autoLockTimer;
let pendingBookmark = null;
let editingBookmarkPath = null;

// Drag & Drop
let draggedItem = null;
let dragOverItem = null;
let dragPath = null;
let isDragging = false;

// Context menu variables
let contextMenu = null;
let clipboardItem = null;

// DOM element cache
let domCache = {};

const messageCache = new Map();

// Localization functions
function getMessage(key, substitutions = []) {
  if (messageCache.has(key)) {
    return messageCache.get(key);
  }
  
  const message = chrome.i18n.getMessage(key, substitutions);
  if (message) {
    messageCache.set(key, message);
  }
  return message || key;
}

function getEmptyTreeMessages() {
  return {
    title: getMessage('emptyTreeTitle') || 'No bookmarks yet',
    subtitle: getMessage('emptyTreeSubtitle') || 'Add your first bookmark or folder to get started',
    addBookmark: getMessage('addBookmark') || 'Add Bookmark',
    newFolder: getMessage('newFolder') || 'New Folder'
  };
}

function getOrCreateElement(selector) {
  if (!domCache[selector]) {
    domCache[selector] = document.querySelector(selector);
  }
  return domCache[selector];
}

function localizePage() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const text = getMessage(key);
    if (text) {
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        element.placeholder = text;
      } else {
        element.textContent = text;
      }
    }
  });
  
  // Localization of special elements
  const elements = {
    '#setup h1': 'extensionName',
    '#setup .subtitle': 'createPassword',
    '#new-pass': 'newPassword',
    '#confirm-pass': 'confirmPassword',
    '#create-pass': 'createStorage',
    '#login h1': 'extensionName',
    '#login .subtitle': 'enterMasterPassword',
    '#password': 'masterPassword',
    '#unlock': 'unlock',
    '#main h1': 'extensionName',
    '#main .subtitle': 'bookmarksProtected',
    '#add-currentdiv': 'addCurrentPage',
    '#add-folder': 'newFolder',
    '#clear-historydiv': 'clearHistory',
    '#support': 'supportProject',
    '#settings-btn': 'settingsbtn',
    '#settings h1': 'settings',
    '#settings .subtitle:nth-of-type(1)': 'changeMasterPassword',
    '#old-pass': 'currentPassword',
    '#new-pass2': 'newPassword2',
    '#confirm-pass2': 'confirmNewPassword',
    '#change-pass': 'changePassword',
    '#settings .subtitle:nth-of-type(2)': 'exportImport',
    '#export': 'export',
    '#import-btn': 'import',
    '#import-from-chrome': 'importChromeBookmarks',
    '#import-from-chrome-advanced': 'importChromeBookmarksAdvanced',
    '#settings .subtitle:nth-of-type(3)': 'importFromChrome',
    '#back': 'back',
    '#modal-cancel': 'cancel',
    '#modal-save': 'save',
    '#new-folder-in-modal': 'new',
    '#important-warning-text': 'importantWarning',
    '#cannot-recover-text': 'passwordCannotBeRecovered',
    '#no-reset-text': 'noPasswordReset',
    '#dont-store-text': 'weDontStorePassword',
    '#encrypted-only-text': 'bookmarksEncrypted',
    '#save-password-text': 'savePasswordSecurely',
    '.quick-action-btn-small[title*="Copy"]': 'copyUrl',
    '.quick-action-btn-small[title*="Edit"]': 'edit',
    '.quick-action-btn-small.delete[title*="Delete"]': 'delete'
  };
  
  for (const selector in elements) {
    const element = getOrCreateElement(selector);
    const key = elements[selector];
    if (element) {
      const text = getMessage(key);
      if (text) {
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
          element.placeholder = text;
        } else if (element.tagName === 'BUTTON') {
          
          const emojiMatch = element.textContent.match(/^[^\w\s]*/);
          if (emojiMatch && !text.startsWith(emojiMatch[0])) {
            element.textContent = emojiMatch[0] + ' ' + text;
          } else {
            element.textContent = text;
          }
        } else {
          element.textContent = text;
        }
      }
    }
  }
  
  // Localization of the modal window
  const modalTitle = getOrCreateElement('#add-bookmark-modal h2');
  if (modalTitle && modalTitle.id !== 'modal-title-text') {
    modalTitle.id = 'modal-title-text';
  }
  
  const modalLabels = document.querySelectorAll('#add-bookmark-modal label');
  if (modalLabels.length >= 3) {
    modalLabels[0].setAttribute('data-i18n', 'title');
    modalLabels[1].setAttribute('data-i18n', 'url');
    modalLabels[2].setAttribute('data-i18n', 'folder');
  }
  
  const pageLabel = getOrCreateElement('#add-bookmark-modal p strong');
  if (pageLabel) {
    pageLabel.setAttribute('data-i18n', 'page');
  }
  
  // Localization of buttons in empty state
  setTimeout(() => {
    const addBookmarkBtn = getOrCreateElement('#empty-add-bookmark');
    const addFolderBtn = getOrCreateElement('#empty-add-folder');
    
    if (addBookmarkBtn) {
      const text = getMessage('addBookmark') || 'Add Bookmark';
      addBookmarkBtn.textContent = '📌 ' + text;
    }
    
    if (addFolderBtn) {
      const text = getMessage('newFolder') || 'New Folder';
      addFolderBtn.textContent = '📁 ' + text;
    }
  }, 100);
}

// Function for getting favicon
async function getFaviconUrl(url) {
  try {
    const urlObj = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
  } catch {
    return null;
  }
}

// Function to extract domain from URL
function getDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return '';
  }
}

// Initialize the context menu
function initContextMenu() {
  contextMenu = document.getElementById('context-menu');
  
  if (!contextMenu) {
    console.error('Context menu element not found!');
    return;
  }
  
// Localization of menu items
  const ctxItems = {
    'ctx-new-folder': 'ctxnewFolder',
    'ctx-new-bookmark': 'newBookmark',
    'ctx-paste': 'paste'
  };
  
  Object.entries(ctxItems).forEach(([id, key]) => {
    const item = document.getElementById(id);
    if (item) {
      const textSpan = item.querySelector('span:not(.icon)');
      if (textSpan) {
        textSpan.textContent = getMessage(key);
      }
    }
  });
  

  document.getElementById('ctx-new-folder').addEventListener('click', handleNewFolder);
  document.getElementById('ctx-new-bookmark').addEventListener('click', handleNewBookmark);
  document.getElementById('ctx-paste').addEventListener('click', handlePaste);
  

  document.addEventListener('contextmenu', function(e) {
    const mainSection = document.getElementById('main');
    if (!mainSection || mainSection.style.display !== 'block') {
      return;
    }
    
    const tree = document.getElementById('tree');
    const clickedOnTreeItem = e.target.closest('.tree-item');
    const clickedOnTree = tree && (tree === e.target || tree.contains(e.target));
    
    if (clickedOnTree || clickedOnTreeItem) {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY);
    } else {
      hideContextMenu();
    }
  });
  

  document.addEventListener('click', (e) => {
    if (contextMenu && contextMenu.style.display === 'block' && !contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });
  

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && contextMenu && contextMenu.style.display === 'block') {
      hideContextMenu();
    }
  });
}


function handleNewFolder() {
  hideContextMenu();
  addFolder();
}

function handleNewBookmark() {
  hideContextMenu();
  addEmptyBookmark();
}

function handlePaste() {
  hideContextMenu();
  pasteFromClipboard();
}


function showContextMenu(x, y) {
  if (!contextMenu) return;
  
  checkClipboard();
  
  contextMenu.style.display = 'block';
  

  const menuWidth = contextMenu.offsetWidth || 200;
  const menuHeight = contextMenu.offsetHeight || 150;
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  
  let finalX = Math.max(10, Math.min(x, windowWidth - menuWidth - 10));
  let finalY = Math.max(10, Math.min(y, windowHeight - menuHeight - 10));
  
  contextMenu.style.left = finalX + 'px';
  contextMenu.style.top = finalY + 'px';
  
  setTimeout(() => {
    contextMenu.style.opacity = '1';
  }, 10);
}


function hideContextMenu() {
  if (contextMenu) {
    contextMenu.style.display = 'none';
    contextMenu.style.opacity = '0';
  }
}


async function checkClipboard() {
  const pasteBtn = document.getElementById('ctx-paste');
  if (!pasteBtn) return;
  
  try {
    const text = await navigator.clipboard.readText();
    const trimmed = text.trim();
    
    if (trimmed) {
      const urlPattern = /^(https?:\/\/|www\.)/i;
      if (urlPattern.test(trimmed)) {
        pasteBtn.style.display = 'flex';
        clipboardItem = { type: 'url', text: trimmed };
        return;
      }
    }
    
    pasteBtn.style.display = 'none';
    clipboardItem = null;
  } catch (err) {
    console.log('Clipboard access denied or error:', err);
    pasteBtn.style.display = 'none';
    clipboardItem = null;
  }
}


function addEmptyBookmark() {
  openAddBookmarkModal('', 'https://');
}


function pasteFromClipboard() {
  if (clipboardItem && clipboardItem.type === 'url') {
    openAddBookmarkModal('', clipboardItem.text);
  } else {
    showNotification(getMessage('noUrlInClipboard') || 'No valid URL in clipboard', true);
  }
}


function initQuickActions() {

  const expandAllBtn = document.getElementById('expand-all-btn');
  const collapseAllBtn = document.getElementById('collapse-all-btn');
  
  if (expandAllBtn) {
    expandAllBtn.addEventListener('click', expandAllFolders);
  }
  
  if (collapseAllBtn) {
    collapseAllBtn.addEventListener('click', collapseAllFolders);
  }
}


function expandAllFolders() {
  document.querySelectorAll('.subitems.collapsed').forEach(sub => {
    sub.classList.remove('collapsed');
    const header = sub.previousElementSibling;
    if (header && header.classList.contains('item-header')) {
      header.querySelector('.arrow').textContent = '▼';
      header.parentElement.classList.add('open');
    }
  });
}


function collapseAllFolders() {
  document.querySelectorAll('.subitems:not(.collapsed)').forEach(sub => {
    sub.classList.add('collapsed');
    const header = sub.previousElementSibling;
    if (header && header.classList.contains('item-header')) {
      header.querySelector('.arrow').textContent = '▶';
      header.parentElement.classList.remove('open');
    }
  });
}


function copyBookmarkUrl(url) {
  navigator.clipboard.writeText(url).then(() => {
    showNotification(getMessage('urlCopied') || 'URL copied to clipboard');
  }).catch(err => {
    console.error('Failed to copy URL:', err);
    showNotification(getMessage('copyFailed') || 'Failed to copy URL', true);
  });
}

// Edit bookmark
function editBookmark(pathStr) {
  const path = pathStr.split(',').map(Number);
  const bookmark = getItemByPath(path);
  if (bookmark) {
    openAddBookmarkModal(bookmark.title, bookmark.url, path);
  } else {
    console.error('Bookmark not found at path:', pathStr);
  }
}

// Delete bookmark
function deleteBookmark(pathStr) {
  const path = pathStr.split(',').map(Number);
  removeItemByPath(path);
  saveAndRefresh();
}

async function init() {
  localizePage();
  initContextMenu();
  initQuickActions();
  
  const [stored, session] = await Promise.all([
    chrome.storage.local.get(STORAGE_KEY),
    chrome.storage.session.get('pendingBookmarkAdd')
  ]);
  
  if (session.pendingBookmarkAdd) {
    pendingBookmark = session.pendingBookmarkAdd;
    await chrome.storage.session.remove('pendingBookmarkAdd');
  }
  

  const handlers = {
    '#create-pass': createMasterPassword,
    '#unlock': unlock,
    '#lock': lock,
    '#add-current': addCurrentPage,
    '#export': exportData,
    '#import-btn': () => getOrCreateElement('#import-file').click(),
    '#import-from-chrome': importFromChromeBookmarks,
    '#import-from-chrome-advanced': importFromChromeBookmarksAdvanced,
    '#support-btn': () => chrome.tabs.create({ url: chrome.runtime.getURL('donate.html') }),
    '#settings-btn': () => showSection('settings'),
    '#back': () => showSection('main'),
    '#change-pass': changeMasterPassword,
    '#modal-cancel': () => getOrCreateElement('#add-bookmark-modal').style.display = 'none'
  };
  
  Object.entries(handlers).forEach(([selector, handler]) => {
    const element = getOrCreateElement(selector);
    if (element) {
      element.addEventListener('click', handler);
    }
  });
  
  getOrCreateElement('#import-file').addEventListener('change', importData);
  
  const clearHistoryBtn = getOrCreateElement('#clear-history');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', clearBookmarksHistoryByDomain);
  }
  
  const newFolderBtn = document.getElementById('new-folder-in-modal');
  if (newFolderBtn) {
    newFolderBtn.addEventListener('click', () => {
      const name = prompt(getMessage('folderName'));
      if (name && name.trim()) {
        const newFolder = { type: 'folder', name: name.trim(), children: [], dateAdded: Date.now() };
        data.folders.push(newFolder);
        saveAndRefresh().then(() => {
          const select = document.getElementById('folder-select');
          select.innerHTML = '';
          const rootOption = document.createElement('option');
          rootOption.value = '';
          rootOption.textContent = getMessage('rootFolder');
          select.appendChild(rootOption);
          buildFolderOptions(data.folders, select, '', 0);
          select.value = (data.folders.length - 1).toString();
        });
      }
    });
  }
  
  const modalSaveBtn = getOrCreateElement('#modal-save');
  if (modalSaveBtn) {
    modalSaveBtn.addEventListener('click', handleModalSave);
  }
  
  if (!stored[STORAGE_KEY]) {
    showSection('setup');
  } else {
    showSection('login');
  }
  // About modal handlers
const aboutBtn = document.getElementById('about-btn');
if (aboutBtn) {
    aboutBtn.addEventListener('click', () => {
        document.getElementById('about-modal').style.display = 'flex';
    });
}

const closeAboutBtn = document.getElementById('close-about');
if (closeAboutBtn) {
    closeAboutBtn.addEventListener('click', () => {
        document.getElementById('about-modal').style.display = 'none';
    });
}

const openGitHubBtn = document.getElementById('open-github');
if (openGitHubBtn) {
    openGitHubBtn.addEventListener('click', () => {
        chrome.tabs.create({ 
            url: 'https://github.com/OSV-IT-Studio/holy-private-bookmarks' 
        });
        document.getElementById('about-modal').style.display = 'none';
    });
}

// Close modal when clicking outside
document.getElementById('about-modal').addEventListener('click', (e) => {
    if (e.target.id === 'about-modal') {
        e.target.style.display = 'none';
    }
});
}

function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
  const section = document.getElementById(id);
  if (section) {
    section.style.display = 'block';
  }
  
  if (id === 'main') {
    renderTree();
    startAutoLock();
    
    if (pendingBookmark) {
      openAddBookmarkModal(pendingBookmark.title, pendingBookmark.url);
      pendingBookmark = null;
    }
  }
}

// Open a modal window for adding/editing a bookmark
function openAddBookmarkModal(pageTitle, pageUrl, editPath = null) {
  const modal = getOrCreateElement('#add-bookmark-modal');
  if (!modal) return;
  
  editingBookmarkPath = editPath;
  const isEdit = editPath !== null;
  
  const modalTitle = modal.querySelector('h2');
  modalTitle.textContent = getMessage(isEdit ? 'editBookmark' : 'addBookmark');
  
  document.getElementById('modal-page-title').textContent = 
    pageTitle.length > 60 ? pageTitle.slice(0, 60) + '...' : pageTitle;
  
  const titleInput = document.getElementById('modal-bookmark-title');
  const urlInput = document.getElementById('modal-bookmark-url');
  
  if (isEdit) {
    const bookmark = getItemByPath(editPath);
    if (bookmark) {
      titleInput.value = bookmark.title;
      urlInput.value = bookmark.url;
    }
  } else {
    titleInput.value = pageTitle;
    urlInput.value = pageUrl;
  }
  
  const select = document.getElementById('folder-select');
  select.innerHTML = '';
  const rootOption = document.createElement('option');
  rootOption.value = '';
  rootOption.textContent = getMessage('rootFolder');
  select.appendChild(rootOption);
  buildFolderOptions(data.folders, select, '', 0);
  
  if (isEdit) {
    const parentPath = editPath.slice(0, -1);
    if (parentPath.length > 0) {
      const parentPathStr = parentPath.join('/');
      select.value = parentPathStr;
    }
  }
  
  modal.style.display = 'flex';
}

// Save handler in modal window
function handleModalSave() {
  const modal = getOrCreateElement('#add-bookmark-modal');
  if (!modal) return;
  
  const titleInput = document.getElementById('modal-bookmark-title');
  const urlInput = document.getElementById('modal-bookmark-url');
  
  const title = titleInput.value.trim();
  const url = urlInput.value.trim();
  
  if (!title || !url) {
    showNotification(getMessage('titleRequired') || 'Title and URL are required', true);
    return;
  }
  
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    showNotification(getMessage('validUrl') || 'Please enter a valid URL starting with http:// or https://', true);
    return;
  }
  
  const pathStr = document.getElementById('folder-select').value;
  const newPath = pathStr ? pathStr.split('/').map(i => parseInt(i, 10)) : [];
  

  if (newPath.some(isNaN)) {
    showNotification(getMessage('invalidPath') || 'Invalid folder path', true);
    return;
  }
  
  if (editingBookmarkPath) {
    updateBookmark(editingBookmarkPath, title, url, newPath);
  } else {
    addNewBookmark(title, url, newPath);
  }
  
  saveAndRefresh().then(() => {
    modal.style.display = 'none';
    editingBookmarkPath = null;
  });
}


function updateBookmark(oldPath, title, url, newPath) {
  const oldParent = getParentByPath(oldPath.slice(0, -1));
  const oldPathIndex = oldPath[oldPath.length - 1];
  
  if (!oldParent || oldParent.length <= oldPathIndex) {
    console.error('Invalid old path for update:', oldPath);
    return;
  }
  

  const bookmark = oldParent[oldPathIndex];
  bookmark.title = title;
  bookmark.url = url;
  

  const oldPathStr = oldPath.slice(0, -1).join('/');
  const newPathStr = newPath.join('/');
  
  if (newPathStr !== oldPathStr) {

    oldParent.splice(oldPathIndex, 1);
    

    let newParent = getParentByPath(newPath);
    newParent.push(bookmark);
  }
}

// Add a new bookmark
function addNewBookmark(title, url, path) {
  let target = data.folders;
  for (const idx of path) {
    if (target[idx] && target[idx].type === 'folder' && target[idx].children) {
      target = target[idx].children;
    } else {
      console.error('Invalid path for adding bookmark:', path);
      return;
    }
  }
  target.push({ 
    type: 'bookmark', 
    title, 
    url,
    dateAdded: Date.now()
  });
}


function getParentByPath(path) {
  if (!path || path.length === 0) {
    return data.folders;
  }
  
  let current = data.folders;
  

  for (const idx of path) {
    if (current[idx] && current[idx].type === 'folder' && current[idx].children) {
      current = current[idx].children;
    } else {
      console.error('Invalid path or not a folder at index:', idx);
      return data.folders;
    }
  }
  
  return current;
}


function getItemByPath(path) {
  let current = data.folders;
  for (let i = 0; i < path.length; i++) {
    const idx = path[i];
    if (i === path.length - 1) {
      return current[idx];
    }
    if (current[idx] && current[idx].type === 'folder' && current[idx].children) {
      current = current[idx].children;
    } else {
      console.error('Invalid path at index:', i, 'path:', path);
      return null;
    }
  }
  return null;
}


function removeItemByPath(path) {
  if (path.length === 0) return;
  
  const parent = getParentByPath(path.slice(0, -1));
  const indexToRemove = path[path.length - 1];
  
  if (parent && parent[indexToRemove]) {
    parent.splice(indexToRemove, 1);
  } else {
    console.error('Cannot remove item at path:', path);
  }
}

async function unlock() {
  const pass = document.getElementById('password').value;
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const salt = new Uint8Array(stored[STORAGE_KEY].salt);
  
  try {
    masterKey = await deriveKey(pass, salt);
    const decrypted = await decrypt(stored[STORAGE_KEY].encrypted, masterKey);
    data = JSON.parse(decrypted);
    currentPassword = pass;
    
    showSection('main');
    
    if (pendingBookmark) {
      openAddBookmarkModal(pendingBookmark.title, pendingBookmark.url);
      pendingBookmark = null;
    }
  } catch (e) {
     showNotification(getMessage('wrongPassword') || 'Wrong password', true);
  }
}

async function addCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !tab.url.startsWith('http')) {
    showNotification(getMessage('cannotAddPage') || 'Cannot add this page', true);
    return;
  }
  openAddBookmarkModal(tab.title || 'No title', tab.url);
}

async function createMasterPassword() {
  const p1 = document.getElementById('new-pass').value;
  const p2 = document.getElementById('confirm-pass').value;
  
  if (p1 !== p2 || p1.length < 6) {
    showNotification(getMessage('passwordsMismatch') || 'Passwords do not match or too short', true);
    return;
  }
  
  const salt = crypto.getRandomValues(new Uint8Array(16));
  currentPassword = p1;
  masterKey = await deriveKey(p1, salt);
  data = { folders: [] };
  await saveEncrypted(salt);
  showSection('main');
}

async function changeMasterPassword() {
  const old = document.getElementById('old-pass').value;
  if (old !== currentPassword) {
    showNotification(getMessage('wrongPassword') || 'Wrong password', true);
    return;
  }
  
  const p1 = document.getElementById('new-pass2').value;
  const p2 = document.getElementById('confirm-pass2').value;
  
  if (p1 !== p2 || p1.length < 6) {
     showNotification(getMessage('passwordsMismatch') || 'Passwords do not match or too short', true);
    return;
  }
  
  const newSalt = crypto.getRandomValues(new Uint8Array(16));
  currentPassword = p1;
  masterKey = await deriveKey(p1, newSalt);
  await saveEncrypted(newSalt);
   showNotification(getMessage('passwordChanged') || 'Password changed successfully', false);
  setTimeout(() => showSection('main'), 1500);
}

async function saveEncrypted(salt) {
  const encrypted = await encrypt(JSON.stringify(data), masterKey);
  await chrome.storage.local.set({ 
    [STORAGE_KEY]: { 
      salt: Array.from(salt), 
      encrypted 
    } 
  });
}

function addFolder() {
  const name = prompt(getMessage('folderName'));
  if (name && name.trim()) {
    data.folders.push({ 
      type: 'folder', 
      name: name.trim(), 
      children: [],
      dateAdded: Date.now()
    });
    saveAndRefresh();
  }
}


function renderTree() {
  const tree = document.getElementById('tree');
  if (!tree) return;
  

  const hasContent = data.folders && data.folders.length > 0;
  
  if (!hasContent) {
    renderEmptyState(tree);
    return;
  }
  
  tree.innerHTML = '';
  const fragment = document.createDocumentFragment();
  renderItems(data.folders, fragment, []);
  tree.appendChild(fragment);
  
  addDragAndDropListeners();
  addEventListenersToTreeItems();
}


function renderEmptyState(container) {
  const messages = getEmptyTreeMessages();
  
  container.innerHTML = `
    <div class="empty-tree-message" style="text-align: center; padding: 40px 20px; color: var(--text-secondary); font-size: 16px; line-height: 1.5;">
      <div style="font-size: 48px; margin-bottom: 16px;"><img src="icons/no-bookmarks.png"></div>
      <h3 style="margin: 0 0 8px 0; color: var(--text-primary);">${messages.title}</h3>
      <p style="margin: 0 0 20px 0;">${messages.subtitle}</p>
      <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
        <button class="btn-secondary" id="empty-add-bookmark" style="font-size: 14px; padding: 8px 16px;">
          📌 ${messages.addBookmark}
        </button>
        <button class="btn-secondary" id="empty-add-folder" style="font-size: 14px; padding: 8px 16px;">
           ${messages.newFolder}
        </button>
      </div>
    </div>
  `;
  

  setTimeout(() => {
    const addBookmarkBtn = document.getElementById('empty-add-bookmark');
    const addFolderBtn = document.getElementById('empty-add-folder');
    
    if (addBookmarkBtn) {
      addBookmarkBtn.addEventListener('click', () => openAddBookmarkModal('New Bookmark', 'https://'));
    }
    
    if (addFolderBtn) {
      addFolderBtn.addEventListener('click', addFolder);
    }
  }, 0);
}


function renderItems(items, container, path = []) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const currentPath = [...path, i];
    
    if (item.type === 'bookmark') {
      const bookmarkElement = createBookmarkElement(item, currentPath);
      container.appendChild(bookmarkElement);
    } else if (item.type === 'folder') {
      const folderElement = createFolderElement(item, currentPath);
      container.appendChild(folderElement);
    }
  }
}


function createBookmarkElement(item, path) {
  const div = document.createElement('div');
  div.className = 'tree-item';
  div.dataset.path = path.join(',');
  
  const domain = getDomainFromUrl(item.url);
  

  const header = document.createElement('div');
  header.className = 'item-header';
  
  const titleDiv = document.createElement('div');
  titleDiv.className = 'item-title';
  

  const iconSpan = document.createElement('span');
  iconSpan.className = 'icon bookmark';
  iconSpan.textContent = '🔗';
  iconSpan.style.cssText = 'margin-right: 8px; font-size: 16px;';
  titleDiv.appendChild(iconSpan);
  

  const link = document.createElement('a');
  link.href = item.url;
  link.target = '_blank';
  link.title = item.url;
  link.textContent = item.title;
  link.style.cssText = 'color: var(--accent); text-decoration: none; transition: var(--transition); display: inline-block; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle;';
  link.addEventListener('mouseenter', () => {
    link.style.color = 'var(--accent-hover)';
    link.style.textDecoration = 'underline';
  });
  link.addEventListener('mouseleave', () => {
    link.style.color = 'var(--accent)';
    link.style.textDecoration = 'none';
  });
  titleDiv.appendChild(link);
  

  const domainSpan = document.createElement('span');
  domainSpan.className = 'item-domain';
  domainSpan.style.cssText = 'font-size: 11px; color: var(--text-secondary); margin-left: 8px; font-family: monospace; opacity: 0.7;';
  domainSpan.textContent = domain;
  titleDiv.appendChild(domainSpan);
  

  const quickActions = document.createElement('div');
  quickActions.className = 'quick-actions-hover';
  quickActions.style.cssText = 'position: absolute; right: 10px; top: 50%; transform: translateY(-50%); display: none; gap: 4px; background: var(--card-bg); backdrop-filter: blur(10px); border: 1px solid var(--card-border); border-radius: 8px; padding: 4px; z-index: 10;';
  

  const editBtn = document.createElement('button');
  editBtn.className = 'quick-action-btn-small';
  editBtn.title = getMessage('edit') || 'Edit';
  editBtn.style.cssText = 'width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; background: rgba(255, 255, 255, 0.1); border: none; color: var(--text-secondary); cursor: pointer; transition: all 0.2s ease;';
  editBtn.textContent = '✏️';
  editBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    editBookmark(path.join(','));
  });
  

  const copyBtn = document.createElement('button');
  copyBtn.className = 'quick-action-btn-small';
  copyBtn.title = getMessage('copyUrl') || 'Copy URL';
  copyBtn.style.cssText = 'width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; background: rgba(255, 255, 255, 0.1); border: none; color: var(--text-secondary); cursor: pointer; transition: all 0.2s ease;';
  copyBtn.textContent = '📋';
  copyBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    copyBookmarkUrl(item.url);
  });
  

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'quick-action-btn-small delete';
  deleteBtn.title = getMessage('delete') || 'Delete';
  deleteBtn.style.cssText = 'width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; background: rgba(255, 64, 96, 0.1); border: none; color: #ff7b9c; cursor: pointer; transition: all 0.2s ease;';
  deleteBtn.textContent = '✖';
  deleteBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (confirm(getMessage('deleteConfirm'))) {
      deleteBookmark(path.join(','));
    }
  });
  
  quickActions.appendChild(editBtn);
  quickActions.appendChild(copyBtn);
  quickActions.appendChild(deleteBtn);
  
  titleDiv.appendChild(quickActions);
  header.appendChild(titleDiv);
  div.appendChild(header);
  

  div.addEventListener('mouseenter', function() {
    quickActions.style.display = 'flex';
  });
  
  div.addEventListener('mouseleave', function() {
    quickActions.style.display = 'none';
  });
  

  loadFaviconAsync(item.url, iconSpan);
  
  return div;
}


async function loadFaviconAsync(url, iconElement) {
  try {
    const faviconUrl = await getFaviconUrl(url);
    if (faviconUrl) {
      const faviconImg = document.createElement('img');
      faviconImg.src = faviconUrl;
      faviconImg.style.cssText = 'width: 16px; height: 16px; margin-right: 8px; border-radius: 2px;';
      iconElement.parentNode.replaceChild(faviconImg, iconElement);
    }
  } catch (error) {
    console.log('Failed to load favicon:', error);
  }
}


function createFolderElement(item, path) {
  const div = document.createElement('div');
  div.className = 'tree-item';
  div.dataset.path = path.join(',');
  

  const itemCount = countItemsInFolder(item);
  
  div.innerHTML = `
    <div class="item-header folder">
      <div class="item-title">
        <span class="arrow">▶</span>
        <span class="icon folder-icon">📁</span>
        <span>${item.name}</span>
        <span class="folder-badge">${itemCount}</span>
      </div>
      <div class="actions">
        <button class="action-btn" data-action="rename" data-path="${path.join(',')}">✏️</button>
        <button class="action-btn delete" data-action="delete" data-path="${path.join(',')}">✖</button>
      </div>
    </div>
    <div class="subitems collapsed"></div>
  `;
  
  const sub = div.querySelector('.subitems');
  

  if (item.children && item.children.length > 0) {
    const fragment = document.createDocumentFragment();
    
    item.children.forEach((child, childIndex) => {
      const childPath = [...path, childIndex];
      
      if (child.type === 'bookmark') {
        const bookmarkElement = createBookmarkElement(child, childPath);
        fragment.appendChild(bookmarkElement);
      } else if (child.type === 'folder') {
        const folderElement = createFolderElement(child, childPath);
        fragment.appendChild(folderElement);
      }
    });
    
    sub.appendChild(fragment);
  }
  
  return div;
}


function countItemsInFolder(folder) {
  let count = 0;
  function countRecursive(items) {
    items.forEach(item => {
      if (item.type === 'bookmark') {
        count++;
      } else if (item.type === 'folder') {
        countRecursive(item.children);
      }
    });
  }
  if (folder.children) {
    countRecursive(folder.children);
  }
  return count;
}


function addEventListenersToTreeItems() {

  document.querySelectorAll('.item-header.folder').forEach(header => {
    header.addEventListener('click', function(e) {
      if (e.target.closest('.action-btn') || e.target.closest('.quick-action-btn-small')) return;
      e.stopPropagation();
      const sub = this.nextElementSibling;
      if (sub && sub.classList.contains('subitems')) {
        sub.classList.toggle('collapsed');
        const arrow = this.querySelector('.arrow');
        if (arrow) {
          arrow.textContent = sub.classList.contains('collapsed') ? '▶' : '▼';
        }
        this.parentElement.classList.toggle('open');
      }
    });
  });
  

  document.querySelectorAll('.action-btn[data-action="rename"]').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const path = this.dataset.path.split(',').map(Number);
      const targetItem = getItemByPath(path);
      
      if (!targetItem) {
        console.error('Item not found at path:', path);
        return;
      }
      
      const currentName = targetItem.type === 'folder' ? targetItem.name : targetItem.title;
      const promptMessage = getMessage('newName');
      const newName = prompt(promptMessage, currentName);
      
      if (newName && newName.trim()) {
        if (targetItem.type === 'folder') {
          targetItem.name = newName.trim();
        } else {
          targetItem.title = newName.trim();
        }
        saveAndRefresh();
      }
    });
  });
  
  document.querySelectorAll('.action-btn[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const path = this.dataset.path.split(',').map(Number);
      if (confirm(getMessage('deleteConfirm'))) {
        removeItemByPath(path);
        saveAndRefresh();
      }
    });
  });
}

// ============ DRAG & DROP SORTING ============
function addDragAndDropListeners() {
  const tree = document.getElementById('tree');
  if (!tree) return;
  
  const items = tree.querySelectorAll('.tree-item');
  items.forEach(item => {
    item.setAttribute('draggable', 'true');
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('dragenter', handleDragEnter);
    item.addEventListener('dragleave', handleDragLeave);
    item.addEventListener('drop', handleDrop);
    item.addEventListener('dragend', handleDragEnd);
  });
}


function handleDragStart(e) {
  if (!e.target.closest('.tree-item')) return;
  
  draggedItem = e.target.closest('.tree-item');
  dragPath = draggedItem.dataset.path ? draggedItem.dataset.path.split(',').map(Number) : null;
  
  isDragging = true;
  draggedItem.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedItem.dataset.path || '');
  
  setTimeout(() => {
    if (draggedItem) draggedItem.style.opacity = '0.4';
  }, 0);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(e) {
  if (!isDragging) return;
  
  const targetItem = e.target.closest('.tree-item');
  if (!targetItem || targetItem === draggedItem) return;
  
  dragOverItem = targetItem;
  const rect = targetItem.getBoundingClientRect();
  const isBefore = e.clientY < rect.top + rect.height / 2;
  
  targetItem.classList.remove('drop-above', 'drop-below');
  targetItem.classList.add(isBefore ? 'drop-above' : 'drop-below');
}

function handleDragLeave(e) {
  if (!dragOverItem) return;
  
  if (!e.relatedTarget || !dragOverItem.contains(e.relatedTarget)) {
    dragOverItem.classList.remove('drop-above', 'drop-below');
    dragOverItem = null;
  }
}

async function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  
  if (!draggedItem || !dragPath) return;
  
  const targetItem = e.target.closest('.tree-item');
  if (!targetItem || targetItem === draggedItem) {
    resetDragState();
    return;
  }
  
  const targetPath = targetItem.dataset.path ? targetItem.dataset.path.split(',').map(Number) : null;
  const rect = targetItem.getBoundingClientRect();
  const isBefore = e.clientY < rect.top + rect.height / 2;
  
  try {
    await moveItem(dragPath, targetPath, isBefore);
    await saveAndRefresh();
  } catch (error) {
    console.error('Error moving item:', error);
    showNotification(error.message || 'Cannot move item to this location', true);
  }
  
  resetDragState();
}

function handleDragEnd() {
  resetDragState();
}

function resetDragState() {
  if (draggedItem) {
    draggedItem.classList.remove('dragging');
    draggedItem.style.opacity = '';
  }
  
  if (dragOverItem) {
    dragOverItem.classList.remove('drop-above', 'drop-below');
  }
  
  draggedItem = null;
  dragOverItem = null;
  dragPath = null;
  isDragging = false;
}

async function moveItem(sourcePath, targetPath, insertBefore = true) {
  const sourceParent = getParentByPath(sourcePath.slice(0, -1));
  const sourceIndex = sourcePath[sourcePath.length - 1];
  const itemToMove = sourceParent[sourceIndex];
  
  let targetParent, targetIndex;
  
  if (targetPath) {
    targetParent = getParentByPath(targetPath.slice(0, -1));
    targetIndex = targetPath[targetPath.length - 1];
  } else {
    targetParent = data.folders;
    targetIndex = targetParent.length - 1;
  }
  

  if (itemToMove.type === 'folder' && targetPath) {
    let checkParent = targetParent;
    
    for (let i = 0; i < targetPath.length; i++) {
      const idx = targetPath[i];
      if (checkParent[idx] === itemToMove) {
        throw new Error('Cannot move a folder into itself or its subfolder');
      }
      if (checkParent[idx] && checkParent[idx].children) {
        checkParent = checkParent[idx].children;
      }
    }
  }
  
  if (targetParent === sourceParent) {
    const adjustedTargetIndex = insertBefore ? targetIndex : targetIndex + 1;
    
    sourceParent.splice(sourceIndex, 1);
    
    if (sourceIndex < adjustedTargetIndex) {
      targetParent.splice(adjustedTargetIndex - 1, 0, itemToMove);
    } else {
      targetParent.splice(adjustedTargetIndex, 0, itemToMove);
    }
  } else {
    sourceParent.splice(sourceIndex, 1);
    const insertIndex = insertBefore ? targetIndex : targetIndex + 1;
    targetParent.splice(insertIndex, 0, itemToMove);
  }
}

async function saveAndRefresh() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  await saveEncrypted(new Uint8Array(stored[STORAGE_KEY].salt));
  renderTree();
}

async function exportData() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const blob = new Blob([JSON.stringify(stored[STORAGE_KEY], null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'holy-private-backup.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    
    if (!json.salt || !json.encrypted) throw new Error('Invalid format');
    
    await chrome.storage.local.set({ [STORAGE_KEY]: json });
    showNotification(getMessage('importSuccess') || 'Import successful');
    
    // Перезагрузка страницы
    setTimeout(() => {
      lock();
      showSection('login');
    }, 500);
    
  } catch {
    showNotification(getMessage('invalidFile') || 'Invalid file format', true);
  }
  
  e.target.value = '';
}

// ============ IMPORT ALL BOOKMARKS FROM CHROME ============
async function importFromChromeBookmarks() {
  if (!confirm(getMessage('importChromeConfirm'))) {
    return;
  }

  try {
    const chromeBookmarks = await chrome.bookmarks.getTree();
    const importedFolders = convertChromeBookmarks(chromeBookmarks[0].children || []);
    
    data.folders.push(...importedFolders);
    await saveAndRefresh();
    
    showNotification(getMessage('importChromeSuccess') || 'Chrome bookmarks imported successfully');
  } catch (error) {
    console.error('Error importing Chrome bookmarks:', error);
    showNotification(getMessage('importChromeError') + ': ' + error.message, true);
  }
}

// ============ ADVANCED IMPORT WITH FOLDER SELECTION ============
async function importFromChromeBookmarksAdvanced() {
  try {
    const chromeBookmarks = await chrome.bookmarks.getTree();
    showChromeImportModal(chromeBookmarks[0].children || []);
  } catch (error) {
    console.error('Error fetching Chrome bookmarks:', error);
    showNotification(getMessage('importChromeError') + ': ' + error.message, true);
  }
}

// Modal window for selecting import folders
function showChromeImportModal(bookmarkNodes) {
  const modal = document.createElement('div');
  modal.id = 'chrome-import-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(16px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  `;
  
  const content = document.createElement('div');
  content.className = 'modal-content';
  content.style.cssText = `
    background: var(--card-bg);
    backdrop-filter: blur(20px);
    border: 1px solid var(--card-border);
    border-radius: var(--radius);
    padding: 28px;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
  `;
  
  content.innerHTML = `
    <h2 style="margin-top:0; color:var(--accent);">${getMessage('selectFoldersToImport') || 'Select folders to import'}</h2>
    <div id="folders-list" style="margin: 20px 0; max-height: 300px; overflow-y: auto;"></div>
    <div style="display: flex; gap: 8px; margin: 16px 0;">
      <button class="btn-secondary" id="select-all-folders">${getMessage('selectAll') || 'Select all'}</button>
      <button class="btn-secondary" id="deselect-all-folders">${getMessage('deselectAll') || 'Deselect all'}</button>
    </div>
    <div class="modal-buttons">
      <button class="btn-secondary" id="cancel-import">${getMessage('cancel')}</button>
      <button class="btn-primary" id="confirm-import">${getMessage('importSelected') || 'Import selected'}</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  const foldersList = content.querySelector('#folders-list');
  const selectedFolders = new Map();
  

  function renderFolders(nodes, parentId = '', depth = 0) {
    nodes.forEach((node, index) => {
      if (!node.url && node.children && node.children.length > 0) {
        const folderId = parentId ? `${parentId}-${index}` : `folder-${index}`;
        
        const folderDiv = document.createElement('div');
        folderDiv.style.cssText = `
          margin: 8px 0;
          padding: 12px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
          margin-left: ${depth * 20}px;
        `;
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = folderId;
        checkbox.checked = false;
        checkbox.style.marginRight = '10px';
        
        const label = document.createElement('label');
        label.htmlFor = folderId;
        label.textContent = (node.title || 'Unnamed Folder') + ` (${countBookmarksInFolder(node)} bookmarks)`;
        label.style.cssText = 'cursor: pointer; display: flex; align-items: center; font-weight: 500;';
        
        label.prepend(checkbox);
        folderDiv.appendChild(label);
        
        checkbox.addEventListener('change', (e) => {
          const isChecked = e.target.checked;
          
          if (isChecked) {
            selectedFolders.set(folderId, {
              node: node,
              childrenIds: getAllChildFolderIds(node, folderId, [])
            });
            
            const childIds = selectedFolders.get(folderId).childrenIds;
            childIds.forEach(childId => {
              selectedFolders.delete(childId);
              const childCheckbox = document.getElementById(childId);
              if (childCheckbox) {
                childCheckbox.checked = false;
                childCheckbox.disabled = true;
              }
            });
          } else {
            selectedFolders.delete(folderId);
            const childIds = getAllChildFolderIds(node, folderId, []);
            childIds.forEach(childId => {
              const childCheckbox = document.getElementById(childId);
              if (childCheckbox) {
                childCheckbox.disabled = false;
              }
            });
          }
        });
        
        foldersList.appendChild(folderDiv);
        
        if (node.children) {
          renderFolders(node.children, folderId, depth + 1);
        }
      }
    });
  }
  
  function getAllChildFolderIds(folderNode, parentId, result = []) {
    if (!folderNode.children) return result;
    
    folderNode.children.forEach((child, index) => {
      if (!child.url && child.children && child.children.length > 0) {
        const childId = `${parentId}-${index}`;
        result.push(childId);
        getAllChildFolderIds(child, childId, result);
      }
    });
    
    return result;
  }
  
  function countBookmarksInFolder(folderNode) {
    let count = 0;
    function countRecursive(node) {
      if (node.url) {
        count++;
      } else if (node.children) {
        node.children.forEach(child => countRecursive(child));
      }
    }
    if (folderNode.children) {
      folderNode.children.forEach(child => countRecursive(child));
    }
    return count;
  }
  
  renderFolders(bookmarkNodes);
  

  content.querySelector('#select-all-folders').addEventListener('click', () => {
    const checkboxes = foldersList.querySelectorAll('input[type="checkbox"]:not(:disabled)');
    checkboxes.forEach(checkbox => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
    });
  });
  
  content.querySelector('#deselect-all-folders').addEventListener('click', () => {
    const checkboxes = foldersList.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
      checkbox.checked = false;
      checkbox.disabled = false;
      checkbox.dispatchEvent(new Event('change'));
    });
    selectedFolders.clear();
  });
  
  content.querySelector('#cancel-import').addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  content.querySelector('#confirm-import').addEventListener('click', async () => {
    const importedData = [];
    
    selectedFolders.forEach((folderData) => {
      const folder = folderData.node;
      const converted = convertChromeBookmarksFull(folder.children || []);
      if (converted.length > 0) {
        importedData.push({
          type: 'folder',
          name: folder.title || 'Imported Folder',
          children: converted,
          dateAdded: Date.now()
        });
      }
    });
    
    data.folders.push(...importedData);
    await saveAndRefresh();
    
    document.body.removeChild(modal);
    showNotification(getMessage('importChromeSuccess') || 'Chrome bookmarks imported successfully');
  });
}

function convertChromeBookmarks(chromeNodes, depth = 0) {
  const result = [];
  
  for (const node of chromeNodes) {
    if (node.url) {
      result.push({
        type: 'bookmark',
        title: node.title || 'Untitled',
        url: node.url,
        dateAdded: Date.now()
      });
    } else if (node.children && node.children.length > 0) {
      const folder = {
        type: 'folder',
        name: node.title || 'Unnamed Folder',
        children: convertChromeBookmarks(node.children, depth + 1),
        dateAdded: Date.now()
      };
      
      if (folder.children.length > 0) {
        result.push(folder);
      }
    }
  }
  
  return result;
}

function convertChromeBookmarksFull(chromeNodes) {
  const result = [];
  
  for (const node of chromeNodes) {
    if (node.url) {
      result.push({
        type: 'bookmark',
        title: node.title || 'Untitled',
        url: node.url,
        dateAdded: Date.now()
      });
    } else if (node.children && node.children.length > 0) {
      const folder = {
        type: 'folder',
        name: node.title || 'Unnamed Folder',
        children: convertChromeBookmarksFull(node.children),
        dateAdded: Date.now()
      };
      
      if (folder.children.length > 0) {
        result.push(folder);
      }
    }
  }
  
  return result;
}

function buildFolderOptions(folders, select, prefix = '', depth = 0) {
  folders.forEach((folder, index) => {
    if (folder.type === 'folder') {
      const option = document.createElement('option');
      option.value = prefix ? `${prefix}/${index}` : index.toString();
      option.textContent = '— '.repeat(depth) + folder.name;
      select.appendChild(option);
      

      if (folder.children && folder.children.length > 0) {
        const newPrefix = prefix ? `${prefix}/${index}` : index.toString();
        buildFolderOptions(folder.children, select, newPrefix, depth + 1);
      }
    }
  });
}

function startAutoLock() {
  clearTimeout(autoLockTimer);
  autoLockTimer = setTimeout(lock, 10 * 60 * 1000);
}

function lock() {
  clearTimeout(autoLockTimer);
  masterKey = null;
  currentPassword = null;
  data = { folders: [] };
  pendingBookmark = null;
  showSection('login');
  document.getElementById('password').value = '';
}

async function clearBookmarksHistoryByDomain() {
  if (!confirm(getMessage('clearHistoryConfirm'))) {
    return;
  }


  const clearHistoryBtn = getOrCreateElement('#clear-history');
  if (!clearHistoryBtn) return;


  const buttonIcon = getOrCreateElement('#clear-historydiv');
  if (!buttonIcon) return;


  const originalContent = buttonIcon.innerHTML;
  

  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  

  buttonIcon.innerHTML = '';
  buttonIcon.appendChild(spinner);
  

  clearHistoryBtn.classList.add('loading');
  

  clearHistoryBtn.disabled = true;
  
  try {
    const allUrls = collectAllBookmarkUrls(data.folders);
    if (allUrls.length === 0) {
      showNotification(getMessage('noBookmarks') || 'No bookmarks found', true);
      return;
    }

    const domains = new Set();
    allUrls.forEach(urlStr => {
      try {
        const url = new URL(urlStr);
        domains.add(url.hostname);
      } catch (e) {
        console.warn('Invalid URL in bookmarks:', urlStr);
      }
    });

    if (domains.size === 0) {
      showNotification(getMessage('noDomains') || 'No domains found in bookmarks', true);
      return;
    }

    let totalDeleted = 0;
    let processedDomains = 0;


    const updateProgress = () => {
      spinner.title = `Processed ${processedDomains} of ${domains.size} domains`;
    };

    for (const domain of domains) {
      try {
        const results = await chrome.history.search({
          text: domain,
          startTime: 0,
          maxResults: 100000
        });

        for (const entry of results) {
          try {
            const entryUrl = new URL(entry.url);
            if (entryUrl.hostname === domain || entryUrl.hostname.endsWith('.' + domain)) {
              await chrome.history.deleteUrl({ url: entry.url });
              totalDeleted++;
            }
          } catch (e) {}
        }
        
        processedDomains++;
        updateProgress();
        

        await new Promise(resolve => setTimeout(resolve, 10));
        
      } catch (e) {
        console.error('Error searching history for domain:', domain, e);
        processedDomains++;
        updateProgress();
      }
    }


    showNotification(getMessage('historyCleared', [totalDeleted, domains.size]) || `Cleared ${totalDeleted} history entries from ${domains.size} domains`);
    
  } catch (error) {
    console.error('Error clearing history:', error);
    showNotification(getMessage('clearHistoryError') || 'An error occurred while clearing history', true);
    
  } finally {

    buttonIcon.innerHTML = originalContent;
    clearHistoryBtn.classList.remove('loading');
    clearHistoryBtn.disabled = false;
  }
}

function collectAllBookmarkUrls(items, urls = []) {
  for (const item of items) {
    if (item.type === 'bookmark' && item.url) {
      urls.push(item.url);
    } else if (item.type === 'folder' && item.children) {
      collectAllBookmarkUrls(item.children, urls);
    }
  }
  return urls;
}

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(text, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
}

async function decrypt(obj, key) {
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(obj.iv) }, key, new Uint8Array(obj.data));
  return new TextDecoder().decode(decrypted);
}


function showNotification(message, isError = false) {

  const oldNotifications = document.querySelectorAll('.notification');
  oldNotifications.forEach(notification => notification.remove());
  

  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  

  if (isError) {
    notification.style.background = 'rgba(255, 64, 96, 0.9)';
  }
  
  document.body.appendChild(notification);
  

  setTimeout(function() {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 2000);
}


function showError(id, msgKey, substitutions = [], isError = true) {
  const message = getMessage(msgKey, substitutions);
  showNotification(message, isError);
}


document.addEventListener('DOMContentLoaded', init);
