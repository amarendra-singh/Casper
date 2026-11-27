"""Read-only audit reproductions. Run with backend/env/Scripts/python.exe.

Calls schemas and pure service builders, plus an in-memory recording adapter.
Does not connect to Casper's database, HTTP endpoints, or browser.
"""

import asyncio
import json
from pathlib import Path
import sys
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.schemas.platform import PlatformCreate, PlatformTierCreate
from app.services.action_pipeline import build_action_pipeline
from app.services.fraud import compute_actor_risk_profiles
from app.services.operations import build_operations
from app.services.reconciliation import build_reconciliation


class RecordingSession:
    def __init__(self, grouped_rows):
        self.grouped_rows = grouped_rows
        self.added = []

    async def execute(self, _statement):
        return SimpleNamespace(all=lambda: self.grouped_rows)

    def add(self, row):
        self.added.append(row)

    async def commit(self):
        pass


async def main():
    invalid_platform = PlatformCreate(
        name="", cr_charge=-100, cr_percentage=150,
        default_ad_pct=-5, target_monthly_units=0,
    )
    invalid_tier = PlatformTierCreate(tier_name="", fee=-10, fee_pct=150)
    operations = build_operations({}, {
        "gross_sales": 1000, "commission": 150,
        "total_expenses": -100, "bank_settlement": 900,
    }, [], [])
    displayed_bridge = operations["fees"][0]["value"] - sum(
        row["value"] for row in operations["fees"] if row["kind"] == "neg"
    )
    reconciliation = build_reconciliation([], [{
        "sku": "AUDIT-ONLY", "platform": "Example", "net_units": 10,
        "expected_bs_per_unit": 120, "actual_bs_total": 1000,
    }])
    actor = {
        "actor_key": "state-reason-cohort", "state_name": "Example state",
        "dominant_reason": "QUALITY", "fraud_signal_type": "FRAUD_SIGNAL",
        "risk_tier": "CRITICAL", "total_orders": 5, "return_count": 5,
        "fraud_reason_count": 5, "actor_fraud_score": 90,
    }
    pipeline = build_action_pipeline([actor])
    grouped_rows = [SimpleNamespace(
        customer_state_name="Example state", return_reason="QUALITY",
        fraud_signal_type=signal, total_orders=5, return_count=5,
        fraud_reason_count=count, avg_velocity=2,
    ) for signal, count in [("FRAUD_SIGNAL", 5), ("NON_FRAUD", 0)]]
    recorder = RecordingSession(grouped_rows)
    await compute_actor_risk_profiles(recorder, company_id=999999)
    keys = [row.actor_key for row in recorder.added]
    evidence = {
        "scope": "synthetic service inputs only; no live data or UI accessed",
        "platform_validation": invalid_platform.model_dump(),
        "tier_validation": invalid_tier.model_dump(),
        "waterfall": {
            "displayed_bridge": displayed_bridge,
            "reported_settlement": operations["summary"]["settlement"],
            "imbalance": operations["summary"]["settlement"] - displayed_bridge,
        },
        "target_shortfall_labelled_recoverable": reconciliation["summary"]["recoverable"],
        "cohort_action": pipeline["queue"][0]["action"],
        "recovery_without_order_values": pipeline["summary"]["est_recovery"],
        "different_signal_groups_receive_same_unique_actor_key": {
            "keys": keys, "duplicate": len(keys) != len(set(keys)),
            "note": "Real service with recording adapter; database rejection inferred from unique constraint.",
        },
    }
    assert evidence["waterfall"]["imbalance"] == 50
    assert evidence["target_shortfall_labelled_recoverable"] == 200
    assert evidence["cohort_action"] == "BLOCK"
    assert evidence["recovery_without_order_values"] == 3000
    assert evidence["different_signal_groups_receive_same_unique_actor_key"]["duplicate"]
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
