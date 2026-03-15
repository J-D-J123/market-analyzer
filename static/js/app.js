/**
 * Bloomberg Terminal Clone Logic
 * Handles API fetching, DOM updates, and Plotly chart rendering.
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
    const cacheObj = {
        timestamp: Date.now(),
        data: data
    };
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
        document.getElementById('theme-toggle').innerText = "THEME: LIGHT";
    }
};

// Color assignment based on positive/negative
const getColorClass = (val) => {
    if (val > 0) return 'pos';
    if (val < 0) return 'neg';
    return 'neu';
};

// Update Clock
setInterval(() => {
    const now = new Date();
    const clockEl = document.getElementById('live-clock-time');
    if (clockEl) clockEl.innerText = now.toTimeString().split(' ')[0];
}, 1000);

// US Market (NYSE/NASDAQ) status: open/closed, weekend, holiday
const ET = "America/New_York";
function getETParts(d) {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "numeric", minute: "numeric", hour12: false, day: "numeric", month: "numeric", year: "numeric", weekday: "short" });
    const parts = {};
    f.formatToParts(d).forEach(p => { if (p.type !== "literal") parts[p.type] = p.value; });
    return parts;
}
function getEasterYear(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const g = Math.floor((8 * b + 13) / 25), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 19 * l) / 433), n = Math.floor((h + l - 7 * m + 90) / 25), p = (h + l - 7 * m + 33 * n + 19) % 32;
    return { month: n, day: p };
}
function getUSMarketHolidays(year) {
    const holidays = [];
    const add = (m, d) => holidays.push({ month: m, day: d });
    add(1, 1);   // New Year's Day
    const mlk = new Date(year, 0, 1); let n = 0;
    while (mlk.getDay() !== 1) mlk.setDate(mlk.getDate() + 1);
    mlk.setDate(mlk.getDate() + 14); add(mlk.getMonth() + 1, mlk.getDate()); // 3rd Mon Jan
    const pres = new Date(year, 1, 1); while (pres.getDay() !== 1) pres.setDate(pres.getDate() + 1);
    pres.setDate(pres.getDate() + 14); add(pres.getMonth() + 1, pres.getDate()); // 3rd Mon Feb
    const easterDate = new Date(year, getEasterYear(year).month - 1, getEasterYear(year).day);
    easterDate.setDate(easterDate.getDate() - 2);
    add(easterDate.getMonth() + 1, easterDate.getDate()); // Good Friday
    const mem = new Date(year, 4, 31); while (mem.getDay() !== 1) mem.setDate(mem.getDate() - 1);
    add(mem.getMonth() + 1, mem.getDate()); // Last Mon May
    add(6, 19);  // Juneteenth
    add(7, 4);   // Independence Day
    const labor = new Date(year, 8, 1); while (labor.getDay() !== 1) labor.setDate(labor.getDate() + 1);
    add(labor.getMonth() + 1, labor.getDate()); // 1st Mon Sep
    const thanksgiving = new Date(year, 10, 1); let th = 0;
    for (let i = 1; i <= 28; i++) { thanksgiving.setDate(i); if (thanksgiving.getDay() === 4) th++; if (th === 4) break; }
    add(thanksgiving.getMonth() + 1, thanksgiving.getDate()); // 4th Thu Nov
    add(12, 25); // Christmas
    return holidays;
}
function getMarketStatus() {
    const now = new Date();
    const p = getETParts(now);
    const hour = parseInt(p.hour, 10), min = parseInt(p.minute, 10);
    const weekday = p.weekday;
    const month = parseInt(p.month, 10), day = parseInt(p.day, 10);
    const isWeekend = weekday === "Sat" || weekday === "Sun";
    const year = parseInt(p.year, 10);
    const holidays = getUSMarketHolidays(year);
    const isHoliday = holidays.some(h => h.month === month && h.day === day);
    const mins = hour * 60 + min;
    const openMins = 9 * 60 + 30, closeMins = 16 * 60;
    const isRegularHours = mins >= openMins && mins < closeMins;
    if (isHoliday) return { text: "MKT CLOSED (HOLIDAY)", title: "US market closed for holiday" };
    if (isWeekend) return { text: "MKT CLOSED (WEEKEND)", title: "US market closed – weekend" };
    if (isRegularHours) return { text: "MKT OPEN", title: "US market open (9:30 AM – 4:00 PM ET)" };
    if (mins < openMins) return { text: "MKT CLOSED (PRE-MKT)", title: "US market closed – pre-market" };
    return { text: "MKT CLOSED (AFTER-HRS)", title: "US market closed – after hours" };
}
function updateMarketStatus() {
    const el = document.getElementById("market-status");
    if (!el) return;
    const s = getMarketStatus();
    el.textContent = s.text;
    el.title = s.title;
    el.classList.toggle("mkt-open", s.text === "MKT OPEN");
    el.classList.toggle("mkt-closed", s.text !== "MKT OPEN");
}
updateMarketStatus();
setInterval(updateMarketStatus, 60000);

// Global function to update focused stock
window.setFocusedTicker = (ticker) => {
    document.getElementById('cmd-input').value = ticker;
    fetchQuote(ticker);
};

// Delegate clicks for tickers
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('clickable-ticker')) {
        setFocusedTicker(e.target.dataset.ticker || e.target.innerText);
    }
});

async function fetchActiveStocks() {
    try {
        const res = await fetch('/api/equities/active');
        const data = await res.json();
        saveCache('active_stocks', data);
        renderActiveStocks(data);
    } catch (e) {
        console.error("Active stock fetch failed", e);
    }
}

function renderActiveStocks(data) {
    const tbody = document.getElementById('active-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (data.active && data.active.length > 0) {
        data.active.forEach(item => {
            const tr = document.createElement('tr');
            const cClass = getColorClass(item.change);
            tr.innerHTML = `
                <td class="clickable-ticker" data-ticker="${item.ticker}">${item.ticker}</td>
                <td class="${cClass}">${formatPrice(item.price)}</td>
                <td class="${cClass}">${item.change_pct > 0 ? '+' : ''}${formatPrice(item.change_pct)}%</td>
                <td>${formatVol(item.volume)}</td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="4" class="neu">DATA UNAVAILABLE</td></tr>';
    }
}

async function fetchPennyStocks() {
    try {
        const res = await fetch('/api/equities/penny');
        const data = await res.json();
        saveCache('penny_stocks', data);
        renderPennyStocks(data);
    } catch (e) {
        console.error("Penny stock fetch failed", e);
    }
}

function renderPennyStocks(data) {
    const tbody = document.getElementById('penny-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (data.penny && data.penny.length > 0) {
        data.penny.forEach(item => {
            const tr = document.createElement('tr');
            const cClass = getColorClass(item.change);
            tr.innerHTML = `
                <td class="clickable-ticker" data-ticker="${item.ticker}">${item.ticker}</td>
                <td class="${cClass}">${formatPrice(item.price)}</td>
                <td class="${cClass}">${item.change_pct > 0 ? '+' : ''}${formatPrice(item.change_pct)}%</td>
                <td>${formatVol(item.volume)}</td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="4" class="neu">DATA UNAVAILABLE</td></tr>';
    }
}

// ==========================================
// API FETCHERS
// ==========================================

async function fetchMarketOverview() {
    try {
        const res = await fetch('/api/market-overview');
        const data = await res.json();
        saveCache('market_overview', data);
        renderMarketOverview(data);
    } catch (e) {
        console.error("Market fetch failed", e);
    }
}

function renderMarketOverview(data) {
    const tbody = document.getElementById('market-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    for (const [ticker, info] of Object.entries(data)) {
        if (info.error) continue;

        const tr = document.createElement('tr');
        const cClass = getColorClass(info.change);

        // Generate extremely basic inline sparkline
        const spark = info.sparkline;
        let sparkStr = "";
        if (spark && spark.length > 0) {
            const min = Math.min(...spark);
            const max = Math.max(...spark);
            const sparkChars = " ▂▃▄▅▆▇█";
            spark.forEach(p => {
                if (max === min) sparkStr += "▄";
                else {
                    const idx = Math.floor(((p - min) / (max - min)) * 7);
                    sparkStr += sparkChars[idx] || " ";
                }
            });
            sparkStr = sparkStr.substring(sparkStr.length - 10);
        }

        tr.innerHTML = `
            <td class="clickable-ticker" data-ticker="${ticker}">${ticker.replace('^', '')}</td>
            <td class="${cClass}">${formatPrice(info.price)}</td>
            <td class="${cClass}">${info.change > 0 ? '+' : ''}${formatPrice(info.change)}</td>
            <td class="${cClass}">${info.change_pct > 0 ? '+' : ''}${formatPrice(info.change_pct)}%</td>
            <td class="${cClass}">${sparkStr}</td>
        `;
        tbody.appendChild(tr);
    }
}

async function fetchCmdtFx() {
    try {
        const res = await fetch('/api/commodities-fx');
        const data = await res.json();
        saveCache('cmdt_fx', data);
        renderCmdtFx(data);
    } catch (e) { console.error("CMDT fetch failed"); }
}

function renderCmdtFx(data) {
    const tbody = document.getElementById('cmdt-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const nameMap = {
        "GC=F": "GOLD", "SI=F": "SILVER", "CL=F": "CRUDE OIL", "NG=F": "NAT GAS",
        "EURUSD=X": "EUR/USD", "JPY=X": "USD/JPY", "GBPUSD=X": "GBP/USD"
    };

    for (const [ticker, info] of Object.entries(data)) {
        if (info.error) continue;
        const tr = document.createElement('tr');
        const cClass = getColorClass(info.change);
        const name = nameMap[ticker] || ticker;

        tr.innerHTML = `
            <td class="clickable-ticker" data-ticker="${ticker}">${name}</td>
            <td class="${cClass}">${formatPrice(info.price)}</td>
            <td class="${cClass}">${info.change > 0 ? '+' : ''}${formatPrice(info.change)}</td>
            <td class="${cClass}">${info.change_pct > 0 ? '+' : ''}${formatPrice(info.change_pct)}%</td>
        `;
        tbody.appendChild(tr);
    }
}

async function fetchNews(ticker = "SPY") {
    try {
        const res = await fetch(`/api/news?ticker=${ticker}`);
        const data = await res.json();
        const container = document.getElementById('news-data');
        container.innerHTML = '';

        if (data.news && data.news.length > 0) {
            data.news.forEach(item => {
                const div = document.createElement('div');
                div.className = 'news-item';

                let sentClass = "sent-neu";
                if (item.sentiment === "POS") sentClass = "sent-pos";
                if (item.sentiment === "NEG") sentClass = "sent-neg";

                const link = (item.link && item.link !== '#') ? item.link : '#';
                div.innerHTML = `
                    <a href="${link}" target="_blank" rel="noopener noreferrer" class="news-source" title="Open at ${item.publisher}">${item.publisher}</a>
                    <a href="${link}" target="_blank" rel="noopener noreferrer" class="news-title">${item.title}</a>
                    <span class="sent-tag ${sentClass}">${item.sentiment}</span>
                `;
                container.appendChild(div);
            });
        } else {
            container.innerHTML = '<div class="neu">NO NEWS ITEMS FOR RELEVANT QUERY.</div>';
        }
    } catch (e) { console.error(e); }
}

async function fetchTopNews() {
    try {
        const res = await fetch('/api/news/top');
        const data = await res.json();
        const content = document.getElementById('news-ticker-content');
        if (!content) return;

        if (data.news && data.news.length > 0) {
            content.innerHTML = '';
            data.news.forEach((item, i) => {
                const wrap = document.createElement('span');
                wrap.className = 'ticker-item';
                const a = document.createElement('a');
                a.href = item.link || '#';
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.className = 'ticker-link';
                a.textContent = item.title;
                a.title = (item.publisher ? item.publisher + ': ' : '') + item.title;
                wrap.appendChild(a);
                if (i < data.news.length - 1) {
                    const sep = document.createElement('span');
                    sep.className = 'ticker-sep';
                    sep.setAttribute('aria-hidden', 'true');
                    sep.textContent = '  \u2022  ';
                    wrap.appendChild(sep);
                }
                content.appendChild(wrap);
            });
        }
    } catch (e) { console.error("Top news fetch failed", e); }
}

let currentSocialMode = 'mentions';

async function fetchSocial() {
    try {
        const res = await fetch(`/api/social?mode=${currentSocialMode}`);
        const data = await res.json();
        saveCache(`social_data_${currentSocialMode}`, data);
        renderSocial(data);
    } catch (e) { console.error(e); }
}

function renderSocial(data) {
    const tbody = document.getElementById('social-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (data.mentions && data.mentions.length > 0) {
        data.mentions.forEach((m, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="clickable-ticker amber" data-ticker="${m.ticker}">${m.ticker}</td>
                <td>${m.count}</td>
                <td>#${idx + 1}</td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="3">NO SIGNIFICANT SOCIAL DATA</td></tr>';
    }
}

async function fetchFundamentals(ticker) {
    try {
        const res = await fetch(`/api/fundamentals/${ticker}`);
        const data = await res.json();
        if (data.error) return;

        const set = (id, val, opts = {}) => {
            const el = document.getElementById(id);
            if (el) el.innerText = formatVal(val, opts);
        };

        set('f-fpe', data.fpe);
        set('f-peg', data.peg);
        set('f-pb', data.pb);
        set('f-roe', data.roe, { pct: true });
        set('f-beta', data.beta);
        set('f-evrev', data.ev_to_revenue);
        set('f-evebitda', data.ev_to_ebitda);
        set('f-book', data.book_value);
        set('f-target', data.target_mean_price);
        set('f-rec', data.recommendation);

        set('f-eps', data.trailing_eps);
        set('f-fwdeps', data.forward_eps);
        set('f-revsh', data.revenue_per_share);
        set('f-revenue', data.total_revenue, { big: true });
        set('f-profitmgn', data.profit_margin, { pct: true });
        set('f-opmgn', data.operating_margin, { pct: true });

        set('f-roa', data.roa, { pct: true });
        set('f-debteq', data.debt_to_equity);
        set('f-currentr', data.current_ratio);
        set('f-quickr', data.quick_ratio);

        set('f-fcf', data.free_cashflow, { big: true });
        set('f-opcf', data.operating_cashflow, { big: true });
        set('f-div', data.div_yld, { pct: true });
        set('f-payout', data.payout_ratio, { pct: true });

        set('f-earngr', data.earnings_growth, { pct: true });
        set('f-revgr', data.revenue_growth, { pct: true });
        set('f-eqgr', data.earnings_quarterly_growth, { pct: true });

        set('f-analysts', data.number_of_analysts);
        set('f-shortpct', data.short_pct_float, { pct: true });
        set('f-shortrat', data.short_ratio);

        set('f-totalassets', data.total_assets, { big: true });
        set('f-yield', data.yield, { pct: true });
        set('f-expense', data.expense_ratio, { pct: true });
    } catch (e) { }
}

const EQUITY_QUOTE_IDS = [
    "price", "change", "changepct", "open", "dayhigh", "daylow", "bid", "ask", "volume", "avgvol",
    "mktcap", "entval", "pe", "range", "50d", "200d"
];
const EQUITY_FUND_IDS = [
    "fpe", "peg", "pb", "roe", "beta", "evrev", "evebitda", "book", "target", "rec",
    "eps", "fwdeps", "revsh", "revenue", "profitmgn", "opmgn", "roa", "debteq", "currentr", "quickr",
    "fcf", "opcf", "div", "payout", "earngr", "revgr", "eqgr", "analysts", "shortpct", "shortrat",
    "totalassets", "yield", "expense"
];

function setEquityPlaceholder(id, text = "N/A") {
    const el = document.getElementById(id);
    if (el) { el.innerText = text; el.className = "value"; }
}

async function fetchQuote(ticker) {
    EQUITY_QUOTE_IDS.forEach(id => setEquityPlaceholder(`q-${id}`, "---"));
    EQUITY_FUND_IDS.forEach(id => setEquityPlaceholder(`f-${id}`, "---"));
    document.getElementById('q-symbol').innerText = "LOADING...";
    document.getElementById('q-name').innerText = "Fetching data...";
    setEquityPlaceholder('q-sector', '');
    setEquityPlaceholder('q-industry', '');
    setEquityPlaceholder('q-type', '');

    try {
        const res = await fetch(`/api/quote/${ticker}`);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        document.getElementById('q-symbol').innerText = data.symbol;
        document.getElementById('q-name').innerText = data.name;
        const meta = document.getElementById('quote-meta');
        if (meta) {
            const sector = data.sector || '';
            const industry = data.industry || '';
            const qtype = (data.quote_type || 'EQUITY').toUpperCase();
            document.getElementById('q-sector').textContent = sector ? `Sector: ${sector}` : '';
            document.getElementById('q-industry').textContent = industry ? `Industry: ${industry}` : '';
            document.getElementById('q-type').textContent = qtype ? `Type: ${qtype}` : '';
        }

        const classStr = 'value ' + getColorClass(data.change);

        document.getElementById('q-price').innerText = formatVal(data.price);
        document.getElementById('q-price').className = classStr;

        document.getElementById('q-change').innerText = (data.change > 0 ? '+' : '') + formatVal(data.change);
        document.getElementById('q-change').className = classStr;

        document.getElementById('q-changepct').innerText = (data.change_pct != null ? (data.change_pct > 0 ? '+' : '') + formatVal(data.change_pct) + '%' : 'N/A');
        document.getElementById('q-changepct').className = classStr;

        document.getElementById('q-open').innerText = formatVal(data.open);
        document.getElementById('q-dayhigh').innerText = formatVal(data.day_high);
        document.getElementById('q-daylow').innerText = formatVal(data.day_low);
        document.getElementById('q-bid').innerText = formatVal(data.bid);
        document.getElementById('q-ask').innerText = formatVal(data.ask);
        document.getElementById('q-volume').innerText = formatVol(data.volume);
        document.getElementById('q-avgvol').innerText = formatVol(data.avg_volume);
        document.getElementById('q-mktcap').innerText = formatVol(data.market_cap);
        document.getElementById('q-entval').innerText = formatVol(data.enterprise_value);
        document.getElementById('q-pe').innerText = formatVal(data.pe_ratio);
        document.getElementById('q-range').innerText = `${formatVal(data.low_52w)} - ${formatVal(data.high_52w)}`;
        document.getElementById('q-50d').innerText = formatVal(data.fifty_day_avg);
        document.getElementById('q-200d').innerText = formatVal(data.two_hundred_day_avg);

        fetchFundamentals(ticker);
        fetchNews(ticker);

    } catch (e) {
        document.getElementById('q-symbol').innerText = "ERROR";
        document.getElementById('q-name').innerText = "TICKER NOT FOUND OR DATA UNAVAILABLE";
        console.error(e);
    }
}


// ==========================================
// INIT AND COMMAND LINE
// ==========================================

document.getElementById('cmd-btn').addEventListener('click', () => {
    let raw = document.getElementById('cmd-input').value.trim().toUpperCase();
    if (raw) {
        let ticker = raw.split(' ')[0];
        fetchQuote(ticker);
    }
});
document.getElementById('cmd-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('cmd-btn').click();
});

// Run Initial Data Fetches
window.onload = () => {
    initTheme();

    document.getElementById('theme-toggle').addEventListener('click', () => {
        const isLight = document.body.classList.toggle('light-mode');
        const theme = isLight ? "LIGHT" : "DARK";
        document.getElementById('theme-toggle').innerText = "THEME: " + theme;
        setCookie("terminal_theme", theme, 365);
    });

    // Strategy: Load from cache first, then fetch background if old.
    // If cache is NULL or > 10 mins old, fetch immediately.
    const marketCache = getCache('market_overview', 10);
    if (marketCache) renderMarketOverview(marketCache);
    else fetchMarketOverview();

    const activeCache = getCache('active_stocks', 10);
    if (activeCache) renderActiveStocks(activeCache);
    else fetchActiveStocks();

    const pennyCache = getCache('penny_stocks', 10);
    if (pennyCache) renderPennyStocks(pennyCache);
    else fetchPennyStocks();

    // Setup social toggles
    document.querySelectorAll('#social-toggle .toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#social-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            currentSocialMode = e.target.getAttribute('data-mode');
            
            // Update table header text
            const th = document.getElementById('social-metric-header');
            if (currentSocialMode === 'trades') {
                th.innerText = 'PUBLIC TRADES (24H)';
            } else {
                th.innerText = 'MENTIONS (24H)';
            }
            
            const socialCache = getCache(`social_data_${currentSocialMode}`, 10);
            if (socialCache) {
                renderSocial(socialCache);
            } else {
                document.getElementById('social-table-body').innerHTML = '<tr><td colspan="3" class="loading">Loading...</td></tr>';
                fetchSocial();
            }
        });
    });

    const socialCacheInit = getCache(`social_data_${currentSocialMode}`, 10);
    if (socialCacheInit) renderSocial(socialCacheInit);
    else fetchSocial();

    fetchCmdtFx();
    fetchTopNews();
    fetchQuote("AAPL");

    // Refresh cycles
    setInterval(() => {
        fetchMarketOverview();
        fetchCmdtFx();
        fetchTopNews();
    }, 30000);
    setInterval(() => {
        fetchActiveStocks();
        fetchPennyStocks();
    }, 60000);
    setInterval(() => {
        fetchSocial();
        const current = document.getElementById('q-symbol').innerText;
        if (current && current !== "LOADING..." && current !== "ERROR") {
            fetchQuote(current);
        }
    }, 300000);
};
