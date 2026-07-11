"""
offline_train.py — Phase 2: Offline LinUCB Training Pipeline for BharatTruck.

PURPOSE
-------
This script replaces the simulator-driven pretraining pipeline with a
historical-data-driven training pipeline using the BharatTruck Excel dataset.
It trains the LinUCB contextual bandit using offline replay, evaluates the
policy against historical quotes on a chronological validation set, and
persists the learned statistics to `agent_state.npz`.

THEORY & LEARNING RESOURCE
--------------------------
To understand how the LinUCB contextual bandit learns and quotes, we break
down the mathematical intuition behind the training pipeline:

1. **How the Historical Multiplier Becomes an Action:**
   We calculate the historical multiplier for each booking as:
       multiplier = Quoted Price / Market Price
   We then snap this continuous value to the nearest discrete action in our
   production action space:
       ACTIONS = [0.90, 0.94, 0.98, 1.02, 1.06, 1.12, 1.20]
   This discretization maps the historical pricing analyst's decision into
   one of the 7 choices the agent is allowed to make. Snapping behaves as:
       action_index = argmin(|ACTIONS - multiplier|)

2. **Why Only One Action is Updated:**
   In Contextual Bandits, we operate under "partial feedback" (bandit feedback).
   We only observe the outcome (reward) for the action `a` that was actually
   taken (the arm pulled). We do not know what reward would have occurred if
   we had chosen a different price multiplier. Thus, we only update the
   ridge regression matrices for that specific action `a` (i.e., `A[a]` and `b[a]`).
   The parameters for the other actions remain untouched.

3. **What A Represents:**
   For each action `a`, `A[a]` is a (d x d) matrix representing the L2-regularized
   covariance matrix of the context vectors `x` observed when action `a` was pulled:
       A_a = Sum_{t} (x_t x_t^T) + lambda * I
   It summarizes the feature variations we've explored under this action.
   Its inverse `A_inv[a]` acts as a measure of uncertainty: directions in the
   feature space with little data will have high variance, producing larger
   exploration bonuses.

4. **What b Represents:**
   For each action `a`, `b[a]` is a (d,) vector representing the reward-weighted
   sum of the context vectors `x` observed when action `a` was pulled:
       b_a = Sum_{t} (r_t * x_t)

5. **Why theta = A_inv * b:**
   We model the expected reward of action `a` as a linear function of the context:
       E[r | x, a] = theta_a^T * x
   Solving for the parameter vector `theta_a` using Ridge Regression yields
   the classic closed-form ordinary least squares (OLS) solution:
       theta_a = (X_a^T * X_a + lambda * I)^-1 * X_a^T * Y_a = A_a^-1 * b_a

6. **How the Sherman–Morrison Update Works:**
   Inverting a (d x d) matrix `A_a` directly is computationally expensive,
   requiring O(d^3) time. Because each training sample updates `A_a` by a
   rank-one matrix addition (`A_a += x x^T`), we can update the inverse
   `A_inv_a` directly in O(d^2) time using the Sherman-Morrison formula:
       (A + u v^T)^-1 = A^-1 - (A^-1 u v^T A^-1) / (1 + v^T A^-1 u)
   Substituting `u = v = x` gives:
       A_inv_a -= (A_inv_a x x^T A_inv_a) / (1.0 + x^T A_inv_a x)
   This incremental update is calculated in `rl_agent.py` line 50.

7. **Why Saving A, b, and A_inv is Sufficient:**
   These matrices represent the "sufficient statistics" of the model.
   They capture all the historical information needed to solve the ridge
   regression. We do not need to keep the original training rows; saving
   these summary matrices is sufficient to recreate the policy.

8. **How service.py Loads the Model to Generate Live Quotes:**
   At startup, `service.py` loads `A`, `b`, and `A_inv` from `agent_state.npz`.
   For each quote request:
     1. It builds the 16-feature context vector `x`.
     2. For each action `a`, it computes the predicted score:
            theta_a = A_inv[a] @ b[a]
            mu = theta_a @ x
            bonus = alpha * sqrt(x @ A_inv[a] @ x)
            score = mu + bonus
     3. It selects the action `a` with the highest score.
     4. It applies the multiplier `ACTIONS[a]` to the market rate, clips it by
        the cost floor, and adds handling charges.

USAGE
-----
    python offline_train.py --alpha 0.35
    python offline_train.py --alpha 0.6 --path data/BharatTruck_Test_Dataset.xlsx
"""
from __future__ import annotations

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import argparse
import numpy as np
import pandas as pd

from dataset_loader import load_dataset
from feature_builder import build_state_matrix, build_state_vector, _market_rate, N_FEATURES
from rl_agent import ACTIONS, LinUCBAgent
from cto_engine import CTOEngine
import cto_data as D

# Production default alpha is 0.35 (defined in service.py L41)
DEFAULT_ALPHA = 0.35


# ---------------------------------------------------------------------------
# Business Objective Mapping
# ---------------------------------------------------------------------------
def compute_reward(row: pd.Series) -> float:
    """Compute reward based on historical acceptance outcome and margins.

    Formulation:
      If matched (both shipper and operator accepted):
        r = (0.04 * Quote + 0.25 * max(Margin, 0)) / 1000.0
      Otherwise:
        r = -0.05

    Alignment with Business Objectives:
      1. Platform Revenue: The 0.04 factor represents the platform's 4%
         commission on the final quote. The agent learns to maximize quote
         volume where feasible.
      2. Fleet Operator ROI: The 0.25 factor weights the operator's margin,
         training the policy to protect driver earnings.
      3. Shipper Competitiveness: The -0.05 penalty represents liquidity
         failure (unmatched orders). It prevents the agent from quoting
         unreasonably high prices, forcing it to find the win-win threshold.
    """
    matched = float(row["matched"])
    quoted_inr = float(row["quoted_inr"])
    margin_inr = float(row["margin_inr"])

    if matched == 1.0:
        return (0.04 * quoted_inr + 0.25 * max(margin_inr, 0.0)) / 1000.0
    else:
        return -0.05


# ---------------------------------------------------------------------------
# Pipeline Implementation
# ---------------------------------------------------------------------------
def train_offline(
    path: str | None = None,
    alpha: float = DEFAULT_ALPHA,
    lam: float = 1.0,
) -> None:
    """Execute the chronological training and validation pipeline."""
    # -- 1. Load Dataset --
    print("Loading cleaned historical dataset...")
    df, meta = load_dataset(path)
    
    # Sort chronologically to preserve time structure
    df = df.sort_values(by="date").reset_index(drop=True)
    total_rows = len(df)

    # -- 2. Chronological Split (approx 80% train / 20% val) --
    # Date-based split: Train on or before 2026-05-20, Validate on or after 2026-07-15
    train_mask = df["date"] <= pd.Timestamp("2026-05-20")
    val_mask = df["date"] >= pd.Timestamp("2026-07-15")

    df_train = df.loc[train_mask].reset_index(drop=True)
    df_val = df.loc[val_mask].reset_index(drop=True)

    n_train = len(df_train)
    n_val = len(df_val)

    if n_train == 0 or n_val == 0:
        print("ERROR: Chronological split resulted in an empty split.")
        print(f"Train mask matches {n_train} rows, Val mask matches {n_val} rows.")
        sys.exit(1)

    # -- 3. Chronological Split Sanity Summary --
    train_matched = int((df_train["matched"] == 1.0).sum())
    train_rejected = n_train - train_matched
    train_rewards = [compute_reward(r) for _, r in df_train.iterrows()]

    print("\n" + "=" * 50)
    print("  CHRONOLOGICAL DATASET SPLIT SUMMARY")
    print("=" * 50)
    print(f"  Total Cleaned Bookings: {total_rows}")
    print(f"  Training Bookings:      {n_train} ({n_train / total_rows * 100:.1f}%)")
    print(f"    - Matched:            {train_matched} ({train_matched / n_train * 100:.1f}%)")
    print(f"    - Rejected:           {train_rejected} ({train_rejected / n_train * 100:.1f}%)")
    print(f"    - Average Quote:      Rs. {df_train['quoted_inr'].mean():,.2f}")
    print(f"    - Average Margin:     Rs. {df_train['margin_inr'].mean():,.2f}")
    print(f"    - Average Reward:     {np.mean(train_rewards):.4f}")
    print(f"  Validation Bookings:    {n_val} ({n_val / total_rows * 100:.1f}%)")
    print(f"  Train/Val Split Date:   Between 2026-05-20 and 2026-07-15")
    print("=" * 50 + "\n")

    # -- 4. Historical Action Discretization --
    print("Mapping continuous historical multipliers to discrete actions...")
    
    # Map all training rows
    train_multipliers = df_train["quoted_inr"] / df_train["market_inr"]
    train_actions = []
    
    for mult in train_multipliers:
        a_idx = int(np.argmin(np.abs(ACTIONS - mult)))
        train_actions.append(a_idx)
        
    df_train["action_index"] = train_actions

    # Action distribution summary
    action_counts = np.bincount(train_actions, minlength=len(ACTIONS))
    print("\n--- Training Action Discretization Distribution ---")
    for a_idx, count in enumerate(action_counts):
        pct = count / n_train * 100
        print(f"  Action {a_idx} (mult={ACTIONS[a_idx]:.2f}): {count:4d} samples ({pct:.1f}%)")
    
    # Print examples of mapping
    print("\nMapping Examples:")
    sample_indices = np.linspace(0, n_train - 1, 5, dtype=int)
    for idx in sample_indices:
        row = df_train.iloc[idx]
        mult = row["quoted_inr"] / row["market_inr"]
        a_idx = int(row["action_index"])
        print(f"  Quote {row['quote_id']}: Mult {mult:.3f} -> Mapped Action {ACTIONS[a_idx]:.2f} (Index {a_idx})")
    print("-" * 50 + "\n")

    # -- 5. Offline Replay Training --
    print(f"Initializing LinUCBAgent (n_features=16, alpha={alpha}, lambda={lam})...")
    agent = LinUCBAgent(n_features=N_FEATURES, alpha=alpha, lam=lam)

    # Shuffling training rows to prevent order-autocorrelation bias
    shuffled_indices = np.random.permutation(n_train)
    
    print("Executing offline contextual bandit replay updates...")
    # NOTE: Bandit replay updates the matrices of the chosen action in a single epoch pass
    for i, idx in enumerate(shuffled_indices):
        row = df_train.iloc[idx]
        x = build_state_vector(row)
        a = int(row["action_index"])
        r = compute_reward(row)
        
        # update sufficient statistics (Sherman-Morrison inverse update happens internally)
        agent.update(x, a, r)
        
    print("Offline replay training complete.\n")

    # -- 6. Validation Evaluation --
    print("Evaluating learned policy on validation set...")
    val_metrics = []
    val_actions_predicted = []
    val_actions_historical = []

    for _, row in df_val.iterrows():
        # Build features
        x = build_state_vector(row)
        
        # Predict action (greedy=True representing exploitation)
        a_pred = agent.act(x, greedy=True)
        val_actions_predicted.append(a_pred)
        
        # Map historical action
        hist_mult = row["quoted_inr"] / row["market_inr"]
        a_hist = int(np.argmin(np.abs(ACTIONS - hist_mult)))
        val_actions_historical.append(a_hist)

        # Dynamic market calculation to rebuild the RL quote
        category = row["truck_category"]
        age = int(row["age"])
        diesel = float(row["diesel_price"])
        ds = float(row["ds_ratio"])
        km = float(row["dist_km"])
        monsoon = bool(row["monsoon"])
        harvest = bool(row["harvest"])
        handling = str(row["handling"])
        weight = float(row["weight_mt"])
        cargo_val = float(row["cargo_value_inr"])
        manual = bool(row["manual_loading"])
        
        seg = D.segment_of(category)
        handling_list = []
        if handling != "general" and handling != "nan":
            handling_list = [h.strip() for h in handling.split(",")]
        surcharge = sum(D.HANDLING[h]["surcharge"] for h in handling_list if h in D.HANDLING)
        surcharge_mult = 1.0 + surcharge
        
        market_dynamic = _market_rate(seg, km, diesel, ds, monsoon, harvest) * surcharge_mult
        
        # Calculate floor
        eng = CTOEngine(diesel_price=diesel)
        toll = 1.9 * km
        allowance = 600 + 0.45 * km
        floor = eng.trip_floor(category, age, km, toll, allowance, 0.0) # loading_inr = 0.0
        
        # Surcharge premiums
        risk_rate = max([D.HANDLING[h]["risk_rate"] for h in handling_list]
                        or [D.HANDLING["general"]["risk_rate"]])
        risk_premium = cargo_val * risk_rate
        flat_handling = D.MANUAL_LOADING_INR_PER_MT * weight if manual else 0.0
        flat_handling += D.ODC_PERMIT_FEE_INR if "odc" in handling_list else 0.0
        
        # Re-quote
        base_quote = max(market_dynamic * ACTIONS[a_pred], floor)
        rl_quote = base_quote + risk_premium + flat_handling
        
        # Compare metrics
        hist_quote = float(row["quoted_inr"])
        quote_diff = rl_quote - hist_quote
        pct_diff = (quote_diff / hist_quote) * 100.0
        
        # Margin comparison
        hist_direct = float(row["total_direct_cost"])
        rl_margin = rl_quote - (hist_direct + risk_premium + flat_handling)
        hist_margin = float(row["margin_inr"])
        margin_diff = rl_margin - hist_margin
        
        val_metrics.append({
            "hist_quote": hist_quote,
            "rl_quote": rl_quote,
            "hist_mult": ACTIONS[a_hist],
            "pred_mult": ACTIONS[a_pred],
            "quote_diff": quote_diff,
            "pct_diff": pct_diff,
            "margin_diff": margin_diff,
            "reward": compute_reward(row)
        })

    # Convert to DataFrame for summary statistics
    df_metrics = pd.DataFrame(val_metrics)
    mae = df_metrics["quote_diff"].abs().mean()
    mpe = df_metrics["pct_diff"].mean()
    avg_quote_diff = df_metrics["quote_diff"].mean()
    avg_margin_diff = df_metrics["margin_diff"].mean()

    # -- 7. Action Distribution Comparison --
    hist_dist = np.bincount(val_actions_historical, minlength=len(ACTIONS))
    pred_dist = np.bincount(val_actions_predicted, minlength=len(ACTIONS))

    # -- 8. Display 20 Random Validation Examples --
    print("\n" + "-" * 72)
    print(f"  RANDOM VALIDATION EXAMPLES INSPECTION (N = 20)")
    print("-" * 72)
    print(f"  {'Hist Quote':<12} {'RL Quote':<12} {'Hist Mult':<10} {'Pred Mult':<10} {'Diff':<10} {'Pct Diff':<10}")
    print("  " + "-" * 68)
    
    np.random.seed(11) # static seed for consistent output report
    val_indices = np.random.choice(n_val, min(20, n_val), replace=False)
    for v_idx in val_indices:
        m = val_metrics[v_idx]
        print(f"  Rs. {m['hist_quote']:<8.0f} Rs. {m['rl_quote']:<8.0f} "
              f"{m['hist_mult']:<10.2f} {m['pred_mult']:<10.2f} "
              f"Rs. {m['quote_diff']:<7.0f} {m['pct_diff']:+6.1f}%")
    print("-" * 72 + "\n")

    # -- 9. Save Model --
    # State file name matches production expectations
    state_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "../agent_state.npz"))
    np.savez(state_file, A=agent.A, b=agent.b, A_inv=agent.A_inv)

    # -- 10. Training Report --
    print("\n" + "=" * 55)
    print("  OFFLINE LINUCB TRAINING COMPLETE")
    print("=" * 55)
    print(f"  Training Samples:           {n_train}")
    print(f"  Validation Samples:         {n_val}")
    print("\n  Validation Performance:")
    print(f"    - Mean Absolute Error:    Rs. {mae:,.2f}")
    print(f"    - Mean Percentage Error:   {mpe:+.2f}%")
    print(f"    - Avg Quote Difference:   Rs. {avg_quote_diff:+,.2f}")
    print(f"    - Avg Margin Difference:  Rs. {avg_margin_diff:+,.2f}")
    
    print("\n  Action Space Distribution Comparison:")
    print(f"    {'Action Multiplier':<20} | {'Historical Count':<18} | {'Predicted Count'}")
    print("    " + "-" * 62)
    for a_idx, mult in enumerate(ACTIONS):
        hist_count = hist_dist[a_idx]
        pred_count = pred_dist[a_idx]
        hist_pct = hist_count / n_val * 100
        pred_pct = pred_count / n_val * 100
        print(f"    {mult:.2f}                 | {hist_count:4d} ({hist_pct:5.1f}%)     | {pred_count:4d} ({pred_pct:5.1f}%)")
        
    print(f"\n  Model Saved:                {state_file}")
    print("=" * 55 + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Offline LinUCB Contextual Bandit training using historical logs."
    )
    parser.add_argument(
        "--alpha",
        type=float,
        default=DEFAULT_ALPHA,
        help=f"Exploration parameter (default: {DEFAULT_ALPHA})",
    )
    parser.add_argument(
        "--path",
        default=None,
        help="Path to the Excel dataset file (auto-detected if omitted).",
    )
    args = parser.parse_args()

    train_offline(path=args.path, alpha=args.alpha)
