const CONFIG = {
    sheets: {
        food: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRRw4HteY6fsmDuDkQKqUSKiK4KK-13wqsPP4XVr4lQzCKFd_5GckUnJujDpzoHhdQWCpHtHDTdMnhj/pub?gid=961397190&single=true&output=csv",
        store: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRRw4HteY6fsmDuDkQKqUSKiK4KK-13wqsPP4XVr4lQzCKFd_5GckUnJujDpzoHhdQWCpHtHDTdMnhj/pub?gid=1090856077&single=true&output=csv",
        music: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRRw4HteY6fsmDuDkQKqUSKiK4KK-13wqsPP4XVr4lQzCKFd_5GckUnJujDpzoHhdQWCpHtHDTdMnhj/pub?gid=0&single=true&output=csv"
    }
};

function escapeHTML(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

let state = { 
    userLoc: null, 
    currentCategory: null, 
    dataCache: [],
    pointers: { food: 0, store: 0, music: 0 },
    carouselOffset: { food: 0, store: 0, music: 0 },
    mobileScrollX: { food: 0, store: 0, music: 0 },
    isLocating: false,
    locationStatus: 'idle',
    appPhase: 'BOOT',
    hasUserInteracted: false,
    hasInitialScrollDone: false,
    // NEW: Filter tracking
    activeFilter: { food: 'All', store: 'All', music: 'All' }, 
    availableFilters: { food: [], store: [], music: [] },
};

const SG_CENTER = { lat: 1.3048, lng: 103.8318 };

const ALLOWED_HOSTS = [
    "google.com",
    "www.google.com",
    "maps.google.com",
    "goo.gl",
    "open.spotify.com"
];

function isSafeUrl(url) {
    try {
        if (!url || typeof url !== "string") return false;

        // prevent extremely long malicious URLs
        if (url.length > 2048) return false;

        const parsed = new URL(url);

        // HTTPS only
        if (parsed.protocol !== "https:") return false;

        const hostname = parsed.hostname.toLowerCase();

        // allowlist check
        return ALLOWED_HOSTS.some(host =>
            hostname === host || hostname.endsWith("." + host)
        );

    } catch {
        return false;
    }
}
// --- UI ENHANCEMENTS ---

function toggleLoader(show) {
    const loader = document.getElementById('loading-overlay');
    if (loader) {
        show ? loader.classList.remove('hidden') : loader.classList.add('hidden');
    }
}

function showHeroOverlay() {
    // Remove existing if any
    const existing = document.querySelector('.hero-transition');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'hero-transition';
    overlay.innerHTML = `
        <div class="hero-card">
            <div class="hero-icon">🇸🇬</div>
            <h2>You're a Hero!</h2>
            <p>Opening now… thanks for supporting local</p>
            <div class="hero-loader"></div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    // The overlay stays visible so when the user comes back from Maps, 
    // they still see the "Thank You" state before it fades.
    setTimeout(() => {
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.remove(), 800);
    }, 4800);
}

async function shareSpot(name, specificUrl) {
    const shareData = {
        title: name,
        text: `Supporting Local: Check out ${name}! Found on SG Vibes. 🇸🇬`,
        url: specificUrl 
    };

    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            await navigator.clipboard.writeText(specificUrl);
            alert("Link copied! Share it to support this local gem.");
        }
    } catch (err) { console.log('Share aborted'); }
}

// --- HELPERS & GEOLOCATION ---

function isInstagramBrowser() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    return /Instagram/i.test(ua);
}

if (isInstagramBrowser() && !sessionStorage.getItem('igReloaded')) {
    sessionStorage.setItem('igReloaded', 'true');
    setTimeout(() => {
        window.location.href = window.location.href;
    }, 300);
}

const secureParseCSV = (row) => {
    const regex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
    return row.split(regex).map(cell => {
        let clean = cell.trim();
        if (clean.startsWith('"') && clean.endsWith('"')) {
            clean = clean.substring(1, clean.length - 1);
        }
        return clean.replace(/""/g, '"');
    });
};

function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 999;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function scrollToResults() {
    const resultsDiv = document.getElementById("results");
    if (!resultsDiv) return;

    window.scrollTo({
        top: resultsDiv.offsetTop - 120,
        behavior: 'smooth'
    });
}

function handleUserClick(category) {
    state.hasUserInteracted = true;
    document.querySelector('.button-group')?.classList.add('sticky-active');
    handleAction(category);
}

async function getLocation() {
    if (state.locationStatus === 'resolved') return state.userLoc || SG_CENTER;
    state.locationStatus = 'requesting';

    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            fallbackLocation(resolve, "Not supported");
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                state.locationStatus = 'resolved';
                // Hide alert if location is now found
                const alertBox = document.getElementById("distance-alert");
            if (alertBox) {
                alertBox.classList.add("hidden");
                alertBox.innerHTML = ""; // clean reset
            }
                resolve(state.userLoc);
            },
            (error) => fallbackLocation(resolve, error.message),
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
    });
}

function fallbackLocation(resolve, reason) {
    const alertBox = document.getElementById("distance-alert");

    state.userLoc = SG_CENTER;
    state.locationStatus = 'resolved';

    if (alertBox) {
        let message = `📍 Unable to get precise location.<br>Showing results across Singapore.`;

        if (isInstagramBrowser()) {
            message += `<br><br>👉 Tap <b>••• / ⋮</b> → <b>Open in Browser</b>`;
        } else {
            message += `<br><br>👉 Turn on location services and refresh the page.`;
        }

        alertBox.innerHTML = message;
        alertBox.classList.remove("hidden");
    }

    resolve(SG_CENTER);
}

// --- MAIN ACTION HANDLER ---
async function handleAction(category) {
    if (state.isLocating) return; 
    
    const resultsDiv = document.getElementById("results");
    toggleLoader(true);

    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`${category}Btn`)?.classList.add('active');

    const isNewCategory = state.currentCategory !== category;
    state.currentCategory = category;

    try {
        state.isLocating = true;
        const userCoords = await getLocation();

        // Only fetch and sort if we don't have this category's data yet
        if (isNewCategory || state.dataCache.length === 0) {
            const response = await fetch(CONFIG.sheets[category], { cache: "no-store" });
            const text = await response.text();
            
            // Keep your existing parsing logic exactly as is
            state.dataCache = text.split(/\r?\n/).slice(1)
                .map((row, index) => {
                    if (!row || typeof row !== "string") return null;
                    const trimmed = row.trim();
                    if (!trimmed) return null;
                    const cols = secureParseCSV(trimmed);
                    if (!cols[0]) return null;
                    return { id: index, cols };
                })
                .filter(Boolean);

            // Calculate Distance & Sort (Closest to Furthest)
            state.dataCache.forEach(item => {
                const lat = parseFloat(item.cols[2]);
                const lng = parseFloat(item.cols[3]);
                item.dist = (category === 'music') ? 0 : calculateDistance(userCoords.lat, userCoords.lng, lat, lng);
            });

            function renderFilters(category) {
    const container = document.getElementById('filter-container');
    if (!container) return;

    if (category === 'music' || !state.availableFilters[category] || state.availableFilters[category].length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = ''; 

    state.availableFilters[category].forEach(filterText => {
        const btn = document.createElement('button');
        btn.className = 'filter-pill';
        if (state.activeFilter[category] === filterText) {
            btn.classList.add('active');
        }
        
        btn.textContent = filterText;
        
        btn.onclick = () => {
            state.activeFilter[category] = filterText;
            state.carouselOffset[category] = 0; 
            if (window.innerWidth <= 500) {
                state.mobileScrollX[category] = 0;
            }
            renderFilters(category); 
            renderCarousel(category);
        };
        
        container.appendChild(btn);
    });
}
        }

        // Reset the "window" to the start of the sorted list
        renderFilters(category);
        renderCarousel(category);

        const resultsDiv = document.getElementById("results");
        if (resultsDiv) {
            if (window.innerWidth <= 500) {
                // Restore mobile position
                resultsDiv.scrollLeft = state.mobileScrollX[category] || 0;
            } else {
                // Restore desktop position
                const offset = state.carouselOffset[category] || 0;
                resultsDiv.style.transform = `translateX(${offset * -50}%)`;
            }
        }
        
        if (state.hasUserInteracted) scrollToResults();

    } catch (err) {
        console.error("Action Error:", err);
        resultsDiv.innerHTML = `<div class="error-box"><h3>Error</h3><p>${escapeHTML(err.message)}</p></div>`;
    } finally {
        state.isLocating = false;
        toggleLoader(false);
    }
}
// --- RENDERING LOGIC ---

function renderCard(item, category) {
    if (!item || !item.cols) return document.createElement("div");
    const cols = item.cols || [];

    const name = cols[0] || "Local Spot";
    const type = cols[1] || category;
    const lat = cols[2];
    const lng = cols[3];
    const desc = cols[4] || "Tap below for details";
    const musicUrl = cols[5];
    const mapsUrl = cols[6];
    const activeCat = category.toLowerCase().trim();

    // RESTORED: Your original rotating image arrays
    const imgMap = {
        food: ["1555939594-58d7cb561ad1", "1540189549336-e6e99c3679fe", "1512621776951-a57141f2eefd"],
        store: ["1441986300917-64674bd600d8", "1472851294608-062f824d29cc"],
        music: ["1511671782779-c97d3d27a1d4", "1470225620780-dba8ba36b745"]
    };

    // Logic: Cycle through the array based on the item's unique index
    const categoryImages = imgMap[activeCat] || imgMap.food;
    const imgId = categoryImages[item.id % categoryImages.length];

    const card = document.createElement("div");
    card.className = "card";
    
    let distHTML = '';

    if (activeCat !== 'music') {
    
        const distText =
            typeof item.dist === "number"
                ? `${item.dist.toFixed(1)}km away`
                : "Discover local";
    
        distHTML = `
            <span class="dist-tag">
                ${escapeHTML(distText)}
            </span>
        `;
    }

    card.innerHTML = `
    <div class="img-container">
        <img src="https://images.unsplash.com/photo-${imgId}?auto=format&fit=crop&w=600&q=60" 
             class="card-img" alt="${escapeHTML(name || "image")}" loading="lazy">
        ${distHTML}
    </div>
    <div class="card-content">
        <div class="card-header-block">
            <span class="category-tag">${escapeHTML(type || category)}</span>
            <h3 class="card-title">${escapeHTML(name || "Local Spot")}</h3>
        </div>
        <p class="card-desc">${escapeHTML(desc || "Goodness waiting to be discovered.")}</p>
        <div class="card-footer"></div>
    </div>`;

    const footer = card.querySelector('.card-footer');
   let targetUrl = (activeCat === 'music' && musicUrl) ? musicUrl : mapsUrl;

    if (typeof targetUrl !== "string") targetUrl = "#";
    targetUrl = targetUrl.trim();
    
    // ONLY allow HTTPS links
    if (targetUrl !== "#" && !targetUrl.startsWith("https://")) {
        targetUrl = "#";
    }
    
    // final safety check
    if (!isSafeUrl(targetUrl)) {
        targetUrl = "#";
    }
    
    // Primary Action (Maps/Spotify)
    const mainBtn = document.createElement('button');
    mainBtn.className = "btn-link btn-primary"; // Added btn-primary class
    // Elevated Micro-Copy: Action-oriented instead of tool-oriented
    mainBtn.innerHTML = (activeCat === 'music') ? "<span class='btn-icon'>🎵</span> Listen Now" : "<span class='btn-icon'>📍</span> Get Directions";
    
   mainBtn.onclick = () => {
    if (!targetUrl || targetUrl === "#") {
        alert("Link unavailable.");
        return;
    }

    // ✅ Show hero first
    showHeroOverlay();

    // ✅ Then navigate in SAME TAB
    setTimeout(() => {
        window.location.assign(targetUrl);
    }, 1600); // 1.2s = visible but not annoying
};
    
    const shareBtn = document.createElement('button');
    shareBtn.className = "btn-link btn-share-secondary";
    shareBtn.innerHTML = "🔗 Share"; // Shorter text to keep the visual weight on the primary button
    shareBtn.onclick = (e) => {
    e.stopPropagation();

    if (!targetUrl || targetUrl === "#") {
        alert("Nothing safe to share.");
        return;
    }

    shareSpot(name, targetUrl);
    };
    
    footer.appendChild(mainBtn);
    footer.appendChild(shareBtn);

    return card;
}

function renderFilters(category) {
    const container = document.getElementById('filter-container');
    if (!container) return;

    if (category === 'music' || !state.availableFilters[category] || state.availableFilters[category].length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = ''; 

    state.availableFilters[category].forEach(filterText => {
        const btn = document.createElement('button');
        btn.className = 'filter-pill';
        if (state.activeFilter[category] === filterText) {
            btn.classList.add('active');
        }
        
        btn.textContent = filterText;
        
        btn.onclick = () => {
            state.activeFilter[category] = filterText;
            state.carouselOffset[category] = 0; 
            if (window.innerWidth <= 500) {
                state.mobileScrollX[category] = 0;
            }
            renderFilters(category); 
            renderCarousel(category);
        };
        
        container.appendChild(btn);
    });
}

function renderCarousel(category) {
    const resultsDiv = document.getElementById("results");
    const prevBtn = document.getElementById("prevBtn");
    const nextBtn = document.getElementById("nextBtn");
    
    if (!resultsDiv) return;

    // FILTER LOGIC: Support multiple types separated by "/"
    let dataToRender = state.dataCache;
    if (category !== 'music' && state.activeFilter[category] !== 'All') {
        dataToRender = state.dataCache.filter(item => {
            const rawType = (item.cols[1] || '').trim();
            const itemTypes = rawType.split('/').map(t => t.trim());
            return itemTypes.includes(state.activeFilter[category]);
        });
    }

    // 1. Render ONLY the filtered items
    resultsDiv.innerHTML = "";
    dataToRender.forEach(item => {
        const card = renderCard(item, category);
        resultsDiv.appendChild(card);
    });

    // 2. Desktop Sliding Mechanism
    if (window.innerWidth > 500) {
        const offset = state.carouselOffset[category] || 0;
        const max = state.dataCache.length;

        // Slide the row horizontally using CSS transforms
        const moveX = offset * -50; // Shifts by 50% per card step
        resultsDiv.style.transform = `translateX(${moveX}%)`;

        // Manage arrow visibility on desktop
        if (offset <= 0) {
            prevBtn?.classList.add('hidden');
        } else {
            prevBtn?.classList.remove('hidden');
        }

        if (offset >= max - 2) {
            nextBtn?.classList.add('hidden');
        } else {
            nextBtn?.classList.remove('hidden');
        }
    } else {
        // On mobile, native CSS scrolling handles positioning, so clear any desktop translation styles
        resultsDiv.style.transform = "none";
        
        // --- ADD THIS SCROLL LISTENER CODE HERE ---
        // Save the scroll position dynamically as the user swipes
        resultsDiv.onscroll = () => {
            if (state.currentCategory === category) {
                state.mobileScrollX[category] = resultsDiv.scrollLeft;
            }
        };
        // ------------------------------------------

        // Always ensure arrows are visible on mobile since you requested them
        prevBtn?.classList.remove('hidden');
        nextBtn?.classList.remove('hidden');
    }
}

function resetList(cat) {
    state.pointers[cat] = 0;
    handleAction(cat);
}

function shareApp() {
    const appData = {
        title: 'SG Vibes',
        text: 'Discover the best local food, shops, and music in Singapore!',
        url: 'https://upnextinsg.github.io/sg-vibes/'
    };
    if (navigator.share) {
        navigator.share(appData);
    } else {
        navigator.clipboard.writeText(appData.url);
        alert("App link copied! Spread the vibes.");
    }
}

// --- INITIALIZATION ---

window.addEventListener('DOMContentLoaded', () => {
    // 1. Setup Button Listeners
    document.getElementById('foodBtn')?.addEventListener('click', () => handleUserClick('food'));
    document.getElementById('storeBtn')?.addEventListener('click', () => handleUserClick('store'));
    document.getElementById('musicBtn')?.addEventListener('click', () => handleUserClick('music'));
    document.getElementById('app-share-fab')?.addEventListener('click', shareApp);

    // Securely bind carousel click parameters without inline code requirements
    document.getElementById('prevBtn')?.addEventListener('click', () => {
        if (state.currentCategory) moveCarousel(state.currentCategory, -1);
    });
    document.getElementById('nextBtn')?.addEventListener('click', () => {
        if (state.currentCategory) moveCarousel(state.currentCategory, 1);
    });

    // 2. Setup Navigation Interactions (One declaration only)
    const resultsDiv = document.getElementById("results");
    let touchStartX = 0;
    let isSwiping = false; 

    if (resultsDiv) {
        resultsDiv.addEventListener("touchstart", (e) => {
            touchStartX = e.touches[0].clientX;
            isSwiping = false; 
        }, { passive: true });

        resultsDiv.addEventListener("touchend", (e) => {
            // CHANGE: Bypass JS calculation on mobile screens to let native CSS scroll-snapping take over perfectly
            if (window.innerWidth <= 500) return;

            if (isSwiping) return;
            const dx = e.changedTouches[0].clientX - touchStartX;
            const threshold = 70;
            const cat = state.currentCategory;
            if (!cat || Math.abs(dx) < threshold) return;

            isSwiping = true;
            moveCarousel(cat, dx > 0 ? -1 : 1);
            setTimeout(() => { isSwiping = false; }, 400);
        }, { passive: true });
    }
    
    // 3. Tutorial & Start Logic
    const overlay = document.getElementById('tutorial-overlay');
    const closeBtn = document.getElementById('close-tutorial');
    let hasStarted = false;

    function startApp() {
        if (hasStarted) return;
        hasStarted = true;
        handleUserClick('food'); // This triggers location and loads first items
    }

    if (overlay) {
        overlay.classList.remove('hidden');
        closeBtn?.addEventListener('click', () => {
            overlay.classList.add('hidden');
            startApp();
        });
        // Failsafe start
        setTimeout(startApp, 2000);
    } else {
        startApp();
    }
});

// Keep moveCarousel at the very bottom, outside the DOMContentLoaded block
function moveCarousel(category, direction) {
    if (!category || !state.dataCache || state.dataCache.length === 0) return;
    
    const resultsDiv = document.getElementById("results");
    const max = resultsDiv.querySelectorAll('.card').length;
    
    if (window.innerWidth <= 500) {
        // Mobile behavior: Use smooth programmatic scrolling to match the native swiper track
        const cardWidth = resultsDiv.querySelector('.card')?.offsetWidth || 0;
        const gap = 12; // Matches layout gap in CSS
        resultsDiv.scrollBy({
            left: direction * (cardWidth + gap),
            behavior: 'smooth'
        });
    } else {
        // Desktop behavior: Adjust translation state offsets
        let currentOffset = state.carouselOffset[category] || 0;
        let newOffset = currentOffset + direction;
        const maxPossibleOffset = Math.max(0, max - 2);
        
        if (newOffset < 0) newOffset = 0;
        if (newOffset > maxPossibleOffset) newOffset = maxPossibleOffset;
        
        if (newOffset !== currentOffset) {
            state.carouselOffset[category] = newOffset;
            renderCarousel(category);
            state.carouselOffset[category] = newOffset;
        }
    }
}
