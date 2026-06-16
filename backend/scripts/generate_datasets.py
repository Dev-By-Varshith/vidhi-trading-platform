import os
import csv
import struct
import argparse
import random

def convert_csv_to_bin(csv_path, bin_path):
    # TickRecord C struct format (88 bytes):
    # int64_t tick_id;       (8 bytes)
    # double bid_price;      (8)
    # double ask_price;      (8)
    # double mid_price;      (8)
    # double fair_value;     (8)
    # double spread;         (8)
    # double volatility;     (8)
    # double bid_vol;        (8)
    # double ask_vol;        (8)
    # double last_trade_px;  (8)
    # double is_news_flag;   (8)
    record_struct = struct.Struct('<q10d')
    
    records = []
    
    with open(csv_path, 'r') as f:
        reader = csv.reader(f, delimiter=';')
        # Skip header
        next(reader, None)
        
        tick_id = 0
        for row in reader:
            if not row or len(row) < 16:
                continue
            
            # Extract basic data
            bid_price = float(row[3])
            bid_vol = float(row[4])
            ask_price = float(row[9])
            ask_vol = float(row[10])
            mid_price = float(row[15])
            
            fair_value = mid_price
            spread = ask_price - bid_price
            volatility = 0.0005 * mid_price # Approximate if not available
            last_trade_px = mid_price
            is_news_flag = 0.0
            
            # Pack record
            packed = record_struct.pack(
                tick_id, bid_price, ask_price, mid_price, fair_value,
                spread, volatility, bid_vol, ask_vol, last_trade_px, is_news_flag
            )
            records.append(packed)
            tick_id += 1
            
    # Write to bin file
    os.makedirs(os.path.dirname(bin_path), exist_ok=True)
    with open(bin_path, 'wb') as f:
        # VIDHI\0\0\0 header (8 bytes) + num_ticks (8 bytes)
        f.write(b'VIDHI\0\0\0')
        f.write(struct.pack('<q', len(records)))
        
        # Write all records
        for rec in records:
            f.write(rec)

def generate_csv(filename, ticks, start_price=1500.0, volatility=0.0005):
    filepath = os.path.join(os.path.dirname(__file__), '..', '..', 'datasets', filename)
    print("Writing to", filepath)
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

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Vidhi Dataset Generator/Converter")
    parser.add_argument("--csv", help="Input CSV file to convert")
    parser.add_argument("--out", help="Output BIN file")

    args = parser.parse_args()

    if args.csv and args.out:
        print(f"Converting CSV {args.csv} to BIN {args.out}...")
        convert_csv_to_bin(args.csv, args.out)
        print("Conversion complete.")
    else:
        print("Generating contest mock datasets...")
        # Round 1 items
        generate_csv("earth_fruit_test.csv", 100000, start_price=100.0)
        generate_csv("mars_banana_test.csv", 100000, start_price=250.0)
        generate_csv("moon_peanut_test.csv", 100000, start_price=150.0)
        generate_csv("earth_fruit_final.csv", 1000000, start_price=100.0)
        generate_csv("mars_banana_final.csv", 1000000, start_price=250.0)
        generate_csv("moon_peanut_final.csv", 1000000, start_price=150.0)
        
        # Round 2 items
        generate_csv("grass_cane_test.csv", 100000, start_price=75.0)
        generate_csv("mango_test.csv", 100000, start_price=180.0)
        generate_csv("grass_cane_final.csv", 1000000, start_price=75.0)
        generate_csv("mango_final.csv", 1000000, start_price=180.0)
