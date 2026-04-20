document.addEventListener('DOMContentLoaded', () => {
    // --- Page Fades ---
    const internalLinks = document.querySelectorAll('a[href]:not([target="_blank"]):not([href^="mailto:"])');
    
    internalLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault(); 
            const targetUrl = link.href;
            
            document.querySelector('.container').classList.add('fade-out');
            
            setTimeout(() => {
                window.location.href = targetUrl;
            }, 300);
        });
    });

    // --- Global Click-to-Copy ---
    document.addEventListener('click', (e) => {
        // Check if the clicked element (or its parent) has the copy-target class
        const copyTarget = e.target.closest('.copy-target');
        if (!copyTarget) return;

        navigator.clipboard.writeText(copyTarget.innerText).then(() => {
            // Find the badge immediately after it and show it
            const badge = copyTarget.nextElementSibling;
            if (badge && badge.classList.contains('copy-feedback')) {
                badge.style.opacity = '1';
                setTimeout(() => {
                    badge.style.opacity = '0';
                }, 2000);
            }
        }).catch(err => console.error('Failed to copy text: ', err));
    });
});

// --- BFCache Fix (Prevents blank screens on mobile back swipe) ---
window.addEventListener('pageshow', (event) => {
    // If the page was restored from the browser's history cache
    if (event.persisted) {
        const container = document.querySelector('.container');
        if (container) {
            container.classList.remove('fade-out');
        }
    }
});