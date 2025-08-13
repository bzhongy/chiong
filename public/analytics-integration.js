// Ensure analytics manager integrates properly with the main app
document.addEventListener('DOMContentLoaded', function() {
    // Initialize analytics with the currently selected asset
    if (window.analyticsManager) {
        // Set initial asset based on UI selection
        const selectedAsset = document.getElementById('selected-asset');
        if (selectedAsset) {
            const currentAsset = selectedAsset.textContent.trim();
            window.analyticsManager.currentAsset = currentAsset;
        }
        
        // Ensure analytics refresh when asset changes (additional integration)
        const assetDropdownItems = document.querySelectorAll('[data-asset]');
        assetDropdownItems.forEach(item => {
            item.addEventListener('click', () => {
                const asset = item.getAttribute('data-asset');
                if (window.analyticsManager && asset !== window.analyticsManager.currentAsset) {
                    setTimeout(() => {
                        window.analyticsManager.currentAsset = asset;
                        window.analyticsManager.refreshAnalytics();
                    }, 200);
                }
            });
        });
    }
}); 