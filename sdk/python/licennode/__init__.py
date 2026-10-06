"""
LicenNode Python SDK - Active Licensed Data Access Layer for AI/ML.

Controlled access client for training and inference pipelines.
Enforces license policy, organization permissions, expiry, and Merkle verification
before returning dataset bytes anchored on Aptos and Shelby.
"""

from .dataset import Dataset, LicenseAccessDeniedError

__version__ = "0.1.0"
__all__ = ["Dataset", "LicenseAccessDeniedError"]
