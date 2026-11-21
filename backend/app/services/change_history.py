"""Capture ORM financial writes in their own transaction, excluding personal text.

Bulk SQL and writes made outside Casper must provide their own history. These
hooks preserve source IDs after deletion and never expose a mutation API.
"""

from datetime import date, datetime
from sqlalchemy import event, inspect, insert
from sqlalchemy.orm import Session
from app.models.audit import FinancialChange

TRACKED = {
    "vendor_name_aliases",
    "invoice_receipts",
    "marketplace_sku_aliases",
    "sku_pricing",
    "sku_platform_config",
    "purchase_bills",
    "purchase_bill_lines",
    "invoices",
    "invoice_lines",
    "ledger_entries",
}
EXCLUDED = {
    "customer_name",
    "customer_gstin",
    "notes",
    "description",
    "party_name",
    "bank_name",
    "created_at",
    "updated_at",
}


def _value(value):
    return value.isoformat() if isinstance(value, (date, datetime)) else value


@event.listens_for(Session, "before_flush")
def capture_changes(session, _context, _instances):
    pending = session.info.setdefault("financial_history_pending", [])
    for obj in list(session.new) + list(session.dirty) + list(session.deleted):
        if isinstance(obj, FinancialChange):
            if obj in session.deleted or (obj in session.dirty and session.is_modified(obj)):
                raise ValueError("Financial history is append-only")
            continue
        if getattr(obj, "__tablename__", None) not in TRACKED:
            continue
        if obj in session.dirty and not session.is_modified(obj, include_collections=False):
            continue
        state = inspect(obj)
        after = {
            col.key: _value(getattr(obj, col.key)) for col in state.mapper.columns if col.key not in EXCLUDED
        }
        before = dict(after)
        for key in before:
            history = state.attrs[key].history
            if history.deleted:
                before[key] = _value(history.deleted[0])
        action = "create" if obj in session.new else "delete" if obj in session.deleted else "update"
        company_id = getattr(obj, "company_id", None)
        # Child lines inherit scope from the parent; parent history also records totals.
        if company_id is None:
            parent = (
                getattr(obj, "invoice", None)
                or getattr(obj, "bill", None)
                or getattr(obj, "sku_pricing", None)
            )
            company_id = getattr(parent, "company_id", None)
        if company_id is None:
            continue
        pending.append(
            (
                obj,
                {
                    "company_id": company_id,
                    "actor_id": session.info.get("actor_id"),
                    "entity_type": obj.__tablename__,
                    "entity_id": getattr(obj, "id", None),
                    "action": action,
                    "before": None if action == "create" else before,
                    "after": None if action == "delete" else after,
                },
            )
        )


@event.listens_for(Session, "after_flush_postexec")
def persist_changes(session, _context):
    records = []
    for obj, record in session.info.pop("financial_history_pending", []):
        record["entity_id"] = obj.id
        if record["after"] is not None:
            record["after"] = {key: _value(getattr(obj, key)) for key in record["after"]}
        records.append(record)
    if records:
        # Use the same connection and transaction; rollback removes history too.
        session.connection().execute(insert(FinancialChange.__table__), records)


@event.listens_for(Session, "after_soft_rollback")
def discard_pending_history(session, _previous_transaction):
    session.info.pop("financial_history_pending", None)
