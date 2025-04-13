var HintRenderer = (function() {
    let _onHintSelectedCallback = null;
    let _hintCardsContainer = null;

    function initialize(containerElementId, onHintSelected) {
        _hintCardsContainer = document.getElementById(containerElementId);
        _onHintSelectedCallback = onHintSelected;
        if (!_hintCardsContainer) {
            console.error(`[Hint Renderer] Hint container #${containerElementId} not found!`);
        }
        console.log('[Hint Renderer] Initialized.');
    }

    function displayCards(hints) {
        if (!_hintCardsContainer) {
            console.error('[Hint Renderer] Container not initialized.');
            return false;
        }
        _hintCardsContainer.innerHTML = ''; // Clear previous hints

        if (!hints || hints.length === 0) {
            _hintCardsContainer.innerHTML = '<p style="color: #666; padding: 10px;">No hints generated for this phrase.</p>';
            console.warn('[Hint Renderer] No hints to display.');
            return false; // Indicate no hints displayed
        }

        hints.forEach(hint => {
            const card = document.createElement('div');
            card.className = 'hint-card';
            // Use data attributes to store data safely
            card.dataset.english = hint.english;
            card.dataset.russian = hint.russian;
            card.innerHTML = `
                <span class="english">${hint.english}</span>
                <span class="russian">${hint.russian}</span>
            `;
            card.onclick = handleClick; // Attach the click handler
            _hintCardsContainer.appendChild(card);
        });
        console.log(`[Hint Renderer] Displayed ${hints.length} cards.`);
        return true; // Indicate hints were displayed
    }

    function handleClick(event) {
        const card = event.currentTarget; // Get the card element
        const hint = {
            english: card.dataset.english,
            russian: card.dataset.russian
        };
        console.log('[Hint Renderer] Hint clicked:', hint);

        clearCards(); // Clear hint cards immediately

        // Trigger the callback provided by CallManager
        if (typeof _onHintSelectedCallback === 'function') {
            _onHintSelectedCallback(hint); 
        } else {
            console.error('[Hint Renderer] Hint selection callback not configured!');
        }
    }

    function clearCards() {
        if (_hintCardsContainer) {
            _hintCardsContainer.innerHTML = '';
            console.log('[Hint Renderer] Cleared hint cards.');
        }
    }

    // Public interface for the module
    return {
        initialize: initialize,
        displayHintCards: displayCards,
        clearHintCards: clearCards
    };
})(); 