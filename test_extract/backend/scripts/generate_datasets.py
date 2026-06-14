import os
import csv
import random

def generate_csv(filename, ticks, start_price=1500.0, volatility=0.0005):
    filepath = os.path.join(os.path.dirname(__file__), '..', 'datasets', filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    
    price = start_price
    
    with open(filepath, 'w', newline='') as f:
        writer = csv.writer(f, delimiter=';')
        writer.writerow([
            "day", "timestamp", "product", 
            "bid_price_1", "bid_volume_1", "bid_price_2", "bid_volume_2", "bid_price_3", "bid_volume_3",
            "ask_price_1", "ask_volume_1", "ask_price_2", "ask_volume_2", "ask_price_3", "ask_volume_3",
            "mid_price", "profit_and_loss"
        ])
        
        for tick in range(ticks):
            # Random walk
            price *= (1 + random.gauss(0, volatility))
            
            mid = round(price, 2)
            spread = max(0.01, round(random.gauss(0.05, 0.02), 2))
            
            bid1 = round(mid - spread/2, 2)
            ask1 = round(mid + spread/2, 2)
            bid2 = round(bid1 - 0.01, 2)
            ask2 = round(ask1 + 0.01, 2)
            bid3 = round(bid2 - 0.01, 2)
            ask3 = round(ask2 + 0.01, 2)
            
            writer.writerow([
                "1", tick * 100, "VIDHI_ASSET",
                f"{bid1:.2f}", "100", f"{bid2:.2f}", "150", f"{bid3:.2f}", "200",
                f"{ask1:.2f}", "100", f"{ask2:.2f}", "150", f"{ask3:.2f}", "200",
                f"{mid:.2f}", "0.00"
            ])
            
            # Print progress
            if tick > 0 and tick % 100000 == 0:
                print(f"Generated {tick} ticks for {filename}...")

    print(f"Finished generating {ticks} ticks in {filepath}")

if __name__ == "__main__":
    print("Generating datasets...")
    generate_csv('test_99k.csv', 100000)
    generate_csv('main_999k.csv', 1000000)
