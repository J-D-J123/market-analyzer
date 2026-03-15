from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import JSONResponse
import yfinance as yf
from textblob import TextBlob
import requests
import asyncio
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

app = FastAPI(title="Market Analyzer")

def _num(v, decimals=2):
    """Return number rounded or None if invalid."""
    if v is None or (isinstance(v, float) and (v != v or abs(v) == float('inf'))):
        return None
    try:
        n = float(v)
        return round(n, decimals) if decimals is not None else n
    except (TypeError, ValueError):
        return None

def _pct(v):
    """Return value as percentage (0.05 -> 5.0) or None."""
    n = _num(v, 2)
    return (round(n * 100, 2) if n is not None and abs(n) < 10 else n) if n is not None else None

# Mount static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

@app.get("/")
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/api/market-overview")
async def get_market_overview():
    # Major Indices: S&P 500, Dow, Nasdaq, Russell 2000, FTSE 100, DAX, Nikkei, Hang Seng, VIX
    tickers = ["^GSPC", "^DJI", "^IXIC", "^RUT", "^FTSE", "^GDAXI", "^N225", "^HSI", "^VIX"]
    
    data = {}
    
    # Run synchronously for now, in a real highly scaled app we'd use unblocking threads
    for ticker_str in tickers:
        try:
            ticker = yf.Ticker(ticker_str)
            hist = ticker.history(period="2d", interval="1m")
            if len(hist) > 0:
                last_price = hist['Close'].iloc[-1]
                # Try to get previous day's close for accurate % change, or just use first price of day
                try:
                    info = ticker.fast_info
                    prev_close = info.previous_close
                except:
                    prev_close = hist['Close'].iloc[0] if len(hist) > 1 else last_price
                
                change = last_price - prev_close
                change_pct = (change / prev_close) * 100 if prev_close else 0
                
                # Sparkline data (last 50 points to save bandwidth)
                sparkline = hist['Close'].tolist()[-50:]
                
                data[ticker_str] = {
                    "price": round(last_price, 2),
                    "change": round(change, 2),
                    "change_pct": round(change_pct, 2),
                    "sparkline": [round(p, 2) for p in sparkline]
                }
            else:
                data[ticker_str] = {"error": "No data"}
        except Exception as e:
            data[ticker_str] = {"error": str(e)}
            
    return JSONResponse(content=data)

def _get_attr(obj, *keys, default=None):
    """Get first available key from dict-like or object (e.g. fast_info)."""
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

@app.get("/api/quote/{ticker_symbol}")
async def get_quote(ticker_symbol: str):
    try:
        ticker = yf.Ticker(ticker_symbol)
        info = ticker.info
        fast_info = ticker.fast_info

        hist = ticker.history(period="5d")
        current_price = (
            _get_attr(info, "currentPrice", "regularMarketPrice") or
            _get_attr(fast_info, "lastPrice", "last_price")
        )
        prev_close = (
            _get_attr(info, "previousClose", "regularMarketPreviousClose") or
            _get_attr(fast_info, "previousClose", "previous_close")
        )
        if (current_price is None or prev_close is None) and not hist.empty:
            current_price = float(hist["Close"].iloc[-1])
            prev_close = float(hist["Close"].iloc[-2]) if len(hist) > 1 else current_price

        change = (current_price - prev_close) if current_price and prev_close else 0
        change_pct = (change / prev_close * 100) if prev_close and change else 0

        open_ = _get_attr(info, "open", "regularMarketOpen")
        day_high = _get_attr(info, "dayHigh", "regularMarketDayHigh")
        day_low = _get_attr(info, "dayLow", "regularMarketDayLow")
        avg_vol = _get_attr(info, "averageVolume", "regularMarketVolume") or info.get("volume")
        last_vol = int(hist["Volume"].iloc[-1]) if not hist.empty and "Volume" in hist.columns else None

        # Intraday for open / day high / day low fallback
        hist_1d = ticker.history(period="1d", interval="5m")
        if not hist_1d.empty:
            if open_ is None:
                open_ = float(hist_1d["Open"].iloc[0])
            if day_high is None:
                day_high = float(hist_1d["High"].max())
            if day_low is None:
                day_low = float(hist_1d["Low"].min())
        if open_ is None and not hist.empty:
            open_ = float(hist["Open"].iloc[-1])
        if day_high is None and not hist.empty:
            day_high = float(hist["High"].iloc[-1])
        if day_low is None and not hist.empty:
            day_low = float(hist["Low"].iloc[-1])

        # Avg volume from history if missing
        if avg_vol is None and not hist.empty and "Volume" in hist.columns:
            avg_vol = int(hist["Volume"].mean())

        # 50d / 200d from history if missing
        hist_1y = ticker.history(period="1y", interval="1d")
        fifty_avg = _num(info.get("fiftyDayAverage"))
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
            "symbol": ticker_symbol.upper(),
            "name": info.get("longName", info.get("shortName", ticker_symbol.upper())),
            "quote_type": info.get("quoteType", "EQUITY"),
            "currency": info.get("currency", "USD"),
            "exchange": info.get("exchange", ""),
            "sector": info.get("sector") or "—",
            "industry": info.get("industry") or "—",
            "price": round(current_price, 2) if current_price else None,
            "change": round(change, 2),
            "change_pct": round(change_pct, 2),
            "open": _num(open_),
            "day_high": _num(day_high),
            "day_low": _num(day_low),
            "bid": _get_attr(info, "bid", "bidPrice"),
            "ask": _get_attr(info, "ask", "askPrice"),
            "volume": info.get("volume") or last_vol,
            "avg_volume": avg_vol,
            "market_cap": info.get("marketCap"),
            "enterprise_value": ent_val,
            "pe_ratio": _num(info.get("trailingPE")),
            "high_52w": _num(info.get("fiftyTwoWeekHigh")),
            "low_52w": _num(info.get("fiftyTwoWeekLow")),
            "fifty_day_avg": fifty_avg,
            "two_hundred_day_avg": two_hundred_avg,
        }
        
        if not hist_1d.empty:
            quote_data["intraday_chart"] = {
                "timestamps": [t.strftime('%H:%M') for t in hist_1d.index],
                "prices": [round(p, 2) for p in hist_1d['Close'].tolist()]
            }

        if not hist_1y.empty:
             quote_data["historical_chart"] = {
                 "timestamps": [t.strftime('%Y-%m-%d') for t in hist_1y.index],
                 "prices": [round(p, 2) for p in hist_1y['Close'].tolist()]
             }
             
        return JSONResponse(content=quote_data)
        
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.get("/api/commodities-fx")
async def get_commodities_fx():
    # Gold, Silver, Crude, NatGas, EURUSD, USDJPY, GBPUSD
    tickers = ["GC=F", "SI=F", "CL=F", "NG=F", "EURUSD=X", "JPY=X", "GBPUSD=X"]
    data = {}
    
    for t_str in tickers:
        try:
            t = yf.Ticker(t_str)
            hist = t.history(period="1d")
            if not hist.empty:
                last = hist['Close'].iloc[-1]
                fi = t.fast_info
                prev = getattr(fi, 'previous_close', last)
                change = last - prev
                change_pct = (change/prev*100) if prev else 0
                
                data[t_str] = {
                    "price": round(last, 4) if "=X" in t_str else round(last, 2),
                    "change": round(change, 4) if "=X" in t_str else round(change, 2),
                    "change_pct": round(change_pct, 2)
                }
        except:
             data[t_str] = {"error": "failed"}
             
    return JSONResponse(content=data)

@app.get("/api/news")
async def get_news(ticker: str = "SPY"):
    try:
        t = yf.Ticker(ticker)
        news = t.news
        results = []
        for item in news[:10]: # Limit to 10
            content = item.get('content', item)
            title = content.get('title', '')
            
            # Publisher handling
            provider_obj = content.get('provider', {})
            publisher = provider_obj.get('displayName') if isinstance(provider_obj, dict) else None
            if not publisher:
                publisher = content.get('publisher', 'News')
                
            # Link handling
            link_obj = content.get('clickThroughUrl', content.get('canonicalUrl', {}))
            link = link_obj.get('url') if isinstance(link_obj, dict) else None
            if not link:
                link = content.get('link', '#')

            # Sentiment Analysis
            blob = TextBlob(title)
            score = blob.sentiment.polarity
            
            if score > 0.1:
                sentiment = "POS"
            elif score < -0.1:
                sentiment = "NEG"
            else:
                sentiment = "NEU"
                
            results.append({
                "title": title,
                "publisher": publisher,
                "link": link,
                "sentiment": sentiment,
                "score": round(score, 2)
            })
            
        return JSONResponse(content={"news": results})
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.get("/api/news/top")
async def get_top_news():
    # Fetch general market news using SPY or similar broad index
    return await get_news(ticker="SPY")

@app.get("/api/fundamentals/{ticker_symbol}")
async def get_fundamentals(ticker_symbol: str):
    try:
        ticker = yf.Ticker(ticker_symbol)
        
        # Get historical data for the chart's candles (optional for fundamentals-only)
        hist = ticker.history(period="1y")
        if hist.empty:
            candles = {"dates": [], "open": [], "high": [], "low": [], "close": [], "volume": []}
        else:
            recent_hist = hist.tail(30)
            candles = {
                "dates": [d.strftime('%Y-%m-%d') for d in recent_hist.index],
                "open": [round(p, 2) for p in recent_hist['Open'].tolist()],
                "high": [round(p, 2) for p in recent_hist['High'].tolist()],
                "low": [round(p, 2) for p in recent_hist['Low'].tolist()],
                "close": [round(p, 2) for p in recent_hist['Close'].tolist()],
                "volume": recent_hist['Volume'].tolist()
            }

        # Extract Fundamentals and many more metrics from info
        info = ticker.info

        def get_num(k, default=None):
            v = info.get(k, default)
            return _num(v) if v is not None and v != "N/A" else default

        def get_pct(k, default=None):
            v = info.get(k, default)
            if v is None or v == "N/A":
                return default
            n = _num(v)
            if n is None:
                return default
            return round(n * 100, 2) if abs(n) <= 2 else _num(n, 2)

        fpe = get_num("forwardPE") or get_num("trailingPE")
        peg = get_num("pegRatio")
        pb = get_num("priceToBook")
        div_yld = get_num("dividendYield")
        if div_yld is not None and div_yld < 2:
            div_yld = round(div_yld * 100, 2)  # often stored as 0.02 for 2%
        roe = get_pct("returnOnEquity")
        beta = get_num("beta")

        # Earnings & revenue
        trailing_eps = get_num("trailingEps")
        forward_eps = get_num("forwardEps")
        total_revenue = info.get("totalRevenue")
        revenue_per_share = get_num("revenuePerShare")

        # Margins & returns
        profit_margin = get_pct("profitMargins")
        operating_margin = get_pct("operatingMargins")
        roa = get_pct("returnOnAssets")

        # Balance sheet
        debt_to_equity = get_num("debtToEquity")
        current_ratio = get_num("currentRatio")
        quick_ratio = get_num("quickRatio")
        book_value = get_num("bookValue")

        # Cash flow
        free_cashflow = info.get("freeCashflow")
        operating_cashflow = info.get("operatingCashflow")

        # Growth
        earnings_growth = get_pct("earningsGrowth")
        revenue_growth = get_pct("revenueGrowth")
        earnings_quarterly_growth = get_pct("earningsQuarterlyGrowth")

        # Analyst & short
        target_mean = get_num("targetMeanPrice")
        recommendation = info.get("recommendationKey") or info.get("recommendationMean")
        num_analysts = info.get("numberOfAnalystOpinions")
        short_pct = get_pct("shortPercentOfFloat")
        short_ratio = get_num("shortRatio")
        payout_ratio = get_pct("payoutRatio")

        # Valuation
        ev_revenue = get_num("enterpriseToRevenue")
        ev_ebitda = get_num("enterpriseToEbitda")

        # Fallbacks from financial statements when info is missing
        try:
            fin = ticker.financials
            bal = ticker.balance_sheet
            cf = ticker.cashflow
            if total_revenue is None and fin is not None and not fin.empty:
                for row in ("Total Revenue", "Revenue", "Operating Revenue"):
                    if row in fin.index:
                        total_revenue = int(fin.loc[row].iloc[0])
                        break
            if free_cashflow is None and cf is not None and not cf.empty and "Free Cash Flow" in cf.index:
                free_cashflow = int(cf.loc["Free Cash Flow"].iloc[0])
            if operating_cashflow is None and cf is not None and not cf.empty and "Operating Cash Flow" in cf.index:
                operating_cashflow = int(cf.loc["Operating Cash Flow"].iloc[0])
            if book_value is None and bal is not None and not bal.empty:
                for row in ("Total Stockholder Equity", "Stockholders Equity", "Total Equity Gross Minority Interest"):
                    if row in bal.index:
                        eq = int(bal.loc[row].iloc[0])
                        sh = info.get("sharesOutstanding") or info.get("floatShares")
                        if eq and sh:
                            book_value = round(eq / sh, 2)
                        break
        except Exception:
            pass

        # ETF / fund specific
        total_assets = info.get("totalAssets")
        yield_ = info.get("yield")  # avoid shadowing builtin
        expense_ratio = get_pct("annualReportExpenseRatio") or get_num("expenseRatio")
        if expense_ratio is not None and expense_ratio < 2:
            expense_ratio = round(expense_ratio * 100, 2)

        return JSONResponse(content={
            "fpe": fpe,
            "peg": peg,
            "pb": pb,
            "div_yld": div_yld,
            "roe": roe,
            "beta": beta,
            "trailing_eps": trailing_eps,
            "forward_eps": forward_eps,
            "total_revenue": total_revenue,
            "revenue_per_share": revenue_per_share,
            "profit_margin": profit_margin,
            "operating_margin": operating_margin,
            "roa": roa,
            "debt_to_equity": debt_to_equity,
            "current_ratio": current_ratio,
            "quick_ratio": quick_ratio,
            "book_value": book_value,
            "free_cashflow": free_cashflow,
            "operating_cashflow": operating_cashflow,
            "earnings_growth": earnings_growth,
            "revenue_growth": revenue_growth,
            "earnings_quarterly_growth": earnings_quarterly_growth,
            "target_mean_price": target_mean,
            "recommendation": recommendation,
            "number_of_analysts": num_analysts,
            "short_pct_float": short_pct,
            "short_ratio": short_ratio,
            "payout_ratio": payout_ratio,
            "ev_to_revenue": ev_revenue,
            "ev_to_ebitda": ev_ebitda,
            "total_assets": total_assets,
            "yield": round(yield_ * 100, 2) if isinstance(yield_, (int, float)) and yield_ is not None and abs(yield_) < 2 else yield_,
            "expense_ratio": expense_ratio,
            "candles": candles,
        })
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.get("/api/social")
async def get_social_buzz(mode: str = "mentions"):
    # Simple Reddit scraping for tickers. 
    # Note: Reddit API often blocks generic requests without a custom User-Agent,
    # so we provide one and catch exceptions if rate-limited.
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BloombergBot/1.0'}
    
    try:
        if mode == "trades":
            # Fetch from r/wallstreetbets for trades
            res = requests.get("https://www.reddit.com/r/wallstreetbets/hot.json?limit=25", headers=headers, timeout=5)
        else:
            # Default to r/stocks for mentions
            res = requests.get("https://www.reddit.com/r/stocks/hot.json?limit=25", headers=headers, timeout=5)
            
        if res.status_code == 200:
            posts = res.json()['data']['children']
            
            if mode == "trades":
                # Filter for posts likely indicating trades
                trade_keywords = ['bought', 'sold', 'calls', 'puts', 'yolo', 'loss', 'gain']
                filtered_posts = []
                for p in posts:
                    text = (p['data']['title'] + " " + p['data'].get('selftext', '')).lower()
                    if any(kw in text for kw in trade_keywords) or p['data'].get('link_flair_text') in ['YOLO', 'Loss', 'Gain']:
                        filtered_posts.append(p)
                posts = filtered_posts if filtered_posts else posts # Fallback to all if strict filter removes all
                
            text_corpus = " ".join([p['data']['title'] + " " + p['data'].get('selftext', '') for p in posts])
            
            # Very primitive ticker extraction (capitalized words 1-5 chars)
            # In a real app we'd intersect this with a known list of valid tickers
            import re
            words = re.findall(r'\b[A-Z]{1,5}\b', text_corpus)
            ignore_list = {'A', 'I', 'THE', 'AND', 'FOR', 'TO', 'IN', 'IS', 'OF', 'ON', 'IT', 'API', 'CEO', 'ETF', 'USA', 'DD', 'YOLO', 'WSB', 'AMC', 'GME'} 
            tickers = [w for w in words if w not in ignore_list]
            
            from collections import Counter
            counts = Counter(tickers).most_common(10)
            
            return JSONResponse(content={"mentions": [{"ticker": t, "count": c} for t, c in counts if c > 1]})
        else:
             return JSONResponse(content={"error": "Reddit blocked or failed", "mentions": []})
    except Exception as e:
        return JSONResponse(content={"error": str(e), "mentions": []})

@app.get("/api/equities/active")
async def get_most_active():
    # Polling a large predefined list to ensure maximum coverage
    high_volume_candidates = [
        "TSLA", "NVDA", "AAPL", "AMD", "PLTR", "AMZN", "SOFI", "NIO", "F", "BAC",
        "INTC", "MSFT", "META", "GOOGL", "RIVN", "CCL", "LCID", "T", "SNAP", "PFE",
        "UBER", "AAL", "CSCO", "DKNG", "HOOD", "PYPL", "WBD", "M", "VALE", "XOM",
        "WFC", "CSX", "KMI", "GM", "DAL", "BMY", "VZ", "HAL", "C", "MU", "BABA",
        "JPM", "KO", "DIS", "BA", "V", "CRM", "NFLX", "QCOM", "TXN", "ABBV", "JNJ",
        "PEP", "WMT", "HD", "PG", "MA", "UNH", "XOM", "CVX", "COST", "MRK", "TMO"
    ]
    try:
        # Bulk download using yfinance is significantly faster than looping t.fast_info
        data = yf.download(tickers=" ".join(high_volume_candidates), period="2d", group_by="ticker", threads=True, progress=False)
        active_data = []
        for symbol in high_volume_candidates:
            try:
                # yf.download format can be slightly tricky when multiple tickers are used
                # data[symbol] gives the dataframe for that symbol
                df = data[symbol]
                if not df.empty and len(df) >= 2:
                    last = float(df['Close'].iloc[-1])
                    prev = float(df['Close'].iloc[-2])
                    vol = int(df['Volume'].iloc[-1])
                    
                    if last and prev and vol:
                        change = last - prev
                        change_pct = (change/prev) * 100
                        active_data.append({
                            "ticker": symbol,
                            "price": round(last, 2),
                            "change": round(change, 2),
                            "change_pct": round(change_pct, 2),
                            "volume": vol
                        })
            except:
                pass
                
        # Sort by volume descending
        active_data.sort(key=lambda x: x["volume"], reverse=True)
        # Return top 50
        return JSONResponse(content={"active": active_data[:50]})
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.get("/api/equities/penny")
async def get_penny_stocks():
    penny_candidates = [
        "SNDL", "GNS", "HOLO", "MTC", "BETR", "TCBP", "LQR", "VFS", "FFIE", "CXAI",
        "ABVC", "GROM", "GMVD", "TTOO", "CHPT", "MVIS", "KOPN", "UAVS", "VISL",
        "HUT", "BITF", "MARA", "RIOT", "CAN", "EBON", "BTBT", "CLSK", "MIGI",
        "GME", "AMC", "BB", "NOK", "KOSS", "TRUP", "SOFI", "PLTR", "LCID", "NKLA"
    ]
    try:
        # Bulk download using yfinance is significantly faster
        data = yf.download(tickers=" ".join(penny_candidates), period="2d", group_by="ticker", threads=True, progress=False)
        penny_data = []
        for symbol in penny_candidates:
            try:
                df = data[symbol]
                if not df.empty and len(df) >= 2:
                    last = float(df['Close'].iloc[-1])
                    prev = float(df['Close'].iloc[-2])
                    vol = int(df['Volume'].iloc[-1])
                    
                    if last and prev:
                        # Only include true penny/low-cap stocks (below $15 to cast a somewhat wider net for volatility)
                        if last <= 15:
                            change = last - prev
                            change_pct = (change/prev) * 100
                            penny_data.append({
                                "ticker": symbol,
                                "price": round(last, 4),
                                "change": round(change, 4),
                                "change_pct": round(change_pct, 2),
                                "volume": vol or 0
                            })
            except:
                pass
                
        # Sort by volume descending
        penny_data.sort(key=lambda x: x["volume"], reverse=True)
        # Return top 40
        return JSONResponse(content={"penny": penny_data[:40]})
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)
