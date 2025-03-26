import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import requests
from dotenv import load_dotenv
from openai import OpenAI
import redis
import json
from datetime import datetime

load_dotenv()

app = FastAPI()

# Serve static files from the React build directory
current_dir = Path(__file__).resolve().parent  # directory of main.py
static_dir = current_dir.parent / "frontend" / "dist"  # path to frontend/dist
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
else:
    @app.get("/")
    def read_root():
        return {"message": "Static files not found. Please verify your build process."}

# Define allowed origins (adjust for your domains)
origins = [
    "http://localhost:5173",            # Vite dev server
    "https://<your-app>.herokuapp.com", # Heroku app domain (if used)
    "https://www.orangeclouds.io"        # Your GoDaddy custom domain (if embedding or direct calls)
]

# Setup CORS properly for your frontend domains
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)

# Configure OpenAI API Client
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Configure Redis cache
cache = redis.Redis(host='localhost', port=6379, db=0)

# Coinbase API URL
COINBASE_API_URL = 'https://api.exchange.coinbase.com'

def get_live_bitcoin_price():
    response = requests.get(f"{COINBASE_API_URL}/products/BTC-USD/ticker")
    response.raise_for_status()
    data = response.json()
    price = float(data["price"])
    timestamp = datetime.utcnow().isoformat()
    return {"price": round(price, 2), "timestamp": timestamp}

def generate_real_time_insight(current_price, previous_price):
    change = current_price - previous_price
    pct_change = (change / previous_price) * 100

    if pct_change >= 1:
        return f"Bitcoin is currently surging by {pct_change:.2f}% at ${current_price}, indicating bullish momentum."
    elif pct_change >= 0.1:
        return f"Bitcoin price is slightly up by {pct_change:.2f}% to ${current_price}, showing modest optimism."
    elif pct_change >= -0.1:
        return f"Bitcoin price is stable, changing only {pct_change:.2f}% at ${current_price}."
    elif pct_change >= -1:
        return f"Bitcoin price slightly declined by {pct_change:.2f}% to ${current_price}, reflecting mild caution."
    else:
        return f"Bitcoin is currently dropping significantly by {pct_change:.2f}% at ${current_price}, indicating bearish sentiment."

def generate_dynamic_market_insights(prices):
    insights = []
    for i in range(1, 5):
        today = prices[-i]
        yesterday = prices[-(i+1)]

        daily_change = today["close"] - yesterday["close"]
        pct_change = (daily_change / yesterday["close"]) * 100

        if pct_change > 2:
            insight = f"Bitcoin surged by {pct_change:.2f}% closing at ${today['close']} yesterday, signaling strong investor optimism."
        elif pct_change > 0.5:
            insight = f"Bitcoin moderately gained {pct_change:.2f}% yesterday, closing at ${today['close']}."
        elif pct_change > -0.5:
            insight = f"Bitcoin remained relatively stable yesterday with a slight change of {pct_change:.2f}%."
        elif pct_change > -2:
            insight = f"Bitcoin declined by {pct_change:.2f}% to close at ${today['close']} yesterday, indicating some investor caution."
        else:
            insight = f"Bitcoin sharply dropped {pct_change:.2f}% yesterday to ${today['close']}, raising concerns among traders."

        insights.append(insight)
    return insights

def analyze_sentiment_openai(text):
    prompt = f"Classify sentiment of this market insight as positive, neutral, or negative:\n\n{text}\n\nSentiment:"

    response = openai_client.completions.create(
        model="gpt-3.5-turbo-instruct",
        prompt=prompt,
        max_tokens=1,
        temperature=0
    )

    sentiment = response.choices[0].text.strip().lower()
    sentiment_scores = {"positive": 1.0, "neutral": 0.5, "negative": 0.0}
    return sentiment_scores.get(sentiment, 0.5)

@app.get("/bitcoin-pulse")
def bitcoin_data():
    cache_key = "bitcoin_pulse_dynamic_data"
    cached_data = cache.get(cache_key)
    if cached_data:
        return json.loads(cached_data)

    try:
        # Fetch historical prices from Coinbase (recent 30 days)
        response = requests.get(
            f"{COINBASE_API_URL}/products/BTC-USD/candles",
            params={"granularity": 86400}  # Daily granularity
        )
        response.raise_for_status()
        candles = response.json()

        # Convert Coinbase candle data into structured format and sort by date (ascending)
        prices = sorted(
            [
                {
                    "date": datetime.utcfromtimestamp(c[0]).date(),
                    "open": c[3],
                    "close": c[4],
                    "high": c[2],
                    "low": c[1],
                    "volume": c[5]
                }
                for c in candles
            ],
            key=lambda x: x["date"]
        )

        # Today's date for accurate filtering
        today = datetime.utcnow().date()

        # Filter to exactly last 14 days (including today)
        historical_prices_filtered = [
            price for price in prices
            if (today - price["date"]).days <= 14
        ]

        # Generate historical insights
        market_insights = generate_dynamic_market_insights(historical_prices_filtered)
        historical_sentiments = [
            analyze_sentiment_openai(insight) for insight in market_insights
        ]
        avg_historical_sentiment = round(sum(historical_sentiments) / len(historical_sentiments), 2)

        historical_data = [
            {
                "date": price["date"].isoformat(),
                "price": round(price["close"], 2),
                "sentiment": avg_historical_sentiment
            } for price in historical_prices_filtered
        ]

        # Fetch real-time price
        current_data = get_live_bitcoin_price()
        current_price = current_data["price"]

        # Previous real-time price caching
        prev_price_key = "previous_live_btc_price"
        previous_price_cached = cache.get(prev_price_key)

        previous_price = float(previous_price_cached) if previous_price_cached else current_price
        cache.setex(prev_price_key, 60, str(current_price))

        # Real-time insights & sentiment
        live_insight = generate_real_time_insight(current_price, previous_price)
        live_sentiment = analyze_sentiment_openai(live_insight)

        # Final structured result
        result = {
            "historical_data": historical_data,
            "real_time": {
                "timestamp": current_data["timestamp"],
                "price": current_price,
                "previous_price": previous_price,
                "insight": live_insight,
                "sentiment": live_sentiment
            },
            "average_historical_sentiment": avg_historical_sentiment,
            "timestamp": datetime.utcnow().isoformat()
        }

        # Cache result for 1 minutes
        cache.setex(cache_key, 60, json.dumps(result))

        return result

    except Exception as e:
        return {"error": str(e)}

