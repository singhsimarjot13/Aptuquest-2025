/**
 * Flash Messages Handler
 * Manages Flask flash messages with auto-dismiss, animations, and proper styling
 */

class FlashMessageHandler {
    constructor() {
        this.messages = [];
        this.container = null;
        this.autoDismissDelay = 5000; // 5 seconds
        this.animationDuration = 300; // milliseconds
        
        this.init();
    }

    init() {
        this.setupContainer();
        this.clearOldMessages();
        this.processExistingMessages();
        this.setupGlobalHandler();
        this.setupPageLoadHandler();
        
        console.log('FlashMessageHandler initialized');
    }

    setupContainer() {
        // Create a fixed container for flash messages
        this.container = document.createElement('div');
        this.container.id = 'flash-messages-container';
        this.container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            max-width: 400px;
            pointer-events: none;
        `;
        
        document.body.appendChild(this.container);
    }

    processExistingMessages() {
        // Process existing Flask flash messages (ignore our own enhanced ones)
        const existingAlerts = document.querySelectorAll('.alert');
        existingAlerts.forEach(alert => {
            if (!alert.classList.contains('flash-message')) {
                this.processMessage(alert);
            }
        });
    }

    setupGlobalHandler() {
        // Listen for new flash messages added to DOM
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.classList && node.classList.contains('alert')) {
                        // Ignore alerts we created to prevent recursion
                        if (!node.classList.contains('flash-message')) {
                            this.processMessage(node);
                        }
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    processMessage(alertElement) {
        // Ignore our own enhanced messages to avoid infinite loops
        if (alertElement.classList.contains('flash-message')) {
            return;
        }
        // Extract message data
        const message = this.extractMessageText(alertElement);
        const type = this.extractMessageType(alertElement);
        const isDismissible = alertElement.classList.contains('alert-dismissible');

        // Create enhanced flash message
        this.showMessage(message, type, isDismissible);

        // Remove original alert
        if (alertElement.parentNode) {
            alertElement.remove();
        }
    }

    extractMessageText(alertElement) {
        // Remove icons and close buttons, get clean text
        const clone = alertElement.cloneNode(true);
        const icons = clone.querySelectorAll('i, .btn-close');
        icons.forEach(icon => icon.remove());
        
        return clone.textContent.trim();
    }

    extractMessageType(alertElement) {
        // Extract Bootstrap alert type
        const classes = alertElement.className.split(' ');
        const typeClass = classes.find(cls => cls.startsWith('alert-'));
        
        if (typeClass) {
            return typeClass.replace('alert-', '');
        }
        
        return 'info'; // default type
    }

    showMessage(message, type = 'info', dismissible = true) {
        // Suppress duplicate messages
        this.suppressDuplicate(message, type);
        
        const messageId = `flash-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const messageElement = document.createElement('div');
        messageElement.id = messageId;
        messageElement.className = `flash-message alert alert-${type} ${dismissible ? 'alert-dismissible' : ''} fade show`;
        messageElement.style.cssText = `
            margin-bottom: 10px;
            pointer-events: auto;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
            transition: all ${this.animationDuration}ms ease;
            opacity: 0;
            transform: translateX(100%);
        `;

        messageElement.innerHTML = `
            <div class="d-flex align-items-center">
                <i class="fas ${this.getIconForType(type)} me-2"></i>
                <span class="flex-grow-1">${this.escapeHtml(message)}</span>
                ${dismissible ? '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>' : ''}
            </div>
        `;

        // Add to container
        this.container.appendChild(messageElement);

        // Animate in
        setTimeout(() => {
            messageElement.style.opacity = '1';
            messageElement.style.transform = 'translateX(0)';
        }, 10);

        // Store message reference
        this.messages.push({
            id: messageId,
            element: messageElement,
            type: type,
            timestamp: Date.now()
        });

        // Setup dismiss functionality
        this.setupDismissHandlers(messageElement, messageId);

        // Auto-dismiss
        if (this.autoDismissDelay > 0) {
            setTimeout(() => {
                this.dismissMessage(messageId);
            }, this.autoDismissDelay);
        }

        return messageId;
    }

    setupDismissHandlers(messageElement, messageId) {
        // Close button click
        const closeBtn = messageElement.querySelector('.btn-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.dismissMessage(messageId);
            });
        }

        // Click anywhere to dismiss
        messageElement.addEventListener('click', (e) => {
            if (e.target !== closeBtn) {
                this.dismissMessage(messageId);
            }
        });

        // Keyboard escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.dismissMessage(messageId);
            }
        });
    }

    dismissMessage(messageId) {
        const messageIndex = this.messages.findIndex(msg => msg.id === messageId);
        
        if (messageIndex === -1) return;

        const message = this.messages[messageIndex];
        const element = message.element;

        // Animate out
        element.style.opacity = '0';
        element.style.transform = 'translateX(100%)';

        // Remove after animation
        setTimeout(() => {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
            this.messages.splice(messageIndex, 1);
        }, this.animationDuration);
    }

    dismissAll() {
        this.messages.forEach(message => {
            this.dismissMessage(message.id);
        });
    }

    getIconForType(type) {
        const icons = {
            'success': 'fa-check-circle',
            'danger': 'fa-exclamation-triangle',
            'warning': 'fa-exclamation-triangle',
            'info': 'fa-info-circle',
            'primary': 'fa-info-circle',
            'secondary': 'fa-info-circle',
            'light': 'fa-info-circle',
            'dark': 'fa-info-circle'
        };
        
        return icons[type] || icons['info'];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Public API methods
    success(message, dismissible = true) {
        return this.showMessage(message, 'success', dismissible);
    }

    error(message, dismissible = true) {
        return this.showMessage(message, 'danger', dismissible);
    }

    warning(message, dismissible = true) {
        return this.showMessage(message, 'warning', dismissible);
    }

    info(message, dismissible = true) {
        return this.showMessage(message, 'info', dismissible);
    }

    // Method to show multiple messages
    showMultiple(messages) {
        messages.forEach((msg, index) => {
            setTimeout(() => {
                this.showMessage(msg.text, msg.type, msg.dismissible !== false);
            }, index * 200); // Stagger messages
        });
    }

    // Method to update auto-dismiss delay
    setAutoDismissDelay(delay) {
        this.autoDismissDelay = delay;
    }

    // Method to get current messages count
    getMessageCount() {
        return this.messages.length;
    }

    // Method to check if any messages are showing
    hasMessages() {
        return this.messages.length > 0;
    }

    // Method to clear old messages from localStorage
    clearOldMessages() {
        try {
            // Clear any stored flash messages from previous sessions
            localStorage.removeItem('flash_messages');
            sessionStorage.removeItem('flash_messages');
            
            // Clear any existing flash messages in the DOM
            const existingAlerts = document.querySelectorAll('.alert');
            existingAlerts.forEach(alert => {
                if (alert.parentNode) {
                    alert.remove();
                }
            });
            
            // Clear any existing flash messages in our container
            if (this.container) {
                this.container.innerHTML = '';
            }
            
            console.log('Old flash messages cleared');
        } catch (error) {
            console.warn('Error clearing old flash messages:', error);
        }
    }

    // Method to setup page load handler
    setupPageLoadHandler() {
        // Clear messages immediately on page load
        this.dismissAll();
        
        // Clear messages when page is about to unload
        window.addEventListener('beforeunload', () => {
            this.dismissAll();
        });

        // Clear messages when navigating away
        window.addEventListener('pagehide', () => {
            this.dismissAll();
        });

        // Clear messages after form submissions
        document.addEventListener('submit', (e) => {
            // Add a small delay to allow the form to process
            setTimeout(() => {
                this.dismissAll();
            }, 100);
        });
        
        // Clear messages when page becomes visible (user returns to tab)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.dismissAll();
            }
        });
    }

    // Method to clear messages after successful operations
    clearAfterSuccess() {
        setTimeout(() => {
            this.dismissAll();
        }, 3000); // Clear after 3 seconds
    }

    // Method to suppress duplicate messages
    suppressDuplicate(message, type) {
        const existingMessage = this.messages.find(msg => 
            msg.element.textContent.trim() === message.trim() && msg.type === type
        );
        
        if (existingMessage) {
            this.dismissMessage(existingMessage.id);
        }
    }
}

// Initialize flash message handler
let flashHandler;

document.addEventListener('DOMContentLoaded', function() {
    flashHandler = new FlashMessageHandler();
    window.flashHandler = flashHandler;
});

// Global function for easy access
window.showFlashMessage = function(message, type = 'info', dismissible = true) {
    if (flashHandler) {
        return flashHandler.showMessage(message, type, dismissible);
    }
    return null;
};

// Export for global access
window.FlashMessageHandler = FlashMessageHandler;

