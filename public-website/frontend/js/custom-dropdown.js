/**
 * Custom Dropdown Utility for Ordinate
 * Replaces native <select> with a branded, premium custom dropdown.
 */

class CustomSelect {
    constructor(element) {
        this.originalSelect = element;
        this.placeholder = element.getAttribute('placeholder') || 'Select an option';
        this.customSelect = null;
        this.trigger = null;
        this.optionsContainer = null;
        this.isOpen = false;

        this.init();
    }

    init() {
        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select-wrapper';
        if (this.originalSelect.className) {
            // Keep some original classes but remove form-control if we're styling specifically
            const classes = this.originalSelect.className.split(' ').filter(c => c !== 'form-control');
            wrapper.classList.add(...classes);
        }
        if (this.originalSelect.id) {
            wrapper.id = 'custom-' + this.originalSelect.id;
        }
        wrapper._customSelect = this;

        // Hide original select but keep it in DOM for form submission and accessibility
        this.originalSelect.style.display = 'none';
        this.originalSelect.setAttribute('aria-hidden', 'true');
        this.originalSelect.parentNode.insertBefore(wrapper, this.originalSelect);
        wrapper.appendChild(this.originalSelect);

        // Build Custom Structure
        this.customSelect = document.createElement('div');
        this.customSelect.className = 'custom-select';
        
        this.trigger = document.createElement('div');
        this.trigger.className = 'custom-select-trigger';
        this.trigger.innerHTML = `<span>${this.getSelectedText()}</span>`;
        
        this.optionsContainer = document.createElement('div');
        this.optionsContainer.className = 'custom-options';

        this.renderOptions();

        this.customSelect.appendChild(this.trigger);
        this.customSelect.appendChild(this.optionsContainer);
        wrapper.appendChild(this.customSelect);

        this.addEventListeners();
    }

    getSelectedText() {
        const selectedOption = this.originalSelect.options[this.originalSelect.selectedIndex];
        return selectedOption ? selectedOption.textContent : this.placeholder;
    }

    renderOptions() {
        this.optionsContainer.innerHTML = '';
        this.trigger.querySelector('span').textContent = this.getSelectedText();
        
        Array.from(this.originalSelect.options).forEach((option, index) => {
            const customOption = document.createElement('span');
            customOption.className = 'custom-option';
            if (this.originalSelect.selectedIndex === index) {
                customOption.classList.add('selected');
            }
            customOption.textContent = option.textContent;
            customOption.dataset.value = option.value;
            customOption.dataset.index = index;

            customOption.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectOption(index);
                this.close();
            });

            this.optionsContainer.appendChild(customOption);
        });
    }

    selectOption(index) {
        this.originalSelect.selectedIndex = index;
        this.trigger.querySelector('span').textContent = this.originalSelect.options[index].textContent;
        
        // Update visual selection
        const options = this.optionsContainer.querySelectorAll('.custom-option');
        options.forEach(opt => opt.classList.remove('selected'));
        options[index].classList.add('selected');

        // Dispatch change event to the original select so listeners work
        this.originalSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    open() {
        // Close all other custom selects first
        document.querySelectorAll('.custom-select.open').forEach(el => {
            if (el !== this.customSelect) el.classList.remove('open');
        });
        
        this.customSelect.classList.add('open');
        this.isOpen = true;
    }

    close() {
        this.customSelect.classList.remove('open');
        this.isOpen = false;
    }

    addEventListeners() {
        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Close on click outside
        document.addEventListener('click', () => {
            if (this.isOpen) this.close();
        });

        // Watch for changes on the original select (e.g. if updated via JS)
        const observer = new MutationObserver(() => this.renderOptions());
        observer.observe(this.originalSelect, { childList: true });
        
        // Also listen for manual value changes on the original select
        this.originalSelect.addEventListener('change', (e) => {
            // Only update if it's not the event we just dispatched
            if (e.isTrusted || e.detail?.fromExternal) {
                 this.trigger.querySelector('span').textContent = this.getSelectedText();
                 this.renderOptions();
            }
        });
    }

    // Helper to refresh if options changed dynamically
    refresh() {
        this.renderOptions();
        this.trigger.querySelector('span').textContent = this.getSelectedText();
    }
}

// Global initialization
document.addEventListener('DOMContentLoaded', () => {
    // We can auto-initialize for specific classes if we want
    // But for this project, let's target them specifically in the pages
});

window.CustomSelect = CustomSelect;
