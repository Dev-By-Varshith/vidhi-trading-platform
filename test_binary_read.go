package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
)

func main() {
	buf := make([]byte, 80)
	var row struct {
		TickID     int64
		PnLFP      int64
		Pos        int64
		LatP50     int64
		LatP99     int64
		BidPrice   float64
		AskPrice   float64
		Spread     float64
		LastTrade  float64
		FillCount  int32
		Pad        [4]byte
	}
	reader := bytes.NewReader(buf)
	err := binary.Read(reader, binary.LittleEndian, &row)
	fmt.Printf("err: %v\n", err)
}
