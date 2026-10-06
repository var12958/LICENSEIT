"""
LicenNode Developer Demo: VS Code & Python AI Training Pipeline

This script demonstrates active license enforcement:
1. Authorized training access (ALLOW -> Dataset served)
2. Unauthorized inference access (DENIED -> Access blocked)
3. Expired license access (DENIED -> Access blocked)
"""

import sys
import os
import time

# Add sdk/python to path so 'import licennode' works directly
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__))))

from licennode import Dataset, LicenseAccessDeniedError

def main():
    print("=" * 70)
    print("LICENNODE // AI/ML DEVELOPER ACCESS TERMINAL")
    print("=" * 70)

    # STEP 1: Authorized Training Request
    print("\n[STEP 1] AI Developer in VS Code requesting training dataset...")
    print(">>> from licennode import Dataset")
    print(">>> data = Dataset.load('customer-data-1mb.csv', purpose='training')")

    try:
        data = Dataset.load(
            blob_name="customer-data-1mb.csv",
            purpose="training",
            reader_id="Varun.v1",
            organization_id="Example AI Labs",
            training_run_id="sentiment.v1",
        )
        print("\n[SUCCESS] ACCESS GRANTED!")
        print(f"  Dataset: {data.blob_name}")
        print(f"  License: {data.license.get('licenseId')} ({data.license.get('rightsHolder')})")
        print(f"  Merkle Root: {data.merkle_root}")
        print(f"  Aptos Txn: {data.receipt_tx_hash}")
        print(f"  Content Size: {len(data.bytes)} bytes")
        print("\n  Data Preview (first 3 lines):")
        for line in data.text.splitlines()[:3]:
            print(f"    | {line}")

    except LicenseAccessDeniedError as e:
        print(f"[DENIED] Access unexpectedly denied: {e}")
    except Exception as e:
        print(f"Notice: LicenNode API server not running locally yet ({e}).")

    # STEP 2: Unauthorized Inference Request
    time.sleep(1)
    print("\n" + "=" * 70)
    print("[STEP 2] Developer attempting INFERENCE on training-only dataset...")
    print(">>> data = Dataset.load('customer-data-1mb.csv', purpose='inference')")

    try:
        data = Dataset.load(
            blob_name="customer-data-1mb.csv",
            purpose="inference",
            reader_id="Varun.v1",
            organization_id="Example AI Labs",
            training_run_id="inference.v1",
        )
        print("FAIL: Access should have been denied!")
    except LicenseAccessDeniedError as e:
        print("[BLOCKED] ACCESS DENIED BY POLICY ENGINE (Fail-Closed)")
        print(f"  Reason: {e.reason}")
        print(f"  Event: {e.event_type}")
        print(f"  Action: {e.action}")
        print(f"  Account Status: {e.account_status}")
    except Exception as e:
        print(f"Notice: LicenNode API server not running locally yet ({e}).")

    # STEP 3: Expired Dataset Request
    time.sleep(1)
    print("\n" + "=" * 70)
    print("[STEP 3] Developer requesting EXPIRED dataset...")
    print(">>> data = Dataset.load('expired-dataset.txt', purpose='training')")

    try:
        data = Dataset.load(
            blob_name="expired-dataset.txt",
            purpose="training",
            reader_id="Varun.v1",
            training_run_id="expired-run.v1",
        )
        print("FAIL: Access should have been denied!")
    except LicenseAccessDeniedError as e:
        print("[BLOCKED] ACCESS DENIED BY POLICY ENGINE (Fail-Closed)")
        print(f"  Reason: {e.reason}")
        print(f"  Event: {e.event_type}")
    except Exception as e:
        print(f"Notice: LicenNode API server not running locally yet ({e}).")

    print("\n" + "=" * 70)
    print("DEMO COMPLETE // LicenNode actively protected datasets.")
    print("=" * 70)

if __name__ == "__main__":
    main()
