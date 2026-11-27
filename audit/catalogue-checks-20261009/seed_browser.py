"""Synthetic catalogue only; run against the disposable 8766 API."""
import httpx

base = "http://127.0.0.1:8766/api/v1"
with httpx.Client(base_url=base, timeout=20) as c:
    auth = c.post("/auth/register", json={
        "name": "Catalogue QA", "email": "catalogue-qa@example.com",
        "password": "Synthetic-QA-2026!", "company_name": "Catalogue QA"})
    auth.raise_for_status()
    info = auth.json()
    c.headers.update({"Authorization": f"Bearer {info['access_token']}",
                      "X-Company-Id": str(info["companies"][0]["id"])})
    platform = c.post("/platforms/", json={
        "name": "Synthetic Market", "cr_charge": 50, "cr_percentage": 10})
    platform.raise_for_status()
    ids = {}
    for code, vendor_code in [
        ("QA-GLASS-P1", "VEND-GLASS"),
        ("QA-GLASS-P2", "VEND-GLASS-2"),
        ("QA-GLASS-P6", "VEND-GLASS-6"),
    ]:
        response = c.post("/skus/", json={
            "shringar_sku": code, "vendor_sku": vendor_code,
            "description": "Synthetic glass for catalogue QA"})
        response.raise_for_status()
        ids[code] = response.json()["id"]
    item = c.post("/catalogue/stock-items", json={
        "name": "QA shared glass", "base_unit": "piece"})
    item.raise_for_status()
    for code, pack in [("QA-GLASS-P1", 1), ("QA-GLASS-P2", 2), ("QA-GLASS-P6", 6)]:
        response = c.post(f"/catalogue/{ids[code]}/stock-link",
                          json={"stock_item_id": item.json()["id"], "base_units_per_sku": pack})
        response.raise_for_status()
    print({"company_id": info["companies"][0]["id"], "sku_ids": ids,
           "stock_item_id": item.json()["id"]})
