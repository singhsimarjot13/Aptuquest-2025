/**
 * ITian Club Aptitude Quiz - Enhanced with Section Navigation & Custom Popups
 * Features: Section-wise navigation, custom submission popup, timer integration, fullscreen handling
 * 
 * FIXES IMPLEMENTED:
 * 1. Browser "Changes you made may not be saved" alert fix:
 *    - All beforeunload listeners (QuizApp, anti-cheat, cleanup) now check submission flags
 *    - Global flag window.quizSubmissionInProgress prevents all beforeunload interference
 *    - beforeunload listener is temporarily disabled when user confirms submission
 *    - Re-enabled when user cancels submission
 *    - Prevents browser alert from appearing after custom popup confirmation
 * 
 * 2. Auto-submit when timer reaches 0 and fullscreen is exited:
 *    - Timer-based submission sets submission flags to prevent fullscreen violation interference
 *    - Fullscreen violation handler checks submission flags before processing violations
 *    - Timer auto-submit always succeeds regardless of fullscreen state
 * 
 * Key Methods Added:
 * - temporarilyDisableBeforeunload(): Disables browser beforeunload listener + sets global flag
 * - reEnableBeforeunload(): Re-enables browser beforeunload listener + clears global flag
 * - handlePageUnload(): Handles cleanup on page unload
 */
let submissionInProgress = false; // global flag for browser
class QuizApp {
    constructor() {
        this.currentQuestion = 1;
        this.totalQuestions = 0;
        this.answeredQuestions = new Set();
        this.isInitialized = false;
        this.eventListeners = new Map();
        this.questionsBySection = {};
        this.currentSection = 'Verbal';
        this.submissionInProgress = false;
        
        this.init();
    }

    init() {
        if (this.isInitialized) return;
        
        this.setupEventListeners();
        this.isInitialized = true;
        
        console.log('QuizApp initialized successfully');
    }

    setupEventListeners() {
        // DOM ready event
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.onDOMReady());
        } else {
            this.onDOMReady();
        }

        // Window events - beforeunload listener that can be temporarily disabled
        this.beforeunloadHandler = (e) => {
            // Check if quiz timer is running AND submission is not in progress
            if (window.quizTimer && window.quizTimer.isRunning && !this.submissionInProgress && !submissionInProgress) {
                e.preventDefault();
                e.returnValue = 'Are you sure you want to leave? Your quiz progress will be lost.';
            }
        };
        this.addEventListener(window, 'beforeunload', this.beforeunloadHandler);

        // Prevent default form submission behavior globally ONLY for quiz form
        this.addEventListener(document, 'submit', (e) => {
            if (e.target.id === 'quizForm') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return false;
            }
        }, true); // Use capture phase to intercept early

        // Form submission events
        this.addEventListener(document, 'submit', (e) => {
            this.handleFormSubmission(e);
        });
    }

    addEventListener(element, event, handler) {
        element.addEventListener(event, handler);
        const key = `${event}_${Date.now()}_${Math.random()}`;
        this.eventListeners.set(key, { element, event, handler });
    }

    removeAllEventListeners() {
        this.eventListeners.forEach(({ element, event, handler }) => {
            element.removeEventListener(event, handler);
        });
        this.eventListeners.clear();
    }

    onDOMReady() {
        this.initializeQuiz();
        this.setupSectionNavigation();
        this.setupQuizNavigation();
        this.setupOptionSelection();
        this.setupFormValidation();
        this.setupLogoutHandler();
        this.setupCustomSubmissionPopup();
        this.setupSidebarNavigation();
        
        console.log('DOM ready - all components initialized');
    }

    initializeQuiz() {
        const quizForm = document.getElementById('quizForm');
        if (!quizForm) return;

        this.totalQuestions = document.querySelectorAll('.question-card').length;
        
        // Organize questions by section
        this.organizeQuestionsBySection();
        
        if (this.totalQuestions > 0) {
            this.updateProgress();
            this.updateQuestionIndicators();
            this.updateSectionCounts();
            this.showQuestion(1); // Show first question
        }
    }

    organizeQuestionsBySection() {
        const questionCards = document.querySelectorAll('.question-card');
        this.questionsBySection = { 'Verbal': [], 'Math': [], 'Reasoning': [] };
        
        questionCards.forEach((card, index) => {
            const categoryBadge = card.querySelector('.category-badge');
            if (categoryBadge) {
                const section = categoryBadge.textContent.trim();
                this.questionsBySection[section].push({
                    element: card,
                    index: index + 1,
                    answered: false
                });
            }
        });
        
        console.log('Questions organized by section:', this.questionsBySection);
    }

    setupSectionNavigation() {
        const sectionTabs = document.querySelectorAll('.section-tab');
        
        sectionTabs.forEach(tab => {
            this.addEventListener(tab, 'click', (e) => {
                e.preventDefault();
                const section = e.target.dataset.section;
                this.switchToSection(section);
            });
        });
    }

    setupSidebarNavigation() {
        // Setup sidebar section navigation
        const sidebarItems = document.querySelectorAll('.section-nav-item');
        
        sidebarItems.forEach(item => {
            this.addEventListener(item, 'click', (e) => {
                e.preventDefault();
                const section = item.dataset.section;
                this.switchToSection(section);
                
                // Close mobile sidebar if open
                this.closeMobileSidebar();
            });
        });

        // Setup mobile sidebar toggle
        const mobileToggle = document.getElementById('mobileSidebarToggle');
        const sidebar = document.getElementById('quizSidebar');
        const overlay = document.getElementById('sidebarOverlay');
        const sidebarToggle = document.getElementById('sidebarToggle');

        if (mobileToggle) {
            this.addEventListener(mobileToggle, 'click', (e) => {
                e.preventDefault();
                this.toggleMobileSidebar();
            });
        }

        if (sidebarToggle) {
            this.addEventListener(sidebarToggle, 'click', (e) => {
                e.preventDefault();
                this.closeMobileSidebar();
            });
        }

        if (overlay) {
            this.addEventListener(overlay, 'click', (e) => {
                e.preventDefault();
                this.closeMobileSidebar();
            });
        }

        // Update sidebar timer
        this.setupSidebarTimer();
    }

    toggleMobileSidebar() {
        const sidebar = document.getElementById('quizSidebar');
        const overlay = document.getElementById('sidebarOverlay');
        
        if (sidebar && overlay) {
            sidebar.classList.toggle('show');
            overlay.classList.toggle('show');
        }
    }

    closeMobileSidebar() {
        const sidebar = document.getElementById('quizSidebar');
        const overlay = document.getElementById('sidebarOverlay');
        
        if (sidebar && overlay) {
            sidebar.classList.remove('show');
            overlay.classList.remove('show');
        }
    }

    setupSidebarTimer() {
        // Update sidebar timer when main timer updates
        const sidebarTimer = document.getElementById('sidebarTimer');
        if (sidebarTimer && window.quizTimer) {
            // Update every second
            setInterval(() => {
                if (window.quizTimer && window.quizTimer.isRunning) {
                    const timeLeft = window.quizTimer.getTimeLeft();
                    const minutes = Math.floor(timeLeft / 60);
                    const seconds = timeLeft % 60;
                    sidebarTimer.textContent = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
                }
            }, 1000);
        }
    }

    switchToSection(section) {
        if (!this.questionsBySection[section] || this.questionsBySection[section].length === 0) {
            console.log(`No questions found for section: ${section}`);
            return;
        }

        // Update active tab (original section tabs)
        document.querySelectorAll('.section-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        const originalTab = document.querySelector(`[data-section="${section}"]`);
        if (originalTab) {
            originalTab.classList.add('active');
        }

        // Update active sidebar item
        document.querySelectorAll('.section-nav-item').forEach(item => {
            item.classList.remove('active');
        });
        const sidebarItem = document.querySelector(`.section-nav-item[data-section="${section}"]`);
        if (sidebarItem) {
            sidebarItem.classList.add('active');
        }
        
        this.currentSection = section;
        
        // Show first question of the section
        const firstQuestion = this.questionsBySection[section][0];
        this.currentQuestion = firstQuestion.index;
        this.showQuestion(this.currentQuestion);
        
        console.log(`Switched to ${section} section, showing question ${this.currentQuestion}`);
    }

    updateSectionCounts() {
        Object.keys(this.questionsBySection).forEach(section => {
            const countElement = document.getElementById(`${section.toLowerCase()}-count`);
            if (countElement) {
                const answeredCount = this.questionsBySection[section].filter(q => 
                    this.answeredQuestions.has(q.index)
                ).length;
                countElement.textContent = answeredCount;
            }
        });
    }

    setupQuizNavigation() {
        const nextBtn = document.getElementById('nextBtn');
        const prevBtn = document.getElementById('prevBtn');
        const submitBtn = document.getElementById('submitBtn');
        const questionIndicators = document.querySelectorAll('.question-indicator');

        if (nextBtn) {
            this.addEventListener(nextBtn, 'click', (e) => {
                e.preventDefault();
                this.nextQuestion();
            });
        }

        if (prevBtn) {
            this.addEventListener(prevBtn, 'click', (e) => {
                e.preventDefault();
                this.prevQuestion();
            });
        }

        if (submitBtn) {
            this.addEventListener(submitBtn, 'click', (e) => {
                e.preventDefault();
                this.submitQuiz();
            });
        }

        questionIndicators.forEach(indicator => {
            this.addEventListener(indicator, 'click', (e) => {
                e.preventDefault();
                const questionNum = parseInt(e.target.dataset.question);
                this.goToQuestion(questionNum);
            });
        });
    }

    setupOptionSelection() {
        const optionInputs = document.querySelectorAll('.option-input');
        
        optionInputs.forEach(input => {
            this.addEventListener(input, 'change', (e) => {
                this.handleOptionSelection(e);
            });
        });
    }

    handleOptionSelection(event) {
        const input = event.target;
        const optionItem = input.closest('.option-item');
        const questionCard = optionItem.closest('.question-card');
        const questionIndex = parseInt(questionCard.dataset.index);

        if (input.type === 'checkbox') {
            optionItem.classList.toggle('selected', input.checked);
        } else if (input.type === 'radio') {
            // Remove selected class from all options in this question
            questionCard.querySelectorAll('.option-item').forEach(item => {
                item.classList.remove('selected');
            });
            // Add selected class to current option
            optionItem.classList.add('selected');
        }

        // Mark question as answered
        this.answeredQuestions.add(questionIndex + 1);
        this.updateQuestionIndicators();
        this.updateProgress();
        this.updateSectionCounts();
    }

    nextQuestion() {
        console.log('Next clicked - Current:', this.currentQuestion, 'Total:', this.totalQuestions);
        
        if (this.currentQuestion < this.totalQuestions) {
            this.currentQuestion++;
            this.showQuestion(this.currentQuestion);
        } else {
            this.showSubmitSection();
        }
    }

    prevQuestion() {
        console.log('Previous clicked - Current:', this.currentQuestion);
        
        if (this.currentQuestion > 1) {
            this.currentQuestion--;
            this.showQuestion(this.currentQuestion);
        }
    }

    goToQuestion(questionNum) {
        console.log('Go to question:', questionNum);
        
        if (questionNum >= 1 && questionNum <= this.totalQuestions) {
            this.currentQuestion = questionNum;
            this.showQuestion(this.currentQuestion);
        }
    }

    showQuestion(questionNum) {
        console.log('Showing question:', questionNum);
        
        // Hide all question cards
        document.querySelectorAll('.question-card').forEach(card => {
            card.style.display = 'none';
        });

        // Show current question
        const currentCard = document.querySelector(`[data-index="${questionNum - 1}"]`);
        if (currentCard) {
            currentCard.style.display = 'block';
            currentCard.classList.add('fade-in');
        }

        // Update navigation buttons
        this.updateNavigationButtons(questionNum);
        
        // Update indicators and progress
        this.updateQuestionIndicators();
        this.updateProgress();
    }

    updateNavigationButtons(questionNum) {
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        const submitBtn = document.getElementById('submitBtn');
        
        if (prevBtn) {
            prevBtn.style.display = questionNum > 1 ? 'inline-block' : 'none';
        }
        
        if (nextBtn) {
            nextBtn.style.display = questionNum < this.totalQuestions ? 'inline-block' : 'none';
        }

        if (submitBtn) {
            submitBtn.style.display = questionNum === this.totalQuestions ? 'inline-block' : 'none';
        }
    }

    showSubmitSection() {
        console.log('Showing submit section');
        
        document.querySelectorAll('.question-card').forEach(card => {
            card.style.display = 'none';
        });
        
        const submitSection = document.querySelector('.submit-section');
        if (submitSection) {
            submitSection.style.display = 'block';
        }

        // Hide navigation buttons
        const nextBtn = document.getElementById('nextBtn');
        const prevBtn = document.getElementById('prevBtn');
        const submitBtn = document.getElementById('submitBtn');
        
        if (nextBtn) nextBtn.style.display = 'none';
        if (prevBtn) prevBtn.style.display = 'none';
        if (submitBtn) submitBtn.style.display = 'none';

        // Update summary stats
        this.updateSummaryStats();
    }

    setupCustomSubmissionPopup() {
        // Override the default submit behavior ONLY for quiz form
        const quizForm = document.getElementById('quizForm');
        if (quizForm) {
            this.addEventListener(quizForm, 'submit', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.showCustomSubmissionPopup();
                return false;
            });
        }
        
        // Also override submit buttons ONLY within quiz form
        if (quizForm) {
            const submitButtons = quizForm.querySelectorAll('button[type="submit"], input[type="submit"]');
            submitButtons.forEach(btn => {
                this.addEventListener(btn, 'click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    this.showCustomSubmissionPopup();
                    return false;
                });
            });
        }
    }

    showCustomSubmissionPopup() {
        if (this.submissionInProgress) return;
        
        // Check if popup already exists
        const existingPopup = document.getElementById('custom-submit-popup');
        if (existingPopup) {
            console.log('Custom popup already exists, removing it first');
            existingPopup.remove();
        }
        
        console.log('Showing custom submission popup');
        
        const answeredCount = this.answeredQuestions.size;
        const totalCount = this.totalQuestions;
        
        // Create custom popup
        const overlay = document.createElement('div');
        overlay.id = 'custom-submit-popup';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 20000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        `;

        const popup = document.createElement('div');
        popup.style.cssText = `
            background: rgba(17, 24, 39, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 2rem;
            max-width: 500px;
            width: 100%;
            text-align: center;
            color: white;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        `;

        popup.innerHTML = `
            <div style="margin-bottom: 1.5rem;">
                <i class="fas fa-question-circle" style="font-size: 3rem; color: var(--primary-blue); margin-bottom: 1rem;"></i>
                <h3 style="margin-bottom: 1rem;">Are you sure you want to submit?</h3>
                <p style="color: #d1d5db; margin-bottom: 1rem;">
                    You have answered <strong>${answeredCount}</strong> out of <strong>${totalCount}</strong> questions.
                </p>
                ${answeredCount < totalCount ? 
                    `<p style="color: #fbbf24; font-size: 0.9rem; margin-bottom: 1.5rem;">
                        <i class="fas fa-exclamation-triangle me-1"></i>
                        You have ${totalCount - answeredCount} unanswered questions.
                    </p>` : 
                    `<p style="color: #10b981; font-size: 0.9rem; margin-bottom: 1.5rem;">
                        <i class="fas fa-check-circle me-1"></i>
                        All questions have been answered!
                    </p>`
                }
            </div>
            <div style="display: flex; gap: 1rem; justify-content: center;">
                <button id="cancel-submit" class="btn btn-outline-light" style="padding: 0.75rem 2rem;">
                    <i class="fas fa-times me-2"></i>Cancel
                </button>
                <button id="confirm-submit" class="btn btn-premium" style="padding: 0.75rem 2rem;">
                    <i class="fas fa-paper-plane me-2"></i>Submit Quiz
                </button>
            </div>
        `;

        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        // Add event listeners
        const cancelBtn = document.getElementById('cancel-submit');
        const confirmBtn = document.getElementById('confirm-submit');
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Cancel button clicked');
                try {
                    document.body.removeChild(overlay);
                    this.returnToQuiz();
                } catch (error) {
                    console.error('Error removing overlay:', error);
                }
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Confirm button clicked');
                this.submissionInProgress = true;
                submissionInProgress = true; 
                try {
                    document.body.removeChild(overlay);
                    this.performSubmission();
                } catch (error) {
                    console.error('Error removing overlay:', error);
                }
            });
        }

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                console.log('Overlay clicked - cancelling');
                try {
                    document.body.removeChild(overlay);
                    this.returnToQuiz();
                } catch (error) {
                    console.error('Error removing overlay:', error);
                }
            }
        });

        // Close on Escape key
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                console.log('Escape key pressed - cancelling');
                try {
                    document.body.removeChild(overlay);
                    document.removeEventListener('keydown', escapeHandler);
                    this.returnToQuiz();
                } catch (error) {
                    console.error('Error removing overlay:', error);
                }
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }

    returnToQuiz() {
        console.log('returnToQuiz called - current question:', this.currentQuestion);
        
        // Reset submission in progress flag
        this.submissionInProgress = false;
        submissionInProgress = false;
        
        // Re-enable beforeunload listener since user cancelled submission
        this.reEnableBeforeunload();
        
        // Ensure the current question is visible
        this.showQuestion(this.currentQuestion);
        
        // Update navigation buttons to show proper state
        this.updateNavigationButtons(this.currentQuestion);
        
        // Focus on the quiz container to return user attention
        const quizContainer = document.getElementById('quizContainer');
        if (quizContainer) {
            quizContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        console.log('Returned to quiz successfully');
    }

    performSubmission() {
        const quizForm = document.getElementById('quizForm');
        if (!quizForm) return;

        // Temporarily disable beforeunload listener to prevent browser alert
        this.temporarilyDisableBeforeunload();

        // Add submission reason
        const reasonInput = document.createElement('input');
        reasonInput.type = 'hidden';
        reasonInput.name = 'submit_reason';
        reasonInput.value = 'manual';
        quizForm.appendChild(reasonInput);

        // Submit the form
        quizForm.submit();
    }

    // Method to temporarily disable beforeunload listener
    temporarilyDisableBeforeunload() {
        console.log('Temporarily disabling beforeunload listener for submission');
        if (this.beforeunloadHandler) {
            window.removeEventListener('beforeunload', this.beforeunloadHandler);
        }
        
        // Set a flag to prevent other beforeunload listeners from interfering
        window.quizSubmissionInProgress = true;
    }

    // Method to re-enable beforeunload listener
    reEnableBeforeunload() {
        console.log('Re-enabling beforeunload listener');
        if (this.beforeunloadHandler) {
            window.addEventListener('beforeunload', this.beforeunloadHandler);
        }
        
        // Clear the flag
        window.quizSubmissionInProgress = false;
    }

    submitQuiz() {
        console.log('Submitting quiz');
        this.showCustomSubmissionPopup();
    }

    // Auto-submit functionality is now handled by quiz_timer.js

    updateProgress() {
        const progress = (this.currentQuestion / this.totalQuestions) * 100;
        const progressBar = document.getElementById('progress');
        const currentQuestionSpan = document.getElementById('currentQuestion');
        const progressPercentage = document.getElementById('progressPercentage');

        if (progressBar) {
            progressBar.style.width = progress + '%';
        }
        
        if (currentQuestionSpan) {
            currentQuestionSpan.textContent = this.currentQuestion;
        }
        
        if (progressPercentage) {
            progressPercentage.textContent = Math.round(progress);
        }
    }

    updateQuestionIndicators() {
        const indicators = document.querySelectorAll('.question-indicator');
        
        indicators.forEach((indicator, index) => {
            const questionNum = index + 1;
            indicator.classList.remove('active', 'answered');

            if (questionNum === this.currentQuestion) {
                indicator.classList.add('active');
            } else if (this.answeredQuestions.has(questionNum)) {
                indicator.classList.add('answered');
            }
        });
    }

    updateSummaryStats() {
        const answeredCount = document.getElementById('answeredCount');
        const remainingCount = document.getElementById('remainingCount');

        if (answeredCount) {
            answeredCount.textContent = this.answeredQuestions.size;
        }
        
        if (remainingCount) {
            remainingCount.textContent = this.totalQuestions - this.answeredQuestions.size;
        }
    }

    // Timer functionality is now handled by quiz_timer.js
    // This prevents conflicts between multiple timer implementations

    setupFormValidation() {
        const forms = document.querySelectorAll('.needs-validation');
        
        forms.forEach(form => {
            this.addEventListener(form, 'submit', (e) => {
                if (!form.checkValidity()) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showAlert('Please fill in all required fields correctly.', 'danger');
                }
                
                form.classList.add('was-validated');
            });
        });
    }

    handleFormSubmission(event) {
        const form = event.target;
        
        // Quiz form validation - custom popup handles this now
        if (form.id === 'quizForm') {
            // Prevent default browser behavior completely
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            this.showCustomSubmissionPopup();
            return false;
        }

        // Profile form validation
        if (form.classList.contains('needs-validation')) {
            const urn = document.getElementById('urn')?.value.trim();
            const crn = document.getElementById('crn')?.value.trim();
            
            if (!urn && !crn) {
                event.preventDefault();
                this.showAlert('Please provide either URN or CRN to continue.', 'danger');
                return false;
            }
        }
    }

    setupLogoutHandler() {
        const logoutLinks = document.querySelectorAll('[href*="logout"], .logout-btn');
        
        logoutLinks.forEach(link => {
            this.addEventListener(link, 'click', (e) => {
                e.preventDefault();
                this.handleLogout();
            });
        });
    }

    handleLogout() {
        const confirmed = confirm('Are you sure you want to logout?');
        if (!confirmed) return;

        // Simple redirect to logout route
        window.location.href = '/logout';
    }

    showAlert(message, type = 'info') {
        // Remove existing alerts
        const existingAlerts = document.querySelectorAll('.custom-alert');
        existingAlerts.forEach(alert => alert.remove());

        // Create new alert
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} custom-alert alert-dismissible fade show`;
        alertDiv.innerHTML = `
            <i class="fas fa-${this.getAlertIcon(type)} me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;

        // Add styles
        alertDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            min-width: 300px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            transition: all 0.3s ease;
        `;

        // Add to page
        document.body.appendChild(alertDiv);

        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            this.dismissAlert(alertDiv);
        }, 5000);

        // Add click to dismiss
        this.addEventListener(alertDiv, 'click', () => {
            this.dismissAlert(alertDiv);
        });
    }

    dismissAlert(alertDiv) {
        alertDiv.style.opacity = '0';
        alertDiv.style.transform = 'translateY(-10px)';
        
        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.parentNode.removeChild(alertDiv);
            }
        }, 300);
    }

    getAlertIcon(type) {
        const icons = {
            'success': 'check-circle',
            'danger': 'exclamation-triangle',
            'warning': 'exclamation-triangle',
            'info': 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    // Cleanup method to prevent memory leaks
    destroy() {
        this.removeAllEventListeners();
        this.isInitialized = false;
        console.log('QuizApp destroyed - memory cleaned up');
    }

    // Method to handle page unload cleanup
    handlePageUnload() {
        // If submission is in progress, ensure beforeunload is disabled
        if (this.submissionInProgress) {
            this.temporarilyDisableBeforeunload();
        }
    }

    // Utility methods
    log(message, level = 'info') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
    }

    error(message, error = null) {
        this.log(message, 'error');
        if (error) {
            console.error(error);
        }
    }
}

// Initialize the app
const quizApp = new QuizApp();

// Export for global access
window.QuizApp = quizApp;

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.QuizApp) {
        window.QuizApp.handlePageUnload();
        window.QuizApp.destroy();
    }
    // Also cleanup quiz timer
    if (window.quizTimer) {
        window.quizTimer.stopTimer();
    }
});

// --- Anti-cheat: Fullscreen, visibility, and refresh/key detection with 3-strike auto-submit ---
(function() {
    function onReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    onReady(function initSecureQuiz() {
        const quizForm = document.getElementById('quizForm');
        if (!quizForm) return;

        // Initialize warnings from sessionStorage to persist across refresh
        let warnings = 0;
        let submitting = false;
        let alertOpen = false;
        let violationLock = false;
        let fsHandling = false;
        const VIOLATION_DEBOUNCE_MS = 800;

        // Mark quiz as active to hide navbar/footer even after exiting fullscreen
        try { document.body.setAttribute('data-quiz-active', 'true'); } catch (e) {}

        // Load persisted warnings if present
        try {
            const existingWarnings = parseInt(sessionStorage.getItem('quiz_warnings') || '0', 10) || 0;
            warnings = existingWarnings;
        } catch (e) {}

        // Show a styled modal to enter fullscreen; cancel redirects home
        const fsModalEl = document.getElementById('fullscreenModal');
        if (fsModalEl) {
            try {
                fsModalInstance = new bootstrap.Modal(fsModalEl, { backdrop: 'static', keyboard: false });
                fsModalInstance.show();
                const startBtn = document.getElementById('enterFullscreenBtn');
                if (startBtn) {
                    startBtn.addEventListener('click', () => {
                        try { requestFullscreenSafe(); } catch (e) {}
                        try { fsModalInstance.hide(); } catch (e) {}
                    });
                }
                const cancelBtn = fsModalEl.querySelector('[data-bs-dismiss="modal"].btn-outline-light');
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', () => { window.location.href = '/'; });
                }
                const closeBtn = fsModalEl.querySelector('.btn-close');
                if (closeBtn) {
                    closeBtn.addEventListener('click', () => { window.location.href = '/'; });
                }
            } catch (e) {
                // If Bootstrap modal is not available, fallback to direct request on first click
                const container = document.getElementById('quizContainer') || document.body;
                let fsArmed = true;
                container.addEventListener('click', function onceClick() {
                    if (!fsArmed) return;
                    fsArmed = false;
                    try { requestFullscreenSafe(); } catch (err) {}
                }, { once: true });
            }
        }

        function requestFullscreenSafe() {
            try {
                const el = document.documentElement;
                const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
                if (typeof req === 'function') {
                    req.call(el).catch(() => {});
                }
            } catch (e) {}
        }

        function disableQuizInputs() {
            try {
                const container = document.querySelector('.quiz-container') || document;
                container.querySelectorAll('input, button, select, textarea, a').forEach(el => {
                    el.disabled = true;
                    if (el.tagName === 'A') {
                        el.addEventListener('click', function preventNav(e){ e.preventDefault(); }, { once: true });
                    }
                });
            } catch (e) {}
        }

        function ensureSubmitReason(form, reason) {
            try {
                if (!form.querySelector('input[name="submit_reason"]')) {
                    const input = document.createElement('input');
                    input.type = 'hidden';
                    input.name = 'submit_reason';
                    input.value = reason;
                    form.appendChild(input);
                }
            } catch (e) {}
        }

        function autoSubmitFinal() {
            if (submitting) return;
            submitting = true;
            disableQuizInputs();
            
            // Remove any existing custom popup
            const existingPopup = document.getElementById('custom-submit-popup');
            if (existingPopup) {
                existingPopup.remove();
            }
            
            // Set submission in progress flag and disable beforeunload listener
            if (window.QuizApp) {
                window.QuizApp.submissionInProgress = true;
                window.QuizApp.temporarilyDisableBeforeunload();
            }
            
            // Set global quiz submission flag
            window.quizSubmissionInProgress = true;
            
            ensureSubmitReason(quizForm, 'violation');
            // Also keep backward compatible flag (server already supports)
            if (!quizForm.querySelector('input[name="time_up"]')) {
                const v = document.createElement('input');
                v.type = 'hidden';
                v.name = 'time_up';
                v.value = 'false';
                quizForm.appendChild(v);
            }
            try {
                // Clear persisted state
                sessionStorage.removeItem('quiz_end_time');
                sessionStorage.removeItem('quiz_total_time');
                sessionStorage.removeItem('quiz_warnings');
            } catch (e) {}
            try { quizForm.submit(); } catch (e) {}
        }

        function showBlockingAlert(text, onClose) {
            if (alertOpen) return;
            alertOpen = true;

            // Build custom overlay
            const overlay = document.createElement('div');
            overlay.id = 'quiz-alert-overlay';
            overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:11000; display:flex; align-items:center; justify-content:center; padding:16px;';

            const panel = document.createElement('div');
            panel.style.cssText = 'max-width:560px; width:100%; background:rgba(17,24,39,0.97); color:#fff; border:1px solid rgba(255,255,255,0.1); border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.5); overflow:hidden;';

            const header = document.createElement('div');
            header.style.cssText = 'padding:14px 18px; border-bottom:1px solid rgba(255,255,255,0.08); font-weight:700; letter-spacing:0.2px; background:rgba(255,255,255,0.03);';
            header.textContent = 'Attention';

            const body = document.createElement('div');
            body.style.cssText = 'padding:22px 20px; text-align:center;';
            body.innerHTML = `<div style="font-size:1.05rem; line-height:1.6;">${text}</div>`;

            const footer = document.createElement('div');
            footer.style.cssText = 'padding:14px 18px; display:flex; justify-content:center; gap:12px; border-top:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.02);';

            const okBtn = document.createElement('button');
            okBtn.className = 'btn btn-premium';
            okBtn.textContent = 'OK';
            okBtn.addEventListener('click', () => {
                try { document.body.removeChild(overlay); } catch (e) {}
                alertOpen = false;
                if (typeof onClose === 'function') onClose();
            });

            footer.appendChild(okBtn);
            panel.appendChild(header);
            panel.appendChild(body);
            panel.appendChild(footer);
            overlay.appendChild(panel);
            document.body.appendChild(overlay);
        }

        function handleViolation(kind) {
            if (violationLock || submitting) return;
            
            // Check if submission is already in progress (from timer or manual submission)
            if (window.QuizApp && window.QuizApp.submissionInProgress) {
                console.log('Submission already in progress, ignoring violation');
                return;
            }
            
            // Check global submission flag
            if (typeof submissionInProgress !== 'undefined' && submissionInProgress) {
                console.log('Global submission flag is true, ignoring violation');
                return;
            }
            
            violationLock = true;
            setTimeout(() => { violationLock = false; }, VIOLATION_DEBOUNCE_MS);

            // Increment and persist warning count
            warnings = (warnings || 0) + 1;
            try { sessionStorage.setItem('quiz_warnings', String(warnings)); } catch (e) {}

            const idx = Math.min(warnings, 3);
            if (idx < 3) {
                showBlockingAlert(`Warning ${idx} of 3: You cannot exit full-screen!`, function(){
                    // After warning on fullscreen exit, prompt user again with the fullscreen modal
                    if (kind === 'fullscreen' && fsModalEl) {
                        try {
                            if (!fsModalInstance) {
                                fsModalInstance = new bootstrap.Modal(fsModalEl, { backdrop: 'static', keyboard: false });
                            }
                            fsModalInstance.show();
                        } catch (e) {}
                    }
                });
            } else {
                // Only auto-submit on 3rd violation, not on timer expiry
                showBlockingAlert('You have exited full-screen 3 times. The test will be submitted automatically.', function(){ 
                    autoSubmitFinal(); 
                });
            }
        }

        // Hide non-essential UI in fullscreen via CSS (already in base.html). No forced re-entry.

        // fullscreenchange — count only when we detect an exit
        document.addEventListener('fullscreenchange', function() {
            if (fsHandling) return;
            fsHandling = true; setTimeout(() => { fsHandling = false; }, 300);
            if (!document.fullscreenElement) {
                handleViolation('fullscreen');
            }
        });

        // keydown — observe ESC/F11 (do not block to avoid freezes); prevent refresh/close
        document.addEventListener('keydown', function(e) {
            if (submitting) return;
            const key = e.key || '';
            const isRefresh = key === 'F5' || (key.toLowerCase() === 'r' && (e.ctrlKey || e.metaKey));
            const isClose = (key.toLowerCase() === 'w' && (e.ctrlKey || e.metaKey));
            const isEsc = key === 'Escape';
            const isF11 = key === 'F11';

            if (isRefresh || isClose) {
                e.preventDefault();
                e.stopPropagation();
                handleViolation('navigation');
                return;
            }
            // Do not prevent ESC/F11; fullscreenchange will handle violation on exit
            if (isEsc || isF11) {
                // no-op
            }
        }, true);

        // visibilitychange — tab switch / minimize
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'hidden' && !submitting) {
                handleViolation('visibility');
            }
        });

        // beforeunload — refresh/close attempts
        window.addEventListener('beforeunload', function(e) {
            if (submitting) return;
            
            // Check if submission is already in progress (from timer or manual submission)
            if (window.QuizApp && window.QuizApp.submissionInProgress) {
                console.log('Submission already in progress, allowing page unload');
                return;
            }
            
            // Check global submission flag
            if (typeof submissionInProgress !== 'undefined' && submissionInProgress) {
                console.log('Global submission flag is true, allowing page unload');
                return;
            }
            
            // Check global quiz submission flag
            if (window.quizSubmissionInProgress) {
                console.log('Quiz submission in progress, allowing page unload');
                return;
            }
            
            // Remove any existing custom popup
            const existingPopup = document.getElementById('custom-submit-popup');
            if (existingPopup) {
                existingPopup.remove();
            }

            // Set submission in progress flag
            if (window.QuizApp) {
                window.QuizApp.submissionInProgress = true;
            }

            // increment warning once per attempt window
            handleViolation('beforeunload');
            
            // block refresh/close
            e.preventDefault();
            e.returnValue = '';

            // Attempt to auto-submit attempted answers synchronously
            try {
                const formData = new FormData(quizForm);
                formData.append('submit_reason', 'beforeunload');
                // sendBeacon supports only simple types; convert FormData to URL-encoded
                const params = new URLSearchParams();
                for (const [key, value] of formData.entries()) {
                    params.append(key, value);
                }
                const blob = new Blob([params.toString()], { type: 'application/x-www-form-urlencoded;charset=UTF-8' });
                const ok = navigator.sendBeacon('/quiz', blob);
                if (!ok) {
                    fetch('/quiz', { method: 'POST', body: params, keepalive: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' } }).catch(() => {});
                }
            } catch (err) {}
        });

        // Remove quiz-active flag after navigation
        window.addEventListener('pagehide', function() {
            try { document.body.removeAttribute('data-quiz-active'); } catch (e) {}
        });
    });
})();
