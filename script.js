const { createIcons, icons } = lucide;

const CONFIG = {
    MAX_ATTEMPTS: 3,
    LOCKOUT_TIME: 30 * 60 * 1000 // 30 minutes in milliseconds
};

const STATUS = {
    PENDING: 'pending',
    IN_PROGRESS: 'in-progress',
    COMPLETED: 'completed',
    ERROR: 'error',
    SKIPPED: 'skipped'
};

const MESSAGES = {
    SELECT_FILE: 'Please select a PDF file to upload.',
    PROCESSING: 'Processing your PDF file...',
    SUCCESS: 'File processed successfully!',
    ERROR: 'An error occurred while processing the file.',
    INVALID_TYPE: 'Please upload a PDF file only.',
    SIZE_ERROR: 'File size must be less than 10MB.',
    INVALID_PASSWORD: 'Invalid password',
    LOCKED_OUT: 'Too many attempts. Please try again later.',
    PASSWORD_REQUIRED: 'Please enter password'
};

class AuthManager {
    constructor() {
        this.attempts = 0;
        this.lastAttemptTime = null;
        this.isAuthenticated = false;
    }

    checkLockout() {
        if (!this.lastAttemptTime) return false;
        return (Date.now() - this.lastAttemptTime) < CONFIG.LOCKOUT_TIME;
    }

    async verifyPassword(password) {
        if (this.checkLockout()) {
            throw new Error(MESSAGES.LOCKED_OUT);
        }

        try {
            const response = await fetch('/verify-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ password })
            });

            const result = await response.json();

            if (response.ok) {
                this.isAuthenticated = true;
                this.attempts = 0;
                return true;
            }

            this.attempts++;
            this.lastAttemptTime = Date.now();
            
            if (this.attempts >= CONFIG.MAX_ATTEMPTS) {
                throw new Error(MESSAGES.LOCKED_OUT);
            }
            
            return false;
        } catch (error) {
            throw new Error(error.message || MESSAGES.INVALID_PASSWORD);
        }
    }
}

class UploadHandler {
    constructor() {
        this.maxFileSize = 10 * 1024 * 1024;
        this.currentStep = 1;
        this.selectedFile = null;
        this.authManager = new AuthManager();
        this.setupEventListeners();
        this.setupPasswordForm();
    }

    setupEventListeners() {
        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput');

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, this.preventDefaults, false);
            document.body.addEventListener(eventName, this.preventDefaults, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => this.highlight(dropZone), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => this.unhighlight(dropZone), false);
        });

        dropZone.addEventListener('drop', (e) => this.handleDrop(e), false);
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e), false);
    }

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    highlight(element) {
        element.classList.add('border-blue-500', 'bg-blue-50');
    }

    unhighlight(element) {
        element.classList.remove('border-blue-500', 'bg-blue-50');
    }

    async handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        this.validateAndShowFile(files[0]);
    }

    async handleFileSelect(e) {
        const files = e.target.files;
        this.validateAndShowFile(files[0]);
    }

    validateAndShowFile(file) {
        if (!file) return;

        if (file.type !== 'application/pdf') {
            this.showNotification(MESSAGES.INVALID_TYPE, 'error');
            return;
        }

        if (file.size > this.maxFileSize) {
            this.showNotification(MESSAGES.SIZE_ERROR, 'error');
            return;
        }

        this.selectedFile = file;

        const selectedFileDiv = document.getElementById('selectedFile');
        const fileNameSpan = document.getElementById('fileName');
        const submitButton = document.getElementById('submitButton');

        fileNameSpan.textContent = file.name;
        selectedFileDiv.classList.remove('hidden');
        submitButton.classList.remove('hidden');
        createIcons();
    }

    clearFile() {
        this.selectedFile = null;
        document.getElementById('fileInput').value = '';
        document.getElementById('selectedFile').classList.add('hidden');
        document.getElementById('submitButton').classList.add('hidden');
    }

    setupPasswordForm() {
        const form = document.createElement('div');
        form.innerHTML = `
            <div id="passwordForm" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                <div class="bg-white p-6 rounded-lg shadow-xl">
                    <h2 class="text-xl mb-4">Enter Password</h2>
                    <input type="password" id="passwordInput" class="border p-2 mb-4 w-full rounded" placeholder="Password">
                    <button id="submitPassword" class="bg-blue-500 text-white px-4 py-2 rounded">Submit</button>
                </div>
            </div>
        `;
        document.body.appendChild(form);

        document.getElementById('submitPassword').addEventListener('click', () => this.handlePasswordSubmit());
        document.getElementById('passwordInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handlePasswordSubmit();
            }
        });
    }

    async handlePasswordSubmit() {
        const password = document.getElementById('passwordInput').value;
        
        try {
            if (await this.authManager.verifyPassword(password)) {
                document.getElementById('passwordForm').style.display = 'none';
                this.showNotification('Access granted', 'success');
            } else {
                this.showNotification(MESSAGES.INVALID_PASSWORD, 'error');
            }
        } catch (error) {
            this.showNotification(error.message, 'error');
        }
    }

    async handleSubmit() {
        if (!this.authManager.isAuthenticated) {
            this.showNotification(MESSAGES.PASSWORD_REQUIRED, 'error');
            return;
        }

        if (!this.selectedFile) {
            this.showNotification(MESSAGES.SELECT_FILE, 'error');
            return;
        }

        try {
            this.showNotification(MESSAGES.PROCESSING, 'info');
            this.updateStepStatus(1, STATUS.IN_PROGRESS);

            const formData = new FormData();
            formData.append('file', this.selectedFile);

            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (response.ok) {
                this.handleSuccess(result);
            } else {
                throw new Error(result.message || MESSAGES.ERROR);
            }
        } catch (error) {
            this.handleError(error);
        }
    }

    handleSuccess(result) {
        this.showNotification(result.message || MESSAGES.SUCCESS, 'success');
        this.updateAllSteps(result.data);
        this.clearFile();
    }

    handleError(error) {
        this.showNotification(error.message || MESSAGES.ERROR, 'error');
        this.updateStepStatus(this.currentStep, STATUS.ERROR);
    }

    showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg ${this.getNotificationStyle(type)}`;
        notification.textContent = message;

        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 5000);
    }

    getNotificationStyle(type) {
        const styles = {
            success: 'bg-green-500 text-white',
            error: 'bg-red-500 text-white',
            info: 'bg-blue-500 text-white'
        };
        return styles[type] || styles.info;
    }

    updateStepStatus(stepNumber, status) {
        const progressBar = document.getElementById(`step${stepNumber}Progress`);
        const statusText = document.getElementById(`step${stepNumber}Status`);
        const stepIcon = document.getElementById(`step${stepNumber}Icon`);

        switch (status) {
            case STATUS.IN_PROGRESS:
                this.animateProgress(progressBar);
                statusText.textContent = 'In Progress';
                statusText.className = 'text-sm text-blue-600';
                stepIcon.className = 'w-8 h-8 rounded-full flex items-center justify-center mr-3 bg-blue-100';
                stepIcon.innerHTML = `<span class="text-blue-600">${stepNumber}</span>`;
                break;

            case STATUS.COMPLETED:
                progressBar.style.width = '100%';
                statusText.textContent = 'Completed';
                statusText.className = 'text-sm text-green-600';
                stepIcon.className = 'w-8 h-8 rounded-full flex items-center justify-center mr-3 bg-green-100';
                stepIcon.innerHTML = '<i data-lucide="check" class="w-4 h-4 text-green-600"></i>';
                createIcons();
                break;

            case STATUS.ERROR:
                progressBar.style.width = '100%';
                progressBar.className = 'h-full bg-red-600 rounded-full transition-all duration-300';
                statusText.textContent = 'Error';
                statusText.className = 'text-sm text-red-600';
                stepIcon.className = 'w-8 h-8 rounded-full flex items-center justify-center mr-3 bg-red-100';
                stepIcon.innerHTML = '<i data-lucide="x" class="w-4 h-4 text-red-600"></i>';
                createIcons();
                break;

            case STATUS.SKIPPED:
                progressBar.style.width = '0%';
                statusText.textContent = 'Skipped';
                statusText.className = 'text-sm text-orange-600';
                stepIcon.className = 'w-8 h-8 rounded-full flex items-center justify-center mr-3 bg-orange-100';
                stepIcon.innerHTML = '<i data-lucide="minus" class="w-4 h-4 text-orange-600"></i>';
                createIcons();
                break;
        }
    }

    animateProgress(progressBar) {
        let width = 0;
        const interval = setInterval(() => {
            if (width >= 90) {
                clearInterval(interval);
            } else {
                width += 1;
                progressBar.style.width = width + '%';
            }
        }, 50);
    }

    updateAllSteps(data) {
        const steps = [
            { key: 'fileUpload', step: 1 },
            { key: 'pageUpdate', step: 2 },
            { key: 'flipbookCreation', step: 3 }
        ];

        steps.forEach(({ key, step }) => {
            const status = data[key] ? STATUS.COMPLETED : STATUS.SKIPPED;
            this.updateStepStatus(step, status);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.uploadHandler = new UploadHandler();
    window.handleSubmit = () => uploadHandler.handleSubmit();
});