"""
Vercel serverless entrypoint.

Vercel's @vercel/python runtime serves the ASGI `app` exported here. The
project root for the Vercel deployment is `backend/`, so `app.main` is
importable directly. All routes (mounted under /api/v1) are handled by FastAPI.
"""
import os
import sys

# Ensure the backend package root is importable regardless of CWD.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app  # noqa: E402  — re-exported for the Vercel runtime

# `app` is the ASGI application Vercel will serve.
