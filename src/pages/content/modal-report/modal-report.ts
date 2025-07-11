import { reportComment, type Comment } from "../api";
import "../css/modal-report.css";

export class ReportModal {
    private modalElement: HTMLElement | null = null;
    private currentComment: Comment | null = null;

    constructor() {
        this.bindMethods();
    }

    private bindMethods() {
        this.closeModal = this.closeModal.bind(this);
        this.handleReasonChange = this.handleReasonChange.bind(this);
        this.handleOtherTextChange = this.handleOtherTextChange.bind(this);
    }

    public show(comment: Comment): void {
        if (document.getElementById("danmaku-report-modal")) return;

        this.currentComment = comment;
        this.createModal();
        this.loadAndAppendForm().then(() => {
            this.setupEventListeners();
            this.populateCommentText();
        });
    }

    private createModal(): void {
        const modalOverlay = document.createElement("div");
        modalOverlay.id = "danmaku-report-modal";
        modalOverlay.className = "danmaku-modal-overlay";

        const modalContent = document.createElement("div");
        modalContent.className = "danmaku-modal-content";
        modalContent.style.height = "auto";
        modalContent.style.maxHeight = "90vh";
        modalContent.style.overflow = "auto";

        const closeButton = document.createElement("button");
        closeButton.className = "danmaku-modal-close";
        closeButton.innerHTML = "&times;";
        closeButton.onclick = this.closeModal;

        modalContent.appendChild(closeButton);
        modalOverlay.appendChild(modalContent);
        document.body.appendChild(modalOverlay);

        this.modalElement = modalOverlay;

        this.modalElement.addEventListener("mousedown", (event) => {
            if (event.target === this.modalElement) {
                this.closeModal();
            }
        });
    }

    private async loadAndAppendForm(): Promise<void> {
        try {
            const response = await fetch(
                chrome.runtime.getURL(
                    "src/pages/content/report-modal/report-modal.html"
                )
            );
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const html = await response.text();
            const modalContent = this.modalElement?.querySelector(
                ".danmaku-modal-content"
            );
            if (modalContent) {
                const reportForm = document.createElement("div");
                reportForm.className = "danmaku-report-form";
                reportForm.innerHTML = html;
                modalContent.appendChild(reportForm);
            }
        } catch (error) {
            console.error("Failed to load report form HTML:", error);
            this.showError("Failed to load report form. Please try again.");
        }
    }

    private populateCommentText(): void {
        const commentTextElement = document.getElementById(
            "danmaku-report-comment-text"
        );
        if (commentTextElement && this.currentComment) {
            commentTextElement.textContent = this.currentComment.content;
        }
    }

    private setupEventListeners(): void {
        const cancelBtn = document.getElementById("danmaku-report-cancel");
        const submitBtn = document.getElementById("danmaku-report-submit");
        const radioButtons = document.querySelectorAll(
            'input[name="report-reason"]'
        );
        const otherTextarea = document.getElementById(
            "danmaku-report-other-reason"
        ) as HTMLTextAreaElement;

        cancelBtn?.addEventListener("click", this.closeModal);

        submitBtn?.addEventListener("click", () => this.handleSubmit());

        radioButtons.forEach((radio) => {
            radio.addEventListener("change", this.handleReasonChange);
        });

        otherTextarea?.addEventListener("input", this.handleOtherTextChange);

        this.updateSubmitButtonState();
    }

    private handleReasonChange(): void {
        const selectedReason = document.querySelector(
            'input[name="report-reason"]:checked'
        ) as HTMLInputElement;
        const otherSection = document.getElementById(
            "danmaku-report-other-section"
        );
        const otherTextarea = document.getElementById(
            "danmaku-report-other-reason"
        ) as HTMLTextAreaElement;

        if (selectedReason?.value === "other") {
            otherSection!.style.display = "block";
            otherTextarea?.focus();
        } else {
            otherSection!.style.display = "none";
            otherTextarea.value = "";
            this.updateCharCount();
        }

        this.updateSubmitButtonState();
    }

    private handleOtherTextChange(): void {
        this.updateCharCount();
        this.updateSubmitButtonState();
    }

    private updateCharCount(): void {
        const otherTextarea = document.getElementById(
            "danmaku-report-other-reason"
        ) as HTMLTextAreaElement;
        const charCountElement = document.getElementById(
            "danmaku-report-char-count"
        );
        const charLimitElement = charCountElement?.parentElement;

        if (otherTextarea && charCountElement) {
            const length = otherTextarea.value.length;
            charCountElement.textContent = length.toString();

            if (charLimitElement) {
                charLimitElement.classList.remove("warning", "error");
                if (length > 450) {
                    charLimitElement.classList.add("error");
                } else if (length > 400) {
                    charLimitElement.classList.add("warning");
                }
            }
        }
    }

    private updateSubmitButtonState(): void {
        const submitBtn = document.getElementById(
            "danmaku-report-submit"
        ) as HTMLButtonElement;
        const selectedReason = document.querySelector(
            'input[name="report-reason"]:checked'
        ) as HTMLInputElement;
        const otherTextarea = document.getElementById(
            "danmaku-report-other-reason"
        ) as HTMLTextAreaElement;

        if (!submitBtn) return;

        let isValid = false;

        if (selectedReason) {
            if (selectedReason.value === "other") {
                const text = otherTextarea?.value.trim();
                isValid = !!(text && text.length > 0 && text.length <= 500);
            } else {
                isValid = true;
            }
        }

        submitBtn.disabled = !isValid;
    }

    private async handleSubmit(): Promise<void> {
        if (!this.currentComment) return;

        const selectedReason = document.querySelector(
            'input[name="report-reason"]:checked'
        ) as HTMLInputElement;
        const otherTextarea = document.getElementById(
            "danmaku-report-other-reason"
        ) as HTMLTextAreaElement;

        if (!selectedReason) {
            this.showError("Please select a reason for reporting.");
            return;
        }

        let reason = selectedReason.value;
        let additionalDetails = "";

        if (reason === "other") {
            additionalDetails = otherTextarea?.value.trim() || "";
            if (!additionalDetails) {
                this.showError(
                    "Please provide additional details for 'Other' reports."
                );
                return;
            }
            if (additionalDetails.length > 500) {
                this.showError(
                    "Additional details must be 500 characters or less."
                );
                return;
            }
        }

        const submitBtn = document.getElementById(
            "danmaku-report-submit"
        ) as HTMLButtonElement;
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "Reporting...";

        try {
            const success = await reportComment(
                this.currentComment.id,
                reason,
                additionalDetails
            );

            if (success) {
                this.showSuccess();
            } else {
                this.showError("Failed to submit report. Please try again.");
            }
        } catch (error) {
            console.error("Report submission error:", error);
            this.showError("An error occurred while submitting the report.");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText || "Report";
        }
    }

    private showSuccess(): void {
        const reportSection = document.querySelector(".danmaku-report-section");
        if (reportSection) {
            reportSection.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <div style="margin-bottom: 20px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#44ff44" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>
                    </div>
                    <h3 style="color: #fff; margin: 0 0 16px 0;">Report Submitted</h3>
                    <p style="color: #ccc; margin: 0 0 24px 0; font-size: 14px;">
                        Thank you for helping keep our community safe. 
                        We'll review this report and take appropriate action.
                    </p>
                    <button id="danmaku-report-close-success" class="danmaku-primary-btn">Close</button>
                </div>
            `;

            const closeBtn = document.getElementById(
                "danmaku-report-close-success"
            );
            closeBtn?.addEventListener("click", this.closeModal);
        }
    }

    private showError(message: string): void {
        const errorDiv = document.getElementById("danmaku-report-error");
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = "block";

            setTimeout(() => {
                errorDiv.style.display = "none";
            }, 5000);
        }
    }

    private hideError(): void {
        const errorDiv = document.getElementById("danmaku-report-error");
        if (errorDiv) {
            errorDiv.style.display = "none";
        }
    }

    public closeModal(): void {
        if (this.modalElement) {
            this.modalElement.remove();
            this.modalElement = null;
        }
        this.currentComment = null;
    }
}
