from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import JSONResponse
import yfinance as yf
from textblob import TextBlob
import requests
import os
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from dotenv import load_dotenv
from ml_model import StockPredictor

load_dotenv()  # Load variables from .env file into os.environ

app = FastAPI(title="Market Analyzer")

# --- API Keys ---
NEWS_API_KEY     = os.environ.get("NEWS_API_KEY")
FINNHUB_API_KEY  = os.environ.get("FINNHUB_API_KEY")
ALPHAVANTAGE_KEY = os.environ.get("ALPHAVANTAGE_KEY")

# --- yfinance configuration ---
# yfinance >= 0.2.59 automatically uses curl_cffi if installed.
# We keep these for fallback or non-yfinance requests.
try:
    from curl_cffi import requests as curl_requests
    yf_session = curl_requests.Session(impersonate="chrome110")
except ImportError:
    yf_session = requests.Session()

dl_session = requests.Session()
dl_session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
})

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _num(v, decimals=2):
    if v is None or (isinstance(v, float) and (v != v or abs(v) == float('inf'))):
        return None
    try:
        n = float(v)
        return round(n, decimals) if decimals is not None else n
    except (TypeError, ValueError):
        return None

def _pct(v):
    n = _num(v, 2)
    return (round(n * 100, 2) if n is not None and abs(n) < 10 else n) if n is not None else None

def _get_attr(obj, *keys, default=None):
    for k in keys:
        try:
            if hasattr(obj, "get"):
                v = obj.get(k)
            else:
                v = getattr(obj, k, None) or getattr(obj, k.replace("_", ""), None)
            if v is not None and (not isinstance(v, float) or v == v):
                return v
        except Exception:
            pass
    return default

def _sentiment(title):
    blob  = TextBlob(title)
    score = blob.sentiment.polarity
    label = "POS" if score > 0.1 else ("NEG" if score < -0.1 else "NEU")
    return label, round(score, 2)

# ---------------------------------------------------------------------------
# Static / templates
# ---------------------------------------------------------------------------

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

@app.get("/")
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

# ---------------------------------------------------------------------------
# Market Overview
# ---------------------------------------------------------------------------

@app.get("/api/market-overview")
async def get_market_overview():
    tickers = ["^GSPC", "^DJI", "^IXIC", "^RUT", "^FTSE", "^GDAXI", "^N225", "^HSI", "^VIX"]
    data = {}
    for ticker_str in tickers:
        try:
            ticker = yf.Ticker(ticker_str)
            hist   = ticker.history(period="2d", interval="1m")
            if len(hist) > 0:
                last_price = hist['Close'].iloc[-1]
                try:
                    prev_close = ticker.fast_info.previous_close
                except Exception:
                    prev_close = hist['Close'].iloc[0] if len(hist) > 1 else last_price
                change     = last_price - prev_close
                change_pct = (change / prev_close) * 100 if prev_close else 0
                sparkline  = hist['Close'].tolist()[-50:]
                data[ticker_str] = {
                    "price":      round(last_price, 2),
                    "change":     round(change, 2),
                    "change_pct": round(change_pct, 2),
                    "sparkline":  [round(p, 2) for p in sparkline],
                }
            else:
                data[ticker_str] = {"error": "No data"}
        except Exception as e:
            data[ticker_str] = {"error": str(e)}
    return JSONResponse(content=data)

# ---------------------------------------------------------------------------
# Quote
# ---------------------------------------------------------------------------

@app.get("/api/quote/{ticker_symbol}")
async def get_quote(ticker_symbol: str):
    try:
        ticker    = yf.Ticker(ticker_symbol)
        info      = ticker.info
        fast_info = ticker.fast_info
        hist      = ticker.history(period="5d")

        current_price = (_get_attr(info, "currentPrice", "regularMarketPrice") or
                         _get_attr(fast_info, "lastPrice", "last_price"))
        prev_close    = (_get_attr(info, "previousClose", "regularMarketPreviousClose") or
                         _get_attr(fast_info, "previousClose", "previous_close"))
        if (current_price is None or prev_close is None) and not hist.empty:
            current_price = float(hist["Close"].iloc[-1])
            prev_close    = float(hist["Close"].iloc[-2]) if len(hist) > 1 else current_price

        change     = (current_price - prev_close) if current_price and prev_close else 0
        change_pct = (change / prev_close * 100) if prev_close and change else 0

        open_     = _get_attr(info, "open", "regularMarketOpen")
        day_high  = _get_attr(info, "dayHigh", "regularMarketDayHigh")
        day_low   = _get_attr(info, "dayLow", "regularMarketDayLow")
        avg_vol   = _get_attr(info, "averageVolume", "regularMarketVolume") or info.get("volume")
        last_vol  = int(hist["Volume"].iloc[-1]) if not hist.empty and "Volume" in hist.columns else None

        hist_1d = ticker.history(period="1d", interval="5m")
        if not hist_1d.empty:
            if open_    is None: open_    = float(hist_1d["Open"].iloc[0])
            if day_high is None: day_high = float(hist_1d["High"].max())
            if day_low  is None: day_low  = float(hist_1d["Low"].min())
        if open_    is None and not hist.empty: open_    = float(hist["Open"].iloc[-1])
        if day_high is None and not hist.empty: day_high = float(hist["High"].iloc[-1])
        if day_low  is None and not hist.empty: day_low  = float(hist["Low"].iloc[-1])
        if avg_vol  is None and not hist.empty and "Volume" in hist.columns:
            avg_vol = int(hist["Volume"].mean())

        hist_1y        = ticker.history(period="1y", interval="1d")
        fifty_avg      = _num(info.get("fiftyDayAverage"))
        two_hundred_avg = _num(info.get("twoHundredDayAverage"))
        if (fifty_avg is None or two_hundred_avg is None) and not hist_1y.empty and len(hist_1y) >= 50:
            close = hist_1y["Close"]
            if fifty_avg is None and len(close) >= 50:
                fifty_avg = round(float(close.tail(50).mean()), 2)
            if two_hundred_avg is None and len(close) >= 200:
                two_hundred_avg = round(float(close.tail(200).mean()), 2)

        ent_val = info.get("enterpriseValue")
        if ent_val is None and info.get("marketCap") and info.get("totalDebt") is not None:
            ent_val = info.get("marketCap") + info.get("totalDebt") - info.get("cash", 0)

        quote_data = {
            "symbol":           ticker_symbol.upper(),
            "name":             info.get("longName", info.get("shortName", ticker_symbol.upper())),
            "quote_type":       info.get("quoteType", "EQUITY"),
            "currency":         info.get("currency", "USD"),
            "exchange":         info.get("exchange", ""),
            "sector":           info.get("sector") or "—",
            "industry":         info.get("industry") or "—",
            "price":            round(current_price, 2) if current_price else None,
            "change":           round(change, 2),
            "change_pct":       round(change_pct, 2),
            "open":             _num(open_),
            "day_high":         _num(day_high),
            "day_low":          _num(day_low),
            "bid":              _get_attr(info, "bid", "bidPrice"),
            "ask":              _get_attr(info, "ask", "askPrice"),
            "volume":           info.get("volume") or last_vol,
            "avg_volume":       avg_vol,
            "market_cap":       info.get("marketCap"),
            "enterprise_value": ent_val,
            "pe_ratio":         _num(info.get("trailingPE")),
            "high_52w":         _num(info.get("fiftyTwoWeekHigh")),
            "low_52w":          _num(info.get("fiftyTwoWeekLow")),
            "fifty_day_avg":    fifty_avg,
            "two_hundred_day_avg": two_hundred_avg,
        }
        if not hist_1d.empty:
            quote_data["intraday_chart"] = {
                "timestamps": [t.strftime('%H:%M') for t in hist_1d.index],
                "prices":     [round(p, 2) for p in hist_1d['Close'].tolist()],
            }
        if not hist_1y.empty:
            quote_data["historical_chart"] = {
                "timestamps": [t.strftime('%Y-%m-%d') for t in hist_1y.index],
                "prices":     [round(p, 2) for p in hist_1y['Close'].tolist()],
            }
        return JSONResponse(content=quote_data)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

# ---------------------------------------------------------------------------
# ML Prediction
# ---------------------------------------------------------------------------

@app.get("/api/predict/{ticker_symbol}")
async def get_prediction(ticker_symbol: str):
    try:
        predictor = StockPredictor(ticker_symbol)
        prediction = predictor.predict()
        return JSONResponse(content=prediction)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

# ---------------------------------------------------------------------------
# Commodities & FX
# ---------------------------------------------------------------------------

@app.get("/api/commodities-fx")
async def get_commodities_fx():
    tickers = ["GC=F", "SI=F", "CL=F", "NG=F", "EURUSD=X", "JPY=X", "GBPUSD=X"]
    data = {}
    for t_str in tickers:
        try:
            t    = yf.Ticker(t_str)
            hist = t.history(period="1d")
            if not hist.empty:
                last   = hist['Close'].iloc[-1]
                prev   = getattr(t.fast_info, 'previous_close', last)
                change = last - prev
                data[t_str] = {
                    "price":      round(last, 4) if "=X" in t_str else round(last, 2),
                    "change":     round(change, 4) if "=X" in t_str else round(change, 2),
                    "change_pct": round((change / prev * 100) if prev else 0, 2),
                }
        except Exception:
            data[t_str] = {"error": "failed"}
    return JSONResponse(content=data)

# ---------------------------------------------------------------------------
# News  (NewsAPI -> Finnhub -> yfinance)
# ---------------------------------------------------------------------------

@app.get("/api/news")
async def get_news(ticker: str = "SPY"):
    results = []

    # 1. NewsAPI
    if NEWS_API_KEY:
        try:
            query = ticker if ticker != "SPY" else "stock market Wall Street"
            resp  = requests.get(
                "https://newsapi.org/v2/everything",
                params={"q": query, "language": "en", "sortBy": "publishedAt",
                        "pageSize": 10, "apiKey": NEWS_API_KEY},
                timeout=8,
            )
            if resp.status_code == 200:
                for a in resp.json().get("articles", [])[:10]:
                    title = a.get("title", "")
                    if not title or title == "[Removed]":
                        continue
                    sentiment, score = _sentiment(title)
                    results.append({
                        "title":     title,
                        "publisher": a.get("source", {}).get("name", "News"),
                        "link":      a.get("url", "#"),
                        "sentiment": sentiment,
                        "score":     score,
                    })
                if results:
                    return JSONResponse(content={"news": results})
        except Exception:
            pass

    # 2. Finnhub
    if FINNHUB_API_KEY:
        try:
            today    = datetime.now().strftime("%Y-%m-%d")
            week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
            url = (f"https://finnhub.io/api/v1/news?category=general&token={FINNHUB_API_KEY}"
                   if ticker == "SPY"
                   else f"https://finnhub.io/api/v1/company-news?symbol={ticker}&from={week_ago}&to={today}&token={FINNHUB_API_KEY}")
            resp = requests.get(url, timeout=8)
            if resp.status_code == 200:
                for a in resp.json()[:10]:
                    title = a.get("headline", "")
                    if not title:
                        continue
                    sentiment, score = _sentiment(title)
                    results.append({
                        "title":     title,
                        "publisher": a.get("source", "Finnhub"),
                        "link":      a.get("url", "#"),
                        "sentiment": sentiment,
                        "score":     score,
                    })
                if results:
                    return JSONResponse(content={"news": results})
        except Exception:
            pass

    # 3. yfinance fallback
    try:
        t    = yf.Ticker(ticker)
        news = t.news or []
        for item in news[:10]:
            content   = item.get('content', item)
            title     = content.get('title', '')
            prov      = content.get('provider', {})
            publisher = prov.get('displayName') if isinstance(prov, dict) else content.get('publisher', 'News')
            link_obj  = content.get('clickThroughUrl', content.get('canonicalUrl', {}))
            link      = link_obj.get('url') if isinstance(link_obj, dict) else content.get('link', '#')
            sentiment, score = _sentiment(title)
            results.append({"title": title, "publisher": publisher, "link": link,
                            "sentiment": sentiment, "score": score})
        return JSONResponse(content={"news": results})
    except Exception as e:
        return JSONResponse(content={"error": str(e), "news": []}, status_code=500)

@app.get("/api/news/top")
async def get_top_news():
    return await get_news(ticker="SPY")

# ---------------------------------------------------------------------------
# Fundamentals
# ---------------------------------------------------------------------------

@app.get("/api/fundamentals/{ticker_symbol}")
async def get_fundamentals(ticker_symbol: str):
    try:
        ticker = yf.Ticker(ticker_symbol)
        hist   = ticker.history(period="1y")
        if hist.empty:
            candles = {"dates": [], "open": [], "high": [], "low": [], "close": [], "volume": []}
        else:
            rh = hist.tail(30)
            candles = {
                "dates":  [d.strftime('%Y-%m-%d') for d in rh.index],
                "open":   [round(p, 2) for p in rh['Open'].tolist()],
                "high":   [round(p, 2) for p in rh['High'].tolist()],
                "low":    [round(p, 2) for p in rh['Low'].tolist()],
                "close":  [round(p, 2) for p in rh['Close'].tolist()],
                "volume": rh['Volume'].tolist(),
            }

        info = ticker.info

        def get_num(k, default=None):
            v = info.get(k, default)
            return _num(v) if v is not None and v != "N/A" else default

        def get_pct(k, default=None):
            v = info.get(k, default)
            if v is None or v == "N/A": return default
            n = _num(v)
            if n is None: return default
            return round(n * 100, 2) if abs(n) <= 2 else _num(n, 2)

        fpe      = get_num("forwardPE") or get_num("trailingPE")
        peg      = get_num("pegRatio")
        pb       = get_num("priceToBook")
        div_yld  = get_num("dividendYield")
        if div_yld is not None and div_yld < 2:
            div_yld = round(div_yld * 100, 2)
        roe                    = get_pct("returnOnEquity")
        beta                   = get_num("beta")
        trailing_eps           = get_num("trailingEps")
        forward_eps            = get_num("forwardEps")
        total_revenue          = info.get("totalRevenue")
        revenue_per_share      = get_num("revenuePerShare")
        profit_margin          = get_pct("profitMargins")
        operating_margin       = get_pct("operatingMargins")
        roa                    = get_pct("returnOnAssets")
        debt_to_equity         = get_num("debtToEquity")
        current_ratio          = get_num("currentRatio")
        quick_ratio            = get_num("quickRatio")
        book_value             = get_num("bookValue")
        free_cashflow          = info.get("freeCashflow")
        operating_cashflow     = info.get("operatingCashflow")
        earnings_growth        = get_pct("earningsGrowth")
        revenue_growth         = get_pct("revenueGrowth")
        earnings_q_growth      = get_pct("earningsQuarterlyGrowth")
        target_mean            = get_num("targetMeanPrice")
        recommendation         = info.get("recommendationKey") or info.get("recommendationMean")
        num_analysts           = info.get("numberOfAnalystOpinions")
        short_pct              = get_pct("shortPercentOfFloat")
        short_ratio            = get_num("shortRatio")
        payout_ratio           = get_pct("payoutRatio")
        ev_revenue             = get_num("enterpriseToRevenue")
        ev_ebitda              = get_num("enterpriseToEbitda")

        try:
            fin = ticker.financials
            bal = ticker.balance_sheet
            cf  = ticker.cashflow
            if total_revenue is None and fin is not None and not fin.empty:
                for row in ("Total Revenue", "Revenue", "Operating Revenue"):
                    if row in fin.index:
                        total_revenue = int(fin.loc[row].iloc[0]); break
            if free_cashflow is None and cf is not None and not cf.empty and "Free Cash Flow" in cf.index:
                free_cashflow = int(cf.loc["Free Cash Flow"].iloc[0])
            if operating_cashflow is None and cf is not None and not cf.empty and "Operating Cash Flow" in cf.index:
                operating_cashflow = int(cf.loc["Operating Cash Flow"].iloc[0])
            if book_value is None and bal is not None and not bal.empty:
                for row in ("Total Stockholder Equity", "Stockholders Equity", "Total Equity Gross Minority Interest"):
                    if row in bal.index:
                        eq = int(bal.loc[row].iloc[0])
                        sh = info.get("sharesOutstanding") or info.get("floatShares")
                        if eq and sh: book_value = round(eq / sh, 2)
                        break
        except Exception:
            pass

        total_assets   = info.get("totalAssets")
        yield_         = info.get("yield")
        expense_ratio  = get_pct("annualReportExpenseRatio") or get_num("expenseRatio")
        if expense_ratio is not None and expense_ratio < 2:
            expense_ratio = round(expense_ratio * 100, 2)

        return JSONResponse(content={
            "fpe": fpe, "peg": peg, "pb": pb, "div_yld": div_yld, "roe": roe,
            "beta": beta, "trailing_eps": trailing_eps, "forward_eps": forward_eps,
            "total_revenue": total_revenue, "revenue_per_share": revenue_per_share,
            "profit_margin": profit_margin, "operating_margin": operating_margin,
            "roa": roa, "debt_to_equity": debt_to_equity, "current_ratio": current_ratio,
            "quick_ratio": quick_ratio, "book_value": book_value,
            "free_cashflow": free_cashflow, "operating_cashflow": operating_cashflow,
            "earnings_growth": earnings_growth, "revenue_growth": revenue_growth,
            "earnings_quarterly_growth": earnings_q_growth,
            "target_mean_price": target_mean, "recommendation": recommendation,
            "number_of_analysts": num_analysts, "short_pct_float": short_pct,
            "short_ratio": short_ratio, "payout_ratio": payout_ratio,
            "ev_to_revenue": ev_revenue, "ev_to_ebitda": ev_ebitda,
            "total_assets": total_assets,
            "yield": round(yield_ * 100, 2) if isinstance(yield_, (int, float)) and yield_ is not None and abs(yield_) < 2 else yield_,
            "expense_ratio": expense_ratio,
            "candles": candles,
        })
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

# ---------------------------------------------------------------------------
# Social Buzz  (Tradestie -> Reddit scrape)
# ---------------------------------------------------------------------------

@app.get("/api/social")
async def get_social_buzz(mode: str = "mentions"):
    # 1. Tradestie — real WSB sentiment, updated every 15 min, no key needed
    try:
        resp = requests.get("https://api.tradestie.com/v1/apps/reddit", timeout=8)
        if resp.status_code == 200:
            data = resp.json()
            return JSONResponse(content={"mentions": [
                {
                    "ticker":          item.get("ticker", ""),
                    "count":           item.get("no_of_comments", 0),
                    "sentiment":       item.get("sentiment", "Neutral"),
                    "sentiment_score": item.get("sentiment_score", 0),
                }
                for item in data[:20]
            ]})
    except Exception:
        pass

    # 2. Raw Reddit scrape fallback
    import re
    from collections import Counter
    headers = {'User-Agent': 'Mozilla/5.0 MarketAnalyzer/1.0'}
    try:
        url = ("https://www.reddit.com/r/wallstreetbets/hot.json?limit=25"
               if mode == "trades"
               else "https://www.reddit.com/r/stocks/hot.json?limit=25")
        res = requests.get(url, headers=headers, timeout=5)
        if res.status_code == 200:
            posts       = res.json()['data']['children']
            text_corpus = " ".join([p['data']['title'] + " " + p['data'].get('selftext', '') for p in posts])
            words       = re.findall(r'\b[A-Z]{1,5}\b', text_corpus)
            ignore      = {'A','I','THE','AND','FOR','TO','IN','IS','OF','ON','IT','API','CEO','ETF','USA','DD','YOLO','WSB'}
            counts      = Counter(w for w in words if w not in ignore).most_common(20)
            return JSONResponse(content={"mentions": [
                {"ticker": t, "count": c, "sentiment": "Neutral", "sentiment_score": 0}
                for t, c in counts if c > 1
            ]})
    except Exception as e:
        pass

    return JSONResponse(content={"error": "All social sources failed", "mentions": []})

# ---------------------------------------------------------------------------
# Most Active  (Alpha Vantage -> yfinance fallback)
# ---------------------------------------------------------------------------

@app.get("/api/equities/active")
async def get_most_active():
    # 1. Alpha Vantage TOP_GAINERS_LOSERS
    if ALPHAVANTAGE_KEY:
        try:
            resp = requests.get(
                "https://www.alphavantage.co/query",
                params={"function": "TOP_GAINERS_LOSERS", "apikey": ALPHAVANTAGE_KEY},
                timeout=10,
            )
            if resp.status_code == 200:
                most_active = resp.json().get("most_actively_traded", [])
                if most_active:
                    results = []
                    for item in most_active[:20]:
                        try:
                            results.append({
                                "ticker":     item.get("ticker", ""),
                                "price":      float(item.get("price", 0)),
                                "change":     float(item.get("change_amount", 0)),
                                "change_pct": float(item.get("change_percentage", "0%").replace("%", "")),
                                "volume":     int(item.get("volume", 0)),
                            })
                        except (ValueError, TypeError):
                            pass
                    if results:
                        results.sort(key=lambda x: x["volume"], reverse=True)
                        return JSONResponse(content={"active": results})
        except Exception:
            pass

    # 2. yfinance bulk download fallback — use dl_session (not curl_cffi)
    candidates = [
        "TSLA","NVDA","AAPL","AMD","PLTR","AMZN","SOFI","NIO","F","BAC",
        "INTC","MSFT","META","GOOGL","RIVN","CCL","LCID","T","SNAP","PFE",
        "UBER","AAL","CSCO","DKNG","HOOD","PYPL","WBD","M","VALE","XOM",
        "WFC","CSX","KMI","GM","DAL","BMY","VZ","HAL","C","MU","BABA",
        "JPM","KO","DIS","BA","V","CRM","NFLX","QCOM","TXN","ABBV","JNJ",
        "PEP","WMT","HD","PG","MA","UNH","CVX","COST","MRK","TMO",
    ]
    try:
        data = yf.download(tickers=" ".join(candidates), period="2d",
                           group_by="ticker", threads=True, progress=False)
        active_data = []
        for symbol in candidates:
            try:
                df = data[symbol]
                if not df.empty and len(df) >= 2:
                    last = float(df['Close'].iloc[-1])
                    prev = float(df['Close'].iloc[-2])
                    vol  = int(df['Volume'].iloc[-1])
                    if last and prev and vol:
                        change = last - prev
                        active_data.append({
                            "ticker":     symbol,
                            "price":      round(last, 2),
                            "change":     round(change, 2),
                            "change_pct": round((change / prev) * 100, 2),
                            "volume":     vol,
                        })
            except Exception:
                pass
        active_data.sort(key=lambda x: x["volume"], reverse=True)
        return JSONResponse(content={"active": active_data[:50]})
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

# ---------------------------------------------------------------------------
# Penny Stocks
# ---------------------------------------------------------------------------

@app.get("/api/equities/penny")
async def get_penny_stocks():
    penny_candidates = [
        "SNDL","GNS","HOLO","MTC","BETR","TCBP","LQR","VFS","FFIE","CXAI",
        "ABVC","GROM","GMVD","TTOO","CHPT","MVIS","KOPN","UAVS","VISL",
        "HUT","BITF","MARA","RIOT","CAN","EBON","BTBT","CLSK","MIGI",
        "GME","AMC","BB","NOK","KOSS","TRUP","SOFI","PLTR","LCID","NKLA",
    ]
    try:
        data = yf.download(tickers=" ".join(penny_candidates), period="2d",
                           group_by="ticker", threads=False, progress=False)
        penny_data = []
        for symbol in penny_candidates:
            try:
                df = data[symbol]
                if not df.empty and len(df) >= 2:
                    last = float(df['Close'].iloc[-1])
                    prev = float(df['Close'].iloc[-2])
                    vol  = int(df['Volume'].iloc[-1])
                    if last and prev and last <= 15:
                        change = last - prev
                        penny_data.append({
                            "ticker":     symbol,
                            "price":      round(last, 4),
                            "change":     round(change, 4),
                            "change_pct": round((change / prev) * 100, 2),
                            "volume":     vol or 0,
                        })
            except Exception:
                pass
        penny_data.sort(key=lambda x: x["volume"], reverse=True)
        return JSONResponse(content={"penny": penny_data[:40]})
    except Exception as e:
        print(f"Error fetching penny stocks: {e}")
        return JSONResponse(content={"penny": []})