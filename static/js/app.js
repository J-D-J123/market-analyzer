/**
 * Market Analyzer Logic
 * Handles API fetching, DOM updates, and UI interactions.
 */

// Format numbers
const formatPrice = (num) => {
    if (isNaN(num) || num === null) return "---";
    return Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
};

const formatVol = (num) => {
    if (num === undefined || num === null || num === '' || (typeof num === 'number' && isNaN(num))) return "N/A";
    const n = Number(num);
    if (isNaN(n)) return "N/A";
    if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return n.toLocaleString();
};

const formatVal = (v, opts = {}) => {
    const { pct = false, big = false } = opts;
    if (v === undefined || v === null || v === '' || (typeof v === 'number' && isNaN(v))) return "N/A";
    if (big && (typeof v === 'number' || !isNaN(Number(v)))) return formatVol(v);
    if (pct && typeof v === 'number') return v + '%';
    if (typeof v === 'number') return Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
    return String(v);
};

// Cookie Helpers
const setCookie = (name, value, days) => {
    let expires = "";
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "") + expires + "; path=/";
};
const getCookie = (name) => {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
};

// Cache Helpers
const saveCache = (key, data) => {
    const cacheObj = { timestamp: Date.now(), data: data };
    localStorage.setItem(key, JSON.stringify(cacheObj));
};
const getCache = (key, maxAgeMins) => {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const cacheObj = JSON.parse(cached);
    const ageMins = (Date.now() - cacheObj.timestamp) / 1000 / 60;
    if (ageMins > maxAgeMins) return null;
    return cacheObj.data;
};

// Theme Initialization
const initTheme = () => {
    const theme = getCookie("terminal_theme") || "DARK";
    if (theme === "LIGHT") {
        document.body.classList.add('light-mode');
    }
    updateThemeIcon();
};

const updateThemeIcon = () => {
    const themeBtn = document.getElementById('theme-toggle');
    if (!themeBtn) return;
    const isLight = document.body.classList.contains('light-mode');
    themeBtn.innerHTML = isLight 
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
};

// Color assignment
const getColorClass = (val) => {
    if (val > 0) return 'pos';
    if (val < 0) return 'neg';
    return 'neu';
};

// Update Clock
setInterval(() => {
    const clockEl = document.getElementById('live-clock');
    if (clockEl) clockEl.innerText = new Date().toLocaleTimeString();
}, 1000);

// Market Status Logic (Simplified for brevity but kept functional)
const getMarketStatus = () => {
    const now = new Date();
    const day = now.getUTCDay();
    const hour = now.getUTCHours();
    const min = now.getUTCMinutes();
    const estHour = (hour - 4 + 24) % 24; // Rough ET conversion
    const isWeekend = day === 0 || day === 6;
    const isOpen = !isWeekend && (estHour > 9 || (estHour === 9 && min >= 30)) && estHour < 16;
    
    if (isWeekend) return { text: "MKT CLOSED", class: "mkt-closed" };
    if (isOpen) return { text: "MKT OPEN", class: "mkt-open" };
    return { text: "MKT CLOSED", class: "mkt-closed" };
};

const updateMarketStatus = () => {
    const el = document.getElementById("market-status");
    if (!el) return;
    const s = getMarketStatus();
    el.textContent = s.text;
    el.className = `market-badge ${s.class}`;
};

// Global Ticker Setter
window.setFocusedTicker = (ticker) => {
    const input = document.getElementById('cmd-input');
    if (input) input.value = ticker;
    fetchQuote(ticker);
};

document.addEventListener('click', (e) => {
    const tickerEl = e.target.closest('.clickable-ticker');
    if (tickerEl) {
        setFocusedTicker(tickerEl.dataset.ticker || tickerEl.innerText.split('\n')[0].trim());
    }
});

// Data Fetchers & Renderers
async function fetchMarketOverview() {
    try {
        const tbody = document.getElementById('market-table-body');
        if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="loading">Loading...</td></tr>';
        const res = await fetch('/api/market-overview');
        const data = await res.json();
        saveCache('market_overview', data);
        renderMarketOverview(data);
    } catch (e) { console.error("Market fetch failed", e); }
}

function renderMarketOverview(data) {
    const tbody = document.getElementById('market-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    for (const [ticker, info] of Object.entries(data)) {
        if (info.error) continue;
        const tr = document.createElement('tr');
        const cClass = getColorClass(info.change);
        tr.innerHTML = `
            <td class="clickable-ticker" data-ticker="${ticker}">${ticker.replace('^', '')}</td>
            <td class="${cClass}">${formatPrice(info.price)}</td>
            <td class="${cClass}">${info.change > 0 ? '+' : ''}${formatPrice(info.change)}</td>
            <td class="${cClass}">${info.change_pct > 0 ? '+' : ''}${info.change_pct}%</td>
        `;
        tbody.appendChild(tr);
    }
}

async function fetchActiveStocks() {
    try {
        const tbody = document.getElementById('active-table-body');
        if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="loading">Loading...</td></tr>';
        const res = await fetch('/api/equities/active');
        const data = await res.json();
        saveCache('active_stocks', data);
        renderActiveStocks(data);
    } catch (e) { console.error(e); }
}

function renderActiveStocks(data) {
    const tbody = document.getElementById('active-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (data.active && data.active.length > 0) {
        data.active.slice(0, 10).forEach(item => {
            const tr = document.createElement('tr');
            const cClass = getColorClass(item.change);
            tr.innerHTML = `
                <td class="clickable-ticker" data-ticker="${item.ticker}">${item.ticker}</td>
                <td class="${cClass}">${formatPrice(item.price)}</td>
                <td class="${cClass}">${item.change > 0 ? '+' : ''}${formatPrice(item.change)}</td>
                <td class="${cClass}">${item.change_pct > 0 ? '+' : ''}${item.change_pct}%</td>
                <td>${item.volume.toLocaleString()}</td>
            `;
            tbody.appendChild(tr);
        });

        // Render Active Stocks scrolling ticker
        const tickerContent = document.getElementById('active-ticker-content');
        if (tickerContent) {
            const tickerHtml = data.active.map(item => {
                const cClass = item.change >= 0 ? 'pos' : 'neg';
                const sign = item.change >= 0 ? '+' : '';
                return `<span class="ticker-item clickable-ticker" data-ticker="${item.ticker}" style="display:inline-block; margin-right: 2.5rem; cursor:pointer;">
                    <span style="font-weight: 600; color: var(--text-main);">${item.ticker}</span>
                    <span style="margin-left:0.5rem; color: var(--text-dim);">${formatPrice(item.price)}</span>
                    <span class="${cClass}" style="margin-left:0.5rem; font-weight:600;">${sign}${item.change_pct}%</span>
                </span>`;
            }).join('');
            tickerContent.innerHTML = tickerHtml + tickerHtml;
        }
    } else {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 2rem;">No active data today.</td></tr>';
        const tc = document.getElementById('active-ticker-content');
        if (tc) tc.innerHTML = 'No active data today.';
    }
}

async function fetchPennyStocks() {
    try {
        const tbody = document.getElementById('penny-table-body');
        if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="loading">Loading...</td></tr>';
        const res = await fetch('/api/equities/penny');
        const data = await res.json();
        saveCache('penny_stocks', data);
        renderPennyStocks(data);
    } catch (e) { console.error(e); }
}

function renderPennyStocks(data) {
    const tbody = document.getElementById('penny-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (data.penny) {
        data.penny.slice(0, 10).forEach(item => {
            const tr = document.createElement('tr');
            const cClass = getColorClass(item.change);
            tr.innerHTML = `
                <td class="clickable-ticker" data-ticker="${item.ticker}">${item.ticker}</td>
                <td class="${cClass}">${formatPrice(item.price)}</td>
                <td class="${cClass}">${item.change_pct > 0 ? '+' : ''}${item.change_pct}%</td>
                <td>${formatVol(item.volume)}</td>
            `;
            tbody.appendChild(tr);
        });
    }
}

async function fetchCmdtFx() {
    try {
        const tbody = document.getElementById('cmdt-table-body');
        if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="loading">Loading...</td></tr>';
        const res = await fetch('/api/commodities-fx');
        const data = await res.json();
        saveCache('cmdt_fx', data);
        renderCmdtFx(data);
    } catch (e) { console.error(e); }
}

function renderCmdtFx(data) {
    const tbody = document.getElementById('cmdt-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    const nameMap = { "GC=F": "Gold", "SI=F": "Silver", "CL=F": "Crude Oil", "NG=F": "Nat Gas", "EURUSD=X": "EUR/USD", "JPY=X": "USD/JPY", "GBPUSD=X": "GBP/USD" };
    for (const [ticker, info] of Object.entries(data)) {
        if (info.error) continue;
        const tr = document.createElement('tr');
        const cClass = getColorClass(info.change);
        tr.innerHTML = `
            <td class="clickable-ticker" data-ticker="${ticker}">${nameMap[ticker] || ticker}</td>
            <td class="${cClass}">${formatPrice(info.price)}</td>
            <td class="${cClass}">${info.change > 0 ? '+' : ''}${formatPrice(info.change)}</td>
            <td class="${cClass}">${info.change_pct > 0 ? '+' : ''}${info.change_pct}%</td>
        `;
        tbody.appendChild(tr);
    }
}

async function fetchNews(ticker = "SPY") {
    try {
        const container = document.getElementById('news-data');
        const tickerNameEl = document.getElementById('news-ticker-name');
        const overallEl = document.getElementById('news-overall-sentiment');
        
        if (container) container.innerHTML = '<div class="loading">Loading News...</div>';
        if (overallEl) overallEl.innerHTML = '';
        
        const res = await fetch(`/api/news?ticker=${ticker}`);
        const data = await res.json();
        
        if (tickerNameEl) tickerNameEl.innerText = `(${ticker})`;
        
        if (!container) return;
        container.innerHTML = '';
        
        if (data.news && data.news.length > 0) {
            let totalScore = 0;
            data.news.forEach(item => { totalScore += (item.score || 0); });
            const avgScore = totalScore / data.news.length;
            
            let overallSent = "NEU";
            let overallClass = "sent-neu";
            if (avgScore >= 0.15) { overallSent = "POS"; overallClass = "sent-pos"; }
            else if (avgScore <= -0.15) { overallSent = "NEG"; overallClass = "sent-neg"; }
            
            if (overallEl) {
                overallEl.innerHTML = `<span class="sent-tag ${overallClass}" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">Overall: ${overallSent}</span>`;
            }

            data.news.forEach(item => {
                const div = document.createElement('div');
                div.className = 'news-item';
                let sentClass = item.sentiment === "POS" ? "sent-pos" : (item.sentiment === "NEG" ? "sent-neg" : "sent-neu");
                div.innerHTML = `
                    <div class="news-meta">
                        <a href="${item.link}" target="_blank" class="news-source">${item.publisher}</a>
                        <span class="sent-tag ${sentClass}">${item.sentiment}</span>
                    </div>
                    <a href="${item.link}" target="_blank" class="news-title">${item.title}</a>
                `;
                container.appendChild(div);
            });
        } else {
            container.innerHTML = '<div style="color: var(--text-dim); padding: 1rem; text-align: center;">No news found.</div>';
        }
    } catch (e) { console.error(e); }
}

async function fetchTopNews() {
    try {
        const res = await fetch('/api/news/top');
        const data = await res.json();
        const content = document.getElementById('news-ticker-content');
        if (!content || !data.news) return;
        content.innerHTML = '';
        data.news.forEach(item => {
            const span = document.createElement('span');
            span.className = 'ticker-item';
            span.innerHTML = `<a href="${item.link}" target="_blank" class="ticker-link">${item.title}</a>`;
            content.appendChild(span);
        });
    } catch (e) { console.error(e); }
}

async function fetchSocial() {
    try {
        const mode = getActiveSocialMode();
        const tbody = document.getElementById('social-table-body');
        if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="loading">Loading...</td></tr>';
        const res = await fetch(`/api/social?mode=${mode}`);
        const data = await res.json();
        renderSocial(data);
    } catch (e) { console.error(e); }
}

function getActiveSocialMode() {
    const activeBtn = document.querySelector('#social-toggle .tab-btn.active');
    return activeBtn ? activeBtn.dataset.mode : 'mentions';
}

function renderSocial(data) {
    const tbody = document.getElementById('social-table-body');
    if (!tbody || !data.mentions) return;
    tbody.innerHTML = '';
    data.mentions.slice(0, 10).forEach((m, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="clickable-ticker" data-ticker="${m.ticker}">${m.ticker}</td>
            <td>${m.count}</td>
            <td>#${idx + 1}</td>
        `;
        tbody.appendChild(tr);
    });
}

const EQUITY_FIELDS = {
    quote: ["price", "change", "changepct", "open", "dayhigh", "daylow", "range", "volume", "avgvol", "mktcap", "entval", "pe"],
    fund: ["pb", "roe", "beta", "revenue", "profitmgn", "eps", "fcf", "div", "payout"]
};

async function fetchQuote(ticker) {
    try {
        const res = await fetch(`/api/quote/${ticker}`);
        const data = await res.json();
        if (data.error) return;

        document.getElementById('q-symbol').innerText = data.symbol;
        document.getElementById('q-name').innerText = data.name;
        document.getElementById('q-sector').innerText = data.sector ? `Sector: ${data.sector}` : '';
        document.getElementById('q-industry').innerText = data.industry ? `Industry: ${data.industry}` : '';

        const classStr = getColorClass(data.change);
        const priceEl = document.getElementById('q-price');
        priceEl.innerText = formatPrice(data.price);
        priceEl.className = `main-price ${classStr}`;
        
        document.getElementById('q-change').innerText = (data.change > 0 ? '+' : '') + formatVal(data.change);
        document.getElementById('q-change').className = classStr;
        document.getElementById('q-changepct').innerText = (data.change_pct > 0 ? '+' : '') + formatVal(data.change_pct) + '%';
        document.getElementById('q-changepct').className = classStr;

        document.getElementById('q-open').innerText = formatVal(data.open);
        document.getElementById('q-dayhigh').innerText = formatVal(data.day_high);
        document.getElementById('q-daylow').innerText = formatVal(data.day_low);
        document.getElementById('q-volume').innerText = formatVol(data.volume);
        document.getElementById('q-avgvol').innerText = formatVol(data.avg_volume);
        document.getElementById('q-mktcap').innerText = formatVol(data.market_cap);
        document.getElementById('q-entval').innerText = formatVol(data.enterprise_value);
        document.getElementById('q-pe').innerText = formatVal(data.pe_ratio);
        document.getElementById('q-range').innerText = `${formatVal(data.low_52w)} - ${formatVal(data.high_52w)}`;

        fetchFundamentals(ticker);
        fetchPrediction(ticker);
        fetchNews(ticker);
    } catch (e) { console.error(e); }
}

async function fetchPrediction(ticker) {
    try {
        const setField = (id, text, colorClass = null) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerText = text;
            if (colorClass) {
                el.className = colorClass;
            } else {
                el.className = '';
            }
        };

        ['30', '1y'].forEach(suffix => {
            setField(`ml-price-${suffix}`, 'Training...');
            setField(`ml-conf-${suffix}`, '...');
            setField(`ml-outlook-${suffix}`, '...');
        });
        setField('ml-updated', '...');

        const res = await fetch(`/api/predict/${ticker}`);
        const data = await res.json();
        
        if (data.error) {
            ['30', '1y'].forEach(suffix => {
                setField(`ml-price-${suffix}`, 'N/A');
                setField(`ml-outlook-${suffix}`, 'No Data', 'neu');
            });
            console.warn("Prediction error:", data.error);
            return;
        }

        // 30D
        if (data.prediction_30d) {
            const d = data.prediction_30d;
            const c = d.trend === 'UP' ? 'pos' : 'neg';
            setField('ml-price-30', formatPrice(d.price), c);
            setField('ml-conf-30', d.prob + '%', c);
            setField('ml-outlook-30', d.trend === 'UP' ? 'BULL' : 'BEAR', c);
            const acc30El = document.getElementById('ml-30d-acc');
            if (acc30El && d.accuracy != null) acc30El.innerText = `(${d.accuracy}% Accurate)`;
        }

        // 1Y
        if (data.prediction_1y && !data.prediction_1y.error) {
            const d = data.prediction_1y;
            const c = d.trend === 'UP' ? 'pos' : 'neg';
            setField('ml-price-1y', formatPrice(d.price), c);
            setField('ml-conf-1y', d.prob + '%', c);
            setField('ml-outlook-1y', d.trend === 'UP' ? 'BULL' : 'BEAR', c);
            const acc1yEl = document.getElementById('ml-1y-acc');
            if (acc1yEl && d.accuracy != null) acc1yEl.innerText = `(${d.accuracy}% Accurate)`;
        } else {
            setField('ml-price-1y', 'N/A');
            setField('ml-outlook-1y', 'Low Data', 'neu');
        }

        setField('ml-updated', data.last_trained);

    } catch (e) {
        console.error("Prediction fetch failed", e);
    }
}

async function fetchFundamentals(ticker) {
    try {
        const res = await fetch(`/api/fundamentals/${ticker}`);
        const data = await res.json();
        if (data.error) return;
        
        const setField = (id, val, opts = {}) => {
            const el = document.getElementById(id);
            if (el) el.innerText = formatVal(val, opts);
        };

        setField('f-pb', data.pb);
        setField('f-roe', data.roe, { pct: true });
        setField('f-beta', data.beta);
        setField('f-revenue', data.total_revenue, { big: true });
        setField('f-profitmgn', data.profit_margin, { pct: true });
        setField('f-eps', data.trailing_eps);
        setField('f-fcf', data.free_cashflow, { big: true });
        setField('f-div', data.div_yld, { pct: true });
        setField('f-payout', data.payout_ratio, { pct: true });
    } catch (e) { console.error(e); }
}

// MOBILE NAVIGATION LOGIC
function initMobileNav() {
    const navButtons = document.querySelectorAll('.mobile-nav-btn');
    const sections = [
        document.getElementById('market-data-column'),
        document.getElementById('equity-detail-column'),
        document.getElementById('news-column')
    ];

    // Default to Market section on mobile
    if (window.innerWidth <= 768) {
        if (sections[0]) sections[0].classList.add('mobile-active');
    }

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-section');
            
            // Update active button state
            navButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Switch visible section
            sections.forEach(sec => {
                if (sec && sec.id === targetId) {
                    sec.classList.add('mobile-active');
                } else if (sec) {
                    sec.classList.remove('mobile-active');
                }
            });

            // Scroll to top when switching
            window.scrollTo(0, 0);
        });
    });

    // Handle window resize to ensure desktop layout isn't affected
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            sections.forEach(sec => {
                if (sec) sec.classList.remove('mobile-active');
            });
        } else {
            // Re-apply mobile-active to current selection if missing
            const activeBtn = document.querySelector('.mobile-nav-btn.active');
            if (activeBtn) {
                const targetId = activeBtn.getAttribute('data-section');
                const targetSec = document.getElementById(targetId);
                if (targetSec) targetSec.classList.add('mobile-active');
            }
        }
    });
}

// Initialization and Event Listeners
window.onload = () => {
    initTheme();
    updateMarketStatus();
    initMlScreener();
    initMobileNav();
    
    document.getElementById('theme-toggle').addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        const theme = document.body.classList.contains('light-mode') ? "LIGHT" : "DARK";
        setCookie("terminal_theme", theme, 365);
        updateThemeIcon();
    });

    document.getElementById('cmd-btn').addEventListener('click', () => {
        const ticker = document.getElementById('cmd-input').value.trim().toUpperCase();
        if (ticker) fetchQuote(ticker);
    });

    document.getElementById('cmd-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('cmd-btn').click();
    });

    document.querySelectorAll('#social-toggle .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#social-toggle .tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            fetchSocial();
        });
    });

    // Initial Data Fetch
    fetchMarketOverview();
    fetchActiveStocks();
    fetchPennyStocks();
    fetchCmdtFx();
    fetchTopNews();
    fetchSocial();
    fetchQuote("AAPL"); // Original: fetchQuote("AAPL")

    // Map Initializations
    setTimeout(() => {
        initWeatherMap();
        initFlightMap();
    }, 500); // Give DOM a moment to settle

    // Background Refresh
    setInterval(() => {
        fetchMarketOverview();
        fetchCmdtFx();
        fetchTopNews();
        updateMarketStatus();
    }, 60000);
};

// -----------------------------------------------------------------------------
// MAPS INTEGRATION (Leaflet.js)
// -----------------------------------------------------------------------------

let weatherMap;
let weatherRadarLayer;
let flightMap;
let flightLayerGroup;

// Free Dark Map Tiles
const DARK_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// --- WEATHER (RainViewer) ---
async function initWeatherMap() {
    const container = document.getElementById('weather-map');
    if (!container || typeof L === 'undefined') return;

    // Center on US globally
    weatherMap = L.map('weather-map', { 
        zoomControl: false,
        attributionControl: false 
    }).setView([39.8283, -98.5795], 3);

    L.tileLayer(DARK_TILE_URL, { maxZoom: 19 }).addTo(weatherMap);

    // Fetch latest radar timestamps
    try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await res.json();
        if (data.radar && data.radar.past && data.radar.past.length > 0) {
            // Get the most recent timestamp
            const latest = data.radar.past[data.radar.past.length - 1];
            
            // Add radar layer
            weatherRadarLayer = L.tileLayer(`${data.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`, {
                opacity: 0.6,
                transparent: true,
                maxZoom: 19
            }).addTo(weatherMap);

            // Add timestamp label
            const timeDate = new Date(latest.time * 1000);
            const tsLabel = document.createElement('div');
            tsLabel.className = 'weather-timestamp';
            tsLabel.innerText = `Radar: ${timeDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
            container.appendChild(tsLabel);
        }
    } catch(e) {
        console.error("RainViewer Error:", e);
    }
}

// -----------------------------------------------------------------------------
// ML SCREENER
// -----------------------------------------------------------------------------
function initMlScreener() {
    const btnOpen = document.getElementById('btn-ml-screener');
    const btnClose = document.getElementById('close-ml-modal');
    const btnStart = document.getElementById('start-ml-scan');
    const modal = document.getElementById('ml-screener-modal');

    if (btnOpen) btnOpen.addEventListener('click', () => { modal.style.display = 'flex'; });
    if (btnClose) btnClose.addEventListener('click', () => { modal.style.display = 'none'; });
    
    // Close on background click
    window.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });

    if (btnStart) btnStart.addEventListener('click', runMlScreener);
}

async function runMlScreener() {
    const statusEl = document.getElementById('ml-screener-status');
    const progressCont = document.getElementById('ml-progress-bar-container');
    const progressBar = document.getElementById('ml-progress-bar');
    const resultsCont = document.getElementById('ml-results-container');
    const btnStart = document.getElementById('start-ml-scan');
    
    btnStart.disabled = true;
    btnStart.innerText = "Scanning...";
    resultsCont.style.display = 'none';
    progressCont.style.display = 'block';
    progressBar.style.width = '0%';
    statusEl.innerText = "Fetching Most Active stocks...";

    try {
        const res = await fetch('/api/equities/active');
        const data = await res.json();
        
        if (!data.active || data.active.length === 0) {
            statusEl.innerText = "No active stocks found to scan.";
            btnStart.disabled = false;
            btnStart.innerText = "Start Scan";
            return;
        }

        const stocksToScan = data.active.slice(0, 10);
        const results = [];

        for (let i = 0; i < stocksToScan.length; i++) {
            const stock = stocksToScan[i];
            statusEl.innerText = `Analyzing ${stock.ticker} (${i+1}/${stocksToScan.length})...`;
            progressBar.style.width = `${((i) / stocksToScan.length) * 100}%`;
            
            try {
                const pRes = await fetch(`/api/predict/${stock.ticker}`);
                const pData = await pRes.json();
                
                if (!pData.error && pData.prediction_30d && pData.prediction_1y && !pData.prediction_1y.error) {
                    const currentPrice = stock.price;
                    const p30 = pData.prediction_30d;
                    const p1y = pData.prediction_1y;
                    
                    const ret30 = ((p30.price - currentPrice) / currentPrice) * 100;
                    const ret1y = ((p1y.price - currentPrice) / currentPrice) * 100;

                    results.push({
                        ticker: stock.ticker,
                        ret30,
                        conf30: p30.prob,
                        ret1y,
                        conf1y: p1y.prob
                    });
                }
            } catch (err) {
                console.warn(`Failed to predict ${stock.ticker}`, err);
            }
        }
        
        progressBar.style.width = '100%';
        
        if (results.length === 0) {
            statusEl.innerText = "Scan completed, but no valid predictions were generated.";
        } else {
            statusEl.innerText = "Scan complete! Top algorithmic picks:";
            
            const best30d = [...results].sort((a,b) => b.ret30 - a.ret30)[0];
            const best1y = [...results].sort((a,b) => b.ret1y - a.ret1y)[0];
            
            const c30 = document.getElementById('ml-winner-30d');
            c30.dataset.ticker = best30d.ticker;
            c30.querySelector('.winner-ticker').innerText = best30d.ticker;
            const r30El = c30.querySelector('.winner-return');
            r30El.innerText = (best30d.ret30 > 0 ? '+' : '') + best30d.ret30.toFixed(2) + '%';
            r30El.className = `winner-return ${best30d.ret30 > 0 ? 'pos' : 'neg'}`;
            c30.querySelector('.winner-conf').innerText = `Conf: ${best30d.conf30.toFixed(1)}%`;

            const c1y = document.getElementById('ml-winner-1y');
            c1y.dataset.ticker = best1y.ticker;
            c1y.querySelector('.winner-ticker').innerText = best1y.ticker;
            const r1yEl = c1y.querySelector('.winner-return');
            r1yEl.innerText = (best1y.ret1y > 0 ? '+' : '') + best1y.ret1y.toFixed(2) + '%';
            r1yEl.className = `winner-return ${best1y.ret1y > 0 ? 'pos' : 'neg'}`;
            c1y.querySelector('.winner-conf').innerText = `Conf: ${best1y.conf1y.toFixed(1)}%`;

            progressCont.style.display = 'none';
            resultsCont.style.display = 'flex';
        }
    } catch (e) {
        console.error(e);
        statusEl.innerText = "An error occurred during scanning.";
    }

    btnStart.disabled = false;
    btnStart.innerText = "Re-Scan";
}

// --- FLIGHTS (OpenSky) ---
async function initFlightMap() {
    const container = document.getElementById('flight-map');
    if (!container || typeof L === 'undefined') return;

    flightMap = L.map('flight-map', { 
        zoomControl: false, 
        attributionControl: false 
    }).setView([39.8283, -98.5795], 4);

    L.tileLayer(DARK_TILE_URL, { maxZoom: 19 }).addTo(flightMap);
    flightLayerGroup = L.layerGroup().addTo(flightMap);

    fetchFlights();
    // Refresh flights every 1.5 minutes (OpenSky caches data to 10s intervals, limit calls)
    setInterval(fetchFlights, 90000);
}

const airplaneIconHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M22 16.33L12.5 10.5V3.5C12.5 2.12 11.38 1 10 1C8.62 1 7.5 2.12 7.5 3.5V10.5L-2 16.33V18.5L7.5 15.5V20.5L5 22.5V24L10 22.5L15 24V22.5L12.5 20.5V15.5L22 18.5V16.33Z"/>
    </svg>
`;

async function fetchFlights() {
    try {
        // We limit to US/Americas bounding box to save rendering power
        // lamin, lomin, lamax, lomax
        const bbox = 'lamin=24&lomin=-125&lamax=50&lomax=-66';
        const res = await fetch(`https://opensky-network.org/api/states/all?${bbox}`);
        if (!res.ok) throw new Error("OpenSky limit reached or error");
        const data = await res.json();
        
        if (data.states && flightLayerGroup) {
            flightLayerGroup.clearLayers();
            
            // Limit to max 400 flights to avoid freezing browser UI entirely
            const flights = data.states.slice(0, 400); 
            
            flights.forEach(f => {
                const callsign = f[1] ? f[1].trim() : 'N/A';
                const origin = f[2];
                const lng = f[5];
                const lat = f[6];
                const alt = f[7] ? Math.round(f[7] * 3.28084) : 0; // m to ft
                const velocity = f[9] ? Math.round(f[9] * 1.94384) : 0; // m/s to knots
                const trueTrack = f[10] || 0; // heading

                if (lat && lng) {
                    const icon = L.divIcon({
                        className: 'airplane-icon',
                        html: `<div style="transform: rotate(${trueTrack}deg); width: 100%; height: 100%;">${airplaneIconHTML}</div>`,
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    });

                    const marker = L.marker([lat, lng], { icon }).bindPopup(`
                        <div style="font-family: var(--font-main); font-size: 0.8rem;">
                            <strong style="color: var(--primary); font-size: 1rem;">${callsign}</strong><br>
                            Origin: ${origin}<br>
                            Alt: ${alt} ft<br>
                            Speed: ${velocity} kt<br>
                            Hdg: ${Math.round(trueTrack)}&deg;
                        </div>
                    `);
                    flightLayerGroup.addLayer(marker);
                }
            });
        }
    } catch(e) {
        console.error("OpenSky Error (Likely Rate Limit):", e);
    }
}

