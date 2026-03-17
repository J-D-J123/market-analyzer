# Market-Analyzer

A web-based financial dashboard that visually resembles a 2016 Bloomberg Terminal interface.
It features a dark theme, dense data layout, monospace typography, and yellow/green accent text.
The backend is powered by Python (FastAPI) and uses `yfinance` to pull live market data.

## Features Built
- **Market Overview:** Major global indices and VIX with inline sparklines.
- **Equities Detail:** Real-time quotes, technical data, and an interactive Plotly candlestick chart styled to match the terminal aesthetics.
- **Top News & Sentiment:** Fetches headlines and uses TextBlob to provide primitive POS/NEG/NEU sentiment scoring.
- **Commodities & FX:** Live pricing for Gold, Silver, Crude, Natural Gas, and major currency pairs.
- **Technical Indicators:** Calculates RSI, MACD, and Moving Averages using pandas.
- **Social Buzz:** Basic Reddit r/stocks scraper to find trending tickers in the last 24 hours.

## Installation & Running Locally

1. **Prerequisites:** Python 3.8+
2. **Setup Virtual Environment:**
   ```bash
   python -m venv venv
   # Windows:
   .\venv\Scripts\activate
   # Mac/Linux:
   source venv/bin/activate
   ```
3. **Configure API Keys:**
   Create a `.env` file in the root directory and add your free API keys for richer functionality:
   ```env
   NEWS_API_KEY=your_key_here          # Optional: Better breaking news
   FINNHUB_API_KEY=your_key_here       # Optional: Rich company data
   ALPHAVANTAGE_KEY=your_key_here      # Optional: Top gainers/losers fallback
   ```
3. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
4. **Run the Server:**
   ```bash
   uvicorn main:app --host 127.0.0.1 --port 8000
   ```
5. **Open in Browser:**
   Navigate to `http://127.0.0.1:8000/`

## Technology Stack
- **Backend:** FastAPI, yfinance, TextBlob, pandas, requests
- **Frontend:** HTML5, CSS Grid (Vanilla CSS), Vanilla JavaScript, Plotly.js for charting.

*Designed for educational purposes using free public data APIs.*
