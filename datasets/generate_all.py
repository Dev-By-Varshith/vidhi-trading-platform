import os
import csv
import random

def generate_csv(file_path, tick_count, start_price):
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    price = start_price
    with open(file_path, 'w', newline='') as f:
        writer = csv.writer(f, delimiter=';')
        writer.writerow(["day", "timestamp", "product", 
                         "bid_price_1", "bid_volume_1", "bid_price_2", "bid_volume_2", "bid_price_3", "bid_volume_3",
                         "ask_price_1", "ask_volume_1", "ask_price_2", "ask_volume_2", "ask_price_3", "ask_volume_3",
                         "mid_price", "profit_and_loss"])
        
        product_name = os.path.basename(file_path).replace('.csv', '')
        for tick in range(tick_count):
            # Random walk with volatility
            change = random.gauss(0, 0.01 * start_price)
            price = max(start_price * 0.7, min(start_price * 1.3, price + change))
            
            spread = max(0.01, 0.0005 * price)
            bid1 = round(price - spread/2, 2)
            ask1 = round(price + spread/2, 2)
            bid2 = round(bid1 - 0.01, 2)
            ask2 = round(ask1 + 0.01, 2)
            bid3 = round(bid2 - 0.01, 2)
            ask3 = round(ask2 + 0.01, 2)
            
            writer.writerow([
                "1", tick*100, product_name,
                f"{bid1:.2f}", "100", f"{bid2:.2f}", "150", f"{bid3:.2f}", "200",
                f"{ask1:.2f}", "100", f"{ask2:.2f}", "150", f"{ask3:.2f}", "200",
                f"{price:.2f}", "0.00"
            ])
    print(f"Generated: {file_path}")

base_dir = os.path.dirname(os.path.abspath(__file__))

# Round 1 items
generate_csv(os.path.join(base_dir, "earth_fruit_test.csv"), 100000, 100.0)
generate_csv(os.path.join(base_dir, "mars_banana_test.csv"), 100000, 250.0)
generate_csv(os.path.join(base_dir, "moon_peanut_test.csv"), 100000, 150.0)
generate_csv(os.path.join(base_dir, "earth_fruit_final.csv"), 1000000, 100.0)
generate_csv(os.path.join(base_dir, "mars_banana_final.csv"), 1000000, 250.0)
generate_csv(os.path.join(base_dir, "moon_peanut_final.csv"), 1000000, 150.0)

# Round 2 items
generate_csv(os.path.join(base_dir, "grass_cane_test.csv"), 100000, 75.0)
generate_csv(os.path.join(base_dir, "mango_test.csv"), 100000, 180.0)
generate_csv(os.path.join(base_dir, "grass_cane_final.csv"), 1000000, 75.0)
generate_csv(os.path.join(base_dir, "mango_final.csv"), 1000000, 180.0)

print("All CSV files generated successfully!")
