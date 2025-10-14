/**
 * Quiz Timer Module - No LocalStorage
 * Handles countdown timer functionality with visual feedback and warnings
 * 
 * FIXES IMPLEMENTED:
 * - Auto-submit when timer reaches 0 now works even if fullscreen is exited
 * - Sets submission flags to prevent fullscreen violation interference
 * - Temporarily disables beforeunload listener for timer-based submissions
 * - Removes any blocking alerts that might interfere with submission
 */

class QuizTimer {
    constructor() {
        this.timerDisplay = null;
        this.quizForm = null;
        this.timeLeft = 0;
        this.totalTime = 0;
        this.endTime = 0; // epoch ms when timer should hit 0
        this.countdown = null;
        this.isRunning = false;
        this.warningThreshold = 60; // seconds
        this.criticalThreshold = 30; // seconds
        this.timeUpHandled = false;
        this.formSubmitted = false;
        this.lastRenderedSecond = null;
        this.warningShown = false;
        this.criticalShown = false;

        this.init();
    }

    init() {
        this.setupElements();
        this.startTimer();
    }

    setupElements() {
        this.timerDisplay = document.getElementById('timer');
        this.quizForm = document.getElementById('quizForm');

        if (!this.timerDisplay || !this.quizForm) {
            console.warn('Timer elements not found');
            return;
        }

        // Read timer from data attribute (in seconds) with sessionStorage resume
        const initialSeconds = parseInt(this.quizForm.dataset.timer, 10) || 300;
        try {
            const storedEnd = sessionStorage.getItem('quiz_end_time');
            const storedTotal = sessionStorage.getItem('quiz_total_time');
            if (storedEnd && storedTotal) {
                const endMs = parseInt(storedEnd, 10);
                const total = parseInt(storedTotal, 10) || initialSeconds;
                const now = Date.now();
                const remaining = Math.max(0, Math.floor((endMs - now) / 1000));
                this.totalTime = total;
                this.timeLeft = remaining;
                this.endTime = endMs;
            } else {
                this.totalTime = initialSeconds;
                this.timeLeft = initialSeconds;
                this.endTime = Date.now() + this.timeLeft * 1000;
                sessionStorage.setItem('quiz_end_time', String(this.endTime));
                sessionStorage.setItem('quiz_total_time', String(this.totalTime));
            }
        } catch (e) {
            this.totalTime = initialSeconds;
            this.timeLeft = initialSeconds;
            this.endTime = Date.now() + this.timeLeft * 1000;
        }

        console.log(`Timer initialized: ${this.timeLeft} seconds`);
    }

    startTimer() {
        if (!this.timerDisplay || this.isRunning) return;

        this.isRunning = true;
        this.updateFromNow();

        this.countdown = setInterval(() => {
            try {
                this.updateFromNow();
                // Persist end time periodically
                if (this.endTime) {
                    try {
                        sessionStorage.setItem('quiz_end_time', String(this.endTime));
                        sessionStorage.setItem('quiz_total_time', String(this.totalTime));
                    } catch (e) {}
                }
            } catch (error) {
                console.error('Timer error:', error);
                this.stopTimer();
            }
        }, 250);

        console.log(`Timer started with ${this.timeLeft} seconds`);
    }

    updateFromNow() {
        if (!this.endTime) return;

        const now = Date.now();
        let remaining = Math.max(0, Math.floor((this.endTime - now) / 1000));

        if (this.lastRenderedSecond !== remaining) {
            this.timeLeft = remaining;
            this.updateDisplay();
            this.checkWarnings();
            this.lastRenderedSecond = remaining;

            if (this.timeLeft % 10 === 0) {
                console.log(`Timer: ${this.timeLeft} seconds remaining`);
            }
        }

        if (remaining <= 0) {
            this.handleTimeUp();
        }
    }

    updateDisplay() {
        if (!this.timerDisplay) return;

        const minutes = Math.floor(this.timeLeft / 60);
        const seconds = this.timeLeft % 60;
        this.timerDisplay.textContent = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
        this.updateProgressBar();
    }

    updateProgressBar() {
        const timerProgress = document.getElementById('timerProgress');
        if (!timerProgress) return;

        const progressPercent = ((this.totalTime - this.timeLeft) / this.totalTime) * 100;
        timerProgress.style.width = progressPercent + '%';
    }

    checkWarnings() {
        if (!this.timerDisplay) return;

        if (this.timeLeft <= this.warningThreshold && !this.warningShown) {
            this.warningShown = true;
            this.timerDisplay.style.color = '#fd7e14';
            this.timerDisplay.style.fontWeight = 'bold';
            this.showWarning('Warning: Less than 1 minute remaining!', 'warning');
        }

        if (this.timeLeft <= this.criticalThreshold && !this.criticalShown) {
            this.criticalShown = true;
            this.timerDisplay.style.color = '#dc3545';
            this.timerDisplay.style.fontWeight = 'bold';
            this.addPulseAnimation();
            this.showWarning('Critical: Less than 30 seconds remaining!', 'danger');
        }
    }

    addPulseAnimation() {
        if (!this.timerDisplay) return;

        this.timerDisplay.style.animation = 'pulse 1s infinite';

        if (!document.getElementById('timer-pulse-style')) {
            const style = document.createElement('style');
            style.id = 'timer-pulse-style';
            style.textContent = `
                @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                    100% { transform: scale(1); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    showWarning(message, type) {
        // Optional: integrate with QuizApp.showAlert or custom alerts
    }

    handleTimeUp() {
        if (this.timeUpHandled) return;
        this.timeUpHandled = true;

        this.stopTimer();
        this.showWarning('Time is up! Quiz will be submitted automatically.', 'danger');

        // Remove any existing custom popup
        const existingPopup = document.getElementById('custom-submit-popup');
        if (existingPopup) {
            existingPopup.remove();
        }

        // Set submission in progress flag to prevent custom popup and fullscreen violations
        if (window.QuizApp) {
            window.QuizApp.submissionInProgress = true;
            // Temporarily disable beforeunload listener for timer-based submission
            window.QuizApp.temporarilyDisableBeforeunload();
        }
        
        // Set global submission flag to prevent fullscreen violation handling
        if (typeof submissionInProgress !== 'undefined') {
            submissionInProgress = true;
        }
        
        // Set global quiz submission flag
        window.quizSubmissionInProgress = true;

        // Also remove any blocking alerts that might interfere
        const blockingAlert = document.getElementById('quiz-alert-overlay');
        if (blockingAlert) {
            blockingAlert.remove();
        }

        setTimeout(() => {
            if (this.quizForm && !this.formSubmitted) {
                this.formSubmitted = true;

                // Add time up reason
                const timeUpInput = document.createElement('input');
                timeUpInput.type = 'hidden';
                timeUpInput.name = 'time_up';
                timeUpInput.value = 'true';
                this.quizForm.appendChild(timeUpInput);

                // Add submit reason
                const reasonInput = document.createElement('input');
                reasonInput.type = 'hidden';
                reasonInput.name = 'submit_reason';
                reasonInput.value = 'time_up';
                this.quizForm.appendChild(reasonInput);

                try { sessionStorage.removeItem('quiz_end_time'); sessionStorage.removeItem('quiz_total_time'); } catch (e) {}

                // Submit immediately without any popups or interference
                this.quizForm.submit();
            }
        }, 2000);
    }

    stopTimer() {
        if (this.countdown) {
            clearInterval(this.countdown);
            this.countdown = null;
            this.isRunning = false;
            console.log('Timer stopped');
        }
        this.endTime = 0;
        this.lastRenderedSecond = null;
        try { sessionStorage.removeItem('quiz_end_time'); sessionStorage.removeItem('quiz_total_time'); } catch (e) {}
    }

    pauseTimer() {
        if (this.isRunning) {
            this.updateFromNow();
            if (this.countdown) clearInterval(this.countdown);
            this.countdown = null;
            this.isRunning = false;
            console.log('Timer paused');
        }
    }

    resumeTimer() {
        if (!this.isRunning && this.timeLeft > 0) {
            this.endTime = Date.now() + this.timeLeft * 1000;
            this.startTimer();
            console.log('Timer resumed');
        }
    }

    getTimeLeft() { return this.timeLeft; }
    getTimeElapsed() { return this.totalTime - this.timeLeft; }
    getProgressPercentage() { return ((this.totalTime - this.timeLeft) / this.totalTime) * 100; }
    isTimerRunning() { return this.isRunning; }

    addTime(seconds) {
        if (seconds > 0) {
            this.timeLeft += seconds;
            this.totalTime += seconds;
            this.endTime = Date.now() + this.timeLeft * 1000;
            this.updateDisplay();
            console.log(`Added ${seconds} seconds to timer`);
        }
    }

    setTime(seconds) {
        if (seconds > 0) {
            this.timeLeft = seconds;
            this.totalTime = seconds;
            this.endTime = Date.now() + this.timeLeft * 1000;
            this.updateDisplay();
            console.log(`Timer set to ${seconds} seconds`);
        }
    }
}

// Initialize timer when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('timer') && document.getElementById('quizForm') && !window.quizTimer) {
        window.quizTimer = new QuizTimer();
        console.log('Quiz timer initialized');
    }
});

window.QuizTimer = QuizTimer;
