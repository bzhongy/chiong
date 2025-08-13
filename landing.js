document.addEventListener('DOMContentLoaded', function() {
    // Technology section toggle
    const techLearnMore = document.querySelector('.tech-learn-more');
    const technologySection = document.getElementById('technology-section');
    
    if (techLearnMore && technologySection) {
        techLearnMore.addEventListener('click', function(e) {
            e.preventDefault();
            
            if (technologySection.style.display === 'none') {
                technologySection.style.display = 'block';
                techLearnMore.querySelector('i').classList.remove('bi-chevron-down');
                techLearnMore.querySelector('i').classList.add('bi-chevron-up');
                techLearnMore.querySelector('span').textContent = 'Hide technology details';
            } else {
                technologySection.style.display = 'none';
                techLearnMore.querySelector('i').classList.remove('bi-chevron-up');
                techLearnMore.querySelector('i').classList.add('bi-chevron-down');
                techLearnMore.querySelector('span').textContent = 'Learn how Thetanuts powers Chiong';
            }
        });
    }
    
    // Countdown timer
    function updateCountdown() {
        const hoursEl = document.querySelector('.hours');
        const minutesEl = document.querySelector('.minutes');
        const secondsEl = document.querySelector('.seconds');
        
        if (!hoursEl || !minutesEl || !secondsEl) return;
        
        // Get current time in UTC
        const now = new Date();
        
        // Set target time to 8:00 UTC today
        const target = new Date();
        target.setUTCHours(8, 0, 0, 0);
        
        // If it's already past 8:00 UTC today, set target to 8:00 UTC tomorrow
        if (now >= target) {
            target.setUTCDate(target.getUTCDate() + 1);
        }
        
        // Calculate time difference in milliseconds
        let diff = target - now;
        
        // Convert to hours, minutes, seconds
        const hours = Math.floor(diff / (1000 * 60 * 60));
        diff -= hours * (1000 * 60 * 60);
        
        const minutes = Math.floor(diff / (1000 * 60));
        diff -= minutes * (1000 * 60);
        
        const seconds = Math.floor(diff / 1000);
        
        // Update the display
        hoursEl.textContent = hours.toString().padStart(2, '0');
        minutesEl.textContent = minutes.toString().padStart(2, '0');
        secondsEl.textContent = seconds.toString().padStart(2, '0');
    }
    
    // Update countdown every second
    setInterval(updateCountdown, 1000);
    
    // Initialize Bootstrap tooltips
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
    
    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    // Add cyberpunk-inspired cursor trail effect
    function createCursorTrail() {
        const trail = document.createElement('div');
        trail.className = 'cursor-trail';
        document.body.appendChild(trail);
        
        trail.style.position = 'fixed';
        trail.style.width = '8px';
        trail.style.height = '8px';
        trail.style.borderRadius = '50%';
        trail.style.backgroundColor = 'rgba(0, 184, 212, 0.7)';
        trail.style.pointerEvents = 'none';
        trail.style.transition = 'transform 0.1s, opacity 0.5s';
        trail.style.zIndex = '9999';
        trail.style.opacity = '0';
        
        document.addEventListener('mousemove', e => {
            trail.style.opacity = '1';
            trail.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 4}px)`;
            
            setTimeout(() => {
                trail.style.opacity = '0';
            }, 200);
        });
    }
    
    // Uncomment to enable cursor trail effect
    // createCursorTrail();
});

// Time decay visualization with p5.js
// This will be implemented in time-decay-visualization.js 