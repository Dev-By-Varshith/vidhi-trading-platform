// game-master/position_limits.hpp
#pragma once
#include <cstdint>

// Branchless hard limit enforcer
// Avoids pipeline stalls by using bitwise mask logic instead of branches.
inline int64_t enforce_position_limit_branchless(int64_t current_pos, int64_t attempted_delta, int64_t limit) {
    int64_t new_pos = current_pos + attempted_delta;
    
    // Create a mask: all 1s if new_pos > limit, else 0s
    int64_t over_mask = -((new_pos > limit) ? 1 : 0);
    
    // Create a mask: all 1s if new_pos < -limit, else 0s
    int64_t under_mask = -((new_pos < -limit) ? 1 : 0);
    
    // Create a mask: all 1s if within limits, else 0s
    int64_t within_mask = ~(over_mask | under_mask);
    
    // Branchless selection
    return (limit & over_mask) | (-limit & under_mask) | (new_pos & within_mask);
}
