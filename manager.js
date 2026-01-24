const STORAGE_KEY = 'holyPrivateData';
let masterKey = null;
let currentPassword = null;
let data = { folders: [] };
let currentFolderId = 'all';
let searchQuery = '';
let editingBookmark = null;
let editingBookmarkPath = null;

let inactivityTimer;
const INACTIVITY_TIMEOUT = 10 * 60 * 1000; 
let isLocked = false;

const messageCache = new Map();

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
}

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  
  if (!isLocked && masterKey) {
    inactivityTimer = setTimeout(lockManager, INACTIVITY_TIMEOUT);
  }
}

async function lockManager() {
  if (isLocked || !masterKey) return;
  
  isLocked = true;
  
  masterKey = null;
  currentPassword = null;
  data = { folders: [] };
  
  document.getElementById('lock-screen').style.display = 'flex';
  document.querySelector('.container').style.display = 'none';
  
  const passwordInput = document.getElementById('password-input');
  if (passwordInput) {
    passwordInput.value = '';
  }
  
  const lockDescription = document.querySelector('.lock-description');
  if (lockDescription) {
    lockDescription.textContent = getMessage('managerLocked') || 'Manager locked';
  }
  
  showNotification(getMessage('managerLocked') || 'Manager locked', false);
}

function manualLock() {
  lockManager();
}

function initActivityTracking() {
  document.addEventListener('mousemove', resetInactivityTimer);
  document.addEventListener('mousedown', resetInactivityTimer);
  document.addEventListener('click', resetInactivityTimer);
  document.addEventListener('scroll', resetInactivityTimer);
  
  document.addEventListener('keydown', resetInactivityTimer);
  document.addEventListener('keypress', resetInactivityTimer);
  document.addEventListener('keyup', resetInactivityTimer);
  
  document.addEventListener('input', resetInactivityTimer);
  document.addEventListener('change', resetInactivityTimer);
  
  window.addEventListener('focus', resetInactivityTimer);
  document.addEventListener('focusin', resetInactivityTimer);
  
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      resetInactivityTimer();
    }
  });
}

function initLockButton() {
  const lockBtn = document.getElementById('manual-lock-btn');
  if (lockBtn) {
    lockBtn.addEventListener('click', manualLock);
  }
}

async function getFaviconUrl(url) {
  try {
    const urlObj = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
  } catch {
    return null;
  }
}

function getDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return '';
  }
}

async function unlock() {
  const password = document.getElementById('password-input').value;
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  
  if (!stored[STORAGE_KEY]) {
    showError('No data found. Please set up the extension first.', true);
    return;
  }
  
  const salt = new Uint8Array(stored[STORAGE_KEY].salt);
  
  try {
    masterKey = await deriveKey(password, salt);
    const decrypted = await decrypt(stored[STORAGE_KEY].encrypted, masterKey);
    data = JSON.parse(decrypted);
    currentPassword = password;
    
    isLocked = false;
    
    document.getElementById('lock-screen').style.display = 'none';
    document.querySelector('.container').style.display = 'flex';
    
    const lockDescription = document.querySelector('.lock-description');
    if (lockDescription) {
      lockDescription.textContent = getMessage('enterMasterPassword') || 'Enter your master password to access bookmarks';
    }
    
    resetInactivityTimer();
    
    renderFolderTree();
    renderBookmarks();
  } catch (e) {
    showError(getMessage('wrongPassword') || 'Wrong password', true);
  }
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

async function decrypt(obj, key) {
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(obj.iv) }, key, new Uint8Array(obj.data));
  return new TextDecoder().decode(decrypted);
}

async function encrypt(text, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
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

function findItemPath(bookmark, items = data.folders, currentPath = []) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const path = [...currentPath, i];
    
    if (item === bookmark) {
      return path;
    }
    
    if (item.type === 'folder' && item.children) {
      const found = findItemPath(bookmark, item.children, path);
      if (found) return found;
    }
  }
  return null;
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
  
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 2000);
}

function showError(message, isError = true) {
  const errorElement = document.getElementById('error-message');
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = 'block';
  }
  showNotification(message, isError);
}

function clearError() {
  const errorElement = document.getElementById('error-message');
  if (errorElement) {
    errorElement.textContent = '';
    errorElement.style.display = 'none';
  }
}

function countAllBookmarks() {
  let count = 0;
  
  function countRecursive(items) {
    items.forEach(item => {
      if (item.type === 'bookmark') {
        count++;
      } else if (item.type === 'folder' && item.children) {
        countRecursive(item.children);
      }
    });
  }
  
  countRecursive(data.folders);
  return count;
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

function countBookmarksInFolder(folderId) {
  if (folderId === 'all') {
    return countAllBookmarks();
  }
  
  const folder = findFolderById(data.folders, folderId);
  if (!folder) return 0;
  
  let count = 0;
  
  function countRecursive(items) {
    items.forEach(item => {
      if (item.type === 'bookmark') {
        count++;
      } else if (item.type === 'folder' && item.children) {
        countRecursive(item.children);
      }
    });
  }
  
  countRecursive(folder.children || []);
  return count;
}

function findFolderById(items, folderId, path = []) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    
    if (item.type === 'folder') {
      const currentPath = [...path, i];
      const currentId = currentPath.join(',');
      
      if (currentId === folderId) {
        return item;
      }
      
      if (item.children && item.children.length > 0) {
        const found = findFolderById(item.children, folderId, currentPath);
        if (found) return found;
      }
    }
  }
  return null;
}

function getBookmarksForFolder(folderId) {
  const bookmarks = [];
  
  if (folderId === 'all') {
    function collectAllBookmarks(items) {
      items.forEach(item => {
        if (item.type === 'bookmark') {
          bookmarks.push(item);
        } else if (item.type === 'folder' && item.children) {
          collectAllBookmarks(item.children);
        }
      });
    }
    collectAllBookmarks(data.folders);
  } else {
    const folder = findFolderById(data.folders, folderId);
    if (folder && folder.children) {
      function collectBookmarksFromFolder(items) {
        items.forEach(item => {
          if (item.type === 'bookmark') {
            bookmarks.push(item);
          } else if (item.type === 'folder' && item.children) {
            collectBookmarksFromFolder(item.children);
          }
        });
      }
      collectBookmarksFromFolder(folder.children);
    }
  }
  
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    return bookmarks.filter(bookmark => 
      bookmark.title.toLowerCase().includes(query) || 
      bookmark.url.toLowerCase().includes(query)
    );
  }
  
  return bookmarks;
}

function renderFolderTree() {
  const tree = document.getElementById('folder-tree');
  if (!tree) return;
  
  const allBookmarksItem = tree.querySelector('.all-bookmarks');
  tree.innerHTML = '';
  if (allBookmarksItem) {
    tree.appendChild(allBookmarksItem);
  }
  
  const allCount = document.getElementById('all-count');
  if (allCount) {
    allCount.textContent = countAllBookmarks();
  }
  
  const fragment = document.createDocumentFragment();
  renderFoldersRecursive(data.folders, fragment, []);
  tree.appendChild(fragment);
  
  addFolderTreeEventListeners();
  
  resetInactivityTimer();
}

function renderFoldersRecursive(items, container, path = [], depth = 0) {
  items.forEach((item, index) => {
    if (item.type === 'folder') {
      const currentPath = [...path, index];
      const folderId = currentPath.join(',');
      const itemCount = countItemsInFolder(item);
      
      const hasSubfolders = item.children && item.children.some(child => child.type === 'folder');
      
      const li = document.createElement('li');
      li.className = 'folder-item';
      if (hasSubfolders) li.classList.add('has-children');
      li.dataset.folderId = folderId;
      
      li.innerHTML = `
        <div class="folder-content">
          <span class="folder-toggle">${hasSubfolders ? '▶' : ''}</span>
          <div class="folder-icon">${hasSubfolders ? '📁' : '📂'}</div>
          <div class="folder-name">${item.name}</div>
          <div class="folder-actions">
            <button class="folder-action-btn edit" title="${getMessage('rename') || 'Rename'}">✏️</button>
            <button class="folder-action-btn delete" title="${getMessage('delete') || 'Delete'}">🗑️</button>
          </div>
        </div>
        <div class="folder-count">${itemCount}</div>
      `;
      
      container.appendChild(li);
      
      if (hasSubfolders) {
        const subUl = document.createElement('ul');
        subUl.className = 'subfolder-list';
        container.appendChild(subUl);
        
        renderFoldersRecursive(item.children, subUl, currentPath, depth + 1);
      }
    }
  });
}

function addFolderTreeEventListeners() {
  document.querySelectorAll('.folder-item.has-children .folder-toggle').forEach(toggle => {
    toggle.addEventListener('click', function(e) {
      e.stopPropagation();
      const folderItem = this.closest('.folder-item');
      toggleFolder(folderItem);
    });
  });
  
  document.querySelectorAll('.folder-item .folder-name').forEach(folderName => {
    folderName.addEventListener('click', function(e) {
      e.stopPropagation();
      const folderItem = this.closest('.folder-item');
      const folderId = folderItem.dataset.folderId || 'all';
      setActiveFolder(folderId);
    });
  });
  
  document.querySelectorAll('.folder-item').forEach(item => {
    item.addEventListener('click', function(e) {
      if (e.target.closest('.folder-toggle')) {
        return;
      }
      
      if (e.target.closest('.folder-actions')) {
        return;
      }
      
      const folderId = this.dataset.folderId || 'all';
      setActiveFolder(folderId);
    });
  });
  
  document.querySelectorAll('.folder-action-btn.edit').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const folderItem = this.closest('.folder-item');
      const folderId = folderItem.dataset.folderId;
      renameFolder(folderId);
    });
  });
  
  document.querySelectorAll('.folder-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const folderItem = this.closest('.folder-item');
      const folderId = folderItem.dataset.folderId;
      deleteFolder(folderId);
    });
  });
}

function toggleFolder(folderItem) {
  const toggle = folderItem.querySelector('.folder-toggle');
  const subList = folderItem.nextElementSibling;

  if (subList && subList.classList.contains('subfolder-list')) {
    const isExpanded = folderItem.classList.contains('expanded');
    
    if (isExpanded) {
      folderItem.classList.remove('expanded');
      toggle.textContent = '▶';
    } else {
      folderItem.classList.add('expanded');
      toggle.textContent = '▼';
    }
  }
  
  resetInactivityTimer();
}

function setActiveFolder(folderId) {
  currentFolderId = folderId;
  
  document.querySelectorAll('.folder-item').forEach(item => {
    item.classList.remove('active');
  });
  
  const activeItem = document.querySelector(`.folder-item[data-folder-id="${folderId}"]`) || 
                     document.querySelector('.all-bookmarks');
  if (activeItem) {
    activeItem.classList.add('active');
  }
  
  const folderNameElement = document.getElementById('current-folder-name');
  const bookmarksCountElement = document.getElementById('bookmarks-count');
  
  if (folderId === 'all') {
    folderNameElement.textContent = getMessage('allBookmarks') || 'All Bookmarks';
  } else {
    const folder = findFolderById(data.folders, folderId);
    folderNameElement.textContent = folder ? folder.name : getMessage('allBookmarks');
  }
  
  const count = getBookmarksForFolder(folderId).length;
  bookmarksCountElement.textContent = `${count} ${getMessage('bookmarks') || 'bookmarks'}`;
  
  renderBookmarks();
  
  resetInactivityTimer();
}

async function renderBookmarks() {
  const grid = document.getElementById('bookmarks-grid');
  const emptyState = document.getElementById('empty-state');
  
  if (!grid) return;
  
  const bookmarks = getBookmarksForFolder(currentFolderId);
  
  if (bookmarks.length === 0) {
    grid.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  
  grid.style.display = 'grid';
  if (emptyState) emptyState.style.display = 'none';
  
  grid.innerHTML = '';
  
  const bookmarkElements = await Promise.all(
    bookmarks.map(async (bookmark, index) => createBookmarkCard(bookmark, index))
  );
  
  bookmarkElements.forEach(element => {
    if (element) grid.appendChild(element);
  });
  
  resetInactivityTimer();
}

async function createBookmarkCard(bookmark, index) {
  const card = document.createElement('div');
  card.className = 'bookmark-card';
  card.dataset.index = index;
  
  const domain = getDomainFromUrl(bookmark.url);
  const faviconUrl = await getFaviconUrl(bookmark.url);
  
  card.innerHTML = `
    <div class="bookmark-header">
      ${faviconUrl ? 
        `<img src="${faviconUrl}" class="bookmark-favicon" alt="${domain}">` :
        `<div class="bookmark-favicon-placeholder">🔗</div>`
      }
      <div class="bookmark-title">${bookmark.title}</div>
    </div>
    <div class="bookmark-url">${bookmark.url}</div>
    <div class="bookmark-domain">${domain}</div>
    <div class="bookmark-actions">
      <button class="action-btn edit" title="${getMessage('edit') || 'Edit'}">✏️</button>
      <button class="action-btn copy" title="${getMessage('copyUrl') || 'Copy URL'}">📋</button>
      <button class="action-btn delete" title="${getMessage('delete') || 'Delete'}">🗑</button>
    </div>
  `;
  
  const actions = card.querySelector('.bookmark-actions');
  const editBtn = actions.querySelector('.edit');
  const copyBtn = actions.querySelector('.copy');
  const deleteBtn = actions.querySelector('.delete');
  
  card.addEventListener('click', (e) => {
    if (!e.target.closest('.bookmark-actions')) {
      window.open(bookmark.url, '_blank');
    }
  });
  
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    editBookmark(bookmark);
  });
  
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(bookmark.url).then(() => {
      showNotification(getMessage('urlCopied') || 'URL copied to clipboard');
    });
  });
  
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm(getMessage('deleteConfirm') || 'Delete this bookmark?')) {
      deleteBookmark(bookmark);
    }
  });
  
  return card;
}

function editBookmark(bookmark) {
  const modal = document.getElementById('edit-bookmark-modal');
  if (!modal) return;
  
  editingBookmark = bookmark;
  editingBookmarkPath = findItemPath(bookmark);
  
  modal.style.display = 'flex';
  
  document.getElementById('modal-title-text').textContent = getMessage('editBookmark') || 'Edit Bookmark';
  document.getElementById('modal-page-title').textContent = bookmark.title.length > 60 ? 
    bookmark.title.slice(0, 60) + '...' : bookmark.title;
  document.getElementById('modal-bookmark-title').value = bookmark.title;
  document.getElementById('modal-bookmark-url').value = bookmark.url;
  
  const select = document.getElementById('folder-select');
  select.innerHTML = '';
  
  const rootOption = document.createElement('option');
  rootOption.value = '';
  rootOption.textContent = getMessage('rootFolder') || 'Root folder';
  select.appendChild(rootOption);
  
  buildFolderOptions(data.folders, select, '', 0);
  
  if (editingBookmarkPath && editingBookmarkPath.length > 1) {
    const parentPath = editingBookmarkPath.slice(0, -1);
    if (parentPath.length > 0) {
      const parentPathStr = parentPath.join('/');
      select.value = parentPathStr;
    }
  }
  
  resetInactivityTimer();
}

function buildFolderOptions(items, select, prefix = '', depth = 0) {
  items.forEach((item, index) => {
    if (!item || item.type !== 'folder') return;

    const option = document.createElement('option');
    option.value = prefix ? `${prefix}/${index}` : index.toString();
    option.textContent = '— '.repeat(depth) + item.name;
    select.appendChild(option);

    if (Array.isArray(item.children) && item.children.length > 0) {
      const newPrefix = prefix ? `${prefix}/${index}` : index.toString();
      buildFolderOptions(item.children, select, newPrefix, depth + 1);
    }
  });
}

async function handleModalSave() {
  const modal = document.getElementById('edit-bookmark-modal');
  if (!modal) return;

  const titleInput = document.getElementById('modal-bookmark-title');
  const urlInput = document.getElementById('modal-bookmark-url');

  const title = titleInput.value.trim();
  const url = urlInput.value.trim();

  if (!title || !url) {
    showNotification('Title and URL are required', true);
    return;
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    showNotification('Please enter a valid URL starting with http:// or https://', true);
    return;
  }

  const pathStr = document.getElementById('folder-select').value;

  let newPath = [];
  if (pathStr !== '') {
    newPath = pathStr
      .split('/')
      .map(Number)
      .filter(Number.isInteger);
  }

  if (newPath.length > 0) {
    const target = getItemByPath(newPath);
    if (!target || target.type !== 'folder') {
      showNotification('Selected path is not a folder', true);
      return;
    }
  }

  if (editingBookmark && editingBookmarkPath) {
    updateBookmark(editingBookmarkPath, title, url, newPath);
  }

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  await saveEncrypted(new Uint8Array(stored[STORAGE_KEY].salt));
  
  modal.style.display = 'none';
  editingBookmark = null;
  editingBookmarkPath = null;
  
  showNotification(getMessage('bookmarkUpdated') || 'Bookmark updated');
  renderFolderTree();
  renderBookmarks();
}

function updateBookmark(oldPath, title, url, newPathRaw) {
  const newPath = newPathRaw || [];
  const oldFolderPath = oldPath.slice(0, -1);

  const sourceParent = getParentByPath(oldFolderPath);
  const sourceIndex = oldPath[oldPath.length - 1];
  const bookmark = sourceParent[sourceIndex];

  if (!bookmark) {
    console.error('Bookmark not found at path:', oldPath);
    return;
  }

  bookmark.title = title;
  bookmark.url = url;

  if (oldFolderPath.join('/') !== newPath.join('/')) {
    let targetArray;

    if (newPath.length === 0) {
      targetArray = data.folders;
    } else {
      const folder = getItemByPath(newPath);
      if (!folder || folder.type !== 'folder' || !Array.isArray(folder.children)) {
        console.error('Target path is not a folder:', newPath);
        return;
      }
      targetArray = folder.children;
    }

    sourceParent.splice(sourceIndex, 1);
    targetArray.push(bookmark);
  }
}

async function deleteBookmark(bookmark) {
  const path = findItemPath(bookmark);
  if (path) {
    removeItemByPath(path);
    
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    await saveEncrypted(new Uint8Array(stored[STORAGE_KEY].salt));
    
    showNotification(getMessage('bookmarkDeleted') || 'Bookmark deleted');
    renderFolderTree();
    renderBookmarks();
  }
}

function handleNewFolderInModal() {
  const name = prompt(getMessage('folderName') || 'Folder name:');
  if (name && name.trim()) {
    const newFolder = { 
      type: 'folder', 
      name: name.trim(), 
      children: [], 
      dateAdded: Date.now() 
    };
    data.folders.push(newFolder);
    
    const select = document.getElementById('folder-select');
    select.innerHTML = '';
    
    const rootOption = document.createElement('option');
    rootOption.value = '';
    rootOption.textContent = getMessage('rootFolder') || 'Root folder';
    select.appendChild(rootOption);
    
    buildFolderOptions(data.folders, select, '', 0);
    select.value = (data.folders.length - 1).toString();
  }
}

let isReloading = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'reloadmanager') {
    isReloading = true;
    
    showReloadingScreen();
    
    setTimeout(() => {
      window.location.reload();
    }, 1000);
    
    return true;
  }
});

function showReloadingScreen() {
  const lockScreen = document.getElementById('lock-screen');
  const mainContainer = document.querySelector('.container');
  
  if (lockScreen) {
    lockScreen.style.display = 'flex';
    lockScreen.innerHTML = `
      <div class="lock-container">
        <div class="lock-icon" style="animation: spin 1.5s linear infinite;">↻</div>
        <h1 class="lock-title">Holy Private Bookmarks</h1>
        <p class="lock-description">manager is reloading...</p>
        <div style="margin-top: 20px; color: var(--text-secondary); font-size: 14px;">
          Please wait while the manager updates
        </div>
      </div>
    `;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
  
  if (mainContainer) {
    mainContainer.style.display = 'none';
  }
}

window.addEventListener('beforeunload', () => {
  if (isReloading) {
    showReloadingScreen();
  }
  
  clearTimeout(inactivityTimer);
});

window.addEventListener('focus', () => {
  if (masterKey && data) {
    setTimeout(() => {
      renderFolderTree();
      renderBookmarks();
    }, 100);
  }
  
  resetInactivityTimer();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && masterKey && data) {
    setTimeout(() => {
      renderFolderTree();
      renderBookmarks();
    }, 100);
  }
  
  resetInactivityTimer();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'closeForPopup') {
    window.close();
    
    chrome.runtime.sendMessage({ action: 'managerClosed' });
    
    return true;
  }
});

async function createNewFolder(parentFolderId = '') {
  const folderName = prompt(getMessage('folderName') || 'Folder name:');
  
  if (!folderName || !folderName.trim()) {
    return;
  }
  
  const trimmedName = folderName.trim();
  
  const newFolder = {
    type: 'folder',
    name: trimmedName,
    children: [],
    dateAdded: Date.now()
  };
  
  if (parentFolderId === '') {
    data.folders.push(newFolder);
  } else {
    const parentFolder = findFolderById(data.folders, parentFolderId);
    if (parentFolder) {
      if (!parentFolder.children) {
        parentFolder.children = [];
      }
      parentFolder.children.push(newFolder);
    } else {
      data.folders.push(newFolder);
    }
  }
  
  await saveChanges();
  
  renderFolderTree();
  
  showNotification(getMessage('folderCreated') || 'Folder created successfully');
  
  resetInactivityTimer();
}

async function saveChanges() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY]) {
    await saveEncrypted(new Uint8Array(stored[STORAGE_KEY].salt));
  }
}

function initNewFolderButton() {
  const newFolderBtn = document.getElementById('new-folder-btn');
  if (newFolderBtn) {
    newFolderBtn.addEventListener('click', () => {
      createNewFolder();
    });
  }
}

async function init() {
  localizePage();
  
  initActivityTracking();
  
  initLockButton();
  
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  
  if (!stored[STORAGE_KEY]) {
    document.querySelector('.lock-container').innerHTML = `
      <div class="lock-icon"><img src="icons/icon128.png"></div>
      <h1 class="lock-title">Holy Private Bookmarks</h1>
      <p class="lock-description">Extension not set up yet. Please open the extension popup to create a password.</p>
      <button id="open-extension" class="unlock-btn" style="margin-top: 20px;">Open Extension</button>
    `;
    
    document.getElementById('open-extension').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    
    return;
  }
  
  clearError();
  
  document.getElementById('unlock-btn').addEventListener('click', unlock);
  
  document.getElementById('password-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      unlock();
    }
  });
  
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderBookmarks();
    });
  }
  
  const modalCancel = document.getElementById('modal-cancel');
  const modalSave = document.getElementById('modal-save');
  const newFolderBtn = document.getElementById('new-folder-in-modal');
  
  if (modalCancel) {
    modalCancel.addEventListener('click', () => {
      document.getElementById('edit-bookmark-modal').style.display = 'none';
      editingBookmark = null;
      editingBookmarkPath = null;
    });
  }
  
  if (modalSave) {
    modalSave.addEventListener('click', handleModalSave);
  }
  
  if (newFolderBtn) {
    newFolderBtn.addEventListener('click', handleNewFolderInModal);
  }
  
  document.getElementById('edit-bookmark-modal').addEventListener('click', (e) => {
    if (e.target.id === 'edit-bookmark-modal') {
      e.target.style.display = 'none';
      editingBookmark = null;
      editingBookmarkPath = null;
    }
  });
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('edit-bookmark-modal');
      if (modal && modal.style.display === 'flex') {
        modal.style.display = 'none';
        editingBookmark = null;
        editingBookmarkPath = null;
      }
    }
  });
  
  const allBookmarksItem = document.querySelector('.all-bookmarks');
  if (allBookmarksItem) {
    allBookmarksItem.addEventListener('click', () => {
      setActiveFolder('all');
    });
  }
  
  initNewFolderButton();
  
  document.getElementById('password-input').focus();
  
  if (sessionStorage.getItem('managerReloading')) {
    sessionStorage.removeItem('managerReloading');
    showReloadingScreen();
    setTimeout(() => {
      window.location.reload();
    }, 500);
  } else {
    
  }
}

async function renameFolder(folderId) {
    if (folderId === 'all') {
        showNotification(getMessage('cannotRenameAll') || 'Cannot rename "All Bookmarks" folder', true);
        return;
    }
    
    const folder = findFolderById(data.folders, folderId);
    if (!folder) {
        console.error('Folder not found:', folderId);
        return;
    }
    
    const currentName = folder.name;
    const newName = prompt(getMessage('renameFolder') || 'Rename folder:', currentName);
    
    if (newName && newName.trim() && newName.trim() !== currentName) {
        folder.name = newName.trim();
        
        await saveChanges();
        
        renderFolderTree();
        
        if (currentFolderId === folderId) {
            document.getElementById('current-folder-name').textContent = folder.name;
        }
        
        showNotification(getMessage('folderRenamed') || 'Folder renamed successfully');
        
        resetInactivityTimer();
    }
}


async function deleteFolder(folderId) {
    if (folderId === 'all') {
        showNotification(getMessage('cannotDeleteAll') || 'Cannot delete "All Bookmarks" folder', true);
        return;
    }
    
    const folder = findFolderById(data.folders, folderId);
    if (!folder) {
        console.error('Folder not found:', folderId);
        return;
    }
    
    const bookmarkCount = countBookmarksInFolder(folderId);
    const folderCount = countFoldersInFolder(folder);
    
    let message = getMessage('deleteFolderConfirm') || 'Delete folder "{0}"?';
    message = message.replace('{0}', folder.name);
    
    if (bookmarkCount > 0 || folderCount > 0) {
        message += '\n\n';
        if (bookmarkCount > 0) {
            const bookmarksText = getMessage('bookmarksCount') || '{0} bookmarks';
            message += '• ' + bookmarksText.replace('{0}', bookmarkCount) + '\n';
        }
        if (folderCount > 0) {
            const foldersText = getMessage('foldersCount') || '{0} folders';
            message += '• ' + foldersText.replace('{0}', folderCount) + '\n';
        }
        message += '\n' + (getMessage('deleteFolderWarning') || 'All content will be permanently deleted.');
    }
    
    if (!confirm(message)) {
        return;
    }
    
    const path = getFolderPathById(folderId);
    if (path) {
        removeItemByPath(path);
        
        await saveChanges();
        
        if (currentFolderId === folderId) {
            setActiveFolder('all');
        } else {
            renderFolderTree();
            renderBookmarks();
        }
        
        showNotification(getMessage('folderDeleted') || 'Folder deleted successfully');
        
        resetInactivityTimer();
    }
}

// Функция для подсчета папок внутри папки
function countFoldersInFolder(folder) {
    let count = 0;
    
    function countRecursive(items) {
        items.forEach(item => {
            if (item.type === 'folder') {
                count++;
                if (item.children && item.children.length > 0) {
                    countRecursive(item.children);
                }
            }
        });
    }
    
    if (folder.children) {
        countRecursive(folder.children);
    }
    
    return count;
}


function getFolderPathById(folderId) {
    const parts = folderId.split(',').map(Number);
    return parts;
}

init();