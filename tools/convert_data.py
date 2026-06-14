import struct
import sys
import os
import argparse
import csv

# The struct format matches price_signal.hpp exactly:
# #pragma pack(push, 1)
# struct TickRecord {
#     int64_t tick_id;
#     double  bid_price;
#     double  ask_price;
#     double  mid_price;
#     double  fair_value;
#     double  spread;
#     double  volatility;
#     double  bid_vol;
#     double  ask_vol;
#     double  last_trade_px;
#     double  is_news_flag;
# };
# #pragma pack(pop)
# Format: little-endian (<), int64 (q), 10 x double (d)
TICK_RECORD_FORMAT = '<q10d'
TICK_RECORD_BYTES = struct.calcsize(TICK_RECORD_FORMAT)

def compile_csv_to_vidhi(csv_path: str, out_path: str):
    """
    Compiles a CSV with market data into the Vidhi zero-copy mmap binary format.
    The binary format is:
      - 8 bytes: Magic string "VIDHI\0\0\0"
      - 8 bytes: int64 number of ticks (N)
      - N * 88 bytes: Array of TickRecord structs
    """
    print(f"Compiling {csv_path} to {out_path}...")
    
    records = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            # Parse row with fallbacks to defaults
            tick_id = int(row.get('tick_id', i))
            bid_price = float(row.get('bid_price', 1500.0))
            ask_price = float(row.get('ask_price', 1500.0))
            mid_price = float(row.get('mid_price', (bid_price + ask_price) / 2.0))
            fair_value = float(row.get('fair_value', mid_price))
            spread = float(row.get('spread', ask_price - bid_price))
            volatility = float(row.get('volatility', 0.0003))
            bid_vol = float(row.get('bid_vol', 100.0))
            ask_vol = float(row.get('ask_vol', 100.0))
            last_trade_px = float(row.get('last_trade_px', mid_price))
            is_news_flag = float(row.get('is_news_flag', 0.0))
            
            # Pack into binary
            packed = struct.pack(
                TICK_RECORD_FORMAT,
                tick_id, bid_price, ask_price, mid_price, fair_value,
                spread, volatility, bid_vol, ask_vol, last_trade_px, is_news_flag
            )
            records.append(packed)

    n_ticks = len(records)
    print(f"Loaded {n_ticks} records. Writing binary...")

    with open(out_path, 'wb') as f:
        # Write header
        magic = b"VIDHI\0\0\0"
        f.write(magic)
        f.write(struct.pack('<q', n_ticks))
        
        # Write records
        for rec in records:
            f.write(rec)

    file_size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"Success! Generated {out_path} ({file_size_mb:.2f} MB)")
    print(f"Loaded {n_ticks} ticks. Ready for mmap.")

def main():
    parser = argparse.ArgumentParser(description="Vidhi CSV to Binary Compiler")
    parser.add_argument("csv_path", help="Path to input CSV file")
    parser.add_argument("out_path", help="Path to output .vidhi binary file")
    args = parser.parse_args()

    compile_csv_to_vidhi(args.csv_path, args.out_path)

if __name__ == "__main__":
    main()
