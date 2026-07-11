# BharatTruck Pricing Engine — Platform Module (v1.2)

Self-contained RL pricing microservice. Quotes any cargo load inside an operational cost-floor / target-market / ceiling band, recommends a price via a 16-feature LinUCB contextual bandit, and **learns online** from live accept/reject feedback.

Version 1.2 transitions the training architecture from simulator-driven pretraining to **historical-data-driven offline training** on chronological data splits, using unbiased features and dynamic baseline calibrators.

---

## Detailed Project Manuals

For in-depth explanations, refer to the following documents inside the `docs/` folder:

1.  **[System Architecture & File Blueprint](docs/architecture.md):** Maps the 3-layer architecture, operational components (cost floor, dynamic market baseline, RL snapping), and describes the role and directory path of every file.
2.  **[Model Choices & Learning Theory](docs/model_choices.md):** Outlines the mathematical rationale for choosing LinUCB Contextual Bandits, Sherman-Morrison updates, policy convergence diagnostics, and feature importance rankings.
3.  **[Operations Run Book](docs/run_book.md):** Complete step-by-step commands to install dependencies, train the model, tune parameters, run benchmarks, execute tests, and launch the engineering dashboard.

---

## Quick-Start Commands (From `ml-engine/` Directory)

### 1. Ingest Data & Train Model
```bash
# Ingest Excel logs and run pipeline checks
python pipeline/verify_features.py

# Train the model and save agent_state.npz
python pipeline/offline_train.py --lambda 5.0
```

### 2. Run Diagnostics & Benchmarks
```bash
# Evaluate model predictions, confusion matrix, and feature importances
python diagnostics/diagnose_model.py

# Generate diagnostic charts (saved in artifacts/)
python diagnostics/generate_visualizations.py

# Benchmark LinUCB against rule-based, static, and historical policies
python diagnostics/benchmark.py
```

### 3. Run Verification Tests & Launch Service
```bash
# Execute automated test suite
python tests/test_suite.py

# Start the FastAPI API microservice
uvicorn service:app --host 0.0.0.0 --port 8090
```
Open **`http://localhost:8090/`** in your browser to access the dynamic Engineering Console dashboard.
