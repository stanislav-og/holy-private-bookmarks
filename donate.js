function getMessage(key, substitutions = []) {
  return chrome.i18n.getMessage(key, substitutions);
}


function localizeDonatePage() {

  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const text = getMessage(key);
    if (text) {
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        element.placeholder = text;
      } else if (element.tagName === 'TITLE') {
        document.title = text;
      } else {
        element.textContent = text;
      }
    }
  });
}


function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(function() {
    showNotification(getMessage('copiedToClipboard') || 'Address copied!');
  }).catch(function(err) {
    console.error('Failed to copy: ', err);
    showNotification(getMessage('copyFailed') || 'Failed to copy address', true);
  });
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


function setupEventListeners() {

  document.querySelectorAll('.copy-btn[data-action="copy"]').forEach(button => {
    button.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      const donateCard = this.closest('.donate-card');
      if (donateCard && donateCard.dataset.address) {
        copyToClipboard(donateCard.dataset.address);
      } else {

        const addressElement = donateCard.querySelector('.address');
        if (addressElement) {
          copyToClipboard(addressElement.textContent);
        }
      }
    });
  });
  

  document.querySelectorAll('.address').forEach(addressElement => {
    addressElement.style.cursor = 'pointer';
    addressElement.title = getMessage('clickToCopy') || 'Click to copy';
    
    addressElement.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      copyToClipboard(this.textContent);
    });
  });
}


function setupQrCodeAltTexts() {
  document.querySelectorAll('.qr').forEach(qr => {
    const parent = qr.closest('.donate-card');
    if (parent) {
      const titleElement = parent.querySelector('h3');
      if (titleElement) {
        qr.alt = getMessage('qrCodeFor', [titleElement.textContent]) || 'QR Code';
      }
    }
  });
}


document.addEventListener('DOMContentLoaded', function() {

  localizeDonatePage();
  

  setupQrCodeAltTexts();
  

  setupEventListeners();
});


window.copyToClipboard = copyToClipboard;
window.localizeDonatePage = localizeDonatePage;
window.getMessage = getMessage;