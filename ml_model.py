import yfinance as yf
import pandas as pd
import numpy as np
import os
import joblib
from datetime import datetime, timedelta
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler

# Directory to store trained models
MODEL_DIR = "models"
if not os.path.exists(MODEL_DIR):
    os.makedirs(MODEL_DIR)

class StockPredictor:
    def __init__(self, ticker_symbol):
        self.ticker_symbol = ticker_symbol.upper()
        self.model_path = os.path.join(MODEL_DIR, f"{self.ticker_symbol}_v3_model.joblib")
        self.models = {}

    def _compute_indicators(self, df):
        """Compute an expanded set of technical indicators as features."""
        # RSI
        delta = df['Close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / (loss + 1e-9)
        df['RSI'] = 100 - (100 / (1 + rs))

        # Stochastic RSI (adds sensitivity to recent extremes)
        rsi_min = df['RSI'].rolling(14).min()
        rsi_max = df['RSI'].rolling(14).max()
        df['StochRSI'] = (df['RSI'] - rsi_min) / (rsi_max - rsi_min + 1e-9)

        # MACD
        exp1 = df['Close'].ewm(span=12, adjust=False).mean()
        exp2 = df['Close'].ewm(span=26, adjust=False).mean()
        df['MACD'] = exp1 - exp2
        df['Signal'] = df['MACD'].ewm(span=9, adjust=False).mean()
        df['MACD_Hist'] = df['MACD'] - df['Signal']  # Histogram captures momentum shifts

        # SMAs and price position
        df['SMA20'] = df['Close'].rolling(window=20).mean()
        df['SMA50'] = df['Close'].rolling(window=50).mean()
        df['SMA200'] = df['Close'].rolling(window=200).mean()
        df['Price_vs_SMA50'] = df['Close'] / df['SMA50'] - 1    # % above/below 50d
        df['Price_vs_SMA200'] = df['Close'] / df['SMA200'] - 1  # % above/below 200d
        df['SMA50_vs_SMA200'] = df['SMA50'] / df['SMA200'] - 1  # Golden/death cross

        # Bollinger Bands (mean reversion signal)
        bb_std = df['Close'].rolling(window=20).std()
        df['BB_Upper'] = df['SMA20'] + 2 * bb_std
        df['BB_Lower'] = df['SMA20'] - 2 * bb_std
        df['BB_Position'] = (df['Close'] - df['BB_Lower']) / (df['BB_Upper'] - df['BB_Lower'] + 1e-9)

        # ATR (Average True Range — volatility risk)
        high_low = df['High'] - df['Low']
        high_close = (df['High'] - df['Close'].shift()).abs()
        low_close = (df['Low'] - df['Close'].shift()).abs()
        true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
        df['ATR'] = true_range.rolling(14).mean()
        df['ATR_pct'] = df['ATR'] / df['Close']  # Normalize by price

        # Volume momentum
        df['Vol_Ratio'] = df['Volume'] / df['Volume'].rolling(20).mean()

        # Price momentum at multiple timeframes
        df['Momentum_5d'] = df['Close'].pct_change(5)
        df['Momentum_20d'] = df['Close'].pct_change(20)

        # Calendar effects (markets have known seasonal patterns)
        df['Month'] = df.index.month
        df['DayOfWeek'] = df.index.dayofweek

        return df.dropna()

    def _get_market_context(self):
        """Fetch SPY + VIX for broad market + volatility regime context."""
        try:
            spy = yf.Ticker("SPY")
            hist = spy.history(period="5y")
            if hist.empty:
                return pd.DataFrame()

            # Strip timezone so the index aligns with any stock ticker index
            if hist.index.tz is not None:
                hist.index = hist.index.tz_localize(None)

            hist['SPY_Return_5d'] = hist['Close'].pct_change(5)
            hist['SPY_Return_20d'] = hist['Close'].pct_change(20)
            hist['SPY_SMA50'] = hist['Close'].rolling(50).mean()
            hist['SPY_Trend'] = hist['Close'] / hist['SPY_SMA50'] - 1
            market_df = hist[['SPY_Return_5d', 'SPY_Return_20d', 'SPY_Trend']]

            try:
                vix = yf.Ticker("^VIX")
                vix_hist = vix.history(period="5y")
                if not vix_hist.empty:
                    if vix_hist.index.tz is not None:
                        vix_hist.index = vix_hist.index.tz_localize(None)
                    vix_hist = vix_hist.rename(columns={'Close': 'VIX'})
                    vix_hist['VIX_zscore'] = (
                        (vix_hist['VIX'] - vix_hist['VIX'].rolling(30).mean())
                        / (vix_hist['VIX'].rolling(30).std() + 1e-9)
                    )
                    market_df = market_df.join(vix_hist[['VIX', 'VIX_zscore']], how='left')
            except Exception:
                pass  # VIX is optional; proceed without it

            return market_df
        except Exception:
            return pd.DataFrame()


    def _walk_forward_accuracy(self, X, y, n_splits=5):
        """
        Walk-forward cross-validation: train on past, predict next window.
        This is the correct way to evaluate time-series ML — no look-ahead bias.
        Returns average accuracy across all folds.
        """
        fold_size = len(X) // (n_splits + 1)
        if fold_size < 50:
            # Not enough data for walk-forward — fallback to single-split
            split = int(len(X) * 0.75)
            clf = GradientBoostingClassifier(n_estimators=100, max_depth=3, learning_rate=0.05, random_state=42)
            clf.fit(X.iloc[:split], y.iloc[:split])
            return clf.score(X.iloc[split:], y.iloc[split:])

        scores = []
        for i in range(1, n_splits + 1):
            train_end = fold_size * i
            test_end = fold_size * (i + 1)
            if test_end > len(X):
                break
            X_tr, y_tr = X.iloc[:train_end], y.iloc[:train_end]
            X_te, y_te = X.iloc[train_end:test_end], y.iloc[train_end:test_end]
            if len(X_tr) < 50 or len(X_te) < 10:
                continue
            clf = GradientBoostingClassifier(n_estimators=100, max_depth=3, learning_rate=0.05, random_state=42)
            clf.fit(X_tr, y_tr)
            scores.append(clf.score(X_te, y_te))

        return float(np.mean(scores)) if scores else 0.5

    def prepare_data(self):
        """
        Fetch and prepare data for training (5 years).
        STRICT TEMPORAL INTEGRITY:
          1. Indicators computed with rolling/EWM windows only — each row sees only past N rows.
          2. Market context joined by date — only same-day values used.
          3. NaN rows are dropped BEFORE targets are added. This means rows are only
             excluded due to insufficient HISTORY (e.g., first 200 rows for SMA200),
             never because of missing FUTURE data.
          4. Targets are appended LAST via shift(-N) — they are LABELS not features.
        """
        ticker = yf.Ticker(self.ticker_symbol)
        raw_df = ticker.history(period="5y")
        if len(raw_df) < 500:
            return None, None
        # Normalize timezone so joins with SPY/VIX align correctly
        if raw_df.index.tz is not None:
            raw_df.index = raw_df.index.tz_localize(None)

        # Step 1: compute all features (purely backward-looking)
        feat_df = self._compute_indicators(raw_df.copy())

        # Step 2: join market context by date (contemporaneous only)
        market_df = self._get_market_context()
        if not market_df.empty:
            feat_df = feat_df.join(market_df, how='left')

        # Step 3: select feature columns that actually exist
        base_features = [
            'RSI', 'StochRSI', 'MACD', 'Signal', 'MACD_Hist',
            'Price_vs_SMA50', 'Price_vs_SMA200', 'SMA50_vs_SMA200',
            'BB_Position', 'ATR_pct', 'Vol_Ratio',
            'Momentum_5d', 'Momentum_20d',
            'Month', 'DayOfWeek'
        ]
        market_features = ['SPY_Return_5d', 'SPY_Return_20d', 'SPY_Trend', 'VIX', 'VIX_zscore']
        features = [f for f in base_features + market_features if f in feat_df.columns]

        # Drop rows where features are NaN (insufficient historical lookback only — never future leakage)
        feat_df = feat_df.dropna(subset=features)

        # Step 4: append targets AFTER features are finalised
        # shift(-N) labels are intentional: "given today's indicators, did price rise over N days?"
        # These are LABELS, not model inputs — no feature computation depends on them.
        feat_df['Target_30D_Return'] = (
            (feat_df['Close'].shift(-30) - feat_df['Close']) / feat_df['Close']
        ).clip(-0.30, 0.30)
        feat_df['Target_30D_Inc'] = (feat_df['Target_30D_Return'] > 0).astype(int)

        feat_df['Target_1Y_Return'] = (
            (feat_df['Close'].shift(-252) - feat_df['Close']) / feat_df['Close']
        ).clip(-0.50, 1.00)
        feat_df['Target_1Y_Inc'] = (feat_df['Target_1Y_Return'] > 0).astype(int)

        return feat_df, features


    def train(self):
        """Train both 30D and 1Y GradientBoosting models with walk-forward accuracy."""
        df, features = self.prepare_data()
        if df is None or df.empty:
            return False

        models_dict = {}

        # ---------- 30D Models ----------
        train_30d = df.dropna(subset=['Target_30D_Return'])
        X_30 = train_30d[features]
        y_30_ret = train_30d['Target_30D_Return']
        y_30_inc = train_30d['Target_30D_Inc']

        reg_30 = GradientBoostingRegressor(n_estimators=200, max_depth=3, learning_rate=0.05,
                                            subsample=0.8, random_state=42)
        reg_30.fit(X_30, y_30_ret)

        clf_30 = GradientBoostingClassifier(n_estimators=200, max_depth=3, learning_rate=0.05,
                                             subsample=0.8, random_state=42)
        clf_30.fit(X_30, y_30_inc)

        # Walk-forward accuracy (realistic, no look-ahead bias)
        acc_30 = self._walk_forward_accuracy(X_30, y_30_inc, n_splits=5)
        models_dict['30D'] = {'reg': reg_30, 'clf': clf_30, 'accuracy': acc_30, 'features': features}

        # ---------- 1Y Models ----------
        train_1y = df.dropna(subset=['Target_1Y_Return'])
        if len(train_1y) > 200:
            X_1y = train_1y[features]
            y_1y_ret = train_1y['Target_1Y_Return']
            y_1y_inc = train_1y['Target_1Y_Inc']

            reg_1y = GradientBoostingRegressor(n_estimators=200, max_depth=3, learning_rate=0.05,
                                                subsample=0.8, random_state=42)
            reg_1y.fit(X_1y, y_1y_ret)

            clf_1y = GradientBoostingClassifier(n_estimators=200, max_depth=3, learning_rate=0.05,
                                                 subsample=0.8, random_state=42)
            clf_1y.fit(X_1y, y_1y_inc)

            acc_1y = self._walk_forward_accuracy(X_1y, y_1y_inc, n_splits=4)
            models_dict['1Y'] = {'reg': reg_1y, 'clf': clf_1y, 'accuracy': acc_1y, 'features': features}

        # Save models
        results = {'timestamp': datetime.now(), 'models': models_dict}
        joblib.dump(results, self.model_path)
        self.models = models_dict
        return True

    def predict(self):
        """Predict both short-term (30D) and long-term (1Y)."""
        should_train = True
        if os.path.exists(self.model_path):
            data = joblib.load(self.model_path)
            if datetime.now() - data['timestamp'] < timedelta(hours=24):
                self.models = data['models']
                should_train = False

        if should_train:
            success = self.train()
            if not success:
                return {"error": "Insufficient data to train model"}

        # Get latest features for inference
        ticker = yf.Ticker(self.ticker_symbol)
        df = ticker.history(period="1y")
        if df.index.tz is not None:
            df.index = df.index.tz_localize(None)
        df = self._compute_indicators(df)
        market_df = self._get_market_context()
        if not market_df.empty:
            df = df.join(market_df, how='left')

        features_30d = self.models['30D'].get('features', list(self.models['30D']['reg'].feature_names_in_))
        # Only use columns present in both the model and the live data
        available_features = [f for f in features_30d if f in df.columns]
        latest_features = df[available_features].dropna().tail(1)

        if latest_features.empty:
            return {"error": "Insufficient recent data for inference"}

        current_price = float(df['Close'].iloc[-1])

        # 30D Prediction
        p30_return = float(self.models['30D']['reg'].predict(latest_features)[0])
        p30_prob = float(self.models['30D']['clf'].predict_proba(latest_features)[0][1])
        p30_price = current_price * (1 + p30_return)

        res = {
            "symbol": self.ticker_symbol,
            "current_price": round(current_price, 2),
            "prediction_30d": {
                "price": round(p30_price, 2),
                "prob": round(p30_prob * 100, 2),
                "trend": "UP" if p30_prob > 0.5 else "DOWN",
                "accuracy": round(self.models['30D'].get('accuracy', 0.5) * 100, 2)
            },
            "last_trained": datetime.now().strftime("%Y-%m-%d %H:%M")
        }

        # 1Y Prediction
        if '1Y' in self.models:
            m1y = self.models['1Y']
            features_1y = m1y.get('features', list(m1y['reg'].feature_names_in_))
            available_1y = [f for f in features_1y if f in df.columns]
            latest_1y = df[available_1y].dropna().tail(1)

            if not latest_1y.empty:
                p1y_return = float(m1y['reg'].predict(latest_1y)[0])
                p1y_prob = float(m1y['clf'].predict_proba(latest_1y)[0][1])
                p1y_price = current_price * (1 + p1y_return)
                res["prediction_1y"] = {
                    "price": round(p1y_price, 2),
                    "prob": round(p1y_prob * 100, 2),
                    "trend": "UP" if p1y_prob > 0.5 else "DOWN",
                    "accuracy": round(m1y.get('accuracy', 0.5) * 100, 2)
                }
            else:
                res["prediction_1y"] = {"error": "Insufficient recent data for 1Y inference"}
        else:
            res["prediction_1y"] = {"error": "Insufficient history for 1Y forecast"}

        return res
