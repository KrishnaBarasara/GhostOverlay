const btnLaunch = document.getElementById('btn-launch');

document.getElementById('app-theme').addEventListener('change', (e) => {
    const theme = e.target.value;
    if (theme === 'Light') {
        document.body.classList.add('light-theme');
    } else {
        document.body.classList.remove('light-theme');
    }
    // Send to main process so overlay gets updated
    window.api.changeTheme(theme);
});

btnLaunch.addEventListener('click', () => {
    // Grab the selected mode
    const selectedMode = document.querySelector('input[name="transcription-mode"]:checked').value;

    const settings = {
        language: document.getElementById('ai-language').value,
        role: document.getElementById('ai-role').value || 'General Candidate',
        context: document.getElementById('ai-context').value || 'Standard interview',
        model: document.getElementById('ai-model').value,
        mode: selectedMode // Send selected transcription mode to the main process
    };
    
    window.api.sendStartOverlay(settings);
});

// --- Custom DOM Dropdown Auto-Converter (Screen-Share Safe) ---
function setupCustomDropdowns() {
    const selects = document.querySelectorAll('select.control-input');

    selects.forEach(select => {
        // 1. Hide the native OS select
        select.style.display = 'none';

        // 2. Create the wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select-container';
        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select); // Move native select inside the wrapper

        // 3. Create the visible trigger button
        const trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        trigger.innerHTML = `<span>${select.options[select.selectedIndex].text}</span>`;
        wrapper.appendChild(trigger);

        // 4. Create the dropdown menu container
        const optionsList = document.createElement('div');
        optionsList.className = 'custom-options';
        wrapper.appendChild(optionsList);

        // 5. Populate the custom menu with options
        Array.from(select.options).forEach((option, index) => {
            const optDiv = document.createElement('div');
            optDiv.className = 'custom-option';
            optDiv.innerText = option.text;

            optDiv.addEventListener('click', function (e) {
                e.stopPropagation();

                // Update the hidden native select's value
                select.selectedIndex = index;

                // CRITICAL: Dispatch a change event so the existing Theme Switcher logic fires!
                select.dispatchEvent(new Event('change'));

                // Update the visible trigger text
                trigger.querySelector('span').innerText = this.innerText;

                // Close the dropdown
                optionsList.classList.remove('open');
                trigger.classList.remove('open');
            });
            optionsList.appendChild(optDiv);
        });

        // 6. Handle Opening/Closing the dropdown
        trigger.addEventListener('click', function (e) {
            e.stopPropagation();

            // Close any other open dropdowns on the page first
            document.querySelectorAll('.custom-options').forEach(opt => {
                if (opt !== optionsList) opt.classList.remove('open');
            });
            document.querySelectorAll('.custom-select-trigger').forEach(trig => {
                if (trig !== trigger) trig.classList.remove('open');
            });

            // Toggle this specific dropdown
            optionsList.classList.toggle('open');
            this.classList.toggle('open');
        });
    });

    // 7. Close dropdowns if user clicks anywhere else on the screen
    document.addEventListener('click', function () {
        document.querySelectorAll('.custom-options').forEach(opt => opt.classList.remove('open'));
        document.querySelectorAll('.custom-select-trigger').forEach(trig => trig.classList.remove('open'));
    });
}

// Initialize the converter on load
setupCustomDropdowns();
