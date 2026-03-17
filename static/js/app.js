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
    if (e.target.classList.contains('clickable-ticker')) {
        setFocusedTicker(e.target.dataset.ticker || e.target.innerText);
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
    if (data.active) {
        data.active.slice(0, 10).forEach(item => {
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
        fetchNews(ticker);
    } catch (e) { console.error(e); }
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

// Initialization and Event Listeners
window.onload = () => {
    initTheme();
    updateMarketStatus();
    
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
    fetchQuote("AAPL");

    // Background Refresh
    setInterval(() => {
        fetchMarketOverview();
        fetchCmdtFx();
        fetchTopNews();
        updateMarketStatus();
    }, 60000);
};
