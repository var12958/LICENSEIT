import os
import json
import urllib.request
import urllib.error
from typing import Optional, Dict, Any

class LicenseAccessDeniedError(Exception):
    """Raised when LicenNode refuses data access based on policy rules."""
    def __init__(
        self,
        reason: str,
        event_type: str = "POLICY_VIOLATION",
        account_status: str = "ACTIVE",
        violation_count: int = 0,
        action: str = "ACCESS_BLOCKED",
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(reason)
        self.reason = reason
        self.event_type = event_type
        self.account_status = account_status
        self.violation_count = violation_count
        self.action = action
        self.details = details or {}

    def __str__(self):
        return (
            f"\n[LicenNode ACCESS DENIED]\n"
            f"  Reason: {self.reason}\n"
            f"  Event Type: {self.event_type}\n"
            f"  Action Taken: {self.action}\n"
            f"  Account Status: {self.account_status} (violations: {self.violation_count})\n"
        )


class Dataset:
    """
    Controlled dataset handle returned by LicenNode upon verified authorization.
    """

    def __init__(
        self,
        blob_name: str,
        content_bytes: bytes,
        receipt: Dict[str, Any],
        license_meta: Dict[str, Any],
        receipt_tx_hash: str,
        explorer_url: str,
    ):
        self.blob_name = blob_name
        self._bytes = content_bytes
        self.receipt = receipt
        self.license = license_meta
        self.receipt_tx_hash = receipt_tx_hash
        self.explorer_url = explorer_url

    @property
    def bytes(self) -> bytes:
        return self._bytes

    @property
    def text(self) -> str:
        return self._bytes.decode("utf-8", errors="replace")

    @property
    def merkle_root(self) -> str:
        return self.receipt.get("merkleRoot", "")

    def preview(self, max_lines: int = 10) -> str:
        lines = self.text.splitlines()[:max_lines]
        return "\n".join(lines)

    def to_dataframe(self):
        """Loads dataset into pandas DataFrame if pandas is installed."""
        try:
            import pandas as pd
            import io
            return pd.read_csv(io.StringIO(self.text))
        except ImportError:
            raise ImportError(
                "pandas is required for to_dataframe(). Install it with: pip install pandas"
            )

    @classmethod
    def load(
        cls,
        blob_name: str,
        purpose: str = "training",
        reader_id: Optional[str] = None,
        organization_id: Optional[str] = None,
        training_run_id: Optional[str] = None,
        api_url: Optional[str] = None,
    ) -> "Dataset":
        """
        Request authorized dataset access from LicenNode.

        Parameters:
            blob_name: Target blob name in Shelby manifest.
            purpose: Requested operation ('training', 'inference', etc.)
            reader_id: User/developer ID (defaults to LICENNODE_READER_ID or 'Varun.v1')
            organization_id: Organization ID (defaults to LICENNODE_ORG_ID or 'Example AI Labs')
            training_run_id: Run identifier (defaults to LICENNODE_RUN_ID or 'sentiment.v1')
            api_url: LicenNode API URL (defaults to LICENNODE_API_URL or 'http://localhost:8787')

        Returns:
            Dataset object with validated bytes, Merkle root, and Aptos receipt.

        Raises:
            LicenseAccessDeniedError: If license expired, user unauthorized, or operation forbidden.
        """
        reader = reader_id or os.environ.get("LICENNODE_READER_ID", "Varun.v1")
        org = organization_id or os.environ.get("LICENNODE_ORG_ID", "Example AI Labs")
        run_id = training_run_id or os.environ.get("LICENNODE_RUN_ID", "sentiment.v1")
        base_url = (api_url or os.environ.get("LICENNODE_API_URL", "http://localhost:8787")).rstrip("/")

        endpoint = f"{base_url}/api/access/request"
        payload = {
            "blobName": blob_name,
            "readerId": reader,
            "organizationId": org,
            "trainingRunId": run_id,
            "operation": purpose.upper(),
        }

        req = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode("utf-8"))

                # In HTTP responses, text or base64 data is returned
                content_raw = data.get("data")
                if isinstance(content_raw, str):
                    if data.get("isText", True):
                        content_bytes = content_raw.encode("utf-8")
                    else:
                        import base64
                        content_bytes = base64.b64decode(content_raw)
                else:
                    content_bytes = b""

                return cls(
                    blob_name=blob_name,
                    content_bytes=content_bytes,
                    receipt=data.get("receipt", {}),
                    license_meta=data.get("license", {}),
                    receipt_tx_hash=data.get("receiptLogTransactionHash", ""),
                    explorer_url=data.get("explorerUrl", ""),
                )

        except urllib.error.HTTPError as err:
            body_str = err.read().decode("utf-8", errors="replace")
            try:
                err_json = json.loads(body_str)
                violation = err_json.get("violation", {})
                raise LicenseAccessDeniedError(
                    reason=err_json.get("error") or err_json.get("reason") or "Access Denied",
                    event_type=violation.get("eventType") or "POLICY_VIOLATION",
                    account_status=err_json.get("accountStatus", "ACTIVE"),
                    violation_count=err_json.get("violationCount", 1),
                    action=violation.get("action", "ACCESS_BLOCKED"),
                    details=err_json,
                ) from err
            except json.JSONDecodeError:
                raise LicenseAccessDeniedError(f"HTTP {err.code}: {body_str}") from err
